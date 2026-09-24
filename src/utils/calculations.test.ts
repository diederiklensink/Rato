import { describe, expect, it } from 'vitest'
import type { FinancialItem, Ledger, Scenario } from '../types'
import { calculateSettlement } from './calculations'

const FIRST = 'profile-first'
const SECOND = 'profile-second'
const EXTRA = 'profile-extra'
const MONTH = '2026-06'

function item(id: string, amountCents: number, startDate = `${MONTH}-15`): FinancialItem {
  return {
    id,
    name: id,
    amountCents,
    categoryId: 'general',
    recurrence: { frequency: 'once', startDate },
  }
}

function ledger(income: FinancialItem[] = [], expenses: FinancialItem[] = []): Ledger {
  return { income, expenses }
}

function scenario(options: {
  mode?: Scenario['calculationMode'];
  firstIncome?: number;
  secondIncome?: number;
  firstExpenses?: number;
  secondExpenses?: number;
  jointIncome?: number;
  jointExpenses?: number;
  extraIncome?: number;
} = {}): Scenario {
  const {
    mode = 'pro_rata',
    firstIncome = 0,
    secondIncome = 0,
    firstExpenses = 0,
    secondExpenses = 0,
    jointIncome = 0,
    jointExpenses = 0,
    extraIncome = 0,
  } = options

  return {
    id: 'scenario-test',
    name: 'Test scenario',
    parentScenarioId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    profiles: {
      [FIRST]: {
        id: FIRST,
        name: 'Partner 1',
        ledger: ledger(
          firstIncome === 0 ? [] : [item('first-income', firstIncome)],
          firstExpenses === 0 ? [] : [item('first-expense', firstExpenses)],
        ),
      },
      [SECOND]: {
        id: SECOND,
        name: 'Partner 2',
        ledger: ledger(
          secondIncome === 0 ? [] : [item('second-income', secondIncome)],
          secondExpenses === 0 ? [] : [item('second-expense', secondExpenses)],
        ),
      },
      [EXTRA]: {
        id: EXTRA,
        name: 'Unselected profile',
        ledger: ledger(extraIncome === 0 ? [] : [item('extra-income', extraIncome)]),
      },
    },
    participantIds: [FIRST, SECOND],
    joint: ledger(
      jointIncome === 0 ? [] : [item('joint-income', jointIncome)],
      jointExpenses === 0 ? [] : [item('joint-expense', jointExpenses)],
    ),
    calculationMode: mode,
    forecastAssumptions: {
      annualExpenseInflationRate: 0,
      annualIncomeGrowthRate: 0,
      expenseInflationByCategory: {},
    },
  }
}

describe('monthly settlement calculations', () => {
  it('calculates pro rata transfers from selected participants and reconciles exactly', () => {
    const result = calculateSettlement(scenario({
      firstIncome: 10_000,
      secondIncome: 20_000,
      firstExpenses: 5_000,
      jointExpenses: 100_000,
      jointIncome: 10_000,
      extraIncome: 500_000,
    }), MONTH)

    expect(result.netJointCostCents).toBe(90_000)
    expect(result.byProfile[FIRST]).toEqual({
      incomeCents: 10_000,
      personalExpenseCents: 5_000,
      contributionCents: 30_000,
      discretionaryCents: -25_000,
    })
    expect(result.byProfile[SECOND]?.contributionCents).toBe(60_000)
    expect(result.byProfile[EXTRA]).toBeUndefined()
    expect((result.byProfile[FIRST]?.contributionCents ?? 0)
      + (result.byProfile[SECOND]?.contributionCents ?? 0)).toBe(result.netJointCostCents)
  })

  it('splits pro rata equally when both participants have zero income', () => {
    const result = calculateSettlement(scenario({ jointExpenses: 101 }), MONTH)
    expect(result.byProfile[FIRST]?.contributionCents).toBe(51)
    expect(result.byProfile[SECOND]?.contributionCents).toBe(50)
  })

  it('supports signed negative joint cost in the 50/50 mode', () => {
    const result = calculateSettlement(scenario({
      mode: 'fifty_fifty',
      jointIncome: 1_001,
    }), MONTH)

    expect(result.netJointCostCents).toBe(-1_001)
    expect(result.byProfile[FIRST]?.contributionCents).toBe(-501)
    expect(result.byProfile[SECOND]?.contributionCents).toBe(-500)
  })

  it('rounds half-cent transfers away from zero and assigns the balancing cent to the second participant', () => {
    const positive = calculateSettlement(scenario({
      mode: 'fifty_fifty',
      jointExpenses: 1_001,
    }), MONTH)
    const negative = calculateSettlement(scenario({
      mode: 'fifty_fifty',
      jointIncome: 1_001,
    }), MONTH)

    expect(positive.byProfile[FIRST]?.contributionCents).toBe(501)
    expect(positive.byProfile[SECOND]?.contributionCents).toBe(500)
    expect(negative.byProfile[FIRST]?.contributionCents).toBe(-501)
    expect(negative.byProfile[SECOND]?.contributionCents).toBe(-500)
  })

  it('equalizes discretionary money after personal expenses in equal remainder mode', () => {
    const result = calculateSettlement(scenario({
      mode: 'equal_remainder',
      firstIncome: 1_000,
      secondIncome: 500,
      firstExpenses: 200,
      secondExpenses: 100,
      jointExpenses: 1_000,
    }), MONTH)

    expect(result.byProfile[FIRST]?.contributionCents).toBe(700)
    expect(result.byProfile[SECOND]?.contributionCents).toBe(300)
    expect(result.byProfile[FIRST]?.discretionaryCents).toBe(100)
    expect(result.byProfile[SECOND]?.discretionaryCents).toBe(100)
  })

  it('does not mutate the scenario and rejects unsafe calculated results', () => {
    const source = scenario({
      mode: 'equal_remainder',
      firstIncome: Number.MAX_SAFE_INTEGER,
      secondExpenses: Number.MAX_SAFE_INTEGER,
      jointExpenses: Number.MAX_SAFE_INTEGER,
    })
    const snapshot = structuredClone(source)

    expect(() => calculateSettlement(source, MONTH)).toThrow(RangeError)
    expect(source).toEqual(snapshot)

    const invalidParticipants = scenario()
    invalidParticipants.participantIds = [FIRST, 'missing']
    expect(() => calculateSettlement(invalidParticipants, MONTH)).toThrow(/distinct existing participants/)
  })
})
