// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppData, AppStore, FinancialItem, ProfileId, ScenarioId } from '../../types'
import { createInitialAppData, useAppStore } from '../../store/useAppStore'
import { AppRoutes } from '../../routes/AppRoutes'

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

function recurringItem(
  id: string,
  name: string,
  amountCents: number,
  categoryId: string,
): FinancialItem {
  return {
    id,
    name,
    amountCents,
    categoryId,
    recurrence: { frequency: 'monthly', startDate: '2026-01-01', endDate: null },
  }
}

function onceItem(
  id: string,
  name: string,
  amountCents: number,
  categoryId: string,
): FinancialItem {
  return {
    id,
    name,
    amountCents,
    categoryId,
    recurrence: { frequency: 'once', startDate: '2026-06-10' },
  }
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year ?? 0, (monthNumber ?? 1) - 1, 1)
  date.setHours(12, 0, 0, 0)
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date)
}

function seedScenario(): { scenarioId: ScenarioId; firstId: ProfileId; secondId: ProfileId } {
  const state = useAppStore.getState()
  const scenarioId = state.activeScenarioId
  const scenario = state.scenarios[scenarioId]
  if (!scenario) throw new Error('Seed scenario is unavailable')
  const [firstId, secondId] = scenario.participantIds

  state.addProfile(scenarioId, {
    id: 'unselected-profile',
    name: 'Unselected profile',
    ledger: { income: [], expenses: [] },
  })

  state.upsertItem(scenarioId, { scope: 'profile', profileId: firstId }, 'income',
    recurringItem('income-first', 'Salary', 30_000, 'Salary'))
  state.upsertItem(scenarioId, { scope: 'profile', profileId: firstId }, 'expense',
    recurringItem('expense-first', 'Personal expenses', 200_000, 'Personal'))
  state.upsertItem(scenarioId, { scope: 'profile', profileId: firstId }, 'expense',
    onceItem('one-time-repair', 'Repair', 8_000, 'Repairs'))
  state.upsertItem(scenarioId, { scope: 'profile', profileId: secondId }, 'income',
    recurringItem('income-second', 'Salary', 20_000, 'Salary'))
  state.upsertItem(scenarioId, { scope: 'profile', profileId: secondId }, 'expense',
    recurringItem('expense-second', 'Personal expenses', 180_000, 'Personal'))
  state.upsertItem(scenarioId, { scope: 'profile', profileId: 'unselected-profile' }, 'income',
    recurringItem('excluded-income', 'Outside settlement', 9_000_000, 'Excluded'))
  state.upsertItem(scenarioId, { scope: 'joint' }, 'income',
    recurringItem('joint-income', 'Joint income', 120_000, 'Joint income'))
  state.upsertItem(scenarioId, { scope: 'joint' }, 'expense',
    recurringItem('joint-expense', 'Joint expenses', 100_000, 'Housing'))
  state.updateForecastAssumptions(scenarioId, {
    annualIncomeGrowthRate: 0.12,
    annualExpenseInflationRate: 0.06,
    expenseInflationByCategory: { Personal: 0.24 },
  })
  return { scenarioId, firstId, secondId }
}

async function mountDashboard() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/?month=2026-06']}>
        <AppRoutes />
      </MemoryRouter>,
    )
  })
  await act(async () => Promise.resolve())
}

async function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLInputElement
    ? window.HTMLInputElement.prototype
    : window.HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) throw new Error('Native value setter is unavailable')
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function profileContribution(name: string): string {
  const card = Array.from(container.querySelectorAll('article'))
    .find((candidate) => candidate.querySelector('h3')?.textContent === name)
  const contribution = card && Array.from(card.querySelectorAll('dt'))
    .find((label) => label.textContent === 'Contribution to joint')
  return contribution?.parentElement?.querySelector('dd')?.textContent ?? ''
}

function netCostValue(): string {
  const card = Array.from(container.querySelectorAll('article'))
    .find((candidate) => candidate.querySelector('h3')?.textContent === 'Net joint cost')
  return card?.querySelector('p.mt-2')?.textContent ?? ''
}

describe('dashboard and forecast views', () => {
  beforeEach(async () => {
    await waitForReady()
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
  })

  it('shows selected participant settlement, signed amounts, source categories and forecast assumptions', async () => {
    const { firstId, secondId } = seedScenario()
    const scenario = useAppStore.getState().scenarios[useAppStore.getState().activeScenarioId]
    if (!scenario) throw new Error('Scenario is unavailable')
    const firstName = scenario.profiles[firstId]?.name ?? ''
    const secondName = scenario.profiles[secondId]?.name ?? ''

    await mountDashboard()

    expect(container.textContent).toContain(monthLabel('2026-06'))
    expect(container.textContent).toContain('Joint income')
    expect(container.textContent).toContain('Net joint cost')
    expect(profileContribution(firstName)).toContain('−')
    expect(profileContribution(secondName)).toContain('−')
    expect(container.textContent).toContain('−')
    expect(container.textContent).toContain('Annual assumptions used for projections')
    expect(container.textContent).toContain('Personal expense inflation')
    expect(container.textContent).toContain('Nominal base')
    expect(container.textContent).toContain('Projected')
    expect(container.querySelector('[role="img"][aria-label*="discretionary cash"]')).not.toBeNull()

    const tables = container.querySelectorAll('table')
    expect(tables).toHaveLength(2)
    expect(tables[0]?.textContent).toContain('Repairs')
    expect(tables[0]?.textContent).not.toContain('Excluded')
    expect(tables[1]?.querySelectorAll('tbody tr')).toHaveLength(12)
    expect(tables[1]?.textContent).toContain(firstName)
    expect(tables[1]?.textContent).toContain(secondName)
    expect(tables[1]?.textContent).toContain('Discretionary')
    expect(tables[1]?.textContent).toContain('Contribution')
  })

  it('updates month, calculation mode, forecast horizon and figures when the active scenario changes', async () => {
    const { scenarioId, firstId } = seedScenario()
    const scenario = useAppStore.getState().scenarios[scenarioId]
    if (!scenario) throw new Error('Scenario is unavailable')
    const firstName = scenario.profiles[firstId]?.name ?? ''
    await mountDashboard()

    const firstContribution = profileContribution(firstName)
    const firstNetCost = netCostValue()
    await act(async () => {
      useAppStore.getState().setCalculationMode(scenarioId, 'fifty_fifty')
    })
    expect(profileContribution(firstName)).not.toBe(firstContribution)

    const monthControl = container.querySelector<HTMLInputElement>('#selected-month')
    const horizonControl = container.querySelector<HTMLSelectElement>('#forecast-horizon')
    if (!monthControl || !horizonControl) throw new Error('Dashboard controls are missing')
    await setNativeValue(monthControl, '2026-07')
    await setNativeValue(horizonControl, '6')
    expect(container.textContent).toContain(monthLabel('2026-07'))
    expect(container.querySelectorAll('table')[1]?.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(container.querySelectorAll('table')[0]?.textContent).not.toContain('Repairs')

    let alternateId: ScenarioId = ''
    await act(async () => {
      alternateId = useAppStore.getState().duplicateScenario(scenarioId, 'Higher joint income')
      useAppStore.getState().upsertItem(
        alternateId,
        { scope: 'joint' },
        'income',
        recurringItem('joint-income', 'Joint income', 250_000, 'Joint income'),
      )
      useAppStore.getState().setActiveScenario(alternateId)
    })

    expect(container.textContent).toContain('Higher joint income')
    expect(netCostValue()).not.toBe(firstNetCost)
  })
})
