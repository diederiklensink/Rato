import type {
  FinancialItem,
  ISODate,
  Ledger,
  LedgerMonthlyTotals,
  Recurrence,
  YearMonth,
} from '../types'

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function parseYearMonth(value: YearMonth): CalendarDate {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) throw new RangeError(`Invalid month "${value}"; expected YYYY-MM.`)

  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) {
    throw new RangeError(`Invalid month "${value}"; month must be between 01 and 12.`)
  }

  return { year, month, day: 1 }
}

function parseISODate(value: ISODate, label: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new RangeError(`Invalid ${label} "${value}"; expected YYYY-MM-DD.`)

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid ${label} "${value}"; it is not a calendar date.`)
  }

  return { year, month, day }
}

function monthIndex(date: Pick<CalendarDate, 'year' | 'month'>): number {
  return date.year * 12 + date.month - 1
}

function formatDate(date: CalendarDate): ISODate {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

function assertAmountCents(amountCents: number, label: string): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer number of cents.`)
  }
}

function addCents(total: number, amountCents: number, label: string): number {
  const next = BigInt(total) + BigInt(amountCents)
  if (next > MAX_SAFE_BIGINT) {
    throw new RangeError(`${label} exceeds the safe integer range.`)
  }
  return Number(next)
}

/**
 * Returns the single occurrence in a calendar month, if the recurrence has one.
 * Calendar arithmetic is performed without local-time or UTC date conversion.
 */
export function getOccurrenceInMonth(
  recurrence: Recurrence,
  month: YearMonth,
): ISODate | null {
  const target = parseYearMonth(month)
  const start = parseISODate(recurrence.startDate, 'start date')
  const startDate = formatDate(start)

  if (recurrence.frequency === 'once') {
    return monthIndex(start) === monthIndex(target) ? startDate : null
  }

  let intervalMonths: number
  switch (recurrence.frequency) {
    case 'monthly':
      intervalMonths = 1
      break
    case 'quarterly':
      intervalMonths = 3
      break
    case 'yearly':
      intervalMonths = 12
      break
    default:
      throw new RangeError('Unsupported recurrence frequency.')
  }

  const endDate = recurrence.endDate
  if (endDate !== null) {
    parseISODate(endDate, 'end date')
    if (endDate < startDate) {
      throw new RangeError('Recurrence end date must be on or after its start date.')
    }
  }

  const monthsSinceStart = monthIndex(target) - monthIndex(start)
  if (monthsSinceStart < 0 || monthsSinceStart % intervalMonths !== 0) return null

  const occurrence = formatDate({
    ...target,
    day: Math.min(start.day, daysInMonth(target.year, target.month)),
  })
  return endDate !== null && occurrence > endDate ? null : occurrence
}

function totalItems(items: FinancialItem[], month: YearMonth, label: string): number {
  let total = 0
  for (const item of items) {
    assertAmountCents(item.amountCents, `Item "${item.id}" amount`)
    if (getOccurrenceInMonth(item.recurrence, month) !== null) {
      total = addCents(total, item.amountCents, label)
    }
  }
  return total
}

/** Sums nominal income and expenses occurring in the requested month. */
export function calculateLedgerTotals(ledger: Ledger, month: YearMonth): LedgerMonthlyTotals {
  // Validate even empty ledgers so callers cannot pass an invalid month silently.
  parseYearMonth(month)
  return {
    incomeCents: totalItems(ledger.income, month, 'Monthly income total'),
    expenseCents: totalItems(ledger.expenses, month, 'Monthly expense total'),
  }
}
