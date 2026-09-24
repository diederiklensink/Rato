// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './AppRoutes'
import { currentLocalYearMonth } from './monthQuery'
import { createInitialAppData, useAppStore } from '../store/useAppStore'
import type { AppData, AppStore, HydrationStatus } from '../types'

let root: Root | undefined
let container: HTMLDivElement
let originalData: AppData

function appDataFromStore(state: AppStore): AppData {
  return {
    schemaVersion: state.schemaVersion,
    baselineScenarioId: state.baselineScenarioId,
    activeScenarioId: state.activeScenarioId,
    scenarios: state.scenarios,
    settings: state.settings,
  }
}

function waitForStatus(status: HydrationStatus): Promise<void> {
  if (useAppStore.getState().hydrationStatus === status) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timed out waiting for hydration status "${status}"`))
    }, 5_000)
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.hydrationStatus === status) {
        clearTimeout(timeout)
        unsubscribe()
        resolve()
      }
    })
  })
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function HistoryControls() {
  const navigate = useNavigate()
  return (
    <div>
      <button onClick={() => navigate(-1)} type="button">Test back</button>
      <button onClick={() => navigate(1)} type="button">Test forward</button>
    </div>
  )
}

async function mountAt(entry: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
        <LocationProbe />
        <HistoryControls />
      </MemoryRouter>,
    )
  })
  await act(async () => Promise.resolve())
}

function textButton(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(label))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button "${label}" was not found`)
  return button
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true }))
  })
}

async function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLInputElement
    ? window.HTMLInputElement.prototype
    : window.HTMLSelectElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!valueSetter) throw new Error('Native value setter is unavailable')

  await act(async () => {
    valueSetter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function currentLocation(): string {
  const output = container.querySelector('[data-testid="location"]')
  if (!output) throw new Error('Router location was not rendered')
  return output.textContent ?? ''
}

describe('application routes and shell', () => {
  beforeEach(async () => {
    await waitForStatus('ready')
    originalData = structuredClone(appDataFromStore(useAppStore.getState()))
    useAppStore.getState().replaceData(createInitialAppData())
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
      root = undefined
    }
    if (container) container.remove()
    useAppStore.getState().replaceData(originalData)
    vi.restoreAllMocks()
  })

  it.each([
    ['/', 'Overview'],
    ['/editor?month=2026-06', 'Ledger'],
    ['/settings?month=2026-06', 'Settings'],
    ['/unknown?month=2026-06', 'That Rato page does not exist'],
  ])('renders the correct page for direct route %s', async (path, expectedText) => {
    await mountAt(path)
    expect(container.textContent).toContain(expectedText)
    expect(container.querySelector('nav[aria-label="Primary navigation"]')).not.toBeNull()
  })

  it('preserves a valid month across route navigation and browser history', async () => {
    await mountAt('/?month=2025-04')
    expect(currentLocation()).toBe('/?month=2025-04')
    expect(container.querySelector<HTMLAnchorElement>('nav a[href^="/editor"]')?.getAttribute('href'))
      .toBe('/editor?month=2025-04')

    const editorLink = container.querySelector<HTMLAnchorElement>('nav a[href^="/editor"]')
    if (!editorLink) throw new Error('Ledger navigation link was not found')
    await click(editorLink)
    expect(currentLocation()).toBe('/editor?month=2025-04')
    expect(container.querySelector<HTMLAnchorElement>('nav a[aria-current="page"]')?.textContent)
      .toContain('Ledger')

    const monthInput = container.querySelector<HTMLInputElement>('#selected-month')
    if (!monthInput) throw new Error('Selected month control was not found')
    await setNativeValue(monthInput, '2026-10')
    expect(currentLocation()).toBe('/editor?month=2026-10')

    await click(textButton('Test back'))
    expect(currentLocation()).toBe('/?month=2025-04')
    await click(textButton('Test forward'))
    expect(currentLocation()).toBe('/editor?month=2026-10')
  })

  it('normalizes a missing or invalid month to the current local month', async () => {
    const currentMonth = currentLocalYearMonth()
    await mountAt('/editor')
    expect(currentLocation()).toBe(`/editor?month=${currentMonth}`)
    expect(container.querySelector<HTMLInputElement>('#selected-month')?.value).toBe(currentMonth)

    await act(async () => root?.unmount())
    root = undefined
    container.remove()
    await mountAt('/settings?month=2026-13')
    expect(currentLocation()).toBe(`/settings?month=${currentMonth}`)
    expect(container.querySelector<HTMLInputElement>('#selected-month')?.value).toBe(currentMonth)
  })

  it('creates, selects, renames, and deletes a sandbox while protecting the baseline', async () => {
    const store = useAppStore.getState()
    const baselineId = store.baselineScenarioId
    await mountAt('/?month=2026-06')

    expect(textButton('Delete sandbox').disabled).toBe(true)
    await click(textButton('Create sandbox'))
    const nameInput = container.querySelector<HTMLInputElement>('#scenario-name')
    const form = container.querySelector<HTMLFormElement>('form')
    if (!nameInput || !form) throw new Error('Sandbox form was not rendered')
    await setNativeValue(nameInput, 'House purchase')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    const sandboxId = useAppStore.getState().activeScenarioId
    expect(sandboxId).not.toBe(baselineId)
    expect(useAppStore.getState().scenarios[sandboxId]?.parentScenarioId).toBe(baselineId)
    expect(container.textContent).toContain('Sandbox')

    const scenarioSelect = container.querySelector<HTMLSelectElement>('#active-scenario')
    if (!scenarioSelect) throw new Error('Scenario selector was not rendered')
    await setNativeValue(scenarioSelect, baselineId)
    expect(useAppStore.getState().activeScenarioId).toBe(baselineId)
    await setNativeValue(scenarioSelect, sandboxId)
    expect(useAppStore.getState().activeScenarioId).toBe(sandboxId)

    await click(textButton('Rename'))
    const renameInput = container.querySelector<HTMLInputElement>('#scenario-name')
    const renameForm = container.querySelector<HTMLFormElement>('form')
    if (!renameInput || !renameForm) throw new Error('Rename form was not rendered')
    await setNativeValue(renameInput, 'House plan')
    await act(async () => {
      renameForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(useAppStore.getState().scenarios[sandboxId]?.name).toBe('House plan')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await click(textButton('Delete sandbox'))
    expect(useAppStore.getState().scenarios[sandboxId]).toBeUndefined()
    expect(useAppStore.getState().activeScenarioId).toBe(baselineId)
    expect(container.querySelector<HTMLButtonElement>('button[aria-describedby="baseline-delete-help"]')?.disabled)
      .toBe(true)
  })
})
