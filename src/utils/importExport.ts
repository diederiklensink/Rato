import type { AppData, AppStore } from '../types'
import { AppDataSchema, migrateAppDataV1ToV2 } from '../validation/schemas'

export interface BackupPreview {
  currencyCode: string;
  baselineScenarioName: string;
  activeScenarioName: string;
  scenarioNames: Array<{ id: string; name: string }>;
  scenarioCount: number;
  profileCount: number;
  incomeItemCount: number;
  expenseItemCount: number;
}

type PersistedFields = Pick<
  AppStore,
  'schemaVersion' | 'baselineScenarioId' | 'activeScenarioId' | 'scenarios' | 'settings'
>

/** Copies only persisted application data, never Zustand actions or runtime state. */
export function appDataSnapshot(state: PersistedFields): AppData {
  return AppDataSchema.parse(structuredClone({
    schemaVersion: state.schemaVersion,
    baselineScenarioId: state.baselineScenarioId,
    activeScenarioId: state.activeScenarioId,
    scenarios: state.scenarios,
    settings: state.settings,
  }))
}

/** Serializes a versioned AppData document without Zustand's persistence envelope. */
export function serializeAppData(data: AppData): string {
  return JSON.stringify(AppDataSchema.parse(data), null, 2)
}

export function parseAppDataBackup(contents: string): AppData {
  let candidate: unknown
  try {
    candidate = JSON.parse(contents) as unknown
  } catch {
    throw new Error('The selected file is not valid JSON.')
  }

  if (typeof candidate === 'object' && candidate !== null && 'schemaVersion' in candidate) {
    const version = candidate.schemaVersion
    if (version === 1) return migrateAppDataV1ToV2(candidate)
    if (version !== 2) {
      throw new Error(`Unsupported backup schema version "${String(version)}".`)
    }
  }

  const result = AppDataSchema.safeParse(candidate)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    throw new Error(`${path}${issue?.message ?? 'The backup does not match the Rato data format.'}`)
  }
  return result.data
}

export function previewAppData(data: AppData): BackupPreview {
  const scenarios = Object.values(data.scenarios)
  const baseline = data.scenarios[data.baselineScenarioId]
  const active = data.scenarios[data.activeScenarioId]
  const profiles = scenarios.flatMap((scenario) => Object.values(scenario.profiles))
  let incomeItemCount = 0
  let expenseItemCount = 0

  for (const scenario of scenarios) {
    for (const profile of Object.values(scenario.profiles)) {
      incomeItemCount += profile.ledger.income.length
      expenseItemCount += profile.ledger.expenses.length
    }
    incomeItemCount += scenario.joint.income.length
    expenseItemCount += scenario.joint.expenses.length
  }

  return {
    currencyCode: data.settings.currencyCode,
    baselineScenarioName: baseline?.name ?? 'Unknown baseline',
    activeScenarioName: active?.name ?? 'Unknown active scenario',
    scenarioNames: scenarios
      .map((scenario) => ({ id: scenario.id, name: scenario.name }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    scenarioCount: scenarios.length,
    profileCount: profiles.length,
    incomeItemCount,
    expenseItemCount,
  }
}

export function backupFilename(date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `rato-backup-${year}-${month}-${day}.json`
}
