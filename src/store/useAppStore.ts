import localforage from 'localforage'
import { create } from 'zustand'
import {
  createJSONStorage,
  persist,
  type PersistStorage,
  type StateStorage,
} from 'zustand/middleware'
import type {
  AppData,
  AppStore,
  FinancialItem,
  Ledger,
  LedgerKind,
  LedgerOwner,
  Profile,
  ProfileId,
  Scenario,
  ScenarioId,
} from '../types'
import {
  AppDataSchema,
  AppSettingsSchema,
  CalculationModeSchema,
  FinancialItemSchema,
  ForecastAssumptionsSchema,
  NameSchema,
  ProfileSchema,
} from '../validation/schemas'

export const APP_STORAGE_KEY = 'rato-app-state'
const PERSIST_VERSION = 1

function createId(): string {
  return globalThis.crypto.randomUUID()
}

function emptyLedger(): Ledger {
  return { income: [], expenses: [] }
}

export function createInitialAppData(): AppData {
  const now = new Date().toISOString()
  const baselineScenarioId = createId()
  const firstProfileId = createId()
  const secondProfileId = createId()
  const profiles: Record<ProfileId, Profile> = {
    [firstProfileId]: {
      id: firstProfileId,
      name: 'Partner 1',
      ledger: emptyLedger(),
    },
    [secondProfileId]: {
      id: secondProfileId,
      name: 'Partner 2',
      ledger: emptyLedger(),
    },
  }

  const baseline: Scenario = {
    id: baselineScenarioId,
    name: 'Baseline',
    parentScenarioId: null,
    createdAt: now,
    updatedAt: now,
    profiles,
    participantIds: [firstProfileId, secondProfileId],
    joint: emptyLedger(),
    calculationMode: 'pro_rata',
    forecastAssumptions: {
      annualExpenseInflationRate: 0,
      annualIncomeGrowthRate: 0,
      expenseInflationByCategory: {},
    },
  }

  return {
    schemaVersion: 1,
    baselineScenarioId,
    activeScenarioId: baselineScenarioId,
    scenarios: { [baselineScenarioId]: baseline },
    settings: { currencyCode: 'EUR' },
  }
}

export function createLocalForagePersistStorage(
  instance: LocalForage = localforage.createInstance({
    name: 'rato-local-data',
    storeName: 'app',
  }),
): PersistStorage<AppData> {
  const indexedDbReady = instance.setDriver(instance.INDEXEDDB)
  const adapter: StateStorage = {
    getItem: async (name) => {
      await indexedDbReady
      return (await instance.getItem<string>(name)) ?? null
    },
    setItem: async (name, value) => {
      await indexedDbReady
      await instance.setItem(name, value)
    },
    removeItem: async (name) => {
      await indexedDbReady
      await instance.removeItem(name)
    },
  }

  const storage = createJSONStorage<AppData>(() => adapter)
  if (!storage) throw new Error('Could not initialize local persistence storage')
  return storage
}

function dataFromStore(state: AppStore): AppData {
  return {
    schemaVersion: state.schemaVersion,
    baselineScenarioId: state.baselineScenarioId,
    activeScenarioId: state.activeScenarioId,
    scenarios: state.scenarios,
    settings: state.settings,
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'The saved data could not be read.'
}

function requireReady(state: AppStore): void {
  if (state.hydrationStatus !== 'ready') {
    throw new Error('Local data is not ready for changes.')
  }
}

function requireScenario(state: AppStore, scenarioId: ScenarioId): Scenario {
  if (!Object.prototype.hasOwnProperty.call(state.scenarios, scenarioId)) {
    throw new Error(`Scenario "${scenarioId}" does not exist.`)
  }
  const scenario = state.scenarios[scenarioId]
  if (!scenario) throw new Error(`Scenario "${scenarioId}" does not exist.`)
  return scenario
}

function timestampScenario(scenario: Scenario, updates: Partial<Scenario>): Scenario {
  return { ...scenario, ...updates, updatedAt: new Date().toISOString() }
}

function getLedger(scenario: Scenario, owner: LedgerOwner): Ledger {
  if (owner.scope === 'joint') return scenario.joint
  if (!Object.prototype.hasOwnProperty.call(scenario.profiles, owner.profileId)) {
    throw new Error(`Profile "${owner.profileId}" does not exist.`)
  }
  const profile = scenario.profiles[owner.profileId]
  if (!profile) throw new Error(`Profile "${owner.profileId}" does not exist.`)
  return profile.ledger
}

function updateLedger(
  scenario: Scenario,
  owner: LedgerOwner,
  nextLedger: Ledger,
): Scenario {
  if (owner.scope === 'joint') return timestampScenario(scenario, { joint: nextLedger })

  if (!Object.prototype.hasOwnProperty.call(scenario.profiles, owner.profileId)) {
    throw new Error(`Profile "${owner.profileId}" does not exist.`)
  }
  const profile = scenario.profiles[owner.profileId]
  if (!profile) throw new Error(`Profile "${owner.profileId}" does not exist.`)
  return timestampScenario(scenario, {
    profiles: {
      ...scenario.profiles,
      [owner.profileId]: { ...profile, ledger: nextLedger },
    },
  })
}

export function createAppStore(
  persistStorage: PersistStorage<AppData> = createLocalForagePersistStorage(),
  storageKey = APP_STORAGE_KEY,
) {
  let writesBlocked = false
  let setRuntimeState: (state: Partial<AppStore>) => void = () => undefined

  const guardedStorage: PersistStorage<AppData> = {
    getItem: async (name) => {
      try {
        return await persistStorage.getItem(name)
      } catch (error) {
        writesBlocked = true
        throw error
      }
    },
    setItem: async (name, value) => {
      if (writesBlocked) return
      await persistStorage.setItem(name, value)
    },
    removeItem: async (name) => {
      await persistStorage.removeItem(name)
      writesBlocked = false
    },
  }

  const store = create<AppStore>()(persist((set, get, api) => {
    setRuntimeState = (state) => set(state)

    const commitData = (nextData: AppData) => {
      requireReady(get())
      set(AppDataSchema.parse(nextData))
    }

    const updateOneScenario = (
      scenarioId: ScenarioId,
      updater: (scenario: Scenario) => Scenario,
    ) => {
      const state = get()
      requireReady(state)
      const current = requireScenario(state, scenarioId)
      const nextData = AppDataSchema.parse({
        ...dataFromStore(state),
        scenarios: {
          ...state.scenarios,
          [scenarioId]: updater(current),
        },
      })
      set(nextData)
    }

    return {
      ...createInitialAppData(),
      hydrationStatus: 'loading',
      hydrationError: null,

      setActiveScenario: (scenarioId) => {
        const state = get()
        requireReady(state)
        if (!Object.prototype.hasOwnProperty.call(state.scenarios, scenarioId)) {
          throw new Error(`Scenario "${scenarioId}" does not exist.`)
        }
        commitData({ ...dataFromStore(state), activeScenarioId: scenarioId })
      },

      duplicateScenario: (sourceId, name) => {
        const state = get()
        requireReady(state)
        const source = requireScenario(state, sourceId)
        const timestamp = new Date().toISOString()
        const id = createId()
        const duplicate: Scenario = {
          ...structuredClone(source),
          id,
          name: name.trim(),
          parentScenarioId: sourceId,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const nextData = AppDataSchema.parse({
          ...dataFromStore(state),
          activeScenarioId: id,
          scenarios: { ...state.scenarios, [id]: duplicate },
        })
        set(nextData)
        return id
      },

      renameScenario: (scenarioId, name) => {
        updateOneScenario(scenarioId, (scenario) => timestampScenario(scenario, {
          name,
        }))
      },

      deleteScenario: (scenarioId) => {
        const state = get()
        requireReady(state)
        requireScenario(state, scenarioId)
        if (scenarioId === state.baselineScenarioId) {
          throw new Error('The baseline scenario cannot be deleted.')
        }
        const scenarios = { ...state.scenarios }
        delete scenarios[scenarioId]
        commitData({
          ...dataFromStore(state),
          scenarios,
          activeScenarioId: state.activeScenarioId === scenarioId
            ? state.baselineScenarioId
            : state.activeScenarioId,
        })
      },

      setParticipants: (scenarioId, participantIds) => {
        updateOneScenario(scenarioId, (scenario) => timestampScenario(scenario, {
          participantIds,
        }))
      },

      addProfile: (scenarioId, inputProfile) => {
        const profile = ProfileSchema.parse(inputProfile)
        updateOneScenario(scenarioId, (scenario) => {
          if (Object.prototype.hasOwnProperty.call(scenario.profiles, profile.id)) {
            throw new Error(`Profile "${profile.id}" already exists.`)
          }
          return timestampScenario(scenario, {
            profiles: { ...scenario.profiles, [profile.id]: profile },
          })
        })
      },

      renameProfile: (scenarioId, profileId, name) => {
        updateOneScenario(scenarioId, (scenario) => {
          if (!Object.prototype.hasOwnProperty.call(scenario.profiles, profileId)) {
            throw new Error(`Profile "${profileId}" does not exist.`)
          }
          const profile = scenario.profiles[profileId]
          if (!profile) throw new Error(`Profile "${profileId}" does not exist.`)
          const validated = NameSchema.parse(name)
          return timestampScenario(scenario, {
            profiles: {
              ...scenario.profiles,
              [profileId]: { ...profile, name: validated },
            },
          })
        })
      },

      removeProfile: (scenarioId, profileId) => {
        updateOneScenario(scenarioId, (scenario) => {
          if (!Object.prototype.hasOwnProperty.call(scenario.profiles, profileId)) {
            throw new Error(`Profile "${profileId}" does not exist.`)
          }
          if (scenario.participantIds.includes(profileId)) {
            throw new Error('Select a replacement participant before removing this profile.')
          }
          const profiles = { ...scenario.profiles }
          delete profiles[profileId]
          return timestampScenario(scenario, { profiles })
        })
      },

      upsertItem: (scenarioId, owner, kind: LedgerKind, inputItem: FinancialItem) => {
        const item = FinancialItemSchema.parse(inputItem)
        updateOneScenario(scenarioId, (scenario) => {
          const ledger = getLedger(scenario, owner)
          const field = kind === 'income' ? 'income' : 'expenses'
          const items = ledger[field]
          const itemIndex = items.findIndex((existing) => existing.id === item.id)
          const nextItems = itemIndex < 0
            ? [...items, item]
            : items.map((existing, index) => index === itemIndex ? item : existing)
          return updateLedger(scenario, owner, { ...ledger, [field]: nextItems })
        })
      },

      removeItem: (scenarioId, owner, kind, itemId) => {
        updateOneScenario(scenarioId, (scenario) => {
          const ledger = getLedger(scenario, owner)
          const field = kind === 'income' ? 'income' : 'expenses'
          if (!ledger[field].some((item) => item.id === itemId)) {
            throw new Error(`Ledger item "${itemId}" does not exist.`)
          }
          return updateLedger(scenario, owner, {
            ...ledger,
            [field]: ledger[field].filter((item) => item.id !== itemId),
          })
        })
      },

      setCalculationMode: (scenarioId, mode) => {
        const validatedMode = CalculationModeSchema.parse(mode)
        updateOneScenario(scenarioId, (scenario) => timestampScenario(scenario, {
          calculationMode: validatedMode,
        }))
      },

      updateForecastAssumptions: (scenarioId, patch) => {
        updateOneScenario(scenarioId, (scenario) => {
          const assumptions = ForecastAssumptionsSchema.parse({
            ...scenario.forecastAssumptions,
            ...patch,
            expenseInflationByCategory: patch.expenseInflationByCategory
              ? {
                  ...scenario.forecastAssumptions.expenseInflationByCategory,
                  ...patch.expenseInflationByCategory,
                }
              : scenario.forecastAssumptions.expenseInflationByCategory,
          })
          return timestampScenario(scenario, { forecastAssumptions: assumptions })
        })
      },

      updateSettings: (patch) => {
        const state = get()
        requireReady(state)
        const settings = AppSettingsSchema.parse({ ...state.settings, ...patch })
        commitData({ ...dataFromStore(state), settings })
      },

      replaceData: (data) => commitData(data),

      retryHydration: () => {
        const state = get()
        if (state.hydrationStatus !== 'recovery_required') return
        set({ hydrationStatus: 'loading', hydrationError: null })
        api.persist.rehydrate()
      },

      resetToFreshBaseline: async () => {
        if (get().hydrationStatus !== 'recovery_required') {
          throw new Error('Reset is available only while local data needs recovery.')
        }
        await guardedStorage.removeItem(storageKey)
        const freshData = createInitialAppData()
        set({
          ...freshData,
          hydrationStatus: 'ready',
          hydrationError: null,
        })
        await guardedStorage.setItem(storageKey, {
          state: freshData,
          version: PERSIST_VERSION,
        })
      },
    }
  }, {
    name: storageKey,
    storage: guardedStorage,
    version: PERSIST_VERSION,
    partialize: (state) => dataFromStore(state),
    migrate: (_persistedState, version) => {
      writesBlocked = true
      throw new Error(`Saved data version ${version} is not supported by this app.`)
    },
    merge: (persistedState, currentState) => {
      if (persistedState === undefined) return currentState
      try {
        const data = AppDataSchema.parse(persistedState)
        writesBlocked = false
        return { ...currentState, ...data }
      } catch (error) {
        writesBlocked = true
        throw error
      }
    },
    onRehydrateStorage: () => (_state, error) => {
      if (error) {
        writesBlocked = true
        setRuntimeState({
          hydrationStatus: 'recovery_required',
          hydrationError: errorMessage(error),
        })
      } else {
        setRuntimeState({ hydrationStatus: 'ready', hydrationError: null })
      }
    },
  }))

  return store
}

export const useAppStore = createAppStore()
