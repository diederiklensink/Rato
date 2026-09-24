import {
  AlertTriangle,
  CalendarDays,
  Check,
  CircleDollarSign,
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
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-900">
        <p className="rounded-xl border border-red-200 bg-white p-6 text-sm text-red-800" role="alert">
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <Link className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-800" to={`/${routeSearch}`}>
              <span className="grid size-11 place-items-center rounded-xl bg-emerald-800 text-white">
                <CircleDollarSign aria-hidden="true" size={25} />
              </span>
              <span>
                <span className="block text-sm font-semibold uppercase tracking-[0.18em] text-emerald-800">Rato</span>
                <span className="block text-xs text-slate-500">Private household finance</span>
              </span>
            </Link>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-900">
              <Check aria-hidden="true" size={14} />
              Saved on this device
            </span>
          </div>

          <nav aria-label="Primary navigation" className="flex flex-wrap gap-2 border-b border-slate-100 pb-4">
            {navigation.map(({ path, label, icon: Icon, end }) => (
              <NavLink
                className={({ isActive }) => [
                  'inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800',
                  isActive
                    ? 'bg-emerald-100 text-emerald-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
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
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="active-scenario">
                  Active scenario
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
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
                    isBaseline ? 'bg-slate-100 text-slate-700' : 'bg-violet-100 text-violet-900'
                  }`}>
                    {isBaseline ? 'Baseline' : 'Sandbox'}
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="selected-month">
                  <CalendarDays aria-hidden="true" size={14} />
                  Selected month
                </label>
                <input
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                  id="selected-month"
                  onChange={(event) => updateMonth(event.currentTarget.value)}
                  type="month"
                  value={selectedMonth}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              <button
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-emerald-800 bg-emerald-800 px-3 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                onClick={() => openScenarioForm('duplicate')}
                type="button"
              >
                <Plus aria-hidden="true" size={16} />
                Create sandbox
              </button>
              <button
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                onClick={() => openScenarioForm('rename')}
                type="button"
              >
                <Pencil aria-hidden="true" size={15} />
                Rename
              </button>
              <button
                aria-describedby={isBaseline ? 'baseline-delete-help' : undefined}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isBaseline}
                onClick={onDeleteScenario}
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
                Delete sandbox
              </button>
            </div>

            {isBaseline && (
              <p className="text-xs text-slate-500 xl:col-span-2" id="baseline-delete-help">
                The baseline scenario is protected from deletion.
              </p>
            )}

            {scenarioFormMode && (
              <form
                className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end xl:col-span-2"
                onSubmit={saveScenarioForm}
              >
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-800" htmlFor="scenario-name">
                    {scenarioFormMode === 'duplicate' ? 'Name for the new sandbox' : 'Scenario name'}
                  </label>
                  <input
                    autoFocus
                    className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                    id="scenario-name"
                    onChange={(event) => setScenarioName(event.currentTarget.value)}
                    value={scenarioName}
                  />
                </div>
                <div className="flex gap-2">
                  <button className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800" type="submit">
                    <Check aria-hidden="true" size={15} />
                    {scenarioFormMode === 'duplicate' ? 'Create' : 'Save name'}
                  </button>
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
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
              <p className="flex items-start gap-2 text-sm text-red-800 xl:col-span-2" role="alert">
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

function DashboardPage() {
  const activeScenarioId = useAppStore((state) => state.activeScenarioId)
  const scenario = useAppStore((state) => state.scenarios[activeScenarioId])

  return (
    <section>
      <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        Your local workspace is ready. Settlement summaries and dashboard visualizations arrive in Phase 5.
      </p>
      {scenario && (
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {scenario.participantIds.map((profileId) => {
            const profile = scenario.profiles[profileId]
            if (!profile) return null
            return (
              <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={profileId}>
                <h2 className="text-lg font-semibold">{profile.name}</h2>
                <p className="mt-2 text-sm text-slate-600">
                  {profile.ledger.income.length} income items · {profile.ledger.expenses.length} expense items
                </p>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function PlaceholderPage({ title, phase, description }: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">{phase}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
    </section>
  )
}

function NotFoundPage() {
  const location = useLocation()
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Page not found</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">That Rato page does not exist</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Check the address or return to your overview.</p>
      <Link
        className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
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
        <Route element={<PlaceholderPage
          description="Income and expense editors for your profiles and joint ledger arrive in Phase 4."
          phase="Planned for Phase 4"
          title="Ledger"
        />} path="editor" />
        <Route element={<PlaceholderPage
          description="Calculation mode, forecast assumptions, and currency controls arrive in Phase 6."
          phase="Planned for Phase 6"
          title="Settings"
        />} path="settings" />
        <Route element={<NotFoundPage />} path="*" />
      </Route>
    </Routes>
  )
}

export default AppRoutes
