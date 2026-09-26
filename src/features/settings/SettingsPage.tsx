import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Download, FileUp, Save, Upload } from 'lucide-react'
import type { AppData, CalculationMode, ForecastAssumptions, Scenario } from '../../types'
import { SUPPORTED_CURRENCIES } from '../../constants/currencies'
import { categoryLabel } from '../../constants/categories'
import { useAppStore } from '../../store/useAppStore'
import {
  appDataSnapshot,
  backupFilename,
  parseAppDataBackup,
  previewAppData,
  serializeAppData,
  type BackupPreview,
} from '../../utils/importExport'
import { intlLocale, languageCode, translateMessage } from '../../i18n'

interface ForecastDraft {
  annualIncomeGrowthRate: string;
  annualExpenseInflationRate: string;
  expenseInflationByCategory: Record<string, string>;
}

interface PendingBackup {
  data: AppData;
  fileName: string;
  preview: BackupPreview;
}

type ForecastFieldErrors = Record<string, string>

const inputClassName = 'min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const buttonClassName = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButtonClassName = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Rato could not complete that action.'
}

function percentDraft(rate: number): string {
  return String(Number((rate * 100).toFixed(8)))
}

function forecastDraftFromScenario(scenario: Scenario, categoryIds: string[]): ForecastDraft {
  const overrides = scenario.forecastAssumptions.expenseInflationByCategory
  return {
    annualIncomeGrowthRate: percentDraft(scenario.forecastAssumptions.annualIncomeGrowthRate),
    annualExpenseInflationRate: percentDraft(scenario.forecastAssumptions.annualExpenseInflationRate),
    expenseInflationByCategory: Object.fromEntries(categoryIds.map((categoryId) => [
      categoryId,
      overrides[categoryId] === undefined ? '' : percentDraft(overrides[categoryId]),
    ])),
  }
}

function parsePercent(value: string): { rate: number } | { error: string } {
  if (!value.trim()) return { error: 'Enter an annual rate.' }
  const percent = Number(value)
  if (!Number.isFinite(percent)) return { error: 'Enter a finite percentage.' }
  if (percent <= -100) return { error: 'The annual rate must be greater than −100%.' }
  const rate = percent / 100
  if (!Number.isFinite(rate) || rate <= -1) return { error: 'Enter a valid annual rate.' }
  return { rate }
}

function categoriesForScenario(scenario: Scenario): string[] {
  const categories = new Set<string>(Object.keys(scenario.forecastAssumptions.expenseInflationByCategory))
  for (const profile of Object.values(scenario.profiles)) {
    for (const item of profile.ledger.expenses) categories.add(item.categoryId)
  }
  for (const item of scenario.joint.expenses) categories.add(item.categoryId)
  return [...categories].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
}

function SectionMessage({ message, error = false }: { message: string; error?: boolean }) {
  const { t } = useTranslation()
  return (
    <p className={`text-sm ${error ? 'text-danger' : 'text-primary'}`} role={error ? 'alert' : 'status'}>
      {translateMessage(message, t)}
    </p>
  )
}

function SectionCard({ title, children }: {
  title: string;
  children: ReactNode;
}) {
  const { t } = useTranslation()
  return (
    <section aria-labelledby={`${title.toLowerCase().replaceAll(' ', '-')}-heading`} className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 text-xl font-semibold tracking-tight" id={`${title.toLowerCase().replaceAll(' ', '-')}-heading`}>{t(title)}</h2>
      {children}
    </section>
  )
}

function FieldError({ id, message }: { id: string; message?: string | undefined }) {
  const { t } = useTranslation()
  if (!message) return null
  return <p className="mt-1 text-xs text-danger" id={id}>{translateMessage(message, t)}</p>
}

function dataForStore(state: ReturnType<typeof useAppStore.getState>): AppData {
  return appDataSnapshot(state)
}

function SettingsEditor({
  scenario,
  currencyCode,
  onBackupStart,
  onBackupRestored,
}: {
  scenario: Scenario;
  currencyCode: string;
  onBackupStart: () => void;
  onBackupRestored: () => void;
}) {
  const { t, i18n: activeI18n } = useTranslation()
  const locale = intlLocale(activeI18n.resolvedLanguage ?? activeI18n.language)
  const setCalculationMode = useAppStore((state) => state.setCalculationMode)
  const updateForecastAssumptions = useAppStore((state) => state.updateForecastAssumptions)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const replaceData = useAppStore((state) => state.replaceData)
  const categoryIds = useMemo(() => categoriesForScenario(scenario), [scenario])

  const [modeDraft, setModeDraft] = useState<CalculationMode>(scenario.calculationMode)
  const [modeMessage, setModeMessage] = useState<string | null>(null)
  const [modeError, setModeError] = useState<string | null>(null)
  const [forecastDraft, setForecastDraft] = useState(() => forecastDraftFromScenario(scenario, categoryIds))
  const [forecastErrors, setForecastErrors] = useState<ForecastFieldErrors>({})
  const [forecastMessage, setForecastMessage] = useState<string | null>(null)
  const [forecastActionError, setForecastActionError] = useState<string | null>(null)
  const [currencyDraft, setCurrencyDraft] = useState(currencyCode)
  const [currencyMessage, setCurrencyMessage] = useState<string | null>(null)
  const [currencyError, setCurrencyError] = useState<string | null>(null)
  const [pendingBackup, setPendingBackup] = useState<PendingBackup | null>(null)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)

  const updateForecastDraft = (field: keyof ForecastDraft, value: string) => {
    setForecastDraft((current) => ({ ...current, [field]: value }))
    setForecastErrors((current) => ({ ...current, [field]: '' }))
    setForecastMessage(null)
    setForecastActionError(null)
  }

  const updateCategoryDraft = (categoryId: string, value: string) => {
    setForecastDraft((current) => ({
      ...current,
      expenseInflationByCategory: { ...current.expenseInflationByCategory, [categoryId]: value },
    }))
    setForecastErrors((current) => ({ ...current, [`category:${categoryId}`]: '' }))
    setForecastMessage(null)
    setForecastActionError(null)
  }

  const saveCalculationMode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setModeError(null)
    setModeMessage(null)
    try {
      setCalculationMode(scenario.id, modeDraft)
      setModeMessage('Calculation mode saved for this scenario.')
    } catch (error) {
      setModeError(errorMessage(error))
    }
  }

  const saveForecast = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setForecastMessage(null)
    setForecastActionError(null)
    const incomeResult = parsePercent(forecastDraft.annualIncomeGrowthRate)
    const expenseResult = parsePercent(forecastDraft.annualExpenseInflationRate)
    const nextErrors: ForecastFieldErrors = {}
    if ('error' in incomeResult) nextErrors.annualIncomeGrowthRate = incomeResult.error
    if ('error' in expenseResult) nextErrors.annualExpenseInflationRate = expenseResult.error

    const expenseInflationByCategory: ForecastAssumptions['expenseInflationByCategory'] = {}
    for (const categoryId of categoryIds) {
      const value = forecastDraft.expenseInflationByCategory[categoryId] ?? ''
      if (!value.trim()) continue
      const parsed = parsePercent(value)
      if ('error' in parsed) nextErrors[`category:${categoryId}`] = parsed.error
      else expenseInflationByCategory[categoryId] = parsed.rate
    }

    setForecastErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || 'error' in incomeResult || 'error' in expenseResult) return

    try {
      updateForecastAssumptions(scenario.id, {
        annualIncomeGrowthRate: incomeResult.rate,
        annualExpenseInflationRate: expenseResult.rate,
        expenseInflationByCategory,
      })
      setForecastMessage('Forecast assumptions saved for this scenario.')
    } catch (error) {
      setForecastActionError(errorMessage(error))
    }
  }

  const saveCurrency = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCurrencyError(null)
    setCurrencyMessage(null)
    try {
      updateSettings({ currencyCode: currencyDraft })
      setCurrencyMessage('App currency saved. Stored amounts were not converted.')
    } catch (error) {
      setCurrencyError(errorMessage(error))
    }
  }

  const exportBackup = () => {
    onBackupStart()
    setBackupError(null)
    setBackupMessage(null)
    try {
      const contents = serializeAppData(dataForStore(useAppStore.getState()))
      const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = backupFilename()
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setBackupMessage('Backup download started.')
    } catch (error) {
      setBackupError(errorMessage(error))
    }
  }

  const readBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    onBackupStart()
    setPendingBackup(null)
    setBackupError(null)
    setBackupMessage(null)
    setBackupBusy(true)
    try {
      const data = parseAppDataBackup(await file.text())
      setPendingBackup({ data, fileName: file.name, preview: previewAppData(data) })
    } catch (error) {
      setBackupError(errorMessage(error))
    } finally {
      setBackupBusy(false)
    }
  }

  const confirmBackupReplacement = () => {
    if (!pendingBackup) return
    setBackupError(null)
    try {
      replaceData(pendingBackup.data)
      onBackupRestored()
      const nextScenario = pendingBackup.data.scenarios[pendingBackup.data.activeScenarioId]
      setPendingBackup(null)
      if (nextScenario) {
        const nextCategories = categoriesForScenario(nextScenario)
        setModeDraft(nextScenario.calculationMode)
        setForecastDraft(forecastDraftFromScenario(nextScenario, nextCategories))
      }
      setCurrencyDraft(pendingBackup.data.settings.currencyCode)
      setForecastErrors({})
      setModeError(null)
      setCurrencyError(null)
    } catch (error) {
      setBackupError(errorMessage(error))
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('Settings')}</h1>
      </header>

      <SectionCard title="Split method">
        <form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={saveCalculationMode}>
          <div>
            <label className="sr-only" htmlFor="calculation-mode">{t('Settlement method')}</label>
            <select className={inputClassName} id="calculation-mode" onChange={(event) => {
              setModeDraft(event.currentTarget.value as CalculationMode)
              setModeMessage(null)
              setModeError(null)
            }} value={modeDraft}>
              <option value="pro_rata">{t('Pro rata by income')}</option>
              <option value="fifty_fifty">50/50</option>
              <option value="equal_remainder">{t('Equal remainder after personal expenses')}</option>
            </select>
          </div>
          <button aria-label={t('Save mode')} className={buttonClassName} type="submit"><Save aria-hidden="true" size={16} />{t('Save')}</button>
        </form>
        {modeMessage && <div className="mt-3"><SectionMessage message={modeMessage} /></div>}
        {modeError && <div className="mt-3"><SectionMessage error message={modeError} /></div>}
      </SectionCard>

      <section aria-labelledby="forecast-assumptions-heading">
        <details className="group rounded-2xl border border-border bg-surface shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:p-5 [&::-webkit-details-marker]:hidden">
            <h2 className="text-xl font-semibold tracking-tight" id="forecast-assumptions-heading">{t('Forecast assumptions')}</h2>
            <ChevronDown aria-hidden="true" className="shrink-0 text-muted transition-transform group-open:rotate-180" size={20} />
          </summary>
          <div className="border-t border-border p-4 sm:p-5">
        <form className="space-y-5" onSubmit={saveForecast}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="income-growth-rate">{t('Annual income growth (%)')}</label>
              <input
                aria-describedby={forecastErrors.annualIncomeGrowthRate ? 'income-growth-rate-error' : undefined}
                aria-invalid={Boolean(forecastErrors.annualIncomeGrowthRate)}
                className={inputClassName}
                id="income-growth-rate"
                inputMode="decimal"
                onChange={(event) => updateForecastDraft('annualIncomeGrowthRate', event.currentTarget.value)}
                step="any"
                type="number"
                value={forecastDraft.annualIncomeGrowthRate}
              />
              <FieldError id="income-growth-rate-error" message={forecastErrors.annualIncomeGrowthRate} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="expense-inflation-rate">{t('General expense inflation (%)')}</label>
              <input
                aria-describedby={forecastErrors.annualExpenseInflationRate ? 'expense-inflation-rate-error' : undefined}
                aria-invalid={Boolean(forecastErrors.annualExpenseInflationRate)}
                className={inputClassName}
                id="expense-inflation-rate"
                inputMode="decimal"
                onChange={(event) => updateForecastDraft('annualExpenseInflationRate', event.currentTarget.value)}
                step="any"
                type="number"
                value={forecastDraft.annualExpenseInflationRate}
              />
              <FieldError id="expense-inflation-rate-error" message={forecastErrors.annualExpenseInflationRate} />
            </div>
          </div>

          <div>
            <details className="group/overrides rounded-xl border border-border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                {t('Category overrides')}
                <ChevronDown aria-hidden="true" className="shrink-0 text-muted transition-transform group-open/overrides:rotate-180" size={16} />
              </summary>
              <div className="border-t border-border p-3 sm:p-4">
                {categoryIds.length === 0 ? (
                  <p className="text-sm text-muted">{t('Add an expense in the Ledger to create a category-specific override.')}</p>
                ) : (
                  <>
                    <p className="mb-3 text-xs text-muted">{t('Leave blank to use the general rate.')}</p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {categoryIds.map((categoryId) => {
                        const fieldId = `category-rate-${categoryIds.indexOf(categoryId)}`
                        const errorId = `${fieldId}-error`
                        const error = forecastErrors[`category:${categoryId}`]
                        return (
                          <div className="rounded-xl border border-border bg-background p-3" key={categoryId}>
                            <label className="mb-1.5 block text-sm font-medium" htmlFor={fieldId}>{categoryLabel(categoryId, (key) => t(key))} (%)</label>
                            <input
                              aria-describedby={error ? errorId : undefined}
                              aria-invalid={Boolean(error)}
                              className={inputClassName}
                              id={fieldId}
                              inputMode="decimal"
                              onChange={(event) => updateCategoryDraft(categoryId, event.currentTarget.value)}
                              step="any"
                              type="number"
                              value={forecastDraft.expenseInflationByCategory[categoryId] ?? ''}
                            />
                            <FieldError id={errorId} message={error} />
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </details>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button aria-label={t('Save forecast assumptions')} className={buttonClassName} type="submit"><Save aria-hidden="true" size={16} />{t('Save')}</button>
            {forecastMessage && <SectionMessage message={forecastMessage} />}
            {forecastActionError && <SectionMessage error message={forecastActionError} />}
          </div>
        </form>
          </div>
        </details>
      </section>

      <SectionCard title="Display">
        <div className="grid gap-4 sm:grid-cols-2">
          <form className="grid gap-3" onSubmit={saveCurrency}>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="app-currency">{t('Currency')}</label>
              <select className={inputClassName} id="app-currency" onChange={(event) => {
                setCurrencyDraft(event.currentTarget.value)
                setCurrencyMessage(null)
                setCurrencyError(null)
              }} value={currencyDraft}>
                {SUPPORTED_CURRENCIES.map(({ code, label }) => (
                  <option key={code} value={code}>{t(label)} ({code})</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-muted">{t('Display only; amounts are not converted.')}</p>
            </div>
            <button aria-label={t('Save currency')} className={`${buttonClassName} justify-self-start`} type="submit"><Save aria-hidden="true" size={16} />{t('Save')}</button>
            {currencyMessage && <SectionMessage message={currencyMessage} />}
            {currencyError && <SectionMessage error message={currencyError} />}
          </form>

          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="app-language">{t('Language')}</label>
            <select
              className={inputClassName}
              id="app-language"
              onChange={(event) => void activeI18n.changeLanguage(event.currentTarget.value)}
              value={languageCode(activeI18n.resolvedLanguage ?? activeI18n.language)}
            >
              <option value="en">English</option>
              <option value="nl">Nederlands</option>
            </select>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Backup and restore">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button className={buttonClassName} onClick={exportBackup} type="button">
            <Download aria-hidden="true" size={16} />{t('Download backup')}
          </button>
          <label className={`${secondaryButtonClassName} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${backupBusy ? 'cursor-wait opacity-50' : ''}`} htmlFor="backup-file">
            <FileUp aria-hidden="true" size={16} />{t('Import backup')}
            <input
              accept=".json,application/json"
              className="sr-only"
              disabled={backupBusy}
              id="backup-file"
              onChange={(event) => void readBackup(event)}
              type="file"
            />
          </label>
        </div>
        {backupBusy && <div className="mt-3"><SectionMessage message="Reading and validating backup…" /></div>}
        {backupMessage && <div className="mt-3"><SectionMessage message={backupMessage} /></div>}
        {backupError && <div className="mt-3"><SectionMessage error message={backupError} /></div>}

        {pendingBackup && (
          <div aria-labelledby="backup-preview-heading" className="mt-5 rounded-xl border border-secondary/30 bg-secondary/5 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <Upload aria-hidden="true" className="mt-1 shrink-0 text-secondary-dark" size={18} />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold" id="backup-preview-heading">{t('Review backup replacement')}</h3>
                <p className="mt-1 break-all text-sm text-muted">{pendingBackup.fileName}</p>
                <p className="mt-3 text-sm leading-6">
                  {t('This backup will replace the current local data. Its active scenario is {{scenario}}, with {{scenarioCount}} {{scenarioUnit}} and {{profileCount}} {{profileUnit}}. Currency: {{currency}}.', {
                    scenario: pendingBackup.preview.activeScenarioName,
                    scenarioCount: new Intl.NumberFormat(locale).format(pendingBackup.preview.scenarioCount),
                    scenarioUnit: t(pendingBackup.preview.scenarioCount === 1 ? 'scenario' : 'scenarios'),
                    profileCount: new Intl.NumberFormat(locale).format(pendingBackup.preview.profileCount),
                    profileUnit: t(pendingBackup.preview.profileCount === 1 ? 'profile' : 'profiles'),
                    currency: pendingBackup.preview.currencyCode,
                  })}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {t('It contains {{incomeCount}} {{incomeUnit}} and {{expenseCount}} {{expenseUnit}}. Baseline: {{baseline}}.', {
                    incomeCount: new Intl.NumberFormat(locale).format(pendingBackup.preview.incomeItemCount),
                    incomeUnit: t(pendingBackup.preview.incomeItemCount === 1 ? 'income item' : 'income items'),
                    expenseCount: new Intl.NumberFormat(locale).format(pendingBackup.preview.expenseItemCount),
                    expenseUnit: t(pendingBackup.preview.expenseItemCount === 1 ? 'expense item' : 'expense items'),
                    baseline: pendingBackup.preview.baselineScenarioName,
                  })}
                </p>
                <ul className="mt-2 list-inside list-disc text-sm text-muted">
                  {pendingBackup.preview.scenarioNames.map((scenarioName) => <li key={scenarioName.id}>{scenarioName.name}</li>)}
                </ul>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button className={buttonClassName} disabled={backupBusy} onClick={confirmBackupReplacement} type="button">
                    {t('Replace current data')}
                  </button>
                  <button className={secondaryButtonClassName} onClick={() => {
                    setPendingBackup(null)
                    setBackupError(null)
                  }} type="button">
                    {t('Cancel')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const [backupRestored, setBackupRestored] = useState(false)
  const activeScenarioId = useAppStore((state) => state.activeScenarioId)
  const scenario = useAppStore((state) => state.scenarios[activeScenarioId])
  const currencyCode = useAppStore((state) => state.settings.currencyCode)

  if (!scenario) {
    return (
      <p className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">
        {t('The active scenario is unavailable. Select a valid scenario before changing settings.')}
      </p>
    )
  }

  return (
    <>
      {backupRestored && (
        <p className="mb-5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary" role="status">
          {t('Backup restored successfully.')}
        </p>
      )}
      <SettingsEditor
        key={scenario.id}
        onBackupRestored={() => setBackupRestored(true)}
        onBackupStart={() => setBackupRestored(false)}
        scenario={scenario}
        currencyCode={currencyCode}
      />
    </>
  )
}
