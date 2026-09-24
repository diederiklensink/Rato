import { Fragment, Suspense, lazy, useMemo, useState } from 'react'
import type { ForecastPoint, ProfileMonthlyResult, Scenario } from '../../types'
import { calculateSettlement } from '../../utils/calculations'
import { buildMonthlyForecast } from '../../utils/forecast'
import { useAppStore } from '../../store/useAppStore'
import { currentLocalYearMonth, isYearMonth } from '../../routes/monthQuery'
import { useSearchParams } from 'react-router-dom'
import { buildCategoryLedgerBreakdown } from './dashboardData'
import type { CategoryLedgerBreakdownRow } from './dashboardData'

const ForecastChart = lazy(() => import('./ForecastChart'))

type ForecastHorizon = 6 | 12 | 24

interface SafeResult<T> {
  value: T | null;
  error: string | null;
}

function safeCalculate<T>(calculate: () => T): SafeResult<T> {
  try {
    return { value: calculate(), error: null }
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : 'Rato could not calculate this view.',
    }
  }
}

function createCurrencyFormatter(currencyCode: string): (cents: number) => string {
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
    })
    return (cents) => formatter.format(cents / 100)
  } catch {
    return (cents) => `${currencyCode} ${(cents / 100).toFixed(2)}`
  }
}

function formatSignedCurrency(cents: number, formatCurrency: (cents: number) => string): string {
  if (cents > 0) return `+${formatCurrency(cents)}`
  if (cents < 0) return `−${formatCurrency(Math.abs(cents))}`
  return formatCurrency(0)
}

function monthDate(month: string): Date {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year ?? 0, (monthNumber ?? 1) - 1, 1)
  date.setHours(12, 0, 0, 0)
  return date
}

function formatMonth(month: string, format: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, format).format(monthDate(month))
}

function formatRate(rate: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(rate)
}

function modeLabel(mode: Scenario['calculationMode']): string {
  switch (mode) {
    case 'pro_rata': return 'Pro rata'
    case 'fifty_fifty': return '50/50'
    case 'equal_remainder': return 'Equal remainder'
  }
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">
      {message}
    </p>
  )
}

function SummaryCard({ label, value, detail }: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <article className="rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {detail && <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>}
    </article>
  )
}

function ProfileSettlementCard({
  profileName,
  result,
  formatCurrency,
}: {
  profileName: string;
  result: ProfileMonthlyResult;
  formatCurrency: (cents: number) => string;
}) {
  const metrics = [
    { label: 'Income', amount: result.incomeCents },
    { label: 'Personal expenses', amount: result.personalExpenseCents },
    { label: 'Contribution to joint', amount: result.contributionCents, signed: true },
    { label: 'Discretionary cash', amount: result.discretionaryCents, signed: true },
  ]

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <h3 className="text-xl font-semibold tracking-tight">{profileName}</h3>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">
        {metrics.map(({ label, amount, signed }) => (
          <div key={label}>
            <dt className="text-xs font-medium text-muted">{label}</dt>
            <dd className="mt-1 font-semibold tabular-nums text-foreground">
              {signed ? formatSignedCurrency(amount, formatCurrency) : formatCurrency(amount)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted">
        A negative contribution means this participant receives money from the joint ledger.
      </p>
    </article>
  )
}

function CategoryBreakdown({
  rows,
  formatCurrency,
}: {
  rows: CategoryLedgerBreakdownRow[];
  formatCurrency: (cents: number) => string;
}) {
  return (
    <section aria-labelledby="breakdown-heading" className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight" id="breakdown-heading">Income and expense sources</h2>
        <p className="mt-1 text-sm text-muted">
          Selected-month totals by category and ledger owner. Only settlement participants and the joint ledger are included.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg bg-background p-4 text-sm text-muted">No income or expenses occur in this month.</p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Category and ledger ownership breakdown">
          <p className="mb-2 px-3 text-xs text-muted sm:hidden">Swipe horizontally to view all columns.</p>
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <caption className="sr-only">Income and expenses grouped by category and settlement ledger owner.</caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-3 font-semibold" scope="col">Category</th>
                <th className="px-3 py-3 font-semibold" scope="col">Ledger owner</th>
                <th className="px-3 py-3 text-right font-semibold" scope="col">Income</th>
                <th className="px-3 py-3 text-right font-semibold" scope="col">Expenses</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-b border-border last:border-0" key={row.key}>
                  <th className="px-3 py-3 font-medium text-foreground" scope="row">{row.categoryId}</th>
                  <td className="px-3 py-3 text-muted">{row.ownerName}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.incomeCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.expenseCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ForecastAssumptions({ scenario }: { scenario: Scenario }) {
  const overrides = Object.entries(scenario.forecastAssumptions.expenseInflationByCategory)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))

  return (
    <aside aria-label="Forecast assumptions" className="rounded-xl border border-border bg-background p-4">
      <h3 className="text-sm font-semibold text-foreground">Annual assumptions used for projections</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs text-muted">Income growth</dt>
          <dd className="mt-0.5 font-medium">{formatRate(scenario.forecastAssumptions.annualIncomeGrowthRate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">General expense inflation</dt>
          <dd className="mt-0.5 font-medium">{formatRate(scenario.forecastAssumptions.annualExpenseInflationRate)}</dd>
        </div>
        {overrides.length === 0 ? (
          <div>
            <dt className="text-xs text-muted">Category overrides</dt>
            <dd className="mt-0.5 font-medium">None</dd>
          </div>
        ) : overrides.map(([categoryId, rate]) => (
          <div key={categoryId}>
            <dt className="text-xs text-muted">{categoryId} expense inflation</dt>
            <dd className="mt-0.5 font-medium">{formatRate(rate)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}

function ForecastTable({
  forecast,
  profileNames,
  profileIds,
  formatCurrency,
}: {
  forecast: ForecastPoint[];
  profileNames: [string, string];
  profileIds: [string, string];
  formatCurrency: (cents: number) => string;
}) {
  const profileValue = (point: ForecastPoint, profileId: string): ProfileMonthlyResult => (
    point.settlement.byProfile[profileId] ?? {
      incomeCents: 0,
      personalExpenseCents: 0,
      contributionCents: 0,
      discretionaryCents: 0,
    }
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Monthly forecast table; scroll horizontally to see all columns">
      <p className="sticky left-0 w-fit px-3 pt-3 text-xs text-muted sm:hidden">Swipe horizontally to view both participants and the joint ledger.</p>
      <table className="w-full min-w-[72rem] border-collapse text-sm">
        <caption className="sr-only">Monthly forecast for selected participants and the joint ledger. Currency amounts are in the app currency.</caption>
        <thead className="bg-background text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="sticky left-0 bg-background px-3 py-3 font-semibold" rowSpan={2} scope="col">Month</th>
            <th className="px-3 py-3 text-center font-semibold" colSpan={4} scope="colgroup">{profileNames[0]}</th>
            <th className="px-3 py-3 text-center font-semibold" colSpan={4} scope="colgroup">{profileNames[1]}</th>
            <th className="px-3 py-3 text-center font-semibold" colSpan={3} scope="colgroup">Joint ledger</th>
            <th className="px-3 py-3 font-semibold" rowSpan={2} scope="col">Basis</th>
          </tr>
          <tr>
            {Array.from({ length: 2 }, (_, profileIndex) => (
              <Fragment key={profileIndex}>
                <th className="px-3 py-2 font-medium" scope="col">Income</th>
                <th className="px-3 py-2 font-medium" scope="col">Personal expenses</th>
                <th className="px-3 py-2 font-medium" scope="col">Contribution</th>
                <th className="px-3 py-2 font-medium" scope="col">Discretionary</th>
              </Fragment>
            ))}
            <th className="px-3 py-2 font-medium" scope="col">Income</th>
            <th className="px-3 py-2 font-medium" scope="col">Expenses</th>
            <th className="px-3 py-2 font-medium" scope="col">Net cost</th>
          </tr>
        </thead>
        <tbody>
          {forecast.map((point, index) => {
            const first = profileValue(point, profileIds[0])
            const second = profileValue(point, profileIds[1])
            return (
              <tr className="border-t border-border" key={point.month}>
                <th className="sticky left-0 whitespace-nowrap bg-surface px-3 py-3 text-left font-medium text-foreground" scope="row">
                  {formatMonth(point.month, { month: 'short', year: 'numeric' })}
                </th>
                {[first, second].map((result, profileIndex) => (
                  <Fragment key={profileIndex}>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatCurrency(result.incomeCents)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatCurrency(result.personalExpenseCents)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatSignedCurrency(result.contributionCents, formatCurrency)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatSignedCurrency(result.discretionaryCents, formatCurrency)}</td>
                  </Fragment>
                ))}
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatCurrency(point.settlement.jointIncomeCents)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatCurrency(point.settlement.jointExpenseCents)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatSignedCurrency(point.settlement.netJointCostCents, formatCurrency)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">{index === 0 ? 'Nominal base' : 'Projected'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ForecastSection({
  scenario,
  forecast,
  horizon,
  onHorizonChange,
  formatCurrency,
}: {
  scenario: Scenario;
  forecast: ForecastPoint[];
  horizon: ForecastHorizon;
  onHorizonChange: (horizon: ForecastHorizon) => void;
  formatCurrency: (cents: number) => string;
}) {
  const [firstProfileId, secondProfileId] = scenario.participantIds
  const firstProfile = scenario.profiles[firstProfileId]
  const secondProfile = scenario.profiles[secondProfileId]
  const profileNames: [string, string] = [firstProfile?.name ?? 'Participant 1', secondProfile?.name ?? 'Participant 2']
  const chartData = forecast.map((point) => ({
    month: point.month,
    firstDiscretionaryCents: point.settlement.byProfile[firstProfileId]?.discretionaryCents ?? 0,
    secondDiscretionaryCents: point.settlement.byProfile[secondProfileId]?.discretionaryCents ?? 0,
  }))
  const hasDiscretionaryCashToPlot = chartData.some((point) => (
    point.firstDiscretionaryCents !== 0 || point.secondDiscretionaryCents !== 0
  ))

  return (
    <section aria-labelledby="forecast-heading" className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight" id="forecast-heading">Monthly forecast</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            The selected month is the nominal base. Later months are projections using the assumptions below.
          </p>
        </div>
        <div className="w-full sm:w-48">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="forecast-horizon">
            Forecast horizon
          </label>
          <select
            className="min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            id="forecast-horizon"
            onChange={(event) => onHorizonChange(Number(event.currentTarget.value) as ForecastHorizon)}
            value={horizon}
          >
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
            <option value={24}>24 months</option>
          </select>
        </div>
      </div>

      <div className="mt-5">
        <ForecastAssumptions scenario={scenario} />
      </div>

      <figure className="mt-6" aria-labelledby="forecast-chart-title">
        <h3 className="sr-only" id="forecast-chart-title">Monthly discretionary cash flow by participant</h3>
        {hasDiscretionaryCashToPlot ? (
          <div
            aria-label={`Line chart comparing discretionary cash for ${profileNames[0]} and ${profileNames[1]} over ${horizon} months.`}
            className="h-72 w-full"
            role="img"
          >
            <Suspense fallback={<span className="sr-only" role="status">Loading the forecast chart</span>}>
              <ForecastChart
                chartData={chartData}
                formatCurrency={formatCurrency}
                formatMonth={formatMonth}
                profileNames={profileNames}
              />
            </Suspense>
          </div>
        ) : (
          <div className="grid min-h-24 w-full place-items-center rounded-xl bg-background px-4 py-6 text-center text-sm text-muted" role="status">
            No participant discretionary cash flow to plot for this forecast. Monthly figures are available in the table below.
          </div>
        )}
        <figcaption className="mt-2 text-xs leading-5 text-muted">
          {hasDiscretionaryCashToPlot
            ? 'Values below zero indicate a projected deficit. The table provides the same figures in an accessible format.'
            : 'The chart appears when the selected participants have nonzero discretionary cash flow.'}
        </figcaption>
      </figure>

      <div className="mt-6">
        <ForecastTable
          forecast={forecast}
          formatCurrency={formatCurrency}
          profileIds={[firstProfileId, secondProfileId]}
          profileNames={profileNames}
        />
      </div>
    </section>
  )
}

export default function DashboardPage() {
  const activeScenarioId = useAppStore((state) => state.activeScenarioId)
  const scenario = useAppStore((state) => state.scenarios[activeScenarioId])
  const currencyCode = useAppStore((state) => state.settings.currencyCode)
  const [searchParams] = useSearchParams()
  const requestedMonth = searchParams.get('month')
  const selectedMonth = isYearMonth(requestedMonth) ? requestedMonth : currentLocalYearMonth()
  const [horizon, setHorizon] = useState<ForecastHorizon>(12)
  const formatCurrency = useMemo(() => createCurrencyFormatter(currencyCode), [currencyCode])

  const settlementResult = useMemo(
    () => scenario
      ? safeCalculate(() => calculateSettlement(scenario, selectedMonth))
      : { value: null, error: 'The active scenario is unavailable.' },
    [scenario, selectedMonth],
  )
  const breakdownResult = useMemo(
    () => scenario
      ? safeCalculate(() => buildCategoryLedgerBreakdown(scenario, selectedMonth))
      : { value: null, error: 'The active scenario is unavailable.' },
    [scenario, selectedMonth],
  )
  const forecastResult = useMemo(
    () => scenario
      ? safeCalculate(() => buildMonthlyForecast(scenario, selectedMonth, horizon))
      : { value: null, error: 'The active scenario is unavailable.' },
    [scenario, selectedMonth, horizon],
  )

  const firstProfileId = scenario?.participantIds[0]
  const secondProfileId = scenario?.participantIds[1]
  const firstProfile = firstProfileId ? scenario?.profiles[firstProfileId] : undefined
  const secondProfile = secondProfileId ? scenario?.profiles[secondProfileId] : undefined
  const settlement = settlementResult.value
  const firstSettlement = firstProfileId ? settlement?.byProfile[firstProfileId] : undefined
  const secondSettlement = secondProfileId ? settlement?.byProfile[secondProfileId] : undefined

  return (
    <div className="space-y-6 sm:space-y-8">
      <section aria-labelledby="overview-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-secondary-dark">Settlement overview</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight" id="overview-heading">{scenario?.name ?? 'Overview'}</h1>
            <p className="mt-2 text-sm text-muted">
              {formatMonth(selectedMonth, { month: 'long', year: 'numeric' })}
              {scenario && <> · {modeLabel(scenario.calculationMode)} settlement</>}
            </p>
          </div>
          <p className="text-xs text-muted">Calculated from the selected participants and joint ledger.</p>
        </div>

        {settlementResult.error && <div className="mt-5"><ErrorNotice message={`Settlement could not be calculated: ${settlementResult.error}`} /></div>}
        {settlement && scenario && (
          <>
            <h2 className="sr-only">Selected month joint totals</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <SummaryCard label="Joint income" value={formatCurrency(settlement.jointIncomeCents)} />
              <SummaryCard label="Joint expenses" value={formatCurrency(settlement.jointExpenseCents)} />
              <SummaryCard
                detail="Joint expenses minus joint income"
                label="Net joint cost"
                value={formatSignedCurrency(settlement.netJointCostCents, formatCurrency)}
              />
            </div>

            <h2 className="sr-only">Selected participant settlement details</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {firstProfile && firstProfileId && firstSettlement && (
                <ProfileSettlementCard
                  formatCurrency={formatCurrency}
                  profileName={firstProfile.name}
                  result={firstSettlement}
                />
              )}
              {secondProfile && secondProfileId && secondSettlement && (
                <ProfileSettlementCard
                  formatCurrency={formatCurrency}
                  profileName={secondProfile.name}
                  result={secondSettlement}
                />
              )}
            </div>
          </>
        )}
      </section>

      {breakdownResult.error && <ErrorNotice message={`Category breakdown could not be calculated: ${breakdownResult.error}`} />}
      {breakdownResult.value && (
        <CategoryBreakdown rows={breakdownResult.value} formatCurrency={formatCurrency} />
      )}

      {scenario && (
        <section>
          {forecastResult.error ? (
            <div aria-labelledby="forecast-heading" className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
              <h2 className="mb-4 text-2xl font-semibold tracking-tight" id="forecast-heading">Monthly forecast</h2>
              <ErrorNotice message={`Forecast could not be calculated: ${forecastResult.error}`} />
            </div>
          ) : forecastResult.value && (
            <ForecastSection
              formatCurrency={formatCurrency}
              forecast={forecastResult.value}
              horizon={horizon}
              onHorizonChange={setHorizon}
              scenario={scenario}
            />
          )}
        </section>
      )}
    </div>
  )
}
