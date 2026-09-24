import { describe, expect, it } from 'vitest'
import type { FinancialItem, Ledger, Recurrence } from '../types'
import { calculateLedgerTotals, getOccurrenceInMonth } from './recurrence'

function item(
  id: string,
  amountCents: number,
  recurrence: Recurrence,
): FinancialItem {
  return { id, name: id, amountCents, categoryId: 'general', recurrence }
}

describe('recurrence utilities', () => {
  it('returns one-time occurrences only in their start month', () => {
    const recurrence: Recurrence = { frequency: 'once', startDate: '2026-04-18' }

    expect(getOccurrenceInMonth(recurrence, '2026-04')).toBe('2026-04-18')
    expect(getOccurrenceInMonth(recurrence, '2026-03')).toBeNull()
    expect(getOccurrenceInMonth(recurrence, '2026-05')).toBeNull()
  })

  it('anchors monthly and quarterly recurrences to the start month and clamps month ends', () => {
    const monthly: Recurrence = {
      frequency: 'monthly',
      startDate: '2024-01-31',
      endDate: null,
    }
    const quarterly: Recurrence = {
      frequency: 'quarterly',
      startDate: '2024-01-31',
      endDate: null,
    }

    expect(getOccurrenceInMonth(monthly, '2024-02')).toBe('2024-02-29')
    expect(getOccurrenceInMonth(monthly, '2024-03')).toBe('2024-03-31')
    expect(getOccurrenceInMonth(quarterly, '2024-04')).toBe('2024-04-30')
    expect(getOccurrenceInMonth(quarterly, '2024-05')).toBeNull()
    expect(getOccurrenceInMonth(quarterly, '2024-07')).toBe('2024-07-31')
  })

  it('clamps yearly leap-day occurrences without losing the original anchor', () => {
    const yearly: Recurrence = {
      frequency: 'yearly',
      startDate: '2024-02-29',
      endDate: null,
    }

    expect(getOccurrenceInMonth(yearly, '2025-02')).toBe('2025-02-28')
    expect(getOccurrenceInMonth(yearly, '2026-02')).toBe('2026-02-28')
    expect(getOccurrenceInMonth(yearly, '2028-02')).toBe('2028-02-29')
  })

  it('includes an occurrence on the end date and excludes one after it', () => {
    const inclusive: Recurrence = {
      frequency: 'monthly',
      startDate: '2026-01-31',
      endDate: '2026-02-28',
    }
    const beforeOccurrence: Recurrence = {
      frequency: 'monthly',
      startDate: '2026-01-31',
      endDate: '2026-02-27',
    }

    expect(getOccurrenceInMonth(inclusive, '2026-02')).toBe('2026-02-28')
    expect(getOccurrenceInMonth(inclusive, '2026-03')).toBeNull()
    expect(getOccurrenceInMonth(beforeOccurrence, '2026-02')).toBeNull()
  })

  it('totals whole occurrences without prorating partial months', () => {
    const ledger: Ledger = {
      income: [item('salary', 250_000, {
        frequency: 'monthly',
        startDate: '2026-04-29',
        endDate: '2026-05-28',
      })],
      expenses: [item('subscription', 1_299, {
        frequency: 'monthly',
        startDate: '2026-04-30',
        endDate: '2026-05-30',
      })],
    }

    expect(calculateLedgerTotals(ledger, '2026-04')).toEqual({
      incomeCents: 250_000,
      expenseCents: 1_299,
    })
    expect(calculateLedgerTotals(ledger, '2026-05')).toEqual({
      incomeCents: 0,
      expenseCents: 1_299,
    })
  })

  it('rejects malformed months, calendar dates, reversed end dates, and unsafe totals', () => {
    const invalidDate = {
      frequency: 'monthly',
      startDate: '2026-02-30',
      endDate: null,
    } as Recurrence

    expect(() => getOccurrenceInMonth({ frequency: 'once', startDate: '2026-01-01' }, '2026-13')).toThrow(RangeError)
    expect(() => getOccurrenceInMonth(invalidDate, '2026-03')).toThrow(RangeError)
    expect(() => getOccurrenceInMonth({
      frequency: 'monthly',
      startDate: '2026-02-10',
      endDate: '2026-02-09',
    }, '2026-02')).toThrow(RangeError)
    expect(() => calculateLedgerTotals({ income: [], expenses: [] }, '2026-00')).toThrow(RangeError)
    expect(() => calculateLedgerTotals({
      income: [
        item('large-a', Number.MAX_SAFE_INTEGER, { frequency: 'once', startDate: '2026-04-01' }),
        item('large-b', 1, { frequency: 'once', startDate: '2026-04-02' }),
      ],
      expenses: [],
    }, '2026-04')).toThrow(RangeError)
  })
})
