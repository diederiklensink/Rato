import type {
  Ledger,
  LedgerMonthlyTotals,
  MonthlySettlement,
  ProfileId,
  Scenario,
  YearMonth,
} from '../types'
import { calculateLedgerTotals } from './recurrence'

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER)

function toSafeInteger(value: bigint, label: string): number {
  if (value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT) {
    throw new RangeError(`${label} exceeds the safe integer range.`)
  }
  return Number(value)
}

function assertTotals(totals: LedgerMonthlyTotals, label: string): void {
  for (const [field, value] of Object.entries(totals)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${label} ${field} must be a nonnegative safe integer number of cents.`)
    }
  }
}

function roundRationalHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Rounding denominator must be positive.')

  const negative = numerator < 0n
  const absoluteNumerator = negative ? -numerator : numerator
  let rounded = absoluteNumerator / denominator
  const remainder = absoluteNumerator % denominator
  if (remainder * 2n >= denominator) rounded += 1n
  return negative ? -rounded : rounded
}

function requireParticipants(scenario: Scenario): [ProfileId, ProfileId] {
  const [firstId, secondId] = scenario.participantIds
  if (!firstId || !secondId || firstId === secondId) {
    throw new RangeError('A settlement requires two distinct existing participants.')
  }
  if (!Object.prototype.hasOwnProperty.call(scenario.profiles, firstId)
    || !Object.prototype.hasOwnProperty.call(scenario.profiles, secondId)) {
    throw new RangeError('A settlement requires two distinct existing participants.')
  }
  return [firstId, secondId]
}

/**
 * Shared settlement implementation for nominal calculations and forecasts.
 * Kept exported only so forecast.ts can reuse the exact cent-allocation rules.
 * @internal
 */
export function calculateSettlementWithLedgerTotals(
  scenario: Scenario,
  month: YearMonth,
  totalsForLedger: (ledger: Ledger) => LedgerMonthlyTotals,
): MonthlySettlement {
  const [firstId, secondId] = requireParticipants(scenario)
  const firstProfile = scenario.profiles[firstId]
  const secondProfile = scenario.profiles[secondId]
  if (!firstProfile || !secondProfile) {
    throw new RangeError('A settlement requires two distinct existing participants.')
  }

  const firstTotals = totalsForLedger(firstProfile.ledger)
  const secondTotals = totalsForLedger(secondProfile.ledger)
  const jointTotals = totalsForLedger(scenario.joint)
  assertTotals(firstTotals, 'First participant totals')
  assertTotals(secondTotals, 'Second participant totals')
  assertTotals(jointTotals, 'Joint totals')

  const firstIncome = BigInt(firstTotals.incomeCents)
  const secondIncome = BigInt(secondTotals.incomeCents)
  const firstPersonalExpense = BigInt(firstTotals.expenseCents)
  const secondPersonalExpense = BigInt(secondTotals.expenseCents)
  const netJointCost = toSafeInteger(
    BigInt(jointTotals.expenseCents) - BigInt(jointTotals.incomeCents),
    'Net joint cost',
  )
  const netJointCostBigInt = BigInt(netJointCost)

  let firstContribution: bigint
  switch (scenario.calculationMode) {
    case 'pro_rata': {
      const totalIncome = firstIncome + secondIncome
      firstContribution = totalIncome === 0n
        ? roundRationalHalfAwayFromZero(netJointCostBigInt, 2n)
        : roundRationalHalfAwayFromZero(netJointCostBigInt * firstIncome, totalIncome)
      break
    }
    case 'fifty_fifty':
      firstContribution = roundRationalHalfAwayFromZero(netJointCostBigInt, 2n)
      break
    case 'equal_remainder': {
      const firstAvailable = firstIncome - firstPersonalExpense
      const secondAvailable = secondIncome - secondPersonalExpense
      firstContribution = roundRationalHalfAwayFromZero(
        firstAvailable - secondAvailable + netJointCostBigInt,
        2n,
      )
      break
    }
    default:
      throw new RangeError(`Unsupported calculation mode "${String(scenario.calculationMode)}".`)
  }

  const secondContribution = netJointCostBigInt - firstContribution
  const firstContributionCents = toSafeInteger(firstContribution, 'First participant contribution')
  const secondContributionCents = toSafeInteger(secondContribution, 'Second participant contribution')
  const firstDiscretionary = toSafeInteger(
    firstIncome - firstPersonalExpense - firstContribution,
    'First participant discretionary amount',
  )
  const secondDiscretionary = toSafeInteger(
    secondIncome - secondPersonalExpense - secondContribution,
    'Second participant discretionary amount',
  )

  return {
    month,
    mode: scenario.calculationMode,
    jointIncomeCents: jointTotals.incomeCents,
    jointExpenseCents: jointTotals.expenseCents,
    netJointCostCents: netJointCost,
    byProfile: {
      [firstId]: {
        incomeCents: firstTotals.incomeCents,
        personalExpenseCents: firstTotals.expenseCents,
        contributionCents: firstContributionCents,
        discretionaryCents: firstDiscretionary,
      },
      [secondId]: {
        incomeCents: secondTotals.incomeCents,
        personalExpenseCents: secondTotals.expenseCents,
        contributionCents: secondContributionCents,
        discretionaryCents: secondDiscretionary,
      },
    },
  }
}

/** Calculates the selected month's settlement using nominal ledger amounts. */
export function calculateSettlement(scenario: Scenario, month: YearMonth): MonthlySettlement {
  return calculateSettlementWithLedgerTotals(
    scenario,
    month,
    (ledger) => calculateLedgerTotals(ledger, month),
  )
}
