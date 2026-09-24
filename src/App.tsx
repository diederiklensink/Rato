import { useState } from 'react'
import { AlertTriangle, Check, CircleDollarSign, Database, RotateCcw } from 'lucide-react'
import { useAppStore } from './store/useAppStore'

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 text-slate-900">
      <section className="flex w-full max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-800">
          <CircleDollarSign aria-hidden="true" size={30} />
        </span>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-800">Rato</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Your finances, locally</h1>
        <p className="mt-3 text-sm text-slate-600" role="status" aria-live="polite">
          Loading your locally stored data…
        </p>
        <span className="mt-6 size-5 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" aria-hidden="true" />
      </section>
    </main>
  )
}

function RecoveryScreen() {
  const retryHydration = useAppStore((state) => state.retryHydration)
  const resetToFreshBaseline = useAppStore((state) => state.resetToFreshBaseline)
  const [resetting, setResetting] = useState(false)

  const reset = async () => {
    const confirmed = window.confirm(
      'Reset Rato on this device? This removes the saved data from this browser and creates a new empty baseline.',
    )
    if (!confirmed) return
    setResetting(true)
    try {
      await resetToFreshBaseline()
    } finally {
      setResetting(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 text-slate-900">
      <section className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-8 shadow-sm sm:p-10">
        <span className="grid size-12 place-items-center rounded-xl bg-amber-100 text-amber-800">
          <AlertTriangle aria-hidden="true" size={25} />
        </span>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-800">Rato</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Your saved data needs attention</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600" role="alert">
          Rato could not read the saved data in this browser. It has been left untouched. You can retry loading it or reset this device to a new empty baseline.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-wait disabled:opacity-60"
            type="button"
            onClick={retryHydration}
          >
            <RotateCcw aria-hidden="true" size={17} />
            Retry loading
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700 disabled:cursor-wait disabled:opacity-60"
            type="button"
            onClick={() => void reset()}
            disabled={resetting}
          >
            {resetting ? 'Resetting…' : 'Reset local data'}
          </button>
        </div>
        <p className="mt-5 text-xs text-slate-500">
          Reset removes this app’s saved data from the current browser only.
        </p>
      </section>
    </main>
  )
}

function ReadyScreen() {
  const activeScenarioId = useAppStore((state) => state.activeScenarioId)
  const baselineScenarioId = useAppStore((state) => state.baselineScenarioId)
  const scenario = useAppStore((state) => state.scenarios[activeScenarioId])

  if (!scenario) return <LoadingScreen />

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-emerald-800 text-white">
            <CircleDollarSign aria-hidden="true" size={25} />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-800">Rato</p>
            <p className="text-xs text-slate-500">Private household finance</p>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-900">
            <Check aria-hidden="true" size={14} />
            Saved on this device
          </span>
        </header>

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{scenario.name}</h1>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {scenario.id === baselineScenarioId ? 'Baseline' : 'Sandbox'}
            </span>
          </div>
          <p className="mt-3 max-w-2xl leading-7 text-slate-600">
            Your local workspace is ready. Your profiles and financial scenarios are stored in this browser.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {scenario.participantIds.map((profileId, index) => {
              const profile = scenario.profiles[profileId]
              if (!profile) return null
              return (
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-5" key={profileId}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Partner {index + 1}</p>
                  <h2 className="mt-2 text-lg font-semibold">{profile.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {profile.ledger.income.length} income items · {profile.ledger.expenses.length} expense items
                  </p>
                </article>
              )
            })}
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-600">
            <Database className="mt-0.5 shrink-0 text-emerald-800" aria-hidden="true" size={18} />
            <p>
              Your data stays on this device. Scenario editing and the dashboard will appear in the next development phases.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}

export default function App() {
  const hydrationStatus = useAppStore((state) => state.hydrationStatus)

  if (hydrationStatus === 'loading') return <LoadingScreen />
  if (hydrationStatus === 'recovery_required') return <RecoveryScreen />
  return <ReadyScreen />
}
