import { z } from 'zod'
import type {
  AppData,
  AppSettings,
  CalculationMode,
  FinancialItem,
  ForecastAssumptions,
  Ledger,
  Profile,
  Recurrence,
  Scenario,
} from '../types'
import { SUPPORTED_CURRENCY_CODES } from '../constants/currencies'

const IdentifierSchema = z.string().trim().min(1, 'ID cannot be empty')
export const NameSchema = z.string().trim().min(1, 'Name cannot be empty')

function hasOwnKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

const ISODateSchema = z.string().refine(isCalendarDate, 'Expected a valid YYYY-MM-DD date')
const ISODateTimeSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}, 'Expected a canonical ISO 8601 UTC timestamp')

const RateSchema = z.number().finite().gt(-1)

export const CalculationModeSchema = z.enum([
  'pro_rata',
  'fifty_fifty',
  'equal_remainder',
]) satisfies z.ZodType<CalculationMode>

export const RecurrenceSchema: z.ZodType<Recurrence> = z.discriminatedUnion('frequency', [
  z.object({
    frequency: z.literal('once'),
    startDate: ISODateSchema,
  }).strict(),
  z.object({
    frequency: z.enum(['monthly', 'quarterly', 'yearly']),
    startDate: ISODateSchema,
    endDate: ISODateSchema.nullable(),
  }).strict().superRefine((recurrence, context) => {
    if (recurrence.endDate && recurrence.endDate < recurrence.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must be on or after the start date',
      })
    }
  }),
])

export const FinancialItemSchema: z.ZodType<FinancialItem> = z.object({
  id: IdentifierSchema,
  name: NameSchema,
  amountCents: z.number().int().safe().nonnegative(),
  categoryId: IdentifierSchema,
  recurrence: RecurrenceSchema,
}).strict()

function requireUniqueItemIds(items: FinancialItem[], path: string, context: z.RefinementCtx) {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      context.addIssue({
        code: 'custom',
        path: [path, index, 'id'],
        message: `Duplicate item ID "${item.id}" in ${path}`,
      })
    }
    seen.add(item.id)
  })
}

export const LedgerSchema: z.ZodType<Ledger> = z.object({
  income: z.array(FinancialItemSchema),
  expenses: z.array(FinancialItemSchema),
}).strict().superRefine((ledger, context) => {
  requireUniqueItemIds(ledger.income, 'income', context)
  requireUniqueItemIds(ledger.expenses, 'expenses', context)
})

export const ProfileSchema: z.ZodType<Profile> = z.object({
  id: IdentifierSchema,
  name: NameSchema,
  ledger: LedgerSchema,
}).strict()

export const ForecastAssumptionsSchema: z.ZodType<ForecastAssumptions> = z.object({
  annualExpenseInflationRate: RateSchema,
  annualIncomeGrowthRate: RateSchema,
  expenseInflationByCategory: z.record(IdentifierSchema, RateSchema),
}).strict()

const ScenarioSchema: z.ZodType<Scenario> = z.object({
  id: IdentifierSchema,
  name: NameSchema,
  parentScenarioId: IdentifierSchema.nullable(),
  createdAt: ISODateTimeSchema,
  updatedAt: ISODateTimeSchema,
  profiles: z.record(IdentifierSchema, ProfileSchema),
  participantIds: z.tuple([IdentifierSchema, IdentifierSchema]),
  joint: LedgerSchema,
  calculationMode: CalculationModeSchema,
  forecastAssumptions: ForecastAssumptionsSchema,
}).strict().superRefine((scenario, context) => {
  const [firstParticipant, secondParticipant] = scenario.participantIds
  if (firstParticipant === secondParticipant) {
    context.addIssue({
      code: 'custom',
      path: ['participantIds'],
      message: 'Settlement participants must be two distinct profiles',
    })
  }

  for (const participantId of scenario.participantIds) {
    if (!hasOwnKey(scenario.profiles, participantId)) {
      context.addIssue({
        code: 'custom',
        path: ['participantIds'],
        message: `Participant "${participantId}" does not exist in this scenario`,
      })
    }
  }

  for (const [profileId, profile] of Object.entries(scenario.profiles)) {
    if (profileId !== profile.id) {
      context.addIssue({
        code: 'custom',
        path: ['profiles', profileId, 'id'],
        message: 'Profile map key must match profile ID',
      })
    }
  }
})

export const AppSettingsSchema: z.ZodType<AppSettings> = z.object({
  currencyCode: z.enum(SUPPORTED_CURRENCY_CODES),
}).strict()

export const AppDataSchema: z.ZodType<AppData> = z.object({
  schemaVersion: z.literal(1),
  baselineScenarioId: IdentifierSchema,
  activeScenarioId: IdentifierSchema,
  scenarios: z.record(IdentifierSchema, ScenarioSchema),
  settings: AppSettingsSchema,
}).strict().superRefine((data, context) => {
  if (!hasOwnKey(data.scenarios, data.baselineScenarioId)) {
    context.addIssue({
      code: 'custom',
      path: ['baselineScenarioId'],
      message: 'Baseline scenario does not exist',
    })
  }

  if (!hasOwnKey(data.scenarios, data.activeScenarioId)) {
    context.addIssue({
      code: 'custom',
      path: ['activeScenarioId'],
      message: 'Active scenario does not exist',
    })
  }

  for (const [scenarioId, scenario] of Object.entries(data.scenarios)) {
    if (scenarioId !== scenario.id) {
      context.addIssue({
        code: 'custom',
        path: ['scenarios', scenarioId, 'id'],
        message: 'Scenario map key must match scenario ID',
      })
    }
  }
})
