import { describe, expect, it } from 'vitest'
import type { FinancialItem } from '../types'
import { createInitialAppData } from '../store/useAppStore'
import {
  appDataSnapshot,
  backupFilename,
  parseAppDataBackup,
  previewAppData,
  serializeAppData,
} from './importExport'

function item(id: string, amountCents: number): FinancialItem {
  return {
    id,
    name: id,
    amountCents,
    categoryId: 'Housing',
    recurrence: { frequency: 'monthly', startDate: '2026-01-01', endDate: null },
  }
}

describe('JSON backup utilities', () => {
  it('serializes and restores the direct versioned AppData shape', () => {
    const data = createInitialAppData()
    const scenario = data.scenarios[data.activeScenarioId]
    if (!scenario) throw new Error('Initial scenario is missing')
    scenario.joint.expenses.push(item('joint-rent', 125_000))
    scenario.planning.openingBalanceCents = 250_000
    scenario.planning.savingsGoals.push({
      id: 'emergency-fund',
      name: 'Emergency fund',
      targetCents: 1_000_000,
      savedCents: 250_000,
      targetDate: '2028-01-01',
    })

    const json = serializeAppData(data)
    const parsed = parseAppDataBackup(json)
    const document = JSON.parse(json) as Record<string, unknown>

    expect(Object.keys(document).sort()).toEqual([
      'activeScenarioId',
      'baselineScenarioId',
      'scenarios',
      'schemaVersion',
      'settings',
    ])
    expect(document).toHaveProperty('schemaVersion', 2)
    expect(document).not.toHaveProperty('state')
    expect(document).not.toHaveProperty('version')
    expect(document).not.toHaveProperty('hydrationStatus')
    expect(parsed).toEqual(data)
  })

  it('snapshots only persisted fields from the live store', () => {
    const data = createInitialAppData()
    const liveState = {
      ...data,
      hydrationStatus: 'ready',
      hydrationError: null,
      setActiveScenario: () => undefined,
    }
    const snapshot = appDataSnapshot(liveState)

    expect(snapshot).toEqual(data)
    expect(snapshot).not.toHaveProperty('setActiveScenario')
    expect(snapshot).not.toHaveProperty('hydrationStatus')
  })

  it('rejects malformed JSON, unsupported versions, invalid data, and unsupported currencies', () => {
    expect(() => parseAppDataBackup('{')).toThrow(/not valid JSON/)
    expect(() => parseAppDataBackup('{"schemaVersion":3}')).toThrow(/Unsupported backup schema version/)
    expect(() => parseAppDataBackup('{"schemaVersion":1}')).toThrow()

    const data = createInitialAppData()
    data.settings.currencyCode = 'JPY'
    expect(() => parseAppDataBackup(JSON.stringify(data))).toThrow(/currencyCode/)
  })

  it('migrates version 1 backups with empty planning data for every scenario', () => {
    const data = createInitialAppData()
    const scenarios = Object.fromEntries(Object.entries(data.scenarios).map(([id, scenario]) => {
      const { planning: _planning, ...legacyScenario } = scenario
      return [id, legacyScenario]
    }))
    const oldData = { ...data, schemaVersion: 1, scenarios }
    const migrated = parseAppDataBackup(JSON.stringify(oldData))

    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.scenarios[migrated.baselineScenarioId]?.planning).toEqual({ openingBalanceCents: 0, savingsGoals: [] })
  })

  it('previews scenario, profile, and ledger item counts', () => {
    const data = createInitialAppData()
    const baseline = data.scenarios[data.baselineScenarioId]
    if (!baseline) throw new Error('Initial scenario is missing')
    const [firstProfileId] = baseline.participantIds
    const firstProfile = baseline.profiles[firstProfileId]
    if (!firstProfile) throw new Error('Initial profile is missing')
    firstProfile.ledger.income.push(item('salary', 300_000))
    firstProfile.ledger.expenses.push(item('personal-rent', 125_000))
    baseline.joint.expenses.push(item('joint-bills', 25_000))

    const preview = previewAppData(data)

    expect(preview).toMatchObject({
      activeScenarioName: 'Baseline',
      baselineScenarioName: 'Baseline',
      currencyCode: 'EUR',
      scenarioCount: 1,
      profileCount: 2,
      incomeItemCount: 1,
      expenseItemCount: 2,
    })
    expect(preview.scenarioNames).toEqual([{ id: baseline.id, name: 'Baseline' }])
  })

  it('uses a local calendar date in the backup filename', () => {
    expect(backupFilename(new Date(2026, 0, 2))).toBe('rato-backup-2026-01-02.json')
  })
})
