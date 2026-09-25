// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { useAppStore } from './store/useAppStore'

let root: Root | undefined
let container: HTMLDivElement

async function waitForReady() {
  if (useAppStore.getState().hydrationStatus === 'ready') return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Timed out waiting for app hydration'))
    }, 5_000)
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.hydrationStatus === 'ready') {
        clearTimeout(timeout)
        unsubscribe()
        resolve()
      }
    })
  })
}

describe('hydration shell', () => {
  beforeEach(async () => {
    await waitForReady()
    window.history.replaceState({}, '', '/')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
      root = undefined
    }
    useAppStore.setState({ hydrationStatus: 'ready', hydrationError: null })
    container.remove()
  })

  it('switches the app language, updates the document language, and stores only a browser preference', async () => {
    const before = useAppStore.getState()
    const appDataBefore = JSON.stringify({
      schemaVersion: before.schemaVersion,
      baselineScenarioId: before.baselineScenarioId,
      activeScenarioId: before.activeScenarioId,
      scenarios: before.scenarios,
      settings: before.settings,
    })
    window.history.replaceState({}, '', '/settings')

    await act(async () => root?.render(<App />))
    const language = container.querySelector<HTMLSelectElement>('#app-language')
    expect(language).not.toBeNull()
    if (!language) throw new Error('Language selector was not rendered')
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    if (!valueSetter) throw new Error('Native select value setter is unavailable')

    await act(async () => {
      valueSetter.call(language, 'nl')
      language.dispatchEvent(new Event('input', { bubbles: true }))
      language.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.textContent).toContain('Taal')
    expect(container.textContent).toContain('Back-up en herstel')
    expect(document.documentElement.lang).toBe('nl')
    expect(window.localStorage.getItem('rato.language')).toBe('nl')
    const after = useAppStore.getState()
    expect(JSON.stringify({
      schemaVersion: after.schemaVersion,
      baselineScenarioId: after.baselineScenarioId,
      activeScenarioId: after.activeScenarioId,
      scenarios: after.scenarios,
      settings: after.settings,
    })).toBe(appDataBefore)
  })

  it('renders loading, ready, and recovery states', async () => {
    await act(async () => {
      window.history.replaceState({}, '', '/editor?month=2026-06')
      useAppStore.setState({ hydrationStatus: 'loading', hydrationError: null })
      root?.render(<App />)
    })
    expect(container.textContent).toContain('Loading your locally stored data')

    await act(async () => {
      useAppStore.setState({ hydrationStatus: 'ready', hydrationError: null })
    })
    expect(container.textContent).toContain('Profiles and participants')
    expect(container.textContent).toContain('Ledger items')
    expect(container.querySelector('#active-scenario')?.textContent).toContain('Baseline')
    expect(container.querySelector<HTMLInputElement>('#selected-month')?.value).toBe('2026-06')

    await act(async () => {
      useAppStore.setState({
        hydrationStatus: 'recovery_required',
        hydrationError: 'Invalid saved data',
      })
    })
    expect(container.textContent).toContain('Your saved data needs attention')
    expect(container.textContent).toContain('Retry loading')
    expect(container.textContent).toContain('Reset local data')
  })
})
