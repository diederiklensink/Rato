import {
  AlertTriangle,
  CalendarDays,
  Check,
  FileSpreadsheet,
  LayoutDashboard,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import {
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from 'react-router-dom'
import type { Scenario, ScenarioId } from '../types'
import { useAppStore } from '../store/useAppStore'
import { currentLocalYearMonth, isYearMonth } from './monthQuery'
import LedgerPage from '../features/ledger/LedgerPage'
import DashboardPage from '../features/dashboard/DashboardPage'
import SettingsPage from '../features/settings/SettingsPage'

type ScenarioFormMode = 'duplicate' | 'rename' | null

const navigation = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { path: '/editor', label: 'Ledger', icon: FileSpreadsheet, end: false },
  { path: '/settings', label: 'Settings', icon: Settings, end: false },
] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Rato could not complete that action.'
}

function roleForScenario(scenario: Scenario, baselineScenarioId: ScenarioId): string {
  return scenario.id === baselineScenarioId ? 'Baseline' : 'Sandbox'
}

function AppLayout() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeScenarioId = useAppStore((state) => state.activeScenarioId)
  const baselineScenarioId = useAppStore((state) => state.baselineScenarioId)
  const scenarios = useAppStore((state) => state.scenarios)
  const setActiveScenario = useAppStore((state) => state.setActiveScenario)
  const duplicateScenario = useAppStore((state) => state.duplicateScenario)
  const renameScenario = useAppStore((state) => state.renameScenario)
  const deleteScenario = useAppStore((state) => state.deleteScenario)
  const activeScenario = scenarios[activeScenarioId]
  const requestedMonth = searchParams.get('month')
  const selectedMonth = isYearMonth(requestedMonth)
    ? requestedMonth
    : currentLocalYearMonth()
  const [scenarioFormMode, setScenarioFormMode] = useState<ScenarioFormMode>(null)
  const [scenarioName, setScenarioName] = useState('')
  const [scenarioError, setScenarioError] = useState<string | null>(null)

  useEffect(() => {
    const monthValues = searchParams.getAll('month')
    if (monthValues.length === 1 && monthValues[0] === selectedMonth) return

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('month')
    nextParams.set('month', selectedMonth)
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, selectedMonth, setSearchParams])

  if (!activeScenario) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <p className="rounded-xl border border-danger/30 bg-surface p-6 text-sm text-danger" role="alert">
          The active scenario is unavailable. Reload Rato to recover the saved data.
        </p>
      </main>
    )
  }

  const orderedScenarios = Object.values(scenarios).sort((left, right) => {
    if (left.id === baselineScenarioId) return -1
    if (right.id === baselineScenarioId) return 1
    return left.name.localeCompare(right.name) || left.createdAt.localeCompare(right.createdAt)
  })
  const isBaseline = activeScenario.id === baselineScenarioId

  const updateMonth = (month: string) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('month')
    nextParams.set('month', isYearMonth(month) ? month : currentLocalYearMonth())
    setSearchParams(nextParams, { replace: true })
  }

  const openScenarioForm = (mode: Exclude<ScenarioFormMode, null>) => {
    setScenarioError(null)
    setScenarioName(mode === 'duplicate' ? `Copy of ${activeScenario.name}` : activeScenario.name)
    setScenarioFormMode(mode)
  }

  const saveScenarioForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = scenarioName.trim()
    if (!trimmedName) {
      setScenarioError('Enter a scenario name.')
      return
    }

    try {
      if (scenarioFormMode === 'duplicate') {
        duplicateScenario(activeScenario.id, trimmedName)
      } else if (scenarioFormMode === 'rename') {
        renameScenario(activeScenario.id, trimmedName)
      }
      setScenarioError(null)
      setScenarioFormMode(null)
    } catch (error) {
      setScenarioError(errorMessage(error))
    }
  }

  const onScenarioChange = (scenarioId: string) => {
    try {
      setActiveScenario(scenarioId)
      setScenarioError(null)
      setScenarioFormMode(null)
    } catch (error) {
      setScenarioError(errorMessage(error))
    }
  }

  const onDeleteScenario = () => {
    if (isBaseline) return
    const confirmed = window.confirm(
      `Delete the sandbox “${activeScenario.name}”? Its scenario data will be removed from this device.`,
    )
    if (!confirmed) return

    try {
      deleteScenario(activeScenario.id)
      setScenarioError(null)
      setScenarioFormMode(null)
    } catch (error) {
      setScenarioError(errorMessage(error))
    }
  }

  const routeParams = new URLSearchParams(searchParams)
  routeParams.set('month', selectedMonth)
  const routeSearch = `?${routeParams.toString()}`

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <Link className="flex items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary" to={`/${routeSearch}`}>
              <img alt="Rato, household finance" className="h-12 w-auto" height="56" src={`${import.meta.env.BASE_URL}logo.svg`} width="204" />
            </Link>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
              <Check aria-hidden="true" size={14} />
              Saved on this device
            </span>
          </div>

          <nav aria-label="Primary navigation" className="flex flex-wrap gap-2 border-b border-border pb-4">
            {navigation.map(({ path, label, icon: Icon, end }) => (
              <NavLink
                className={({ isActive }) => [
                  'inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted hover:bg-surface-hover hover:text-foreground',
                ].join(' ')}
                end={end}
                key={path}
                to={`${path}${routeSearch}`}
              >
                <Icon aria-hidden="true" size={17} />
                {label}
              </NavLink>
            ))}
          </nav>

          <section aria-label="Workspace controls" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.55fr)]">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="active-scenario">
                  Active scenario
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    id="active-scenario"
                    onChange={(event) => onScenarioChange(event.currentTarget.value)}
                    value={activeScenario.id}
                  >
                    {orderedScenarios.map((scenario) => (
                      <option key={scenario.id} value={scenario.id}>
                        {scenario.name} · {roleForScenario(scenario, baselineScenarioId)}
                      </option>
                    ))}
                  </select>
                  <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    isBaseline ? 'bg-surface-hover text-muted' : 'bg-secondary/10 text-secondary-dark'
                  }`}>
                    {isBaseline ? 'Baseline' : 'Sandbox'}
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="selected-month">
                  <CalendarDays aria-hidden="true" size={14} />
                  Selected month
                </label>
                <input
                  className="min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  id="selected-month"
                  onChange={(event) => updateMonth(event.currentTarget.value)}
                  type="month"
                  value={selectedMonth}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              <button
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-primary bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                onClick={() => openScenarioForm('duplicate')}
                type="button"
              >
                <Plus aria-hidden="true" size={16} />
                Create sandbox
              </button>
              <button
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                onClick={() => openScenarioForm('rename')}
                type="button"
              >
                <Pencil aria-hidden="true" size={15} />
                Rename
              </button>
              <button
                aria-describedby={isBaseline ? 'baseline-delete-help' : undefined}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3 text-sm font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isBaseline}
                onClick={onDeleteScenario}
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
                Delete sandbox
              </button>
            </div>

            {isBaseline && (
              <p className="text-xs text-muted xl:col-span-2" id="baseline-delete-help">
                The baseline scenario is protected from deletion.
              </p>
            )}

            {scenarioFormMode && (
              <form
                className="grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end xl:col-span-2"
                onSubmit={saveScenarioForm}
              >
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="scenario-name">
                    {scenarioFormMode === 'duplicate' ? 'Name for the new sandbox' : 'Scenario name'}
                  </label>
                  <input
                    autoFocus
                    className="min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    id="scenario-name"
                    onChange={(event) => setScenarioName(event.currentTarget.value)}
                    value={scenarioName}
                  />
                </div>
                <div className="flex gap-2">
                  <button className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" type="submit">
                    <Check aria-hidden="true" size={15} />
                    {scenarioFormMode === 'duplicate' ? 'Create' : 'Save name'}
                  </button>
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    onClick={() => {
                      setScenarioFormMode(null)
                      setScenarioError(null)
                    }}
                    type="button"
                  >
                    <X aria-hidden="true" size={15} />
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {scenarioError && (
              <p className="flex items-start gap-2 text-sm text-danger xl:col-span-2" role="alert">
                <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
                {scenarioError}
              </p>
            )}
          </section>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Outlet />
      </main>
    </div>
  )
}

function NotFoundPage() {
  const location = useLocation()
  return (
    <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-9">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-secondary-dark">Page not found</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">That Rato page does not exist</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Check the address or return to your overview.</p>
      <Link
        className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        to={`/${location.search}`}
      >
        Go to overview
      </Link>
    </section>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />} path="/">
        <Route element={<DashboardPage />} index />
        <Route element={<LedgerPage />} path="editor" />
        <Route element={<SettingsPage />} path="settings" />
        <Route element={<NotFoundPage />} path="*" />
      </Route>
    </Routes>
  )
}

export default AppRoutes
