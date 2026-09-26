# Rato system design

## Purpose and architecture

Rato is a local-first, serverless single-page app for comparing the monthly financial position of two partners. Each scenario is an independent snapshot of profiles, personal ledgers, the joint ledger, calculation mode, and forecast assumptions. Duplicating the baseline creates a sandbox with no shared mutable data. The UI never assumes particular names or IDs.

The stack is React 18, TypeScript, Vite, React Router v7, Tailwind CSS, Lucide React, Zustand `persist`, and `localforage` backed by IndexedDB. Pure utilities calculate results from a scenario and selected month. Zustand holds persisted data and actions; React renders selectors and dispatches actions. The selected month is URL state in `?month=YYYY-MM`, not persisted `AppData`. JSON import/export provides portability without a server.

## Canonical TypeScript contract: `src/types/index.ts`

The following is the intended **exact content** of the initial type module. Money is stored in nonnegative integer minor units (cents for EUR); runtime validation enforces constraints that TypeScript cannot.

```typescript
export type ProfileId = string;
export type ScenarioId = string;
export type ItemId = string;
export type CategoryId = string;
export type ISODate = string; // YYYY-MM-DD, local calendar date
export type YearMonth = string; // YYYY-MM
export type ISODateTime = string; // ISO 8601 timestamp

export type CalculationMode =
  | 'pro_rata'
  | 'fifty_fifty'
  | 'equal_remainder';

export type LedgerKind = 'income' | 'expense';

export type Recurrence =
  | {
      frequency: 'once';
      startDate: ISODate;
      endDate?: never;
    }
  | {
      frequency: 'monthly' | 'quarterly' | 'yearly';
      startDate: ISODate;
      endDate: ISODate | null;
    };

export interface FinancialItem {
  id: ItemId;
  name: string;
  amountCents: number;
  categoryId: CategoryId;
  recurrence: Recurrence;
}

export interface Ledger {
  income: FinancialItem[];
  expenses: FinancialItem[];
}

export interface Profile {
  id: ProfileId;
  name: string;
  ledger: Ledger;
}

export interface ForecastAssumptions {
  annualExpenseInflationRate: number;
  annualIncomeGrowthRate: number;
  expenseInflationByCategory: Record<CategoryId, number>;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  targetDate: ISODate;
}

export interface Scenario {
  id: ScenarioId;
  name: string;
  parentScenarioId: ScenarioId | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  profiles: Record<ProfileId, Profile>;
  participantIds: [ProfileId, ProfileId];
  joint: Ledger;
  calculationMode: CalculationMode;
  forecastAssumptions: ForecastAssumptions;
  planning: {
    openingBalanceCents: number;
    savingsGoals: SavingsGoal[];
  };
}

export interface AppSettings {
  currencyCode: string; // ISO 4217; initial value: 'EUR'
}

export interface AppData {
  schemaVersion: 2;
  baselineScenarioId: ScenarioId;
  activeScenarioId: ScenarioId;
  scenarios: Record<ScenarioId, Scenario>;
  settings: AppSettings;
}

export type LedgerOwner =
  | { scope: 'profile'; profileId: ProfileId }
  | { scope: 'joint' };

export type HydrationStatus = 'loading' | 'ready' | 'recovery_required';

export interface AppRuntimeState {
  hydrationStatus: HydrationStatus;
  hydrationError: string | null;
}

export interface AppActions {
  setActiveScenario: (scenarioId: ScenarioId) => void;
  duplicateScenario: (sourceId: ScenarioId, name: string) => ScenarioId;
  renameScenario: (scenarioId: ScenarioId, name: string) => void;
  deleteScenario: (scenarioId: ScenarioId) => void;
  setParticipants: (
    scenarioId: ScenarioId,
    participantIds: [ProfileId, ProfileId]
  ) => void;
  addProfile: (scenarioId: ScenarioId, profile: Profile) => void;
  renameProfile: (
    scenarioId: ScenarioId,
    profileId: ProfileId,
    name: string
  ) => void;
  removeProfile: (scenarioId: ScenarioId, profileId: ProfileId) => void;
  upsertItem: (
    scenarioId: ScenarioId,
    owner: LedgerOwner,
    kind: LedgerKind,
    item: FinancialItem
  ) => void;
  removeItem: (
    scenarioId: ScenarioId,
    owner: LedgerOwner,
    kind: LedgerKind,
    itemId: ItemId
  ) => void;
  setCalculationMode: (
    scenarioId: ScenarioId,
    mode: CalculationMode
  ) => void;
  updateForecastAssumptions: (
    scenarioId: ScenarioId,
    patch: Partial<ForecastAssumptions>
  ) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  replaceData: (data: AppData) => void;
  retryHydration: () => void;
  resetToFreshBaseline: () => Promise<void>;
}

export type AppStore = AppData & AppActions & AppRuntimeState;

export interface ProfileMonthlyResult {
  incomeCents: number;
  personalExpenseCents: number;
  contributionCents: number; // signed transfer into the joint pool
  discretionaryCents: number;
}

export interface MonthlySettlement {
  month: YearMonth;
  mode: CalculationMode;
  jointIncomeCents: number;
  jointExpenseCents: number;
  netJointCostCents: number;
  byProfile: Record<ProfileId, ProfileMonthlyResult>;
}
```

Record keys and embedded IDs must agree. Exactly two distinct `participantIds` must exist in `profiles`; other profiles may exist but are excluded from the two-person settlement. The baseline is identified only by `baselineScenarioId`, never by a hardcoded name or ID, and cannot be deleted. Deleting the active sandbox selects the baseline. Removing a selected participant requires a replacement first. Duplication gives the new scenario its own ID and timestamps and deeply copies all profiles, ledgers, items, and assumptions. `parentScenarioId` records provenance, not live inheritance.

## Time and money rules

- An item amount is one occurrence, in integer minor units. Income and expense arrays determine sign; item amounts are nonnegative safe integers. Item IDs must be unique within each ledger array.
- Dates are calendar dates, not UTC instants. `startDate` is the first occurrence. Repeating items have an inclusive `endDate` on or after the start date, or `null` for no end. A one-time item occurs only on its start date.
- Monthly occurrences repeat each month, quarterly every three months, yearly every twelve months, anchored to the start month. Clamp the start day to the last day of shorter months. Count an occurrence only when its date falls within the requested month and on or before its end date. Do not prorate partial months.
- Forecast from a selected base month. Future occurrences use `(1 + annualRate) ** (monthsAhead / 12)`; a category expense rate overrides the global expense rate. Round each projected occurrence to cents before summing. Rates must be finite and greater than `-1`. Current and past months use nominal amounts.
- Currency is one app-wide ISO 4217 code. Import rejects unsupported or mixed-currency data until conversion is designed.

## Settlement contract

For a month, sum each selected partner's personal income and expenses, plus joint income and expenses. `netJointCostCents = jointExpenseCents - jointIncomeCents`; it may be negative. Positive contributions pay into the joint pool; negative contributions receive from it. The two contributions always sum exactly to net joint cost.

| Mode | Partner contribution before cent rounding |
| --- | --- |
| Pro rata | Net joint cost times that partner's income divided by total partner income. If both incomes are zero, split equally. |
| 50/50 | Half of net joint cost for each partner. |
| Equal remainder | Let `available = personal income - personal expenses`. Contribution is `available - (sum of both available amounts - net joint cost) / 2`. This equalizes discretionary money after all expenses and contributions. |

Round the first participant's contribution to integer cents, then set the second to `netJointCostCents - firstContributionCents`. `discretionaryCents = incomeCents - personalExpenseCents - contributionCents`. Preserve negative transfers and deficits. Forecast charts show projected cash flows. Planning also stores a scenario-level opening household balance for a date-based three-month cash-flow projection; it does not affect settlement.

## Persistence and module boundaries

`src/store/useAppStore.ts` uses `persist` with `createJSONStorage` and a `localforage` adapter forced to IndexedDB. Persist only `AppData`, never actions, derived results, or `AppRuntimeState`. Persistence and backup schema version 2 migrates version 1 scenarios by adding a zero opening balance and no savings goals. Reject unknown versions. Seed and save a baseline with two generic empty profiles, such as “Partner 1” and “Partner 2”. Validate action inputs and update immutably. If saved data cannot be parsed or validated, block writes and show recovery controls; retry keeps stored data intact, while reset is an explicit operation that clears this app's key before seeding a fresh baseline.

`src/utils/recurrence.ts` finds occurrences; `src/utils/calculations.ts` aggregates ledgers and computes settlement; `src/utils/forecast.ts` projects future months. `src/utils/importExport.ts` exports only `AppData`, validates parsed imports and schema version, then calls `replaceData` only after success. The existing `docs/calculation_engine.md` is an early draft; reconcile it with this contract during the calculation phase.
