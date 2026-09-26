import type { Scenario, YearMonth } from '../../types'
import { getOccurrenceInMonth } from '../../utils/recurrence'

export interface CategoryLedgerBreakdownRow {
  key: string;
  categoryId: string;
  ownerKey: string;
  ownerName: string;
  incomeCents: number;
  expenseCents: number;
}

export interface RankedExpenseCategory {
  categoryId: string;
  expenseCents: number;
  grouped: boolean;
}

export interface RankedExpenseCategories {
  categories: RankedExpenseCategory[];
  totalExpensesCents: number;
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

function addCents(total: number, amount: number, categoryId: string): number {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`Category "${categoryId}" contains an invalid amount.`)
  }
  const next = BigInt(total) + BigInt(amount)
  if (next > MAX_SAFE_BIGINT) {
    throw new RangeError(`Category "${categoryId}" exceeds the safe integer range.`)
  }
  return Number(next)
}

/** Groups selected-month occurrences by category and settlement ledger owner. */
export function buildCategoryLedgerBreakdown(
  scenario: Scenario,
  month: YearMonth,
): CategoryLedgerBreakdownRow[] {
  const rows = new Map<string, CategoryLedgerBreakdownRow>()
  const owners = scenario.participantIds.map((profileId) => {
    const profile = scenario.profiles[profileId]
    if (!profile) throw new RangeError(`Participant "${profileId}" does not exist.`)
    return {
      ownerKey: `profile:${profileId}`,
      ownerName: profile.name,
      ledger: profile.ledger,
    }
  })

  owners.push({
    ownerKey: 'joint',
    ownerName: 'Joint ledger',
    ledger: scenario.joint,
  })

  for (const owner of owners) {
    for (const kind of ['income', 'expenses'] as const) {
      for (const item of owner.ledger[kind]) {
        if (getOccurrenceInMonth(item.recurrence, month) === null) continue

        const key = JSON.stringify([owner.ownerKey, item.categoryId])
        const row = rows.get(key) ?? {
          key,
          categoryId: item.categoryId,
          ownerKey: owner.ownerKey,
          ownerName: owner.ownerName,
          incomeCents: 0,
          expenseCents: 0,
        }
        if (kind === 'income') {
          row.incomeCents = addCents(row.incomeCents, item.amountCents, item.categoryId)
        } else {
          row.expenseCents = addCents(row.expenseCents, item.amountCents, item.categoryId)
        }
        rows.set(key, row)
      }
    }
  }

  return [...rows.values()].sort((left, right) => (
    left.categoryId.localeCompare(right.categoryId, undefined, { sensitivity: 'base' })
      || left.ownerName.localeCompare(right.ownerName, undefined, { sensitivity: 'base' })
      || left.ownerKey.localeCompare(right.ownerKey)
  ))
}

/** Returns the largest expense categories and combines the remainder into one row. */
export function rankExpenseCategories(
  rows: CategoryLedgerBreakdownRow[],
  limit = 5,
): RankedExpenseCategories {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Category limit must be positive.')
  const totals = new Map<string, number>()
  let totalExpensesCents = 0
  for (const row of rows) {
    if (!Number.isSafeInteger(row.expenseCents) || row.expenseCents < 0) {
      throw new RangeError(`Category "${row.categoryId}" contains an invalid amount.`)
    }
    totals.set(row.categoryId, addCents(totals.get(row.categoryId) ?? 0, row.expenseCents, row.categoryId))
    totalExpensesCents = addCents(totalExpensesCents, row.expenseCents, row.categoryId)
  }
  const sorted = [...totals.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([categoryId, expenseCents]) => ({ categoryId, expenseCents, grouped: false }))
    .sort((left, right) => right.expenseCents - left.expenseCents
      || left.categoryId.localeCompare(right.categoryId, undefined, { sensitivity: 'base' }))
  const visible = sorted.slice(0, limit)
  const groupedCents = sorted.slice(limit).reduce(
    (sum, category) => addCents(sum, category.expenseCents, category.categoryId),
    0,
  )
  if (groupedCents > 0) visible.push({ categoryId: 'Other categories', expenseCents: groupedCents, grouped: true })
  return { categories: visible, totalExpensesCents }
}
