import { describe, expect, it } from 'vitest'
import type { FinancialItem, Scenario } from '../../types'
import { buildCategoryLedgerBreakdown, rankExpenseCategories } from './dashboardData'

const FIRST = 'profile-first'
const SECOND = 'profile-second'
const EXTRA = 'profile-extra'

function monthlyItem(
  id: string,
  name: string,
  amountCents: number,
  categoryId: string,
  startDate = '2026-01-01',
  endDate: string | null = null,
): FinancialItem {
  return {
    id,
    name,
    amountCents,
    categoryId,
    recurrence: { frequency: 'monthly', startDate, endDate },
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

function scenario(): Scenario {
  return {
    id: 'scenario-test',
    name: 'Test scenario',
    parentScenarioId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    profiles: {
      [FIRST]: {
        id: FIRST,
        name: 'Alex',
        ledger: {
          income: [monthlyItem('salary-a', 'Salary', 300_000, 'Salary')],
          expenses: [
            monthlyItem('rent-a', 'Rent', 50_000, 'Housing', '2026-01-01', '2026-06-30'),
            onceItem('repair-a', 8_000, 'Repairs', '2026-06-05'),
          ],
        },
      },
      [SECOND]: {
        id: SECOND,
        name: 'Blair',
        ledger: { income: [], expenses: [monthlyItem('rent-b', 'Rent', 40_000, 'Housing')] },
      },
      [EXTRA]: {
        id: EXTRA,
        name: 'Unselected profile',
        ledger: { income: [monthlyItem('other-salary', 'Other', 9_000_000, 'Excluded')] , expenses: [] },
      },
    },
    participantIds: [FIRST, SECOND],
    joint: {
      income: [],
      expenses: [monthlyItem('shared-rent', 'Rent', 80_000, 'Housing')],
    },
    calculationMode: 'pro_rata',
    planning: { openingBalanceCents: 0, savingsGoals: [] },
    forecastAssumptions: {
      annualExpenseInflationRate: 0,
      annualIncomeGrowthRate: 0,
      expenseInflationByCategory: {},
    },
  }
}

describe('dashboard category and owner breakdown', () => {
  it('groups recurring and one-time selected-month amounts by category and ledger owner', () => {
    const rows = buildCategoryLedgerBreakdown(scenario(), '2026-06')

    expect(rows).toEqual([
      {
        key: '["profile:profile-first","Housing"]',
        categoryId: 'Housing',
        ownerKey: `profile:${FIRST}`,
        ownerName: 'Alex',
        incomeCents: 0,
        expenseCents: 50_000,
      },
      {
        key: '["profile:profile-second","Housing"]',
        categoryId: 'Housing',
        ownerKey: `profile:${SECOND}`,
        ownerName: 'Blair',
        incomeCents: 0,
        expenseCents: 40_000,
      },
      {
        key: '["joint","Housing"]',
        categoryId: 'Housing',
        ownerKey: 'joint',
        ownerName: 'Joint ledger',
        incomeCents: 0,
        expenseCents: 80_000,
      },
      {
        key: '["profile:profile-first","Repairs"]',
        categoryId: 'Repairs',
        ownerKey: `profile:${FIRST}`,
        ownerName: 'Alex',
        incomeCents: 0,
        expenseCents: 8_000,
      },
      {
        key: '["profile:profile-first","Salary"]',
        categoryId: 'Salary',
        ownerKey: `profile:${FIRST}`,
        ownerName: 'Alex',
        incomeCents: 300_000,
        expenseCents: 0,
      },
    ])
    expect(rows.some((row) => row.categoryId === 'Excluded')).toBe(false)
  })

  it('omits occurrences outside the selected month and after a recurrence end date', () => {
    const rows = buildCategoryLedgerBreakdown(scenario(), '2026-07')

    expect(rows.some((row) => row.categoryId === 'Repairs')).toBe(false)
    expect(rows.find((row) => row.ownerKey === `profile:${FIRST}` && row.categoryId === 'Housing'))
      .toBeUndefined()
    expect(rows.find((row) => row.ownerKey === `profile:${SECOND}` && row.categoryId === 'Housing')
      ?.expenseCents).toBe(40_000)
  })

  it('ranks five expense categories and groups the remaining amount', () => {
    const rows = ['Housing', 'Groceries', 'Utilities', 'Travel', 'Pets', 'Other expenses'].map((categoryId, index) => ({
      key: categoryId,
      categoryId,
      ownerKey: 'joint',
      ownerName: 'Joint ledger',
      incomeCents: 0,
      expenseCents: (6 - index) * 100,
    }))

    expect(rankExpenseCategories(rows)).toEqual({
      totalExpensesCents: 2_100,
      categories: [
        { categoryId: 'Housing', expenseCents: 600, grouped: false },
        { categoryId: 'Groceries', expenseCents: 500, grouped: false },
        { categoryId: 'Utilities', expenseCents: 400, grouped: false },
        { categoryId: 'Travel', expenseCents: 300, grouped: false },
        { categoryId: 'Pets', expenseCents: 200, grouped: false },
        { categoryId: 'Other categories', expenseCents: 100, grouped: true },
      ],
    })
  })
})
