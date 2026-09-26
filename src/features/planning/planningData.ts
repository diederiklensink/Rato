import type { FinancialItem, LedgerKind, Scenario, YearMonth } from '../../types'
import { getOccurrenceInMonth } from '../../utils/recurrence'
import { projectFinancialItemAmount } from '../../utils/forecast'

export interface CashFlowItem {
  id: string;
  name: string;
  ownerName: string;
  kind: LedgerKind;
  amountCents: number;
}

export interface CashFlowDay {
  date: string;
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  items: CashFlowItem[];
}

export interface PlannedChange {
  date: string;
  kind: 'one-time' | 'starts' | 'ends';
  name: string;
  ownerName: string;
  amountCents: number;
}

export interface CategoryProjectionChange {
  categoryId: string;
  baseCents: number;
  futureCents: number;
  changeCents: number;
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER)

function addSafeCents(left: number, right: number, label: string): number {
  const result = BigInt(left) + BigInt(right)
  if (result > MAX_SAFE_BIGINT || result < MIN_SAFE_BIGINT) {
    throw new RangeError(`${label} exceeds the safe integer range.`)
  }
  return Number(result)
}

function monthIndex(month: YearMonth): number {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) throw new RangeError(`Invalid month "${month}"; expected YYYY-MM.`)
  const year = Number(match[1])
  const monthNumber = Number(match[2])
  if (monthNumber < 1 || monthNumber > 12) throw new RangeError(`Invalid month "${month}".`)
  return year * 12 + monthNumber - 1
}

function monthAt(baseMonth: YearMonth, monthsAhead: number): YearMonth {
  const index = monthIndex(baseMonth) + monthsAhead
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  if (year > 9999) throw new RangeError('Planning period exceeds the supported calendar range.')
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

function dateMonth(value: string): number {
  return monthIndex(value.slice(0, 7))
}

function activeLedgers(scenario: Scenario) {
  const owners = scenario.participantIds.map((profileId) => {
    const profile = scenario.profiles[profileId]
    if (!profile) throw new RangeError(`Participant "${profileId}" does not exist.`)
    return { ownerName: profile.name, ledger: profile.ledger }
  })
  owners.push({ ownerName: 'Joint ledger', ledger: scenario.joint })
  return owners
}

function amountRate(scenario: Scenario, item: FinancialItem, kind: LedgerKind): number {
  if (kind === 'income') return scenario.forecastAssumptions.annualIncomeGrowthRate
  return Object.prototype.hasOwnProperty.call(
    scenario.forecastAssumptions.expenseInflationByCategory,
    item.categoryId,
  )
    ? scenario.forecastAssumptions.expenseInflationByCategory[item.categoryId] ?? 0
    : scenario.forecastAssumptions.annualExpenseInflationRate
}

/** Builds a date-sorted household cash flow for the requested calendar months. */
export function buildCashFlowTimeline(
  scenario: Scenario,
  baseMonth: YearMonth,
  monthCount = 3,
): CashFlowDay[] {
  if (!Number.isSafeInteger(monthCount) || monthCount < 1) {
    throw new RangeError('Cash-flow month count must be a positive safe integer.')
  }
  monthIndex(baseMonth)
  const days = new Map<string, Omit<CashFlowDay, 'balanceCents'>>()
  const owners = activeLedgers(scenario)

  owners.forEach(({ ownerName, ledger }) => {
    for (const kind of ['income', 'expense'] as const) {
      for (const item of ledger[kind === 'income' ? 'income' : 'expenses']) {
        for (let offset = 0; offset < monthCount; offset += 1) {
          const month = monthAt(baseMonth, offset)
          const date = getOccurrenceInMonth(item.recurrence, month)
          if (!date) continue
          const amountCents = projectFinancialItemAmount(item, amountRate(scenario, item, kind), offset)
          const day = days.get(date) ?? { date, incomeCents: 0, expenseCents: 0, items: [] }
          if (kind === 'income') day.incomeCents = addSafeCents(day.incomeCents, amountCents, 'Daily income total')
          else day.expenseCents = addSafeCents(day.expenseCents, amountCents, 'Daily expense total')
          day.items.push({ id: item.id, name: item.name, ownerName, kind, amountCents })
          days.set(date, day)
        }
      }
    }
  })

  let balanceCents = scenario.planning.openingBalanceCents
  return [...days.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => {
      balanceCents = addSafeCents(balanceCents, day.incomeCents, 'Running balance')
      balanceCents = addSafeCents(balanceCents, -day.expenseCents, 'Running balance')
      return { ...day, items: day.items.sort((left, right) => left.name.localeCompare(right.name)), balanceCents }
    })
}

/** Lists upcoming scheduled item starts, ends, and one-time occurrences. */
export function buildUpcomingPlannedChanges(
  scenario: Scenario,
  baseMonth: YearMonth,
  monthCount = 3,
): PlannedChange[] {
  const startDate = `${baseMonth}-01`
  const endMonth = monthAt(baseMonth, monthCount)
  const endDate = `${endMonth}-01`
  const fromIndex = monthIndex(baseMonth)
  const endIndex = monthIndex(endMonth)
  const changes: PlannedChange[] = []

  for (const { ownerName, ledger } of activeLedgers(scenario)) {
    for (const kind of ['income', 'expense'] as const) {
      for (const item of ledger[kind === 'income' ? 'income' : 'expenses']) {
        const amountForDate = (date: string) => projectFinancialItemAmount(
          item,
          amountRate(scenario, item, kind),
          Math.max(0, dateMonth(date) - fromIndex),
        )
        if (item.recurrence.frequency === 'once') {
          if (item.recurrence.startDate >= startDate && item.recurrence.startDate < endDate) {
            changes.push({ date: item.recurrence.startDate, kind: 'one-time', name: item.name, ownerName, amountCents: amountForDate(item.recurrence.startDate) })
          }
          continue
        }
        if (item.recurrence.startDate >= startDate && item.recurrence.startDate < endDate) {
          changes.push({ date: item.recurrence.startDate, kind: 'starts', name: item.name, ownerName, amountCents: amountForDate(item.recurrence.startDate) })
        }
        const end = item.recurrence.endDate
        if (end && end >= startDate && end < endDate && dateMonth(end) >= fromIndex && dateMonth(end) < endIndex) {
          changes.push({ date: end, kind: 'ends', name: item.name, ownerName, amountCents: amountForDate(end) })
        }
      }
    }
  }
  return changes.sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name))
}

/** Compares projected category expenses in the base month and final horizon month. */
export function buildCategoryProjectionChanges(
  scenario: Scenario,
  baseMonth: YearMonth,
  horizon = 12,
): CategoryProjectionChange[] {
  if (!Number.isSafeInteger(horizon) || horizon < 1) throw new RangeError('Forecast horizon must be positive.')
  const owners = activeLedgers(scenario)
  const firstMonth = monthAt(baseMonth, 0)
  const lastMonth = monthAt(baseMonth, horizon - 1)
  const totals = (month: YearMonth, monthsAhead: number) => {
    const byCategory = new Map<string, number>()
    for (const { ledger } of owners) {
      for (const item of ledger.expenses) {
        if (getOccurrenceInMonth(item.recurrence, month) === null) continue
        const amount = projectFinancialItemAmount(item, amountRate(scenario, item, 'expense'), monthsAhead)
        byCategory.set(item.categoryId, addSafeCents(byCategory.get(item.categoryId) ?? 0, amount, 'Category forecast'))
      }
    }
    return byCategory
  }
  const first = totals(firstMonth, 0)
  const last = totals(lastMonth, horizon - 1)
  const ids = new Set([...first.keys(), ...last.keys()])
  return [...ids].map((categoryId) => {
    const baseCents = first.get(categoryId) ?? 0
    const futureCents = last.get(categoryId) ?? 0
    return { categoryId, baseCents, futureCents, changeCents: futureCents - baseCents }
  }).sort((left, right) => Math.abs(right.changeCents) - Math.abs(left.changeCents)
    || left.categoryId.localeCompare(right.categoryId))
}
