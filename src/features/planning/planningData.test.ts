import { describe, expect, it } from 'vitest'
import type { FinancialItem, Scenario } from '../../types'
import { buildCashFlowTimeline, buildCategoryProjectionChanges, buildUpcomingPlannedChanges } from './planningData'

function item(
  id: string,
  amountCents: number,
  categoryId: string,
  startDate: string,
  frequency: 'once' | 'monthly' = 'monthly',
  endDate: string | null = null,
): FinancialItem {
  return {
    id,
    name: id,
    amountCents,
    categoryId,
    recurrence: frequency === 'once'
      ? { frequency, startDate }
      : { frequency, startDate, endDate },
  }
}

function scenario(): Scenario {
  return {
    id: 'scenario-planning',
    name: 'Planning test',
    parentScenarioId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    profiles: {
      first: {
        id: 'first',
        name: 'Alex',
        ledger: {
          income: [item('salary', 300_000, 'Salary', '2026-01-15')],
          expenses: [item('rent', 100_000, 'Housing', '2026-01-10', 'monthly', '2026-03-10')],
        },
      },
      second: {
        id: 'second',
        name: 'Blair',
        ledger: { income: [], expenses: [] },
      },
      extra: {
        id: 'extra',
        name: 'Not selected',
        ledger: { income: [item('excluded', 9_000_000, 'Salary', '2026-01-01')], expenses: [] },
      },
    },
    participantIds: ['first', 'second'],
    joint: {
      income: [],
      expenses: [item('shared', 50_000, 'Utilities', '2026-01-15')],
    },
    calculationMode: 'fifty_fifty',
    forecastAssumptions: {
      annualExpenseInflationRate: 0,
      annualIncomeGrowthRate: 0.12,
      expenseInflationByCategory: { Housing: 0.12 },
    },
    planning: { openingBalanceCents: 200_000, savingsGoals: [] },
  }
}

describe('planning projections', () => {
  it('groups same-day flows, applies forecast assumptions, and carries a running balance', () => {
    const days = buildCashFlowTimeline(scenario(), '2026-01', 3)
    const firstDay = days.find((day) => day.date === '2026-01-15')
    const februaryPay = days.find((day) => day.date === '2026-02-15')

    expect(days.map((day) => day.date)).toEqual([
      '2026-01-10', '2026-01-15', '2026-02-10', '2026-02-15', '2026-03-10', '2026-03-15',
    ])
    expect(firstDay).toMatchObject({ incomeCents: 300_000, expenseCents: 50_000, balanceCents: 350_000 })
    expect(firstDay?.items).toHaveLength(2)
    expect(februaryPay?.incomeCents).toBeGreaterThan(300_000)
    expect(days.at(-1)?.balanceCents).toBeGreaterThan(200_000)
    expect(days.some((day) => day.items.some((entry) => entry.id === 'excluded'))).toBe(false)
  })

  it('lists one-time costs and recurring starts and ends inside the selected period', () => {
    const subject = scenario()
    const changes = buildUpcomingPlannedChanges(subject, '2026-01', 3)
    subject.joint.expenses.push(item('repair', 25_000, 'Repairs', '2026-02-20', 'once'))
    const withRepair = buildUpcomingPlannedChanges(subject, '2026-01', 3)

    expect(changes.some((change) => change.name === 'rent' && change.kind === 'starts')).toBe(true)
    expect(changes.some((change) => change.name === 'rent' && change.kind === 'ends')).toBe(true)
    expect(withRepair.find((change) => change.name === 'repair')).toMatchObject({ date: '2026-02-20', kind: 'one-time' })
  })

  it('reports category cost changes over the chosen forecast horizon', () => {
    const subject = scenario()
    const rent = subject.profiles.first?.ledger.expenses[0]
    if (!rent || rent.recurrence.frequency === 'once') throw new Error('Recurring rent item is missing')
    rent.recurrence.endDate = null
    const changes = buildCategoryProjectionChanges(subject, '2026-01', 13)
    expect(changes.find((change) => change.categoryId === 'Housing')).toMatchObject({
      baseCents: 100_000,
      futureCents: 112_000,
      changeCents: 12_000,
    })
  })
})
