import { useState } from 'react'
import { AlertTriangle, CircleDollarSign, RotateCcw } from 'lucide-react'
import { BrowserRouter } from 'react-router-dom'
import AppRoutes from './routes/AppRoutes'
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
  const [resetError, setResetError] = useState<string | null>(null)

  const reset = async () => {
    const confirmed = window.confirm(
      'Reset Rato on this device? This removes the saved data from this browser and creates a new empty baseline.',
    )
    if (!confirmed) return
    setResetting(true)
    setResetError(null)
    try {
      await resetToFreshBaseline()
    } catch {
      setResetError('Rato could not reset local storage. The saved data has not been replaced.')
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
        {resetError && <p className="mt-3 text-sm text-red-700" role="alert">{resetError}</p>}
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

export default function App() {
  const hydrationStatus = useAppStore((state) => state.hydrationStatus)

  if (hydrationStatus === 'loading') return <LoadingScreen />
  if (hydrationStatus === 'recovery_required') return <RecoveryScreen />
  return <BrowserRouter><AppRoutes /></BrowserRouter>
}
