# Monthly calculation engine

This document follows the canonical data and settlement contract in [design.md](design.md). All amounts are integer minor units (cents for EUR), and all date calculations use calendar dates.

## Recurring ledger totals

`getOccurrenceInMonth(recurrence, month)` returns the single occurrence date in a `YearMonth`, or `null` when the item does not occur. A one-time item occurs only in its start month. Monthly, quarterly, and yearly items stay anchored to their start month and day; if a target month is shorter, the occurrence is clamped to that month's final day. A repeating item's end date is inclusive. Monthly totals count the full amount for each occurrence and do not prorate partial months.

`calculateLedgerTotals(ledger, month)` sums nominal income and expenses for the requested month. Its totals and the later settlement calculations must remain safe integers.

## Settlement API and rules

```typescript
calculateSettlement(scenario: Scenario, month: YearMonth): MonthlySettlement
```

The engine includes the two profile ledgers referenced by `scenario.participantIds` and the joint ledger. Other profiles are ignored. It computes:

```text
netJointCostCents = jointExpenseCents - jointIncomeCents
```

Positive contributions pay into the joint pool. Negative contributions receive money from it. Contributions always sum exactly to the net joint cost.

| Mode | First participant's unrounded contribution |
| --- | --- |
| Pro rata | `netJointCost × firstIncome / (firstIncome + secondIncome)`; split equally when both incomes are zero. |
| 50/50 | `netJointCost / 2`. |
| Equal remainder | `firstAvailable - (firstAvailable + secondAvailable - netJointCost) / 2`, where each available amount is personal income minus personal expenses. |

Round the first contribution to cents using half away from zero, then set the second contribution to `netJointCostCents - firstContributionCents`. Calculate each partner's discretionary amount as personal income minus personal expenses minus their signed contribution. Preserve negative discretionary amounts and negative contributions. Fail explicitly if a total or result cannot be represented as a safe integer number of cents.

## Forecasts

`buildMonthlyForecast(scenario, baseMonth, monthCount)` returns a sequence beginning with `baseMonth`; that first point uses nominal amounts and has `monthsAhead: 0`. Later points use `monthsAhead` relative to that base month. For each occurrence, project income with the scenario's annual income growth rate and expenses with the category override when present, otherwise the global expense inflation rate:

```text
projectedCents = round(amountCents × (1 + annualRate) ** (monthsAhead / 12))
```

Project and round each occurrence before summing a month's totals. Rates must be finite and greater than `-1`. Forecasts do not mutate scenarios; they return the same `MonthlySettlement` shape as nominal calculations for each point.
