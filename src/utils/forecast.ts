import type {
  ForecastAssumptions,
  ForecastPoint,
  FinancialItem,
  Ledger,
  LedgerMonthlyTotals,
  Scenario,
  YearMonth,
} from '../types'
import { calculateSettlementWithLedgerTotals } from './calculations'
import { getOccurrenceInMonth } from './recurrence'

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_MONTH_INDEX = 9999 * 12 + 11

function parseMonthIndex(month: YearMonth): number {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) throw new RangeError(`Invalid month "${month}"; expected YYYY-MM.`)
  const year = Number(match[1])
  const monthNumber = Number(match[2])
  if (monthNumber < 1 || monthNumber > 12) {
    throw new RangeError(`Invalid month "${month}"; month must be between 01 and 12.`)
  }
  return year * 12 + monthNumber - 1
}

function formatMonthIndex(index: number): YearMonth {
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_MONTH_INDEX) {
    throw new RangeError('Forecast exceeds the supported YYYY-MM calendar range.')
  }
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

function assertRate(rate: number, label: string): void {
  if (!Number.isFinite(rate) || rate <= -1) {
    throw new RangeError(`${label} must be finite and greater than -1.`)
  }
}

function validateAssumptions(assumptions: ForecastAssumptions): void {
  assertRate(assumptions.annualIncomeGrowthRate, 'Annual income growth rate')
  assertRate(assumptions.annualExpenseInflationRate, 'Annual expense inflation rate')
  for (const [categoryId, rate] of Object.entries(assumptions.expenseInflationByCategory)) {
    assertRate(rate, `Expense inflation rate for category "${categoryId}"`)
  }
}

function assertAmountCents(item: FinancialItem): void {
  if (!Number.isSafeInteger(item.amountCents) || item.amountCents < 0) {
    throw new RangeError(`Item "${item.id}" amount must be a nonnegative safe integer number of cents.`)
  }
}

function checkedAdd(total: number, amount: number, label: string): number {
  const result = BigInt(total) + BigInt(amount)
  if (result > MAX_SAFE_BIGINT) throw new RangeError(`${label} exceeds the safe integer range.`)
  return Number(result)
}

function projectOccurrence(
  item: FinancialItem,
  rate: number,
  monthsAhead: number,
): number {
  if (monthsAhead === 0) return item.amountCents

  const factor = Math.pow(1 + rate, monthsAhead / 12)
  const projected = item.amountCents * factor
  if (!Number.isFinite(projected) || projected < 0) {
    throw new RangeError(`Projected amount for item "${item.id}" is not finite.`)
  }
  const rounded = Math.floor(projected + 0.5)
  if (!Number.isSafeInteger(rounded)) {
    throw new RangeError(`Projected amount for item "${item.id}" exceeds the safe integer range.`)
  }
  return rounded
}

function projectedLedgerTotals(
  ledger: Ledger,
  month: YearMonth,
  monthsAhead: number,
  assumptions: ForecastAssumptions,
): LedgerMonthlyTotals {
  let incomeCents = 0
  for (const item of ledger.income) {
    assertAmountCents(item)
    if (getOccurrenceInMonth(item.recurrence, month) === null) continue
    incomeCents = checkedAdd(
      incomeCents,
      projectOccurrence(item, assumptions.annualIncomeGrowthRate, monthsAhead),
      'Monthly income total',
    )
  }

  let expenseCents = 0
  for (const item of ledger.expenses) {
    assertAmountCents(item)
    if (getOccurrenceInMonth(item.recurrence, month) === null) continue
    const categoryRate = Object.prototype.hasOwnProperty.call(
      assumptions.expenseInflationByCategory,
      item.categoryId,
    )
      ? assumptions.expenseInflationByCategory[item.categoryId]
      : assumptions.annualExpenseInflationRate
    if (categoryRate === undefined) {
      throw new RangeError(`Missing expense inflation rate for category "${item.categoryId}".`)
    }
    expenseCents = checkedAdd(
      expenseCents,
      projectOccurrence(item, categoryRate, monthsAhead),
      'Monthly expense total',
    )
  }

  return { incomeCents, expenseCents }
}

/** Builds a scenario forecast beginning with the nominal base month. */
export function buildMonthlyForecast(
  scenario: Scenario,
  baseMonth: YearMonth,
  monthCount: number,
): ForecastPoint[] {
  const baseIndex = parseMonthIndex(baseMonth)
  if (!Number.isSafeInteger(monthCount) || monthCount < 1) {
    throw new RangeError('Forecast month count must be a positive safe integer.')
  }
  if (baseIndex + monthCount - 1 > MAX_MONTH_INDEX) {
    throw new RangeError('Forecast exceeds the supported YYYY-MM calendar range.')
  }
  validateAssumptions(scenario.forecastAssumptions)

  return Array.from({ length: monthCount }, (_, monthsAhead) => {
    const month = formatMonthIndex(baseIndex + monthsAhead)
    const settlement = calculateSettlementWithLedgerTotals(
      scenario,
      month,
      (ledger) => projectedLedgerTotals(
        ledger,
        month,
        monthsAhead,
        scenario.forecastAssumptions,
      ),
    )
    return { month, monthsAhead, settlement }
  })
}
