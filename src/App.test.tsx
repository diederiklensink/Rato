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
