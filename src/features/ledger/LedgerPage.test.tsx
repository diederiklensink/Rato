// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppData, AppStore, FinancialItem, HydrationStatus } from '../../types'
import { createInitialAppData, useAppStore } from '../../store/useAppStore'
import { AppRoutes } from '../../routes/AppRoutes'

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

async function mountLedger() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/editor?month=2026-06']}>
        <AppRoutes />
      </MemoryRouter>,
    )
  })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label)
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Button "${label}" was not found`)
  return found
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

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true }))
  })
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

function addItemToActiveProfile(item: FinancialItem) {
  const state = useAppStore.getState()
  const scenario = state.scenarios[state.activeScenarioId]
  if (!scenario) throw new Error('Active scenario is missing')
  const [profileId] = scenario.participantIds
  state.upsertItem(scenario.id, { scope: 'profile', profileId }, 'income', item)
}

describe('ledger and profile editors', () => {
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

  it('adds profile income using decimal input converted to integer cents', async () => {
    await mountLedger()
    await click(button('Add income item'))
    await setValue(labelledControl('Name'), 'Salary')
    await setValue(labelledControl('Amount (EUR)'), '1234.56')
    await setValue(labelledControl('Category'), 'Employment')
    await click(button('Save item'))

    const state = useAppStore.getState()
    const scenario = state.scenarios[state.activeScenarioId]
    if (!scenario) throw new Error('Active scenario is missing')
    const [profileId] = scenario.participantIds
    const item = scenario.profiles[profileId]?.ledger.income[0]
    expect(item?.amountCents).toBe(123_456)
    expect(item?.categoryId).toBe('Employment')
    expect(item?.recurrence).toEqual({ frequency: 'monthly', startDate: '2026-06-01', endDate: null })
  })

  it('keeps owner controls keyboard focusable and switches item forms to stacked layouts on narrow screens', async () => {
    await mountLedger()
    const ownerButton = button('Joint ledger')
    await act(async () => ownerButton.focus())
    expect(document.activeElement).toBe(ownerButton)

    await click(button('Add income item'))
    const amountInput = labelledControl('Amount (EUR)')
    expect(amountInput.tabIndex).toBe(0)
    const responsiveFieldGrid = Array.from(container.querySelectorAll('form > div'))
      .find((element) => element.className.includes('grid-cols-1') && element.className.includes('lg:grid-cols-'))
    expect(responsiveFieldGrid).toBeDefined()
  })

  it('edits, duplicates, and confirms deletes for profile and joint items', async () => {
    const sample: FinancialItem = {
      id: 'rent-item',
      name: 'Rent',
      amountCents: 150_000,
      categoryId: 'Housing',
      recurrence: { frequency: 'monthly', startDate: '2026-01-01', endDate: null },
    }
    addItemToActiveProfile(sample)
    await mountLedger()

    await click(button('Edit Rent'))
    await setValue(labelledControl('Amount (EUR)'), '1725.00')
    await click(button('Save item'))
    expect(useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]?.profiles[
      useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]?.participantIds[0] ?? ''
    ]?.ledger.income[0]?.amountCents).toBe(172_500)

    await click(button('Duplicate Rent'))
    const scenarioId = useAppStore.getState().activeScenarioId
    let scenario = useAppStore.getState().scenarios[scenarioId]
    if (!scenario) throw new Error('Active scenario is missing')
    let profileId = scenario.participantIds[0]
    let incomes = scenario.profiles[profileId]?.ledger.income ?? []
    expect(incomes).toHaveLength(2)
    expect(incomes[1]?.id).not.toBe(incomes[0]?.id)
    expect(incomes[1]?.name).toBe('Rent (copy)')

    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await click(button('Delete Rent'))
    expect(confirmation).toHaveBeenCalledOnce()
    expect(useAppStore.getState().scenarios[scenarioId]?.profiles[profileId]?.ledger.income).toHaveLength(2)
    confirmation.mockReturnValue(true)
    await click(button('Delete Rent'))
    scenario = useAppStore.getState().scenarios[scenarioId]
    if (!scenario) throw new Error('Active scenario is missing')
    profileId = scenario.participantIds[0]
    incomes = scenario.profiles[profileId]?.ledger.income ?? []
    expect(incomes).toHaveLength(1)
    expect(incomes[0]?.name).toBe('Rent (copy)')

    await click(button('Joint ledger'))
    await click(button('Add expense item'))
    await setValue(labelledControl('Name'), 'Insurance')
    await setValue(labelledControl('Amount (EUR)'), '40.50')
    await setValue(labelledControl('Category'), 'Home')
    await setValue(labelledControl('Frequency'), 'yearly')
    await setValue(labelledControl('Start date'), '2026-06-15')
    await click(button('Save item'))
    expect(useAppStore.getState().scenarios[scenarioId]?.joint.expenses[0]).toMatchObject({
      name: 'Insurance',
      amountCents: 4_050,
      recurrence: { frequency: 'yearly', startDate: '2026-06-15', endDate: null },
    })

    await click(button('Edit Insurance'))
    await setValue(labelledControl('Amount (EUR)'), '42.75')
    await click(button('Save item'))
    expect(useAppStore.getState().scenarios[scenarioId]?.joint.expenses[0]?.amountCents).toBe(4_275)
    await click(button('Duplicate Insurance'))
    const jointItems = useAppStore.getState().scenarios[scenarioId]?.joint.expenses ?? []
    expect(jointItems).toHaveLength(2)
    expect(jointItems[1]?.id).not.toBe(jointItems[0]?.id)
    expect(jointItems[1]?.name).toBe('Insurance (copy)')
    await click(button('Delete Insurance'))
    expect(useAppStore.getState().scenarios[scenarioId]?.joint.expenses).toHaveLength(1)
    expect(useAppStore.getState().scenarios[scenarioId]?.joint.expenses[0]?.name).toBe('Insurance (copy)')
  })

  it.each([
    ['once', { frequency: 'once', startDate: '2026-06-15' }],
    ['monthly', { frequency: 'monthly', startDate: '2026-06-15', endDate: null }],
    ['quarterly', { frequency: 'quarterly', startDate: '2026-06-15', endDate: '2027-06-15' }],
    ['yearly', { frequency: 'yearly', startDate: '2026-06-15', endDate: null }],
  ] as const)('saves the %s recurrence shape', async (frequency, expectedRecurrence) => {
    await mountLedger()
    await click(button('Add expense item'))
    await setValue(labelledControl('Name'), `Item ${frequency}`)
    await setValue(labelledControl('Amount (EUR)'), '9.99')
    await setValue(labelledControl('Category'), 'Test')
    await setValue(labelledControl('Frequency'), frequency)
    await setValue(labelledControl('Start date'), '2026-06-15')
    if (frequency === 'quarterly') await setValue(labelledControl('End date (optional)'), '2027-06-15')
    await click(button('Save item'))

    const state = useAppStore.getState()
    const scenario = state.scenarios[state.activeScenarioId]
    if (!scenario) throw new Error('Active scenario is missing')
    const [profileId] = scenario.participantIds
    expect(scenario.profiles[profileId]?.ledger.expenses[0]?.recurrence).toEqual(expectedRecurrence)
  })

  it('shows amount and recurrence errors beside fields and keeps invalid rows unsaved', async () => {
    await mountLedger()
    await click(button('Add expense item'))
    await setValue(labelledControl('Name'), 'Bad item')
    await setValue(labelledControl('Amount (EUR)'), '-1')
    await setValue(labelledControl('Category'), 'Test')
    await setValue(labelledControl('Start date'), '2026-06-15')
    await setValue(labelledControl('End date (optional)'), '2026-06-14')
    await click(button('Save item'))

    expect(container.textContent).toContain('Enter a non-negative amount')
    expect(container.textContent).toContain('End date must be on or after the start date')
    const invalidAmount = labelledControl('Amount (EUR)')
    expect(invalidAmount.getAttribute('aria-invalid')).toBe('true')
    const amountErrorId = invalidAmount.getAttribute('aria-describedby')
    expect(amountErrorId && document.getElementById(amountErrorId)?.textContent).toContain('Enter a non-negative amount')
    const scenario = useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]
    if (!scenario) throw new Error('Active scenario is missing')
    const [profileId] = scenario.participantIds
    expect(scenario.profiles[profileId]?.ledger.expenses).toHaveLength(0)

    await setValue(labelledControl('Amount (EUR)'), '12.345')
    await click(button('Save item'))
    expect(container.textContent).toContain('up to two decimal places')
    expect(useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]?.profiles[profileId]?.ledger.expenses).toHaveLength(0)

    await setValue(labelledControl('Amount (EUR)'), '10.00')
    await setValue(labelledControl('End date (optional)'), '')
    await setValue(labelledControl('Start date'), '')
    await click(button('Save item'))
    expect(container.textContent).toContain('Expected a valid YYYY-MM-DD date')
    expect(useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]?.profiles[profileId]?.ledger.expenses).toHaveLength(0)
  })

  it('adds, renames, selects, and protects participant profiles while confirming profile removal', async () => {
    await mountLedger()
    await setValue(labelledControl('Profile name'), 'Third profile')
    await click(button('Add profile'))

    let scenario = useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]
    if (!scenario) throw new Error('Active scenario is missing')
    let thirdProfile = Object.values(scenario.profiles).find((profile) => profile.name === 'Third profile')
    if (!thirdProfile) throw new Error('New profile was not added')
    const profileNameInput = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find((candidate) => candidate.value === 'Third profile')
    if (!profileNameInput) throw new Error('New profile name input was not found')
    await setValue(profileNameInput, 'Renamed profile')
    await click(button('Save name for Third profile'))
    scenario = useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]
    thirdProfile = scenario?.profiles[thirdProfile.id]
    expect(thirdProfile?.name).toBe('Renamed profile')

    const firstId = scenario?.participantIds[0]
    const secondId = scenario?.participantIds[1]
    if (!firstId || !secondId || !thirdProfile) throw new Error('Scenario participants are missing')
    const profileId = thirdProfile.id
    await setValue(labelledControl('Participant 1'), profileId)
    scenario = useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]
    expect(scenario?.participantIds).toEqual([profileId, secondId])
    expect(Array.from((labelledControl('Participant 2') as HTMLSelectElement).options).map((option) => option.value))
      .not.toContain(profileId)
    expect(() => useAppStore.getState().setParticipants(useAppStore.getState().activeScenarioId, [profileId, profileId]))
      .toThrow(/distinct/)

    const profileTab = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Renamed profile') && candidate.textContent?.includes('Participant'))
    expect(profileTab?.getAttribute('aria-pressed')).toBe('true')
    const unselectedTab = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.trim() === 'Partner 1')
    expect(unselectedTab?.textContent).not.toContain('Participant')
    expect(button('Remove profile Renamed profile').disabled).toBe(true)

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await click(button(`Remove profile ${scenario?.profiles[firstId]?.name ?? ''}`))
    expect(confirm).toHaveBeenCalledOnce()
    expect(useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]?.profiles[firstId]).toBeDefined()
    confirm.mockReturnValue(true)
    await click(button(`Remove profile ${scenario?.profiles[firstId]?.name ?? ''}`))
    expect(useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]?.profiles[firstId]).toBeUndefined()
  })

  it('writes sandbox edits without changing baseline ledger rows', async () => {
    const store = useAppStore.getState()
    const baselineId = store.baselineScenarioId
    const sandboxId = store.duplicateScenario(baselineId, 'Ledger sandbox')
    await mountLedger()

    await click(button('Add income item'))
    await setValue(labelledControl('Name'), 'Sandbox salary')
    await setValue(labelledControl('Amount (EUR)'), '100.00')
    await setValue(labelledControl('Category'), 'Employment')
    await click(button('Save item'))

    const current = useAppStore.getState()
    const sandbox = current.scenarios[sandboxId]
    const baseline = current.scenarios[baselineId]
    if (!sandbox || !baseline) throw new Error('Expected baseline and sandbox scenarios')
    const [sandboxProfileId] = sandbox.participantIds
    const [baselineProfileId] = baseline.participantIds
    expect(sandbox.profiles[sandboxProfileId]?.ledger.income).toHaveLength(1)
    expect(baseline.profiles[baselineProfileId]?.ledger.income).toHaveLength(0)
  })
})
