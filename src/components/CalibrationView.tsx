import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BaselineMetric, CalibrationPoint } from '../types/treasury';
import { formatInrCompact } from '../utils/format';

interface CalibrationViewProps {
  baselines: BaselineMetric[];
  calibration: CalibrationPoint[];
}

export const CalibrationView: React.FC<CalibrationViewProps> = ({
  baselines,
  calibration,
}) => {
  const reliabilityData = calibration.map((pt) => ({
    ...pt,
    idealPct: pt.predictedPct,
  }));

  return (
    <div className="space-y-4">
      {/* Model Benchmark Table */}
      <section className="isolated-panel rounded-md border border-[#E2E6ED] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E6ED] px-4 py-3">
          <h2 id="baseline-table-caption" className="text-sm font-semibold text-[#0F172A]">
            Baseline Benchmark vs. Runway AI (Active Ledger + 180-Day Backtest)
          </h2>
          <span className="font-mono text-[11px] text-[#64748B]">
            542 rolling-horizon test windows
          </span>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="baseline-table-caption"
          className="table-wrapper"
        >
          <table className="ledger-table text-xs">
            <thead>
              <tr className="border-b border-[#E2E6ED] text-left font-semibold text-[#334155]">
                <th scope="col" className="px-4 py-2.5">
                  Model
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  30d Risk
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  60d Risk
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  Min / P10 Cash
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  Brier Score ↓
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  ECE Error ↓
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  Lead Time ↑
                </th>
                <th scope="col" className="px-4 py-2.5 text-right">
                  Missed Crunches ↓
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E6ED] font-mono tabular-nums">
              {baselines.map((m, idx) => {
                const isWinner = idx === 0;
                return (
                  <tr
                    key={m.modelName}
                    className={isWinner ? 'bg-[#F0FDFA]/70 font-medium' : ''}
                  >
                    <td data-label="Model" className="px-4 py-3 font-sans">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#0F172A]">
                          {m.modelName}
                        </span>
                        {isWinner && (
                          <span className="rounded bg-[#0F766E] px-1.5 py-0.5 text-[10px] font-medium text-white">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#64748B]">{m.methodTag}</div>
                    </td>
                    <td data-label="30d Risk" className="px-3 py-3 text-right text-[#0F172A]">
                      {m.predicted30dRisk.toFixed(0)}%
                    </td>
                    <td data-label="60d Risk" className="px-3 py-3 text-right text-[#0F172A]">
                      {m.predicted60dRisk.toFixed(0)}%
                    </td>
                    <td
                      data-label="Min Cash"
                      className={`px-3 py-3 text-right ${
                        m.predictedMinCash < 0 ? 'text-[#B91C1C]' : 'text-[#0F172A]'
                      }`}
                    >
                      {formatInrCompact(m.predictedMinCash)}
                    </td>
                    <td
                      data-label="Brier Score"
                      className={`px-3 py-3 text-right ${
                        isWinner ? 'font-semibold text-[#0F766E]' : 'text-[#475569]'
                      }`}
                    >
                      {m.brierScore.toFixed(3)}
                    </td>
                    <td
                      data-label="ECE Error"
                      className={`px-3 py-3 text-right ${
                        isWinner ? 'font-semibold text-[#0F766E]' : 'text-[#475569]'
                      }`}
                    >
                      {m.eceError.toFixed(1)}%
                    </td>
                    <td
                      data-label="Lead Time"
                      className={`px-3 py-3 text-right ${
                        isWinner ? 'font-semibold text-[#0F766E]' : 'text-[#475569]'
                      }`}
                    >
                      {m.avgLeadTimeDays.toFixed(1)}d
                    </td>
                    <td
                      data-label="Missed Crunches"
                      className={`px-4 py-3 text-right ${
                        isWinner ? 'font-semibold text-[#0F766E]' : 'text-[#B91C1C]'
                      }`}
                    >
                      {m.missedCrunchRate.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Calibration Curve & Baseline Error Chart */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section className="isolated-panel rounded-md border border-[#E2E6ED] bg-white p-4 lg:col-span-6">
          <div className="mb-3 flex items-center justify-between border-b border-[#E2E6ED] pb-2.5">
            <h3 className="text-sm font-semibold text-[#0F172A]">
              Probability Calibration Reliability
            </h3>
            <span className="font-mono text-[11px] text-[#0F766E]">ECE 2.4%</span>
          </div>
          <div style={{ width: '100%', height: 270 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={reliabilityData}
                margin={{ top: 10, right: 16, left: 0, bottom: 4 }}
              >
                <CartesianGrid stroke="#E2E6ED" strokeDasharray="3 3" />
                <XAxis
                  dataKey="predictedPct"
                  unit="%"
                  tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={{ stroke: '#CBD5E1' }}
                />
                <YAxis
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(val: number, name: string) => [
                    `${val}%`,
                    name === 'observedPct' ? 'Observed Frequency' : 'Ideal Calibration',
                  ]}
                  labelFormatter={(l) => `Predicted Risk Bin: ~${l}%`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="linear"
                  dataKey="idealPct"
                  name="Ideal (y = x)"
                  stroke="#94A3B8"
                  strokeDasharray="4 4"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="observedPct"
                  name="Runway AI Observed"
                  stroke="#1E40AF"
                  strokeWidth={2.25}
                  dot={{ r: 3.5, fill: '#1E40AF' }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="isolated-panel rounded-md border border-[#E2E6ED] bg-white p-4 lg:col-span-6">
          <div className="mb-3 flex items-center justify-between border-b border-[#E2E6ED] pb-2.5">
            <h3 className="text-sm font-semibold text-[#0F172A]">
              Missed Shortfall Rate (%) vs. ECE Error (%)
            </h3>
            <span className="font-mono text-[11px] text-[#64748B]">Lower is better</span>
          </div>
          <div style={{ width: '100%', height: 270 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={baselines}
                margin={{ top: 10, right: 16, left: 0, bottom: 4 }}
              >
                <CartesianGrid stroke="#E2E6ED" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="modelName"
                  tick={{ fill: '#334155', fontSize: 11 }}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickLine={false}
                />
                <YAxis
                  unit="%"
                  tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="missedCrunchRate"
                  name="Missed Crunches (%)"
                  fill="#1E40AF"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="eceError"
                  name="Calibration Error (%)"
                  fill="#94A3B8"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
};
