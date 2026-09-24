import { describe, expect, it } from 'vitest'
import type { FinancialItem, Scenario } from '../types'
import { buildMonthlyForecast } from './forecast'

const FIRST = 'profile-first'
const SECOND = 'profile-second'

function recurringItem(
  id: string,
  amountCents: number,
  categoryId: string,
  startDate = '2026-01-01',
): FinancialItem {
  return {
    id,
    name: id,
    amountCents,
    categoryId,
    recurrence: { frequency: 'monthly', startDate, endDate: null },
  }
}

function onceItem(
  id: string,
  amountCents: number,
  categoryId: string,
  startDate: string,
): FinancialItem {
  return {
    id,
    name: id,
    amountCents,
    categoryId,
    recurrence: { frequency: 'once', startDate },
  }
}

function baseScenario(): Scenario {
  return {
    id: 'scenario-forecast',
    name: 'Forecast test',
    parentScenarioId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    profiles: {
      [FIRST]: {
        id: FIRST,
        name: 'Partner 1',
        ledger: {
          income: [recurringItem('first-salary', 120_000, 'salary')],
          expenses: [
            recurringItem('housing', 12_000, 'housing'),
            onceItem('planned-purchase', 1_000_000, 'other', '2027-01-20'),
          ],
        },
      },
      [SECOND]: {
        id: SECOND,
        name: 'Partner 2',
        ledger: {
          income: [recurringItem('second-salary', 60_000, 'salary')],
          expenses: [recurringItem('groceries', 6_000, 'groceries')],
        },
      },
    },
    participantIds: [FIRST, SECOND],
    joint: {
      income: [],
      expenses: [recurringItem('joint-cost', 18_000, 'groceries')],
    },
    calculationMode: 'fifty_fifty',
    forecastAssumptions: {
      annualExpenseInflationRate: 0.12,
      annualIncomeGrowthRate: 0.12,
      expenseInflationByCategory: { housing: 0.24 },
    },
  }
}

describe('monthly scenario forecasts', () => {
  it('includes the nominal base month and applies annualized rates after it', () => {
    const forecast = buildMonthlyForecast(baseScenario(), '2026-01', 13)
    const base = forecast[0]
    const oneYearAhead = forecast[12]

    expect(forecast).toHaveLength(13)
    expect(base).toMatchObject({ month: '2026-01', monthsAhead: 0 })
    expect(base?.settlement.byProfile[FIRST]?.incomeCents).toBe(120_000)
    expect(base?.settlement.byProfile[FIRST]?.personalExpenseCents).toBe(12_000)
    expect(oneYearAhead).toMatchObject({ month: '2027-01', monthsAhead: 12 })
    expect(oneYearAhead?.settlement.byProfile[FIRST]?.incomeCents).toBe(134_400)
    expect(oneYearAhead?.settlement.byProfile[SECOND]?.incomeCents).toBe(67_200)
    expect(oneYearAhead?.settlement.byProfile[FIRST]?.personalExpenseCents).toBe(1_134_880)
    expect(oneYearAhead?.settlement.byProfile[SECOND]?.personalExpenseCents).toBe(6_720)
    expect(oneYearAhead?.settlement.jointExpenseCents).toBe(20_160)
    expect(oneYearAhead?.settlement.netJointCostCents).toBe(20_160)
  })

  it('rounds each projected occurrence before summing items', () => {
    const scenario = baseScenario()
    scenario.profiles[FIRST]!.ledger.expenses = [
      recurringItem('one-cent-a', 1, 'tiny'),
      recurringItem('one-cent-b', 1, 'tiny'),
    ]
    scenario.joint.expenses = []
    scenario.forecastAssumptions.annualExpenseInflationRate = 255
    scenario.forecastAssumptions.expenseInflationByCategory = {}

    const nextMonth = buildMonthlyForecast(scenario, '2026-01', 2)[1]
    expect(nextMonth?.settlement.byProfile[FIRST]?.personalExpenseCents).toBe(4)
  })

  it('uses the selected base month when applying fractional-year growth and does not mutate inputs', () => {
    const scenario = baseScenario()
    const snapshot = structuredClone(scenario)
    const forecast = buildMonthlyForecast(scenario, '2026-01', 7)
    const sixMonthsAhead = forecast[6]
    const expectedIncome = Math.floor(120_000 * Math.pow(1.12, 6 / 12) + 0.5)
    const expectedHousing = Math.floor(12_000 * Math.pow(1.24, 6 / 12) + 0.5)

    expect(sixMonthsAhead?.settlement.byProfile[FIRST]?.incomeCents).toBe(expectedIncome)
    expect(sixMonthsAhead?.settlement.byProfile[FIRST]?.personalExpenseCents).toBe(expectedHousing)
    expect(scenario).toEqual(snapshot)
  })

  it('rejects invalid horizons, out-of-range months, and invalid forecast rates', () => {
    const scenario = baseScenario()

    expect(() => buildMonthlyForecast(scenario, '2026-01', 0)).toThrow(RangeError)
    expect(() => buildMonthlyForecast(scenario, '2026-01', 1.5)).toThrow(RangeError)
    expect(() => buildMonthlyForecast(scenario, '2026-13', 1)).toThrow(RangeError)
    expect(() => buildMonthlyForecast(scenario, '9999-12', 2)).toThrow(RangeError)
    scenario.forecastAssumptions.annualIncomeGrowthRate = -1
    expect(() => buildMonthlyForecast(scenario, '2026-01', 1)).toThrow(RangeError)
  })

  it('rejects projected occurrences that exceed safe integer cents', () => {
    const scenario = baseScenario()
    scenario.profiles[FIRST]!.ledger.expenses = [
      recurringItem('large-expense', Number.MAX_SAFE_INTEGER, 'large'),
    ]
    scenario.joint.expenses = []
    scenario.forecastAssumptions.annualExpenseInflationRate = 1
    scenario.forecastAssumptions.expenseInflationByCategory = {}

    expect(() => buildMonthlyForecast(scenario, '2026-01', 13)).toThrow(RangeError)
  })
})
