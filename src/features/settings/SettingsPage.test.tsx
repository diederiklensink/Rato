// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage'
import { createInitialAppData, useAppStore } from '../../store/useAppStore'
import type { AppData, AppStore, FinancialItem } from '../../types'
import { serializeAppData } from '../../utils/importExport'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement
let originalData: AppData

function dataFromStore(state: AppStore): AppData {
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
      reject(new Error('Timed out waiting for store hydration'))
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

async function mountSettings() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<SettingsPage />))
}

function labelledControl(labelText: string): HTMLInputElement | HTMLSelectElement {
  const label = Array.from(container.querySelectorAll('label'))
    .find((candidate) => candidate.textContent?.trim() === labelText)
  if (!label?.htmlFor) throw new Error(`Label "${labelText}" was not found`)
  const control = document.getElementById(label.htmlFor)
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement) || !container.contains(control)) {
    throw new Error(`Control for "${labelText}" was not found`)
  }
  return control
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Button "${label}" was not found`)
  return found
}

async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    button: 0,
    cancelable: true,
  })))
}

async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
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

async function submit(control: HTMLInputElement | HTMLSelectElement) {
  const form = control.closest('form')
  if (!form) throw new Error('Control is not inside a form')
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}

function expense(id: string, categoryId: string): FinancialItem {
  return {
    id,
    name: id,
    amountCents: 12_345,
    categoryId,
    recurrence: { frequency: 'monthly', startDate: '2026-01-01', endDate: null },
  }
}

function uploadBackup(name: string, contents: string) {
  const input = container.querySelector<HTMLInputElement>('#backup-file')
  if (!input) throw new Error('Backup file control was not rendered')
  const file = new File([contents], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', { configurable: true, value: async () => contents })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  return act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('settings and backup controls', () => {
  beforeEach(async () => {
    await waitForReady()
    originalData = structuredClone(dataFromStore(useAppStore.getState()))
    useAppStore.getState().replaceData(createInitialAppData())
    const state = useAppStore.getState()
    const scenario = state.scenarios[state.activeScenarioId]
    if (!scenario) throw new Error('Initial scenario is missing')
    const [profileId] = scenario.participantIds
    state.upsertItem(scenario.id, { scope: 'profile', profileId }, 'expense', expense('rent', 'Housing'))
    state.upsertItem(scenario.id, { scope: 'joint' }, 'expense', expense('utilities', 'Utilities'))
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
      root = undefined
    }
    if (container) container.remove()
    useAppStore.getState().replaceData(originalData)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('saves scenario mode and percentage assumptions, and removes cleared category overrides', async () => {
    await mountSettings()
    await setValue(labelledControl('Settlement method'), 'equal_remainder')
    await submit(labelledControl('Settlement method'))
    let scenario = useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]
    expect(scenario?.calculationMode).toBe('equal_remainder')

    await setValue(labelledControl('Annual income growth (%)'), '2.5')
    await setValue(labelledControl('General expense inflation (%)'), '4.25')
    await setValue(labelledControl('Housing (%)'), '8.75')
    await setValue(labelledControl('Utilities (%)'), '-0.5')
    await submit(labelledControl('Annual income growth (%)'))
    scenario = useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]
    expect(scenario?.forecastAssumptions).toEqual({
      annualIncomeGrowthRate: 0.025,
      annualExpenseInflationRate: 0.0425,
      expenseInflationByCategory: { Housing: 0.0875, Utilities: -0.005 },
    })

    await setValue(labelledControl('Housing (%)'), '')
    await setValue(labelledControl('Utilities (%)'), '')
    await submit(labelledControl('Annual income growth (%)'))
    scenario = useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]
    expect(scenario?.forecastAssumptions.expenseInflationByCategory).toEqual({})

    await setValue(labelledControl('Annual income growth (%)'), '-100')
    await submit(labelledControl('Annual income growth (%)'))
    expect(container.textContent).toContain('The annual rate must be greater than −100%.')
    expect(useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]
      ?.forecastAssumptions.annualIncomeGrowthRate).toBe(0.025)
  })

  it('changes the display currency without changing stored amounts', async () => {
    await mountSettings()
    const before = useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]
    if (!before) throw new Error('Initial scenario is missing')
    const [profileId] = before.participantIds
    const amountBefore = before.profiles[profileId]?.ledger.expenses[0]?.amountCents

    const currency = labelledControl('Currency')
    expect(Array.from((currency as HTMLSelectElement).options).map((option) => option.value)).not.toContain('JPY')
    await setValue(currency, 'USD')
    await submit(currency)

    const state = useAppStore.getState()
    expect(state.settings.currencyCode).toBe('USD')
    expect(state.scenarios[state.activeScenarioId]?.profiles[profileId]?.ledger.expenses[0]?.amountCents)
      .toBe(amountBefore)
    expect(container.textContent).toContain('Stored amounts were not converted.')
  })

  it('keeps settings keyboard accessible and stacks controls at narrow widths', async () => {
    await mountSettings()
    const saveButton = button('Save mode')
    await act(async () => saveButton.focus())
    expect(document.activeElement).toBe(saveButton)
    expect(saveButton.tabIndex).toBe(0)

    const responsiveForm = Array.from(container.querySelectorAll('form'))
      .find((form) => form.className.includes('sm:grid-cols-[minmax(0,1fr)_auto]'))
    expect(responsiveForm).toBeDefined()
    expect(button('Download JSON backup').tabIndex).toBe(0)

    const backupInput = container.querySelector<HTMLInputElement>('#backup-file')
    const backupLabel = backupInput?.closest('label')
    if (!backupInput || !backupLabel) throw new Error('Backup file control is missing its label')
    await act(async () => backupInput.focus())
    expect(document.activeElement).toBe(backupInput)
    expect(backupLabel.className).toContain('focus-within:outline-2')
  })

  it('downloads a dated JSON backup through the browser download link', async () => {
    await mountSettings()
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:rato-backup')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    let downloadName = ''
    const clickLink = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download
    })

    await click(button('Download JSON backup'))

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(downloadName).toMatch(/^rato-backup-\d{4}-\d{2}-\d{2}\.json$/)
    expect(clickLink).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:rato-backup')
  })

  it('leaves current data untouched when an import is cancelled or invalid', async () => {
    await mountSettings()
    const before = structuredClone(dataFromStore(useAppStore.getState()))
    const replacement = createInitialAppData()
    const replacementScenario = replacement.scenarios[replacement.activeScenarioId]
    if (!replacementScenario) throw new Error('Replacement scenario is missing')
    replacementScenario.name = 'Imported plan'
    replacement.settings.currencyCode = 'CHF'

    await uploadBackup('backup.json', serializeAppData(replacement))
    expect(container.textContent).toContain('Review backup replacement')
    expect(container.textContent).toContain('Imported plan')
    expect(container.textContent).toContain('Currency: CHF')
    await click(button('Cancel'))
    expect(dataFromStore(useAppStore.getState())).toEqual(before)

    await uploadBackup('broken.json', '{not json')
    expect(container.textContent).toContain('The selected file is not valid JSON.')
    expect(dataFromStore(useAppStore.getState())).toEqual(before)
  })

  it('replaces local data only after the import preview is confirmed', async () => {
    await mountSettings()
    const replacement = createInitialAppData()
    const replacementScenario = replacement.scenarios[replacement.activeScenarioId]
    if (!replacementScenario) throw new Error('Replacement scenario is missing')
    replacementScenario.name = 'Restored plan'
    replacementScenario.calculationMode = 'fifty_fifty'
    replacement.settings.currencyCode = 'GBP'

    await uploadBackup('rato-backup.json', serializeAppData(replacement))
    const before = dataFromStore(useAppStore.getState())
    expect(before.scenarios[before.activeScenarioId]?.name).toBe('Baseline')
    await click(button('Replace current data'))

    const restored = useAppStore.getState()
    expect(restored.scenarios[restored.activeScenarioId]?.name).toBe('Restored plan')
    expect(restored.scenarios[restored.activeScenarioId]?.calculationMode).toBe('fifty_fifty')
    expect(restored.settings.currencyCode).toBe('GBP')
    expect(container.textContent).not.toContain('Review backup replacement')
    expect(container.textContent).toContain('Backup restored successfully.')
  })
})
