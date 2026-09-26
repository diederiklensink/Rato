export type ProfileId = string;
export type ScenarioId = string;
export type ItemId = string;
export type CategoryId = string;
export type ISODate = string;
export type YearMonth = string;
export type ISODateTime = string;

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

export interface ScenarioPlanning {
  openingBalanceCents: number;
  savingsGoals: SavingsGoal[];
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
  planning: ScenarioPlanning;
}

export interface AppSettings {
  currencyCode: string;
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
    participantIds: [ProfileId, ProfileId],
  ) => void;
  addProfile: (scenarioId: ScenarioId, profile: Profile) => void;
  renameProfile: (
    scenarioId: ScenarioId,
    profileId: ProfileId,
    name: string,
  ) => void;
  removeProfile: (scenarioId: ScenarioId, profileId: ProfileId) => void;
  upsertItem: (
    scenarioId: ScenarioId,
    owner: LedgerOwner,
    kind: LedgerKind,
    item: FinancialItem,
  ) => void;
  removeItem: (
    scenarioId: ScenarioId,
    owner: LedgerOwner,
    kind: LedgerKind,
    itemId: ItemId,
  ) => void;
  setCalculationMode: (
    scenarioId: ScenarioId,
    mode: CalculationMode,
  ) => void;
  updateForecastAssumptions: (
    scenarioId: ScenarioId,
    patch: Partial<ForecastAssumptions>,
  ) => void;
  setScenarioOpeningBalance: (scenarioId: ScenarioId, amountCents: number) => void;
  upsertSavingsGoal: (scenarioId: ScenarioId, goal: SavingsGoal) => void;
  removeSavingsGoal: (scenarioId: ScenarioId, goalId: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  replaceData: (data: AppData) => void;
  retryHydration: () => void;
  resetToFreshBaseline: () => Promise<void>;
}

export type AppStore = AppData & AppActions & AppRuntimeState;

export interface ProfileMonthlyResult {
  incomeCents: number;
  personalExpenseCents: number;
  contributionCents: number;
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

export interface LedgerMonthlyTotals {
  incomeCents: number;
  expenseCents: number;
}

export interface ForecastPoint {
  month: YearMonth;
  monthsAhead: number;
  settlement: MonthlySettlement;
}
