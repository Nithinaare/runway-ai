import React, { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DeficitWindow, DailyForecastPoint } from '../types/treasury';
import { formatInrCompact, formatShortDate } from '../utils/format';

interface CashFanChartProps {
  baselineDaily: DailyForecastPoint[];
  simulatedDaily?: DailyForecastPoint[] | null;
  safetyBuffer: number;
  deficitWindow: DeficitWindow;
  showInterquartile?: boolean;
  height?: number;
}

interface ChartDatum {
  day: number;
  label: string;
  date: string;
  bandOuter: [number, number];
  bandInner: [number, number];
  p10: number;
  p50: number;
  p90: number;
  expectedOutflow: number;
  simP50?: number;
  simP10?: number;
}

const CustomTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-md border border-[#CBD5E1] bg-white px-3 py-2.5 text-xs shadow-sm">
      <div className="mb-1.5 flex items-center justify-between gap-4 border-b border-[#E2E6ED] pb-1">
        <span className="font-semibold text-[#0F172A]">{row.label}</span>
        <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
          Day +{row.day}
        </span>
      </div>
      <div className="space-y-1 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-5">
          <span className="font-sans text-[#64748B]">P90 Upside</span>
          <span className="text-[#334155]">{formatInrCompact(row.p90)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="font-sans font-medium text-[#0F172A]">P50 Median</span>
          <span className="font-semibold text-[#0F172A]">{formatInrCompact(row.p50)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="font-sans text-[#64748B]">P10 Downside</span>
          <span className={row.p10 < 0 ? 'font-semibold text-[#B91C1C]' : 'text-[#334155]'}>
            {formatInrCompact(row.p10)}
          </span>
        </div>
        {row.simP50 !== undefined && (
          <>
            <div className="my-1 border-t border-[#E2E6ED]" />
            <div className="flex items-center justify-between gap-5">
              <span className="font-sans font-medium text-[#0F766E]">With Plan (P50)</span>
              <span className="font-semibold text-[#0F766E]">
                {formatInrCompact(row.simP50)}
              </span>
            </div>
            {row.simP10 !== undefined && (
              <div className="flex items-center justify-between gap-5">
                <span className="font-sans text-[#0F766E]">With Plan (P10)</span>
                <span className="text-[#0F766E]">{formatInrCompact(row.simP10)}</span>
              </div>
            )}
          </>
        )}
        {row.expectedOutflow > 0 && (
          <div className="mt-1 flex items-center justify-between gap-5 border-t border-[#E2E6ED] pt-1">
            <span className="font-sans text-[#B45309]">Scheduled Outflow</span>
            <span className="text-[#B45309]">-{formatInrCompact(row.expectedOutflow)}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const CashFanChart: React.FC<CashFanChartProps> = ({
  baselineDaily,
  simulatedDaily,
  safetyBuffer,
  deficitWindow,
  showInterquartile = true,
  height = 310,
}) => {
  const data = useMemo<ChartDatum[]>(() => {
    return baselineDaily.map((pt, idx) => {
      const sim = simulatedDaily?.[idx];
      return {
        day: pt.day,
        label: formatShortDate(pt.date),
        date: pt.date,
        bandOuter: [pt.p10, pt.p90],
        bandInner: [pt.p25, pt.p75],
        p10: pt.p10,
        p50: pt.p50,
        p90: pt.p90,
        expectedOutflow: pt.expectedOutflow,
        simP50: sim?.p50,
        simP10: sim?.p10,
      };
    });
  }, [baselineDaily, simulatedDaily]);

  const hasWindow =
    deficitWindow.earliestDay !== null &&
    deficitWindow.latestDay !== null &&
    !simulatedDaily;

  const winStartLabel =
    hasWindow && deficitWindow.earliestDay !== null
      ? data[deficitWindow.earliestDay]?.label
      : undefined;
  const winEndLabel =
    hasWindow && deficitWindow.latestDay !== null
      ? data[deficitWindow.latestDay]?.label
      : undefined;

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 16, left: 6, bottom: 4 }}>
          <CartesianGrid stroke="#E2E6ED" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            interval={9}
            tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            axisLine={{ stroke: '#CBD5E1' }}
            tickLine={false}
          />
          <YAxis
            width={68}
            tickFormatter={(v: number) => formatInrCompact(v)}
            tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />

          {winStartLabel && winEndLabel && (
            <ReferenceArea
              x1={winStartLabel}
              x2={winEndLabel}
              fill="#B91C1C"
              fillOpacity={0.07}
              strokeOpacity={0}
            />
          )}

          <ReferenceLine
            y={0}
            stroke="#B91C1C"
            strokeWidth={1.5}
            label={{
              value: '₹0 Deficit Line',
              position: 'insideTopRight',
              fill: '#B91C1C',
              fontSize: 10,
              fontWeight: 600,
            }}
          />

          <ReferenceLine
            y={safetyBuffer}
            stroke="#B45309"
            strokeDasharray="4 4"
            strokeWidth={1}
            label={{
              value: `Safety Buffer (${formatInrCompact(safetyBuffer)})`,
              position: 'insideBottomRight',
              fill: '#B45309',
              fontSize: 10,
            }}
          />

          <Area
            type="monotone"
            dataKey="bandOuter"
            stroke="none"
            fill="#1E40AF"
            fillOpacity={0.1}
            isAnimationActive={false}
          />

          {showInterquartile && (
            <Area
              type="monotone"
              dataKey="bandInner"
              stroke="none"
              fill="#1E40AF"
              fillOpacity={0.14}
              isAnimationActive={false}
            />
          )}

          <Line
            type="monotone"
            dataKey="p10"
            stroke="#94A3B8"
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
          />

          <Line
            type="monotone"
            dataKey="p50"
            stroke="#0F172A"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />

          {simulatedDaily && (
            <>
              <Line
                type="monotone"
                dataKey="simP10"
                stroke="#0F766E"
                strokeWidth={1.25}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="simP50"
                stroke="#0F766E"
                strokeWidth={2.25}
                dot={false}
                isAnimationActive={false}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};
