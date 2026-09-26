import { useId, useMemo, useState, type FormEvent } from 'react'
import type { ReactNode } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { categoryIdFromInput, categoryLabel, LEDGER_CATEGORIES } from '../../constants/categories'
import { useAppStore } from '../../store/useAppStore'
import type {
  FinancialItem,
  LedgerKind,
  LedgerOwner,
  ProfileMonthlyResult,
  SavingsGoal,
  Scenario,
  ScenarioId,
} from '../../types'
import { intlLocale, translateMessage } from '../../i18n'
import { currentLocalYearMonth, isYearMonth } from '../../routes/monthQuery'
import { calculateSettlement } from '../../utils/calculations'
import { buildMonthlyForecast } from '../../utils/forecast'
import { FinancialItemSchema, SavingsGoalSchema } from '../../validation/schemas'
import {
  buildCashFlowTimeline,
  buildCategoryProjectionChanges,
  buildUpcomingPlannedChanges,
} from './planningData'
import type { CashFlowDay, CategoryProjectionChange, PlannedChange } from './planningData'

type ForecastHorizon = 6 | 12 | 24

interface SafeResult<T> {
  value: T | null;
  error: string | null;
}

interface ItemDraft {
  kind: LedgerKind;
  ownerId: string;
  name: string;
  amount: string;
  category: string;
  frequency: 'once' | 'monthly' | 'quarterly' | 'yearly';
  startDate: string;
  endDate: string;
}

interface WhatIfItem {
  owner: LedgerOwner;
  kind: LedgerKind;
  item: FinancialItem;
}

interface GoalDraft {
  id: string | null;
  name: string;
  target: string;
  saved: string;
  targetDate: string;
}

const inputClassName = 'min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const buttonClassName = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClassName = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50'

function safeCalculate<T>(calculate: () => T): SafeResult<T> {
  try {
    return { value: calculate(), error: null }
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : 'Rato could not calculate this view.' }
  }
}

function createCurrencyFormatter(currencyCode: string, locale: string): (cents: number) => string {
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode })
    return (cents) => formatter.format(cents / 100)
  } catch {
    const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return (cents) => `${currencyCode} ${formatter.format(cents / 100)}`
  }
}

function formatAmountInput(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

function parseAmountToCents(value: string, allowNegative = false): { cents: number } | { error: string } {
  const normalized = value.trim().replace(',', '.')
  const pattern = allowNegative ? /^-?(\d+)(?:\.(\d{1,2}))?$/ : /^(\d+)(?:\.(\d{1,2}))?$/
  const match = pattern.exec(normalized)
  if (!match) return { error: 'Enter a non-negative amount with up to two decimal places.' }
  const whole = match[1]
  if (whole === undefined) return { error: 'Enter a valid amount.' }
  const fraction = match[2] ?? ''
  const sign = allowNegative && normalized.startsWith('-') ? -1 : 1
  const cents = sign * Number(`${whole}${fraction.padEnd(2, '0')}`)
  if (!Number.isSafeInteger(cents)) return { error: 'Amount is too large to store safely.' }
  return { cents }
}

function monthDate(value: string): Date {
  const [year, month] = value.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year ?? 0, (month ?? 1) - 1, 1)
  date.setHours(12, 0, 0, 0)
  return date
}

function formatMonth(value: string, locale: string, short = false): string {
  return new Intl.DateTimeFormat(locale, short
    ? { month: 'short', year: 'numeric' }
    : { month: 'long', year: 'numeric' }).format(monthDate(value))
}

function formatDate(value: string, locale: string): string {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

function monthOffset(left: string, right: string): number {
  const [leftYear, leftMonth] = left.split('-').map(Number)
  const [rightYear, rightMonth] = right.split('-').map(Number)
  return ((rightYear ?? 0) - (leftYear ?? 0)) * 12 + ((rightMonth ?? 1) - (leftMonth ?? 1))
}

function signedCurrency(cents: number, formatCurrency: (amount: number) => string): string {
  if (cents > 0) return `+${formatCurrency(cents)}`
  if (cents < 0) return `−${formatCurrency(Math.abs(cents))}`
  return formatCurrency(0)
}

function ErrorNotice({ message }: { message: string }) {
  return <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">{message}</p>
}

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6" aria-label={title}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm leading-5 text-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function ScenarioSettlement({
  scenario,
  month,
  formatCurrency,
}: {
  scenario: Scenario;
  month: string;
  formatCurrency: (cents: number) => string;
}) {
  const { t } = useTranslation()
  const result = safeCalculate(() => calculateSettlement(scenario, month))
  if (!result.value) return <ErrorNotice message={t('Settlement could not be calculated: {{error}}', { error: translateMessage(result.error ?? '', t) })} />
  const settlement = result.value
  return (
    <article className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold">{scenario.name}</h3>
        <div className="text-right">
          <p className="text-xs text-muted">{t('Net joint cost')}</p>
          <p className="font-semibold tabular-nums">{formatCurrency(settlement.netJointCostCents)}</p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
        <div><dt className="text-muted">{t('Joint income')}</dt><dd className="mt-0.5 font-medium tabular-nums">{formatCurrency(settlement.jointIncomeCents)}</dd></div>
        <div><dt className="text-muted">{t('Joint expenses')}</dt><dd className="mt-0.5 font-medium tabular-nums">{formatCurrency(settlement.jointExpenseCents)}</dd></div>
      </dl>
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        {scenario.participantIds.map((profileId) => {
          const profile = scenario.profiles[profileId]
          const amount: ProfileMonthlyResult | undefined = settlement.byProfile[profileId]
          if (!profile || !amount) return null
          return (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm" key={profileId}>
              <span className="font-medium">{profile.name}</span>
              <span className="text-right text-muted">
                {t('Contribution')}: {formatCurrency(amount.contributionCents)} <span aria-hidden="true">·</span> {t('Left after bills')}: {formatCurrency(amount.discretionaryCents)}
              </span>
            </div>
          )
        })}
      </div>
    </article>
  )
}

function ScenarioComparison({
  baseline,
  sandbox,
  month,
  horizon,
  locale,
  formatCurrency,
}: {
  baseline: Scenario;
  sandbox: Scenario;
  month: string;
  horizon: ForecastHorizon;
  locale: string;
  formatCurrency: (cents: number) => string;
}) {
  const { t } = useTranslation()
  const baselineSettlement = safeCalculate(() => calculateSettlement(baseline, month))
  const sandboxSettlement = safeCalculate(() => calculateSettlement(sandbox, month))
  const baselineForecast = safeCalculate(() => buildMonthlyForecast(baseline, month, horizon))
  const sandboxForecast = safeCalculate(() => buildMonthlyForecast(sandbox, month, horizon))
  const matchingParticipants = baseline.participantIds.length === sandbox.participantIds.length
    && baseline.participantIds.every((id) => sandbox.participantIds.includes(id))

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <ScenarioSettlement formatCurrency={formatCurrency} month={month} scenario={baseline} />
        <ScenarioSettlement formatCurrency={formatCurrency} month={month} scenario={sandbox} />
      </div>
      <p className="text-xs leading-5 text-muted">
        {t(matchingParticipants
          ? 'Both scenarios use the same participants, so their settlement amounts are directly comparable.'
          : 'Participant selections differ, so each scenario shows its own participants without a direct participant comparison.')}
      </p>
      {matchingParticipants && baselineSettlement.value && sandboxSettlement.value && (
        <div className="rounded-xl border border-border bg-background p-4">
          <h3 className="font-semibold">{t('Participant differences')}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {baseline.participantIds.map((profileId) => {
              const profile = baseline.profiles[profileId]
              const before = baselineSettlement.value?.byProfile[profileId]
              const after = sandboxSettlement.value?.byProfile[profileId]
              if (!profile || !before || !after) return null
              return (
                <dl className="rounded-lg border border-border p-3 text-sm" key={profileId}>
                  <dt className="font-medium">{profile.name}</dt>
                  <dd className="mt-2 flex justify-between gap-2 text-muted"><span>{t('Contribution difference')}</span><span className="font-medium tabular-nums text-foreground">{signedCurrency(after.contributionCents - before.contributionCents, formatCurrency)}</span></dd>
                  <dd className="mt-1 flex justify-between gap-2 text-muted"><span>{t('Left-after-bills difference')}</span><span className="font-medium tabular-nums text-foreground">{signedCurrency(after.discretionaryCents - before.discretionaryCents, formatCurrency)}</span></dd>
                </dl>
              )
            })}
          </div>
        </div>
      )}
      {baselineForecast.value && sandboxForecast.value ? (
        <div className="overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label={t('Scenario forecast comparison')}>
          <table className="w-full min-w-[38rem] border-collapse text-sm">
            <caption className="sr-only">{t('Projected net joint cost for baseline and sandbox scenarios.')}</caption>
            <thead className="bg-background text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-3 font-semibold" scope="col">{t('Month')}</th>
                <th className="px-3 py-3 text-right font-semibold" scope="col">{t('Baseline net cost')}</th>
                <th className="px-3 py-3 text-right font-semibold" scope="col">{t('Sandbox net cost')}</th>
                <th className="px-3 py-3 text-right font-semibold" scope="col">{t('Difference')}</th>
              </tr>
            </thead>
            <tbody>
              {baselineForecast.value.map((point, index) => {
                const alternative = sandboxForecast.value?.[index]
                if (!alternative) return null
                const difference = alternative.settlement.netJointCostCents - point.settlement.netJointCostCents
                return (
                  <tr className="border-t border-border" key={point.month}>
                    <th className="whitespace-nowrap px-3 py-3 text-left font-medium" scope="row">{formatMonth(point.month, locale, true)}</th>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatCurrency(point.settlement.netJointCostCents)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatCurrency(alternative.settlement.netJointCostCents)}</td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums ${difference > 0 ? 'text-danger' : 'text-foreground'}`}>{signedCurrency(difference, formatCurrency)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ErrorNotice message={t('Scenario forecast could not be calculated: {{error}}', { error: translateMessage(baselineForecast.error ?? sandboxForecast.error ?? '', t) })} />
      )}
    </div>
  )
}

function ComparisonSection({
  baseline,
  sandboxes,
  activeScenarioId,
  month,
  horizon,
  locale,
  formatCurrency,
}: {
  baseline: Scenario | undefined;
  sandboxes: Scenario[];
  activeScenarioId: ScenarioId;
  month: string;
  horizon: ForecastHorizon;
  locale: string;
  formatCurrency: (cents: number) => string;
}) {
  const { t } = useTranslation()
  const duplicateScenario = useAppStore((state) => state.duplicateScenario)
  const [selectedSandboxId, setSelectedSandboxId] = useState('')
  const sandbox = sandboxes.find((scenario) => scenario.id === selectedSandboxId)
    ?? sandboxes.find((scenario) => scenario.id === activeScenarioId)
    ?? sandboxes[0]
  const handleCreateSandbox = () => {
    if (!baseline) return
    try {
      const id = duplicateScenario(activeScenarioId, t('Planning comparison'))
      setSelectedSandboxId(id)
    } catch {
      // Scenario controls in the header provide the store error state.
    }
  }

  return (
    <Panel title={t('Compare scenarios')} description={t('Compare the baseline with one sandbox for this month and its forecast.')}>
      {!baseline ? (
        <ErrorNotice message={t('The baseline scenario is unavailable.')} />
      ) : sandboxes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong p-5 text-center">
          <p className="text-sm text-muted">{t('Create a sandbox to compare a planning change with your baseline.')}</p>
          <button className={`${primaryButtonClassName} mt-3`} onClick={handleCreateSandbox} type="button">{t('Create comparison sandbox')}</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="block w-full max-w-sm">
              <span className="mb-1.5 block text-sm font-medium">{t('Sandbox to compare')}</span>
              <select className={inputClassName} onChange={(event) => setSelectedSandboxId(event.currentTarget.value)} value={sandbox?.id ?? ''}>
                {sandboxes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>
          {sandbox && <ScenarioComparison baseline={baseline} formatCurrency={formatCurrency} horizon={horizon} locale={locale} month={month} sandbox={sandbox} />}
        </div>
      )}
    </Panel>
  )
}

function CashFlowSection({
  scenario,
  month,
  currencyCode,
  locale,
  formatCurrency,
}: {
  scenario: Scenario;
  month: string;
  currencyCode: string;
  locale: string;
  formatCurrency: (cents: number) => string;
}) {
  const { t } = useTranslation()
  const setOpeningBalance = useAppStore((state) => state.setScenarioOpeningBalance)
  const [openingDraft, setOpeningDraft] = useState(formatAmountInput(scenario.planning.openingBalanceCents))
  const [error, setError] = useState<string | null>(null)
  const timeline = safeCalculate(() => buildCashFlowTimeline(scenario, month, 3))

  const saveOpeningBalance = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = parseAmountToCents(openingDraft, true)
    if ('error' in amount) {
      setError(amount.error)
      return
    }
    try {
      setOpeningBalance(scenario.id, amount.cents)
      setOpeningDraft(formatAmountInput(amount.cents))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rato could not save that balance.')
    }
  }

  return (
    <Panel title={t('Cash-flow timeline')} description={t('Projected household income and expenses over the next three months, using this scenario’s forecast assumptions.')}>
      <form className="grid gap-3 rounded-xl bg-background p-3 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end" onSubmit={saveOpeningBalance}>
        <label>
          <span className="mb-1.5 block text-sm font-medium">{t('Opening balance on {{date}}', { date: formatDate(`${month}-01`, locale) })}</span>
          <span className="relative block">
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">{currencyCode}</span>
            <input aria-label={t('Opening household balance')} className={`${inputClassName} pl-14`} inputMode="decimal" onChange={(event) => setOpeningDraft(event.currentTarget.value)} value={openingDraft} />
          </span>
        </label>
        <button className={buttonClassName} type="submit">{t('Save opening balance')}</button>
      </form>
      {error && <ErrorNotice message={translateMessage(error, t)} />}
      {timeline.error ? <ErrorNotice message={t('Cash flow could not be calculated: {{error}}', { error: translateMessage(timeline.error, t) })} /> : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background p-3 text-sm">
            <span className="text-muted">{t('Opening balance')}</span>
            <span className="font-semibold tabular-nums">{formatCurrency(scenario.planning.openingBalanceCents)}</span>
          </div>
          {timeline.value?.length ? (
            <ol className="space-y-3">
              {timeline.value.map((day: CashFlowDay) => (
                <li className="rounded-xl border border-border bg-background p-4" key={day.date}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{formatDate(day.date, locale)}</h3>
                      <p className="mt-1 text-sm text-muted">{t('{{value}} scheduled items', { value: day.items.length })}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted">{t('Projected balance')}</p>
                      <p className={`font-semibold tabular-nums ${day.balanceCents < 0 ? 'text-danger' : ''}`}>{formatCurrency(day.balanceCents)}</p>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                    <div><dt className="text-muted">{t('Income')}</dt><dd className="mt-0.5 font-medium tabular-nums">{formatCurrency(day.incomeCents)}</dd></div>
                    <div><dt className="text-muted">{t('Expenses')}</dt><dd className="mt-0.5 font-medium tabular-nums">{formatCurrency(day.expenseCents)}</dd></div>
                  </dl>
                  <ul className="mt-3 space-y-2 border-t border-border pt-3">
                    {day.items.map((item, index) => (
                      <li className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm" key={`${item.id}:${item.kind}:${index}`}>
                        <span><span className="font-medium">{item.name}</span> <span className="text-muted">· {item.ownerName}</span></span>
                        <span className="tabular-nums">{item.kind === 'expense' ? '−' : '+'}{formatCurrency(item.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted">{t('No scheduled income or expenses in this three-month period.')}</p>
          )}
        </>
      )}
    </Panel>
  )
}

function emptyItemDraft(scenario: Scenario, month: string): ItemDraft {
  return {
    kind: 'expense',
    ownerId: scenario.participantIds[0] ?? 'joint',
    name: '',
    amount: '',
    category: '',
    frequency: 'monthly',
    startDate: `${month}-01`,
    endDate: '',
  }
}

function scenarioWithItems(scenario: Scenario, entries: WhatIfItem[]): Scenario {
  const preview = structuredClone(scenario)
  for (const entry of entries) {
    const field = entry.kind === 'income' ? 'income' : 'expenses'
    if (entry.owner.scope === 'joint') {
      preview.joint[field] = [...preview.joint[field], entry.item]
    } else {
      const profile = preview.profiles[entry.owner.profileId]
      if (!profile) throw new RangeError(`Profile "${entry.owner.profileId}" does not exist.`)
      profile.ledger[field] = [...profile.ledger[field], entry.item]
    }
  }
  return preview
}

function WhatIfSection({
  scenario,
  month,
  horizon,
  currencyCode,
  locale,
  formatCurrency,
}: {
  scenario: Scenario;
  month: string;
  horizon: ForecastHorizon;
  currencyCode: string;
  locale: string;
  formatCurrency: (cents: number) => string;
}) {
  const { t } = useTranslation()
  const upsertItem = useAppStore((state) => state.upsertItem)
  const duplicateScenario = useAppStore((state) => state.duplicateScenario)
  const [draft, setDraft] = useState(() => emptyItemDraft(scenario, month))
  const [entries, setEntries] = useState<WhatIfItem[]>([])
  const [scenarioName, setScenarioName] = useState(t('What-if sandbox'))
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState(false)
  const id = useId()
  const safeOwnerId = draft.ownerId === 'joint' || scenario.profiles[draft.ownerId]
    ? draft.ownerId
    : scenario.participantIds[0] ?? 'joint'
  const preview = useMemo(() => safeCalculate(() => scenarioWithItems(scenario, entries)), [scenario, entries])
  const baseNetCost = safeCalculate(() => calculateSettlement(scenario, month)).value?.netJointCostCents ?? null
  const previewNetCost = preview.value
    ? safeCalculate(() => calculateSettlement(preview.value!, month)).value?.netJointCostCents ?? null
    : null
  const baseForecastEnd = safeCalculate(() => buildMonthlyForecast(scenario, month, horizon).at(-1)?.settlement.netJointCostCents ?? 0).value
  const previewForecastEnd = preview.value
    ? safeCalculate(() => buildMonthlyForecast(preview.value!, month, horizon).at(-1)?.settlement.netJointCostCents ?? 0).value
    : null

  const updateDraft = (key: keyof ItemDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }))

  const addItemToPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = parseAmountToCents(draft.amount)
    if ('error' in amount) {
      setError(amount.error)
      return
    }
    const categoryId = categoryIdFromInput(draft.category.trim(), draft.kind, (key) => t(key))
    const recurrence = draft.frequency === 'once'
      ? { frequency: 'once' as const, startDate: draft.startDate }
      : { frequency: draft.frequency, startDate: draft.startDate, endDate: draft.endDate || null }
    const parsed = FinancialItemSchema.safeParse({
      id: globalThis.crypto.randomUUID(),
      name: draft.name,
      amountCents: amount.cents,
      categoryId,
      recurrence,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('Enter a valid hypothetical item.'))
      return
    }
    const owner: LedgerOwner = safeOwnerId === 'joint'
      ? { scope: 'joint' }
      : { scope: 'profile', profileId: safeOwnerId }
    setEntries((current) => [...current, { owner, kind: draft.kind, item: parsed.data }])
    setError(null)
    setSavedMessage(false)
    setDraft({ ...emptyItemDraft(scenario, month), kind: draft.kind, ownerId: safeOwnerId })
  }

  const saveSandbox = () => {
    const name = scenarioName.trim()
    if (!name) {
      setError(t('Enter a name for the new sandbox.'))
      return
    }
    if (!entries.length) return
    try {
      const validatedEntries = entries.map((entry) => {
        const item = FinancialItemSchema.parse(entry.item)
        if (entry.owner.scope === 'profile' && !scenario.profiles[entry.owner.profileId]) {
          throw new Error(`Profile "${entry.owner.profileId}" does not exist in this scenario.`)
        }
        return { ...entry, item }
      })
      const newId = duplicateScenario(scenario.id, name)
      for (const entry of validatedEntries) upsertItem(newId, entry.owner, entry.kind, entry.item)
      setEntries([])
      setError(null)
      setSavedMessage(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('Rato could not save this sandbox.'))
    }
  }

  return (
    <Panel title={t('What-if planner')} description={t('Add temporary ledger items to preview a change. Nothing is saved until you create a sandbox. Only selected participants and the joint ledger affect settlement.')}>
      <form className="grid gap-3 rounded-xl bg-background p-4" onSubmit={addItemToPreview}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label><span className="mb-1.5 block text-sm font-medium">{t('Kind')}</span><select className={inputClassName} onChange={(event) => updateDraft('kind', event.currentTarget.value)} value={draft.kind}><option value="income">{t('Income')}</option><option value="expense">{t('Expenses')}</option></select></label>
          <label><span className="mb-1.5 block text-sm font-medium">{t('Ledger owner')}</span><select className={inputClassName} onChange={(event) => updateDraft('ownerId', event.currentTarget.value)} value={safeOwnerId}><option value="joint">{t('Joint ledger')}</option>{Object.values(scenario.profiles).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
          <label><span className="mb-1.5 block text-sm font-medium">{t('Name')}</span><input className={inputClassName} onChange={(event) => updateDraft('name', event.currentTarget.value)} value={draft.name} /></label>
          <label><span className="mb-1.5 block text-sm font-medium">{t('Amount ({{currency}})', { currency: currencyCode })}</span><input className={inputClassName} inputMode="decimal" onChange={(event) => updateDraft('amount', event.currentTarget.value)} value={draft.amount} /></label>
          <label><span className="mb-1.5 block text-sm font-medium">{t('Category')}</span><input className={inputClassName} list={`${id}-categories`} onChange={(event) => updateDraft('category', event.currentTarget.value)} value={draft.category} /><datalist id={`${id}-categories`}>{LEDGER_CATEGORIES[draft.kind].map((categoryId) => <option key={categoryId} value={t(categoryId)} />)}</datalist></label>
          <label><span className="mb-1.5 block text-sm font-medium">{t('Frequency')}</span><select className={inputClassName} onChange={(event) => updateDraft('frequency', event.currentTarget.value)} value={draft.frequency}><option value="once">{t('Once')}</option><option value="monthly">{t('Monthly')}</option><option value="quarterly">{t('Quarterly')}</option><option value="yearly">{t('Yearly')}</option></select></label>
          <label><span className="mb-1.5 block text-sm font-medium">{t('Start date')}</span><input className={inputClassName} onChange={(event) => updateDraft('startDate', event.currentTarget.value)} type="date" value={draft.startDate} /></label>
          <label><span className="mb-1.5 block text-sm font-medium">{t('End date (optional)')}</span><input className={inputClassName} disabled={draft.frequency === 'once'} onChange={(event) => updateDraft('endDate', event.currentTarget.value)} type="date" value={draft.endDate} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className={buttonClassName} type="submit"><Plus aria-hidden="true" size={16} />{t('Add to preview')}</button>
          {error && <span className="text-sm text-danger" role="alert">{translateMessage(error, t)}</span>}
        </div>
      </form>

      {entries.length > 0 && (
        <div className="space-y-3">
          <ul className="space-y-2">
            {entries.map((entry, index) => {
              const ownerLabel = entry.owner.scope === 'joint' ? t('Joint ledger') : scenario.profiles[entry.owner.profileId]?.name ?? entry.owner.profileId
              return (
                <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-3" key={`${entry.item.id}:${index}`}>
                  <span className="min-w-0"><span className="font-medium">{entry.item.name}</span><span className="ml-2 text-sm text-muted">{ownerLabel} · {t(entry.kind === 'income' ? 'Income' : 'Expenses')} · {categoryLabel(entry.item.categoryId, (key) => t(key))}</span></span>
                  <span className="flex items-center gap-3 tabular-nums"><span>{formatCurrency(entry.item.amountCents)}</span><button aria-label={t('Remove {{name}} from preview', { name: entry.item.name })} className="rounded-md p-2 text-muted hover:bg-surface-hover hover:text-danger focus-visible:outline-2 focus-visible:outline-primary" onClick={() => { setEntries((current) => current.filter((_, currentIndex) => currentIndex !== index)); setSavedMessage(false) }} type="button"><X aria-hidden="true" size={16} /></button></span>
                </li>
              )
            })}
          </ul>
          {preview.error ? <ErrorNotice message={t('Preview could not be calculated: {{error}}', { error: translateMessage(preview.error, t) })} /> : preview.value && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <h3 className="font-semibold">{t('Preview for {{month}}', { month: formatMonth(month, locale) })}</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div><p className="text-xs text-muted">{t('Net joint cost')}</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(previewNetCost ?? 0)}</p></div>
                <div><p className="text-xs text-muted">{t('Change this month')}</p><p className="mt-1 text-lg font-semibold tabular-nums">{signedCurrency((previewNetCost ?? 0) - (baseNetCost ?? 0), formatCurrency)}</p></div>
                <div><p className="text-xs text-muted">{t('Forecast end net cost ({{horizon}} months)', { horizon })}</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(previewForecastEnd ?? 0)}</p></div>
                <div><p className="text-xs text-muted">{t('Forecast change')}</p><p className="mt-1 text-lg font-semibold tabular-nums">{signedCurrency((previewForecastEnd ?? 0) - (baseForecastEnd ?? 0), formatCurrency)}</p></div>
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label><span className="mb-1.5 block text-sm font-medium">{t('Name for the new sandbox')}</span><input className={inputClassName} onChange={(event) => setScenarioName(event.currentTarget.value)} value={scenarioName} /></label>
            <button className={primaryButtonClassName} onClick={saveSandbox} type="button">{t('Save as sandbox')}</button>
          </div>
        </div>
      )}
      {savedMessage && <p className="text-sm text-primary" role="status">{t('What-if items saved to a new sandbox.')}</p>}
    </Panel>
  )
}

function emptyGoalDraft(month: string): GoalDraft {
  return { id: null, name: '', target: '', saved: '0.00', targetDate: `${month}-01` }
}

function SavingsGoalsSection({
  scenario,
  month,
  locale,
  formatCurrency,
}: {
  scenario: Scenario;
  month: string;
  locale: string;
  formatCurrency: (cents: number) => string;
}) {
  const { t } = useTranslation()
  const upsertGoal = useAppStore((state) => state.upsertSavingsGoal)
  const removeGoal = useAppStore((state) => state.removeSavingsGoal)
  const [draft, setDraft] = useState<GoalDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const settlement = safeCalculate(() => calculateSettlement(scenario, month))
  const discretionaryCents = settlement.value
    ? scenario.participantIds.reduce((total, profileId) => total + (settlement.value?.byProfile[profileId]?.discretionaryCents ?? 0), 0)
    : null

  const saveGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft) return
    const target = parseAmountToCents(draft.target)
    const saved = parseAmountToCents(draft.saved)
    if ('error' in target || 'error' in saved) {
      setError(t('Enter valid target and saved amounts.'))
      return
    }
    const goal: SavingsGoal = {
      id: draft.id ?? globalThis.crypto.randomUUID(),
      name: draft.name,
      targetCents: target.cents,
      savedCents: saved.cents,
      targetDate: draft.targetDate,
    }
    const parsed = SavingsGoalSchema.safeParse(goal)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('Enter valid savings goal details.'))
      return
    }
    try {
      upsertGoal(scenario.id, parsed.data)
      setDraft(null)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('Could not save this goal.'))
    }
  }

  const deleteGoal = (goal: SavingsGoal) => {
    if (!window.confirm(t('Delete savings goal “{{name}}”?', { name: goal.name }))) return
    try {
      removeGoal(scenario.id, goal.id)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('Could not delete this goal.'))
    }
  }

  const requiredMonthly = (goal: SavingsGoal): number => {
    const remaining = Math.max(0, goal.targetCents - goal.savedCents)
    if (remaining === 0) return 0
    const monthsRemaining = monthOffset(month, goal.targetDate.slice(0, 7))
    const periods = monthsRemaining < 0 ? 1 : monthsRemaining + 1
    return Math.ceil(remaining / Math.max(1, periods))
  }

  const totalRequiredCents = scenario.planning.savingsGoals.reduce((total, goal) => total + requiredMonthly(goal), 0)
  const goalsExceedAvailable = discretionaryCents !== null && totalRequiredCents > discretionaryCents

  return (
    <Panel title={t('Savings goals')} description={t('Track progress and see the monthly amount needed. Goals are planning targets and do not change bill settlement.')}>
      {discretionaryCents !== null && (
        <div className="grid gap-3 rounded-xl bg-background p-4 sm:grid-cols-2">
          <div><p className="text-xs text-muted">{t('Combined left after bills')}</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(discretionaryCents)}</p></div>
          <div><p className="text-xs text-muted">{t('Monthly amount for all goals')}</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(totalRequiredCents)}</p></div>
        </div>
      )}
      {discretionaryCents !== null && scenario.planning.savingsGoals.length > 0 && (
        <p className={`text-sm ${goalsExceedAvailable ? 'text-danger' : 'text-muted'}`} role={goalsExceedAvailable ? 'status' : undefined}>
          {t(goalsExceedAvailable ? 'Goal savings exceed current leftover after bills.' : 'Goal savings fit within current leftover after bills.')}
        </p>
      )}
      {settlement.error && <ErrorNotice message={t('Savings comparison could not be calculated: {{error}}', { error: translateMessage(settlement.error, t) })} />}
      {scenario.planning.savingsGoals.length ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {scenario.planning.savingsGoals.map((goal) => {
            const progress = Math.min(100, goal.savedCents / goal.targetCents * 100)
            const required = requiredMonthly(goal)
            const targetPassed = goal.targetDate.slice(0, 7) < month
            return (
              <li className="rounded-xl border border-border bg-background p-4" key={goal.id}>
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="font-semibold">{goal.name}</h3><p className="mt-1 text-sm text-muted">{t('Target date')}: {formatDate(goal.targetDate, locale)}</p></div>
                  <div className="flex gap-1">
                    <button className={buttonClassName} onClick={() => setDraft({ id: goal.id, name: goal.name, target: formatAmountInput(goal.targetCents), saved: formatAmountInput(goal.savedCents), targetDate: goal.targetDate })} type="button">{t('Edit')}</button>
                    <button aria-label={t('Delete {{name}}', { name: goal.name })} className="rounded-lg p-2 text-muted hover:bg-danger/5 hover:text-danger focus-visible:outline-2 focus-visible:outline-danger" onClick={() => deleteGoal(goal)} type="button"><Trash2 aria-hidden="true" size={17} /></button>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between gap-3 text-sm"><span className="text-muted">{formatCurrency(goal.savedCents)} {t('saved of')} {formatCurrency(goal.targetCents)}</span><span className="font-medium tabular-nums">{Math.round(progress)}%</span></div>
                <div aria-label={t('{{name}} progress', { name: goal.name })} aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress} className="mt-2 h-2 overflow-hidden rounded-full bg-surface" role="progressbar"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
                <p className={`mt-3 text-sm ${targetPassed && required ? 'text-danger' : 'text-muted'}`}>
                  {required === 0 ? t('Goal reached') : targetPassed ? t('Target date has passed; remaining amount is {{amount}}.', { amount: formatCurrency(goal.targetCents - goal.savedCents) }) : t('Save {{amount}} per month to reach this goal.', { amount: formatCurrency(required) })}
                </p>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted">{t('No savings goals yet.')}</p>
      )}
      {!draft ? (
        <button className={buttonClassName} onClick={() => setDraft(emptyGoalDraft(month))} type="button"><Plus aria-hidden="true" size={16} />{t('Add savings goal')}</button>
      ) : (
        <form className="grid gap-3 rounded-xl border border-border p-4" onSubmit={saveGoal}>
          <h3 className="font-semibold">{draft.id ? t('Edit savings goal') : t('New savings goal')}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label><span className="mb-1.5 block text-sm font-medium">{t('Name')}</span><input className={inputClassName} id={`${id}-goal-name`} onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} value={draft.name} /></label>
            <label><span className="mb-1.5 block text-sm font-medium">{t('Target amount')}</span><input className={inputClassName} inputMode="decimal" onChange={(event) => setDraft({ ...draft, target: event.currentTarget.value })} value={draft.target} /></label>
            <label><span className="mb-1.5 block text-sm font-medium">{t('Already saved')}</span><input className={inputClassName} inputMode="decimal" onChange={(event) => setDraft({ ...draft, saved: event.currentTarget.value })} value={draft.saved} /></label>
            <label><span className="mb-1.5 block text-sm font-medium">{t('Target date')}</span><input className={inputClassName} onChange={(event) => setDraft({ ...draft, targetDate: event.currentTarget.value })} type="date" value={draft.targetDate} /></label>
          </div>
          {error && <ErrorNotice message={translateMessage(error, t)} />}
          <div className="flex flex-wrap gap-2"><button className={primaryButtonClassName} type="submit">{t('Save goal')}</button><button className={buttonClassName} onClick={() => { setDraft(null); setError(null) }} type="button">{t('Cancel')}</button></div>
        </form>
      )}
    </Panel>
  )
}

function ChangeLabel({ kind }: { kind: PlannedChange['kind'] }) {
  const { t } = useTranslation()
  return <span className="rounded-full bg-surface px-2 py-1 text-xs font-medium text-muted">{t(kind === 'starts' ? 'Starts' : kind === 'ends' ? 'Ends' : 'One-time')}</span>
}

function PlannedCostInsights({
  scenario,
  month,
  horizon,
  locale,
  formatCurrency,
}: {
  scenario: Scenario;
  month: string;
  horizon: ForecastHorizon;
  locale: string;
  formatCurrency: (cents: number) => string;
}) {
  const { t } = useTranslation()
  const plannedChanges = safeCalculate(() => buildUpcomingPlannedChanges(scenario, month, 3))
  const categories = safeCalculate(() => buildCategoryProjectionChanges(scenario, month, horizon))
  const endMonth = safeCalculate(() => buildMonthlyForecast(scenario, month, horizon).at(-1)?.month ?? month).value ?? month
  const categoryChanges = categories.value?.filter((item: CategoryProjectionChange) => item.changeCents !== 0).slice(0, 4) ?? []
  return (
    <Panel title={t('Planned-cost insights')} description={t('Projections from scheduled ledger items and forecast assumptions. These are not actual transactions.')}>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl bg-background p-4" aria-label={t('Upcoming planned changes')}>
          <h3 className="font-semibold">{t('Upcoming changes')}</h3>
          {plannedChanges.error ? <ErrorNotice message={translateMessage(plannedChanges.error, t)} /> : plannedChanges.value?.length ? (
            <ul className="mt-3 space-y-3">
              {plannedChanges.value.map((change: PlannedChange, index: number) => (
                <li className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 first:border-0 first:pt-0" key={`${change.date}:${change.name}:${change.kind}:${index}`}>
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{change.name}</span><ChangeLabel kind={change.kind} /></div><p className="mt-1 text-xs text-muted">{formatDate(change.date, locale)} · {change.ownerName}</p></div>
                  <span className="text-sm tabular-nums">{formatCurrency(change.amountCents)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-muted">{t('No planned item starts, ends, or one-time costs in this period.')}</p>}
        </section>
        <section className="rounded-xl bg-background p-4" aria-label={t('Projected category changes')}>
          <h3 className="font-semibold">{t('Projected category changes')}</h3>
          <p className="mt-1 text-xs text-muted">{formatMonth(month, locale, true)} → {formatMonth(endMonth, locale, true)}</p>
          {categories.error ? <ErrorNotice message={translateMessage(categories.error, t)} /> : categoryChanges.length ? (
            <ul className="mt-3 space-y-3">
              {categoryChanges.map((change: CategoryProjectionChange) => (
                <li className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 first:border-0 first:pt-0" key={change.categoryId}>
                  <div><span className="font-medium">{categoryLabel(change.categoryId, (key) => t(key))}</span><p className="mt-1 text-xs text-muted">{formatCurrency(change.baseCents)} → {formatCurrency(change.futureCents)}</p></div>
                  <span className={`text-sm font-semibold tabular-nums ${change.changeCents > 0 ? 'text-danger' : 'text-foreground'}`}>{signedCurrency(change.changeCents, formatCurrency)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-muted">{t('No category cost changes across this forecast.')}</p>}
        </section>
      </div>
    </Panel>
  )
}

export default function PlanningPage() {
  const { t, i18n } = useTranslation()
  const [searchParams] = useSearchParams()
  const baselineScenarioId = useAppStore((state) => state.baselineScenarioId)
  const activeScenarioId = useAppStore((state) => state.activeScenarioId)
  const scenarios = useAppStore((state) => state.scenarios)
  const currencyCode = useAppStore((state) => state.settings.currencyCode)
  const activeScenario = scenarios[activeScenarioId]
  const baseline = scenarios[baselineScenarioId]
  const sandboxes = Object.values(scenarios).filter((scenario) => scenario.id !== baselineScenarioId)
  const requestedMonth = searchParams.get('month')
  const selectedMonth = isYearMonth(requestedMonth) ? requestedMonth : currentLocalYearMonth()
  const [horizon, setHorizon] = useState<ForecastHorizon>(12)
  const locale = intlLocale(i18n.resolvedLanguage ?? i18n.language)
  const formatCurrency = useMemo(() => createCurrencyFormatter(currencyCode, locale), [currencyCode, locale])

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('Planning')}</h1>
          <p className="mt-1 text-sm text-muted">{t('Compare scenarios and plan upcoming household costs.')}</p>
        </div>
        <label className="block w-full sm:w-44">
          <span className="mb-1.5 block text-sm font-medium">{t('Forecast horizon')}</span>
          <select className={inputClassName} onChange={(event) => setHorizon(Number(event.currentTarget.value) as ForecastHorizon)} value={horizon}>
            <option value={6}>{t('6 months')}</option><option value={12}>{t('12 months')}</option><option value={24}>{t('24 months')}</option>
          </select>
        </label>
      </header>
      <ComparisonSection activeScenarioId={activeScenarioId} baseline={baseline} formatCurrency={formatCurrency} horizon={horizon} locale={locale} month={selectedMonth} sandboxes={sandboxes} />
      {!activeScenario ? <ErrorNotice message={t('The active scenario is unavailable.')} /> : (
        <>
          <CashFlowSection key={activeScenario.id} currencyCode={currencyCode} formatCurrency={formatCurrency} locale={locale} month={selectedMonth} scenario={activeScenario} />
          <WhatIfSection currencyCode={currencyCode} formatCurrency={formatCurrency} horizon={horizon} locale={locale} month={selectedMonth} scenario={activeScenario} />
          <SavingsGoalsSection formatCurrency={formatCurrency} locale={locale} month={selectedMonth} scenario={activeScenario} />
          <PlannedCostInsights formatCurrency={formatCurrency} horizon={horizon} locale={locale} month={selectedMonth} scenario={activeScenario} />
        </>
      )}
    </div>
  )
}
