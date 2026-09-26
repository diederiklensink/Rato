import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppData, AppStore, FinancialItem, HydrationStatus } from '../types'
import {
  APP_STORAGE_KEY,
  createAppStore,
  createLocalForagePersistStorage,
  createInitialAppData,
} from './useAppStore'

const database = localforage.createInstance({
  name: 'rato-store-tests',
  storeName: 'app',
})

let testNumber = 0
let storageKey = APP_STORAGE_KEY

function waitForStatus(store: ReturnType<typeof createAppStore>, status: HydrationStatus) {
  if (store.getState().hydrationStatus === status) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timed out waiting for hydration status "${status}"`))
    }, 5_000)
    const unsubscribe = store.subscribe((state) => {
      if (state.hydrationStatus === status) {
        clearTimeout(timeout)
        unsubscribe()
        resolve()
      }
    })
  })
}

function makeStore() {
  return createAppStore(createLocalForagePersistStorage(database), storageKey)
}

async function makeReadyStore() {
  const store = makeStore()
  await waitForStatus(store, 'ready')
  return store
}

function firstTwoProfileIds(state: AppStore): [string, string] {
  const scenario = state.scenarios[state.baselineScenarioId]
  if (!scenario) throw new Error('Baseline scenario missing from the store')
  return scenario.participantIds
}

function item(overrides: Partial<FinancialItem> = {}): FinancialItem {
  return {
    id: 'income-salary',
    name: 'Salary',
    amountCents: 400_000,
    categoryId: 'employment',
    recurrence: {
      frequency: 'monthly',
      startDate: '2026-01-01',
      endDate: null,
    },
    ...overrides,
  }
}

async function getRawItem(key = storageKey): Promise<string | null> {
  return database.getItem<string>(key)
}

describe('Rato persisted store', () => {
  beforeEach(async () => {
    await database.clear()
    testNumber += 1
    storageKey = `rato-app-state-test-${testNumber}`
  })

  afterEach(async () => {
    await database.clear()
  })

  it('seeds a generic baseline and keeps its IDs stable across reloads', async () => {
    const firstStore = await makeReadyStore()
    const first = firstStore.getState()
    const [firstId, secondId] = firstTwoProfileIds(first)

    expect(first.baselineScenarioId).toBe(first.activeScenarioId)
    expect(first.scenarios[first.baselineScenarioId]?.name).toBe('Baseline')
    expect(first.scenarios[first.baselineScenarioId]?.profiles[firstId]?.name).toBe('Partner 1')
    expect(first.scenarios[first.baselineScenarioId]?.profiles[secondId]?.name).toBe('Partner 2')
    expect(firstId).not.toBe(secondId)

    await getRawItem()
    const reloadedStore = await makeReadyStore()
    expect(reloadedStore.getState().baselineScenarioId).toBe(first.baselineScenarioId)
    expect(firstTwoProfileIds(reloadedStore.getState())).toEqual([firstId, secondId])
  })

  it('duplicates scenarios as independent snapshots', async () => {
    const store = await makeReadyStore()
    const baselineId = store.getState().baselineScenarioId
    const [profileId] = firstTwoProfileIds(store.getState())
    store.getState().upsertItem(baselineId, { scope: 'profile', profileId }, 'income', item())

    const sandboxId = store.getState().duplicateScenario(baselineId, 'House')
    const baselineItem = store.getState().scenarios[baselineId]?.profiles[profileId]?.ledger.income[0]
    const sandboxItem = store.getState().scenarios[sandboxId]?.profiles[profileId]?.ledger.income[0]
    expect(sandboxId).not.toBe(baselineId)
    expect(sandboxItem).toEqual(baselineItem)
    expect(sandboxItem).not.toBe(baselineItem)
    expect(store.getState().scenarios[sandboxId]?.parentScenarioId).toBe(baselineId)

    store.getState().upsertItem(
      sandboxId,
      { scope: 'profile', profileId },
      'income',
      item({ amountCents: 500_000 }),
    )
    expect(store.getState().scenarios[baselineId]?.profiles[profileId]?.ledger.income[0]?.amountCents).toBe(400_000)

    store.getState().upsertItem(
      baselineId,
      { scope: 'profile', profileId },
      'income',
      item({ amountCents: 300_000 }),
    )
    expect(store.getState().scenarios[sandboxId]?.profiles[profileId]?.ledger.income[0]?.amountCents).toBe(500_000)
  })

  it('rejects invalid scenario references, participants, dates, amounts, and rates', async () => {
    const store = await makeReadyStore()
    const baselineId = store.getState().baselineScenarioId
    const [firstId] = firstTwoProfileIds(store.getState())

    expect(() => store.getState().setActiveScenario('missing')).toThrow(/does not exist/)
    expect(() => store.getState().setParticipants(baselineId, [firstId, firstId])).toThrow(/distinct/)
    expect(() => store.getState().setParticipants(baselineId, [firstId, 'missing'])).toThrow(/does not exist/)
    expect(() => store.getState().upsertItem(
      baselineId,
      { scope: 'profile', profileId: firstId },
      'income',
      item({ amountCents: -1 }),
    )).toThrow()
    expect(() => store.getState().upsertItem(
      baselineId,
      { scope: 'profile', profileId: firstId },
      'income',
      item({ recurrence: { frequency: 'monthly', startDate: '2026-02-30', endDate: null } }),
    )).toThrow()
    expect(() => store.getState().updateForecastAssumptions(baselineId, {
      annualIncomeGrowthRate: Number.NaN,
    })).toThrow()
    expect(() => store.getState().updateSettings({ currencyCode: 'eur' })).toThrow()
    expect(() => store.getState().updateSettings({ currencyCode: 'JPY' })).toThrow()

    expect(store.getState().scenarios[baselineId]?.profiles[firstId]?.ledger.income).toHaveLength(0)
  })

  it('stores opening balances and savings goals independently for each scenario', async () => {
    const store = await makeReadyStore()
    const baselineId = store.getState().baselineScenarioId
    store.getState().setScenarioOpeningBalance(baselineId, -25_000)
    store.getState().upsertSavingsGoal(baselineId, {
      id: 'emergency-fund',
      name: 'Emergency fund',
      targetCents: 500_000,
      savedCents: 100_000,
      targetDate: '2027-12-31',
    })
    const sandboxId = store.getState().duplicateScenario(baselineId, 'Planning sandbox')
    store.getState().setScenarioOpeningBalance(sandboxId, 100_000)
    store.getState().upsertSavingsGoal(sandboxId, {
      id: 'emergency-fund',
      name: 'Larger emergency fund',
      targetCents: 750_000,
      savedCents: 100_000,
      targetDate: '2028-12-31',
    })

    expect(store.getState().scenarios[baselineId]?.planning).toEqual({
      openingBalanceCents: -25_000,
      savingsGoals: [{ id: 'emergency-fund', name: 'Emergency fund', targetCents: 500_000, savedCents: 100_000, targetDate: '2027-12-31' }],
    })
    expect(store.getState().scenarios[sandboxId]?.planning.openingBalanceCents).toBe(100_000)
    expect(store.getState().scenarios[sandboxId]?.planning.savingsGoals[0]?.name).toBe('Larger emergency fund')

    expect(() => store.getState().upsertSavingsGoal(baselineId, {
      id: 'invalid-goal', name: 'Invalid', targetCents: 0, savedCents: 0, targetDate: '2026-02-30',
    })).toThrow()
    store.getState().removeSavingsGoal(sandboxId, 'emergency-fund')
    expect(store.getState().scenarios[sandboxId]?.planning.savingsGoals).toEqual([])
    expect(store.getState().scenarios[baselineId]?.planning.savingsGoals).toHaveLength(1)

  })

  it('replaces category inflation overrides so removed categories fall back to the general rate', async () => {
    const store = await makeReadyStore()
    const baselineId = store.getState().baselineScenarioId

    store.getState().updateForecastAssumptions(baselineId, {
      expenseInflationByCategory: { Housing: 0.08, Utilities: 0.03 },
    })
    store.getState().updateForecastAssumptions(baselineId, {
      expenseInflationByCategory: { Housing: 0.05 },
    })
    expect(store.getState().scenarios[baselineId]?.forecastAssumptions.expenseInflationByCategory)
      .toEqual({ Housing: 0.05 })

    store.getState().updateForecastAssumptions(baselineId, { expenseInflationByCategory: {} })
    expect(store.getState().scenarios[baselineId]?.forecastAssumptions.expenseInflationByCategory).toEqual({})
  })

  it('requires a replacement before profile removal and falls back to baseline on scenario deletion', async () => {
    const store = await makeReadyStore()
    const baselineId = store.getState().baselineScenarioId
    const [firstId, secondId] = firstTwoProfileIds(store.getState())

    expect(() => store.getState().removeProfile(baselineId, secondId)).toThrow(/replacement/)
    store.getState().addProfile(baselineId, {
      id: 'replacement-profile',
      name: 'Partner 3',
      ledger: { income: [], expenses: [] },
    })
    store.getState().setParticipants(baselineId, [firstId, 'replacement-profile'])
    store.getState().removeProfile(baselineId, secondId)
    expect(store.getState().scenarios[baselineId]?.profiles[secondId]).toBeUndefined()

    const sandboxId = store.getState().duplicateScenario(baselineId, 'Sandbox')
    expect(() => store.getState().deleteScenario(baselineId)).toThrow(/cannot be deleted/)
    store.getState().deleteScenario(sandboxId)
    expect(store.getState().activeScenarioId).toBe(baselineId)
    expect(store.getState().scenarios[sandboxId]).toBeUndefined()
  })

  it('preserves invalid stored JSON until the user explicitly resets it', async () => {
    const corruptValue = '{not valid JSON'
    await database.setItem(storageKey, corruptValue)
    const store = makeStore()
    await waitForStatus(store, 'recovery_required')

    expect(await getRawItem()).toBe(corruptValue)
    store.getState().retryHydration()
    await waitForStatus(store, 'recovery_required')
    expect(await getRawItem()).toBe(corruptValue)

    const previousBaselineId = store.getState().baselineScenarioId
    await store.getState().resetToFreshBaseline()
    expect(store.getState().hydrationStatus).toBe('ready')
    expect(store.getState().baselineScenarioId).not.toBe(previousBaselineId)
    const repaired = JSON.parse((await getRawItem()) ?? 'null') as { version: number; state: AppData }
    expect(repaired.version).toBe(2)
    expect(repaired.state.baselineScenarioId).toBe(store.getState().baselineScenarioId)
  })

  it('preserves data from unsupported persistence versions for recovery', async () => {
    const unsupported = JSON.stringify({ state: { legacy: true }, version: 29 })
    await database.setItem(storageKey, unsupported)
    const store = makeStore()
    await waitForStatus(store, 'recovery_required')

    expect(await getRawItem()).toBe(unsupported)
    expect(store.getState().hydrationError).toMatch(/version 29/)
  })

  it('migrates version 1 local data and saves its new planning defaults', async () => {
    const current = createInitialAppData()
    const scenarios = Object.fromEntries(Object.entries(current.scenarios).map(([id, scenario]) => {
      const { planning: _planning, ...legacyScenario } = scenario
      return [id, legacyScenario]
    }))
    const oldData = { ...current, schemaVersion: 1, scenarios }
    await database.setItem(storageKey, JSON.stringify({ state: oldData, version: 1 }))

    const store = await makeReadyStore()
    const scenario = store.getState().scenarios[store.getState().baselineScenarioId]
    expect(store.getState().schemaVersion).toBe(2)
    expect(scenario?.planning).toEqual({ openingBalanceCents: 0, savingsGoals: [] })
    const persisted = JSON.parse((await getRawItem()) ?? 'null') as { version: number; state: AppData }
    expect(persisted.version).toBe(2)
    expect(persisted.state.schemaVersion).toBe(2)
  })

  it('preserves same-version data that fails the application schema', async () => {
    const invalidSchema = JSON.stringify({
      state: {
        schemaVersion: 1,
        baselineScenarioId: 'missing',
        activeScenarioId: 'missing',
        scenarios: {},
        settings: { currencyCode: 'EUR' },
      },
      version: 1,
    })
    await database.setItem(storageKey, invalidSchema)
    const store = makeStore()
    await waitForStatus(store, 'recovery_required')

    expect(await getRawItem()).toBe(invalidSchema)
    expect(store.getState().hydrationError).toContain('Baseline scenario does not exist')
  })
})
