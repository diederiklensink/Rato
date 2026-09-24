import {
  AlertTriangle,
  Copy,
  Plus,
  Save,
  Trash2,
  UserRoundPlus,
  X,
} from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import type {
  FinancialItem,
  LedgerKind,
  LedgerOwner,
  Profile,
  ProfileId,
  Recurrence,
  Scenario,
} from '../../types'
import { useAppStore } from '../../store/useAppStore'
import { FinancialItemSchema } from '../../validation/schemas'
import { currentLocalYearMonth, isYearMonth } from '../../routes/monthQuery'

type Frequency = Recurrence['frequency']
type ItemDraft = {
  name: string
  amount: string
  category: string
  frequency: Frequency
  startDate: string
  endDate: string
}
type ItemField = keyof ItemDraft
type ItemErrors = Partial<Record<ItemField, string>>
type EditingItem = {
  id: string
  mode: 'add' | 'edit'
  draft: ItemDraft
  attempted: boolean
  actionError: string | null
}

const frequencyOptions: { value: Frequency; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
]

const inputClassName = 'min-h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:bg-surface-hover'
const secondaryButtonClassName = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50'
const dangerButtonClassName = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3 text-sm font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-50'

function makeId(): string {
  return globalThis.crypto.randomUUID()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Rato could not complete that action.'
}

function parseAmountToCents(rawAmount: string): { cents: number } | { error: string } {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(rawAmount.trim())
  if (!match) return { error: 'Enter a non-negative amount with up to two decimal places.' }

  const whole = match[1]
  if (whole === undefined) return { error: 'Enter a valid amount.' }
  const fraction = match[2] ?? ''
  const centsText = `${whole}${fraction.padEnd(2, '0')}`
  const cents = Number(centsText)
  if (!Number.isSafeInteger(cents)) return { error: 'Amount is too large to store safely.' }

  return { cents }
}

function validateItemDraft(id: string, draft: ItemDraft): {
  item: FinancialItem | null
  errors: ItemErrors
} {
  const errors: ItemErrors = {}
  const amount = parseAmountToCents(draft.amount)
  if ('error' in amount) errors.amount = amount.error

  const recurrence: Recurrence = draft.frequency === 'once'
    ? { frequency: 'once', startDate: draft.startDate }
    : {
        frequency: draft.frequency,
        startDate: draft.startDate,
        endDate: draft.endDate || null,
      }

  const parsed = FinancialItemSchema.safeParse({
    id,
    name: draft.name,
    amountCents: 'cents' in amount ? amount.cents : 0,
    categoryId: draft.category,
    recurrence,
  })

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path[0] === 'recurrence' ? issue.path[1] : issue.path[0]
      if (path === 'name' || path === 'categoryId') {
        errors[path === 'categoryId' ? 'category' : 'name'] ??= issue.message
      } else if (path === 'startDate') {
        errors.startDate ??= issue.message
      } else if (path === 'endDate') {
        errors.endDate ??= issue.message
      } else if (path === 'amountCents' && !errors.amount) {
        errors.amount = issue.message
      }
    }
  }

  return { item: Object.keys(errors).length === 0 && parsed.success ? parsed.data : null, errors }
}

function draftFromItem(item: FinancialItem): ItemDraft {
  return {
    name: item.name,
    amount: `${Math.floor(item.amountCents / 100)}.${String(item.amountCents % 100).padStart(2, '0')}`,
    category: item.categoryId,
    frequency: item.recurrence.frequency,
    startDate: item.recurrence.startDate,
    endDate: item.recurrence.frequency === 'once' ? '' : item.recurrence.endDate ?? '',
  }
}

function newItemDraft(selectedMonth: string): ItemDraft {
  return {
    name: '',
    amount: '',
    category: '',
    frequency: 'monthly',
    startDate: `${selectedMonth}-01`,
    endDate: '',
  }
}

function formatCurrency(cents: number, currencyCode: string): string {
  const amount = cents / 100
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }
}

function DraftField({
  field,
  label,
  value,
  error,
  onChange,
  type = 'text',
  step,
  min,
  disabled = false,
}: {
  field: ItemField
  label: string
  value: string
  error?: string | undefined
  onChange: (field: ItemField, value: string) => void
  type?: 'text' | 'number' | 'date'
  step?: string
  min?: string
  disabled?: boolean
}) {
  const generatedId = useId().replaceAll(':', '')
  const inputId = `${generatedId}-${field}`
  const errorId = `${inputId}-error`

  return (
    <div className="min-w-0">
      <label className="mb-1 block text-xs font-medium text-muted lg:sr-only" htmlFor={inputId}>
        {label}
      </label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        className={inputClassName}
        disabled={disabled}
        id={inputId}
        min={min}
        onChange={(event) => onChange(field, event.currentTarget.value)}
        step={step}
        type={type}
        value={value}
      />
      {error && <p className="mt-1 text-xs leading-5 text-danger" id={errorId}>{error}</p>}
    </div>
  )
}

function ItemDraftCard({
  editing,
  currencyCode,
  onChange,
  onSubmit,
  onCancel,
}: {
  editing: EditingItem
  currencyCode: string
  onChange: (field: ItemField, value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}) {
  const generatedId = useId().replaceAll(':', '')
  const frequencyId = `${generatedId}-frequency`
  const validation = validateItemDraft(editing.id, editing.draft)
  const errors = editing.attempted ? validation.errors : {}
  const fieldColumns = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.35fr)_minmax(8rem,0.75fr)_minmax(8rem,1fr)_minmax(8rem,0.9fr)_minmax(8rem,1fr)_minmax(8rem,1fr)]'
  const update = (field: ItemField, value: string) => onChange(field, value)

  return (
    <form className="rounded-xl border border-secondary/30 bg-secondary/5 p-4" onSubmit={onSubmit} noValidate>
      <div className={fieldColumns}>
        <DraftField field="name" label="Name" value={editing.draft.name} error={errors.name} onChange={update} />
        <DraftField
          field="amount"
          label={`Amount (${currencyCode})`}
          value={editing.draft.amount}
          error={errors.amount}
          onChange={update}
          type="number"
          min="0"
          step="0.01"
        />
        <DraftField field="category" label="Category" value={editing.draft.category} error={errors.category} onChange={update} />
        <div className="min-w-0">
          <label className="mb-1 block text-xs font-medium text-muted lg:sr-only" htmlFor={frequencyId}>
            Frequency
          </label>
          <select
            className={inputClassName}
            id={frequencyId}
            onChange={(event) => update('frequency', event.currentTarget.value as Frequency)}
            value={editing.draft.frequency}
          >
            {frequencyOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <DraftField field="startDate" label="Start date" value={editing.draft.startDate} error={errors.startDate} onChange={update} type="date" />
        {editing.draft.frequency === 'once'
          ? <div className="hidden lg:block" aria-hidden="true" />
          : <DraftField field="endDate" label="End date (optional)" value={editing.draft.endDate} error={errors.endDate} onChange={update} type="date" />}
      </div>
      {editing.actionError && (
        <p className="mt-3 flex items-start gap-2 text-sm text-danger" role="alert">
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
          {editing.actionError}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" type="submit">
          <Save aria-hidden="true" size={15} />
          Save item
        </button>
        <button className={secondaryButtonClassName} onClick={onCancel} type="button">
          <X aria-hidden="true" size={15} />
          Cancel
        </button>
      </div>
    </form>
  )
}

function ViewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted lg:sr-only">{label}</p>
      <p className="mt-1 break-words text-sm text-foreground lg:mt-0">{value || '—'}</p>
    </div>
  )
}

function ItemRow({
  item,
  currencyCode,
  disabled,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  item: FinancialItem
  currencyCode: string
  disabled: boolean
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const recurrence = item.recurrence
  const recurrenceLabel = frequencyOptions.find(({ value }) => value === recurrence.frequency)?.label ?? recurrence.frequency
  const endDate = recurrence.frequency === 'once' ? '—' : recurrence.endDate ?? 'No end date'
  const rowColumns = 'grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.35fr)_minmax(8rem,0.75fr)_minmax(8rem,1fr)_minmax(8rem,0.9fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_auto] lg:items-center'

  return (
    <article className={rowColumns}>
      <ViewField label="Name" value={item.name} />
      <ViewField label="Amount" value={formatCurrency(item.amountCents, currencyCode)} />
      <ViewField label="Category" value={item.categoryId} />
      <ViewField label="Frequency" value={recurrenceLabel} />
      <ViewField label="Start date" value={recurrence.startDate} />
      <ViewField label="End date" value={endDate} />
      <div className="flex flex-wrap gap-2 lg:justify-end">
        <button aria-label={`Edit ${item.name}`} className={secondaryButtonClassName} disabled={disabled} onClick={onEdit} type="button">
          Edit
        </button>
        <button aria-label={`Duplicate ${item.name}`} className={secondaryButtonClassName} disabled={disabled} onClick={onDuplicate} type="button">
          <Copy aria-hidden="true" size={15} />
          Duplicate
        </button>
        <button aria-label={`Delete ${item.name}`} className={dangerButtonClassName} disabled={disabled} onClick={onDelete} type="button">
          <Trash2 aria-hidden="true" size={15} />
          Delete
        </button>
      </div>
    </article>
  )
}

function LedgerEditor({
  scenarioId,
  owner,
  ownerLabel,
  kind,
  items,
  selectedMonth,
  currencyCode,
}: {
  scenarioId: string
  owner: LedgerOwner
  ownerLabel: string
  kind: LedgerKind
  items: FinancialItem[]
  selectedMonth: string
  currencyCode: string
}) {
  const upsertItem = useAppStore((state) => state.upsertItem)
  const removeItem = useAppStore((state) => state.removeItem)
  const [editing, setEditing] = useState<EditingItem | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const label = kind === 'income' ? 'Income' : 'Expenses'
  const addLabel = kind === 'income' ? 'Add income item' : 'Add expense item'

  const beginAdd = () => {
    setActionError(null)
    setEditing({ id: makeId(), mode: 'add', draft: newItemDraft(selectedMonth), attempted: false, actionError: null })
  }

  const beginEdit = (item: FinancialItem) => {
    setActionError(null)
    setEditing({ id: item.id, mode: 'edit', draft: draftFromItem(item), attempted: false, actionError: null })
  }

  const updateDraft = (field: ItemField, value: string) => {
    setEditing((current) => current
      ? { ...current, draft: { ...current.draft, [field]: value }, actionError: null }
      : current)
  }

  const saveDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const result = validateItemDraft(editing.id, editing.draft)
    if (!result.item) {
      setEditing({ ...editing, attempted: true })
      return
    }

    try {
      upsertItem(scenarioId, owner, kind, result.item)
      setEditing(null)
      setActionError(null)
    } catch (error) {
      setEditing({ ...editing, attempted: true, actionError: errorMessage(error) })
    }
  }

  const duplicateItem = (item: FinancialItem) => {
    try {
      upsertItem(scenarioId, owner, kind, {
        ...item,
        id: makeId(),
        name: `${item.name} (copy)`,
      })
      setActionError(null)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  const deleteItem = (item: FinancialItem) => {
    const confirmed = window.confirm(`Delete “${item.name}” from ${ownerLabel} ${label.toLowerCase()}? This action cannot be undone.`)
    if (!confirmed) return
    try {
      removeItem(scenarioId, owner, kind, item.id)
      setActionError(null)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  return (
    <section aria-label={`${ownerLabel} ${label.toLowerCase()}`} className="rounded-2xl border border-border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{label}</h3>
          <p className="mt-1 text-sm text-muted">{items.length} {items.length === 1 ? 'item' : 'items'}</p>
        </div>
        <button className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-secondary-dark px-3 text-sm font-semibold text-white hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-dark disabled:cursor-not-allowed disabled:opacity-50" disabled={Boolean(editing)} onClick={beginAdd} type="button">
          <Plus aria-hidden="true" size={16} />
          {addLabel}
        </button>
      </div>

      {actionError && (
        <p className="mt-3 flex items-start gap-2 text-sm text-danger" role="alert">
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
          {actionError}
        </p>
      )}

      <div className="mt-4 hidden gap-3 px-4 text-xs font-semibold uppercase tracking-wide text-muted lg:grid lg:grid-cols-[minmax(12rem,1.35fr)_minmax(8rem,0.75fr)_minmax(8rem,1fr)_minmax(8rem,0.9fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_auto]">
        <span>Name</span><span>Amount</span><span>Category</span><span>Frequency</span><span>Start date</span><span>End date</span><span className="sr-only">Actions</span>
      </div>
      <div className="mt-3 space-y-3" aria-label={`${label} items`}>
        {editing?.mode === 'add' && (
          <ItemDraftCard
            editing={editing}
            currencyCode={currencyCode}
            onChange={updateDraft}
            onSubmit={saveDraft}
            onCancel={() => setEditing(null)}
          />
        )}
        {items.map((item) => editing?.mode === 'edit' && editing.id === item.id
          ? <ItemDraftCard
              key={item.id}
              editing={editing}
              currencyCode={currencyCode}
              onChange={updateDraft}
              onSubmit={saveDraft}
              onCancel={() => setEditing(null)}
            />
          : <ItemRow
              key={item.id}
              item={item}
              currencyCode={currencyCode}
              disabled={Boolean(editing)}
              onEdit={() => beginEdit(item)}
              onDuplicate={() => duplicateItem(item)}
              onDelete={() => deleteItem(item)}
            />)}
        {items.length === 0 && editing?.mode !== 'add' && (
          <p className="rounded-xl border border-dashed border-border-strong bg-surface p-5 text-sm text-muted">
            No {label.toLowerCase()} items yet. Add one to get started.
          </p>
        )}
      </div>
    </section>
  )
}

function ProfileNameRow({
  scenarioId,
  profile,
  isParticipant,
}: {
  scenarioId: string
  profile: Profile
  isParticipant: boolean
}) {
  const generatedId = useId().replaceAll(':', '')
  const renameProfile = useAppStore((state) => state.renameProfile)
  const removeProfile = useAppStore((state) => state.removeProfile)
  const [name, setName] = useState(profile.name)
  const [error, setError] = useState<string | null>(null)

  const saveName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const nextName = name.trim()
      renameProfile(scenarioId, profile.id, nextName)
      setName(nextName)
      setError(null)
    } catch (caughtError) {
      setError(errorMessage(caughtError))
    }
  }

  const deleteProfile = () => {
    if (isParticipant) return
    const confirmed = window.confirm(`Remove profile “${profile.name}” and its ledger from this scenario?`)
    if (!confirmed) return
    try {
      removeProfile(scenarioId, profile.id)
      setError(null)
    } catch (caughtError) {
      setError(errorMessage(caughtError))
    }
  }

  const nameId = `${generatedId}-profile-name`
  const deleteHelpId = `${generatedId}-profile-delete-help`

  return (
    <li className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <form className="min-w-0" onSubmit={saveName}>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor={nameId}>
          Name for {profile.name}
        </label>
        <div className="flex flex-wrap gap-2">
          <input className={`${inputClassName} min-w-[12rem] flex-1`} id={nameId} onChange={(event) => setName(event.currentTarget.value)} value={name} />
          <button aria-label={`Save name for ${profile.name}`} className={secondaryButtonClassName} disabled={!name.trim() || name.trim() === profile.name} type="submit">
            <Save aria-hidden="true" size={15} />
            Save profile name
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
        {isParticipant && <p className="mt-2 text-xs text-secondary-dark">Selected participant</p>}
        {isParticipant && <p className="sr-only" id={deleteHelpId}>Change the participant selection before removing this profile.</p>}
      </form>
      <button
        aria-describedby={isParticipant ? deleteHelpId : undefined}
        aria-label={`Remove profile ${profile.name}`}
        className={dangerButtonClassName}
        disabled={isParticipant}
        onClick={deleteProfile}
        type="button"
      >
        <Trash2 aria-hidden="true" size={15} />
        Remove profile
      </button>
    </li>
  )
}

function ProfileManagement({ scenario, scenarioId }: { scenario: Scenario; scenarioId: string }) {
  const addProfile = useAppStore((state) => state.addProfile)
  const setParticipants = useAppStore((state) => state.setParticipants)
  const profiles = Object.values(scenario.profiles)
  const [firstParticipant, secondParticipant] = scenario.participantIds
  const [newProfileName, setNewProfileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const profileIds = new Set(scenario.participantIds)

  const changeParticipant = (slot: 0 | 1, profileId: string) => {
    const next: [ProfileId, ProfileId] = slot === 0
      ? [profileId, secondParticipant]
      : [firstParticipant, profileId]
    try {
      setParticipants(scenarioId, next)
      setError(null)
    } catch (caughtError) {
      setError(errorMessage(caughtError))
    }
  }

  const createProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newProfileName.trim()
    if (!name) {
      setError('Enter a profile name.')
      return
    }
    try {
      addProfile(scenarioId, {
        id: makeId(),
        name,
        ledger: { income: [], expenses: [] },
      })
      setNewProfileName('')
      setError(null)
    } catch (caughtError) {
      setError(errorMessage(caughtError))
    }
  }

  const participantOptions = (excludeId: string) => profiles
    .filter((profile) => profile.id !== excludeId)
    .map((profile) => (
      <option key={profile.id} value={profile.id}>
        {profile.name} · profile {profiles.findIndex((entry) => entry.id === profile.id) + 1}
      </option>
    ))

  return (
    <section aria-labelledby="profile-management-title" className="mt-7 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight" id="profile-management-title">Profiles and participants</h2>
        <p className="mt-1 text-sm text-muted">Choose the two profiles included in settlement, or manage profile ledgers below.</p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="participant-one">Participant 1</label>
          <select
            className={inputClassName}
            id="participant-one"
            onChange={(event) => changeParticipant(0, event.currentTarget.value)}
            value={firstParticipant}
          >
            {participantOptions(secondParticipant)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="participant-two">Participant 2</label>
          <select
            className={inputClassName}
            id="participant-two"
            onChange={(event) => changeParticipant(1, event.currentTarget.value)}
            value={secondParticipant}
          >
            {participantOptions(firstParticipant)}
          </select>
        </div>
      </div>

      <form className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={createProfile}>
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="new-profile-name">New profile name</label>
          <input className={inputClassName} id="new-profile-name" onChange={(event) => setNewProfileName(event.currentTarget.value)} value={newProfileName} />
        </div>
        <button className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-secondary-dark px-3 text-sm font-semibold text-white hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-dark" type="submit">
          <UserRoundPlus aria-hidden="true" size={16} />
          Add profile
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}

      <ul className="mt-5 grid list-none gap-3 p-0">
        {profiles.map((profile) => (
          <ProfileNameRow
            key={profile.id}
            scenarioId={scenarioId}
            profile={profile}
            isParticipant={profileIds.has(profile.id)}
          />
        ))}
      </ul>
    </section>
  )
}

function LedgerPage() {
  const [searchParams] = useSearchParams()
  const activeScenarioId = useAppStore((state) => state.activeScenarioId)
  const scenario = useAppStore((state) => state.scenarios[state.activeScenarioId])
  const baselineScenarioId = useAppStore((state) => state.baselineScenarioId)
  const currencyCode = useAppStore((state) => state.settings.currencyCode)
  const [selectedProfileTab, setSelectedProfileTab] = useState<string | null>(null)
  const requestedMonth = searchParams.get('month')
  const selectedMonth = isYearMonth(requestedMonth) ? requestedMonth : currentLocalYearMonth()

  if (!scenario) {
    return <p className="rounded-xl border border-danger/30 bg-surface p-5 text-sm text-danger" role="alert">The active scenario is unavailable. Reload Rato to recover the saved data.</p>
  }

  const profiles = Object.values(scenario.profiles)
  const activeProfileId = selectedProfileTab && scenario.profiles[selectedProfileTab]
    ? selectedProfileTab
    : scenario.participantIds[0]
  const activeProfile = scenario.profiles[activeProfileId]
  const isJoint = selectedProfileTab === 'joint'
  const owner: LedgerOwner = isJoint ? { scope: 'joint' } : { scope: 'profile', profileId: activeProfileId }
  const ledger = isJoint ? scenario.joint : activeProfile?.ledger
  const ownerLabel = isJoint ? 'Joint ledger' : activeProfile?.name ?? 'Profile ledger'

  return (
    <div>
      <header>
        <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${scenario.id === baselineScenarioId ? 'text-primary' : 'text-secondary-dark'}`}>{scenario.id === baselineScenarioId ? 'Baseline' : 'Sandbox'} · {scenario.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Ledger</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Changes save to this scenario. Edit any profile or the joint ledger; settlement uses the two selected participants.
        </p>
      </header>

      <ProfileManagement key={activeScenarioId} scenario={scenario} scenarioId={activeScenarioId} />

      <section aria-labelledby="ledger-owner-title" className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight" id="ledger-owner-title">Ledger items</h2>
            <p className="mt-1 text-sm text-muted">{ownerLabel}</p>
          </div>
          <p className="text-xs font-medium text-muted">Amounts in {currencyCode}</p>
        </div>

        <div aria-label="Ledger owner" className="mt-4 flex flex-wrap gap-2" role="group">
          {profiles.map((profile) => {
            const isActive = !isJoint && activeProfileId === profile.id
            const participantIndex = scenario.participantIds.indexOf(profile.id)
            const isParticipant = participantIndex >= 0
            const activeTone = participantIndex === 1
              ? 'border-secondary-dark bg-secondary-dark text-white'
              : 'border-primary bg-primary text-white'
            const participantTone = participantIndex === 1
              ? 'bg-secondary/10 text-secondary-dark'
              : 'bg-primary/10 text-primary'
            return (
              <button
                aria-pressed={isActive}
                className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${isActive ? activeTone : 'border-border-strong bg-surface text-foreground hover:bg-surface-hover'}`}
                key={profile.id}
                onClick={() => setSelectedProfileTab(profile.id)}
                type="button"
              >
                {profile.name}
                {isParticipant && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isActive ? 'bg-white/20 text-white' : participantTone}`}>Participant</span>}
              </button>
            )
          })}
          <button
            aria-pressed={isJoint}
            className={`inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${isJoint ? 'border-primary bg-primary text-white' : 'border-border-strong bg-surface text-foreground hover:bg-surface-hover'}`}
            onClick={() => setSelectedProfileTab('joint')}
            type="button"
          >
            Joint ledger
          </button>
        </div>

        {ledger && (
          <div className="mt-5 grid gap-5">
            <LedgerEditor
              key={`${activeScenarioId}:${isJoint ? 'joint' : activeProfileId}:income`}
              scenarioId={activeScenarioId}
              owner={owner}
              ownerLabel={ownerLabel}
              kind="income"
              items={ledger.income}
              selectedMonth={selectedMonth}
              currencyCode={currencyCode}
            />
            <LedgerEditor
              key={`${activeScenarioId}:${isJoint ? 'joint' : activeProfileId}:expense`}
              scenarioId={activeScenarioId}
              owner={owner}
              ownerLabel={ownerLabel}
              kind="expense"
              items={ledger.expenses}
              selectedMonth={selectedMonth}
              currencyCode={currencyCode}
            />
          </div>
        )}
      </section>
    </div>
  )
}

export default LedgerPage
