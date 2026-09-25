import type { LedgerKind } from '../types'

export const LEDGER_CATEGORIES = {
  income: [
    'Salary',
    'Self-employment',
    'Benefits',
    'Pension',
    'Investment income',
    'Rental income',
    'Child support',
    'Other income',
  ],
  expense: [
    'Housing',
    'Utilities',
    'Groceries',
    'Transportation',
    'Insurance',
    'Healthcare',
    'Childcare',
    'Education',
    'Debt repayment',
    'Personal care',
    'Clothing',
    'Dining out',
    'Entertainment',
    'Travel',
    'Pets',
    'Savings',
    'Other expenses',
  ],
} as const satisfies Record<LedgerKind, readonly string[]>

const standardCategoryIds = new Set<string>([
  ...LEDGER_CATEGORIES.income,
  ...LEDGER_CATEGORIES.expense,
])

export function categoryLabel(categoryId: string, translate: (key: string) => string): string {
  return standardCategoryIds.has(categoryId) ? translate(categoryId) : categoryId
}

export function categoryIdFromInput(
  value: string,
  kind: LedgerKind,
  translate: (key: string) => string,
): string {
  const option = LEDGER_CATEGORIES[kind].find((categoryId) => (
    categoryId === value || translate(categoryId) === value
  ))
  return option ?? value
}
