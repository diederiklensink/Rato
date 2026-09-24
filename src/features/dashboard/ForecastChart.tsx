import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface ForecastChartPoint {
  month: string;
  firstDiscretionaryCents: number;
  secondDiscretionaryCents: number;
}

export default function ForecastChart({
  chartData,
  profileNames,
  formatCurrency,
  formatMonth,
}: {
  chartData: ForecastChartPoint[];
  profileNames: [string, string];
  formatCurrency: (cents: number) => string;
  formatMonth: (month: string, format: Intl.DateTimeFormatOptions) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart accessibilityLayer data={chartData} margin={{ top: 10, right: 18, bottom: 4, left: 16 }}>
        <CartesianGrid stroke="#e1dbcf" strokeDasharray="3 3" />
        <XAxis
          axisLine={{ stroke: '#cec6b8' }}
          dataKey="month"
          tick={{ fill: '#73746b', fontSize: 12 }}
          tickFormatter={(value) => formatMonth(String(value), { month: 'short', year: '2-digit' })}
          tickLine={false}
        />
        <YAxis
          axisLine={false}
          tick={{ fill: '#73746b', fontSize: 12 }}
          tickFormatter={(value) => formatCurrency(Number(value))}
          tickLine={false}
          width={92}
        />
        <ReferenceLine y={0} stroke="#73746b" strokeDasharray="5 4" />
        <Tooltip
          contentStyle={{ backgroundColor: '#fffdf8', borderColor: '#cec6b8', borderRadius: 12 }}
          formatter={(value) => formatCurrency(Number(value))}
          labelFormatter={(value) => formatMonth(String(value), { month: 'long', year: 'numeric' })}
        />
        <Legend verticalAlign="top" height={34} />
        <Line
          activeDot={{ r: 5 }}
          dataKey="firstDiscretionaryCents"
          dot={false}
          name={profileNames[0]}
          stroke="#315b49"
          strokeWidth={3}
          type="monotone"
        />
        <Line
          activeDot={{ r: 5 }}
          dataKey="secondDiscretionaryCents"
          dot={false}
          name={profileNames[1]}
          stroke="#a86643"
          strokeWidth={3}
          type="monotone"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
