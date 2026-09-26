// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppData, AppStore } from '../../types'
import { createInitialAppData, useAppStore } from '../../store/useAppStore'
import { AppRoutes } from '../../routes/AppRoutes'
import i18n from '../../i18n'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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

function waitForReady(): Promise<void> {
  if (useAppStore.getState().hydrationStatus === 'ready') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Timed out waiting for hydration'))
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

async function mountPlanning() {
  await import('./PlanningPage')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<MemoryRouter initialEntries={['/planning?month=2026-06']}><AppRoutes /></MemoryRouter>)
    await Promise.resolve()
  })
  await act(async () => Promise.resolve())
}

function sectionByName(name: string): HTMLElement {
  const section = container.querySelector<HTMLElement>(`section[aria-label="${name}"]`)
  if (!section) throw new Error(`Section "${name}" was not found`)
  return section
}

function labelInput(section: HTMLElement, labelText: string): HTMLInputElement {
  const label = Array.from(section.querySelectorAll('label')).find((candidate) => candidate.textContent?.includes(labelText))
  const input = label?.querySelector('input')
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input for "${labelText}" was not found`)
  return input
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Native input setter is unavailable')
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })))
}

function buttonIn(section: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(section.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(label))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button "${label}" was not found`)
  return button
}

describe('Planning page', () => {
  beforeEach(async () => {
    await waitForReady()
    originalData = structuredClone(appDataFromStore(useAppStore.getState()))
    useAppStore.getState().replaceData(createInitialAppData())
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
      root = undefined
    }
    container?.remove()
    useAppStore.getState().replaceData(originalData)
  })

  it('previews what-if items without saving, saves them to a new sandbox, and stores goals per scenario', async () => {
    await mountPlanning()
    expect(container.textContent).toContain('Cash-flow timeline')
    expect(container.textContent).toContain('Planned-cost insights')

    const whatIf = sectionByName('What-if planner')
    await setInputValue(labelInput(whatIf, 'Name'), 'What-if heating')
    await setInputValue(labelInput(whatIf, 'Amount (EUR)'), '25.50')
    await setInputValue(labelInput(whatIf, 'Category'), 'Utilities')
    await click(buttonIn(whatIf, 'Add to preview'))
    expect(whatIf.textContent).toContain('What-if heating')
    const baselineId = useAppStore.getState().baselineScenarioId
    const baseline = useAppStore.getState().scenarios[baselineId]
    if (!baseline) throw new Error('Baseline scenario is missing')
    expect(Object.values(baseline.profiles).flatMap((profile) => profile.ledger.expenses).some((item) => item.name === 'What-if heating')).toBe(false)

    await click(buttonIn(whatIf, 'Save as sandbox'))
    const sandboxId = useAppStore.getState().activeScenarioId
    expect(sandboxId).not.toBe(baselineId)
    const sandbox = useAppStore.getState().scenarios[sandboxId]
    expect(Object.values(sandbox?.profiles ?? {}).flatMap((profile) => profile.ledger.expenses).some((item) => item.name === 'What-if heating' && item.amountCents === 2_550)).toBe(true)
    expect(Object.values(useAppStore.getState().scenarios[baselineId]?.profiles ?? {}).flatMap((profile) => profile.ledger.expenses)).toHaveLength(0)

    const goals = sectionByName('Savings goals')
    await click(buttonIn(goals, 'Add savings goal'))
    await setInputValue(labelInput(goals, 'Name'), 'Holiday')
    await setInputValue(labelInput(goals, 'Target amount'), '1000.00')
    await setInputValue(labelInput(goals, 'Already saved'), '200.00')
    await setInputValue(labelInput(goals, 'Target date'), '2027-06-01')
    await click(buttonIn(goals, 'Save goal'))
    expect(useAppStore.getState().scenarios[sandboxId]?.planning.savingsGoals[0]).toMatchObject({
      name: 'Holiday',
      targetCents: 100_000,
      savedCents: 20_000,
      targetDate: '2027-06-01',
    })
    expect(useAppStore.getState().scenarios[baselineId]?.planning.savingsGoals).toHaveLength(0)
  })
})
