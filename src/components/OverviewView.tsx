import React, { useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  InterventionCandidate,
  LedgerDataset,
  RiskDriver,
  SimulationSummary,
} from '../types/treasury';
import { formatInrCompact, formatShortDate } from '../utils/format';
import { CashFanChart } from './CashFanChart';

interface OverviewViewProps {
  dataset: LedgerDataset;
  baseline: SimulationSummary;
  simulated: SimulationSummary | null;
  topDrivers: RiskDriver[];
  interventions: InterventionCandidate[];
  selectedInterventions: Record<string, number>;
  totalActionSpend: number;
  onToggleIntervention: (cand: InterventionCandidate) => void;
  onApplyBestPlan: () => void;
  onResetPlan: () => void;
  onInspectTransaction: (txId: string) => void;
  onOpenSimulatorTab: () => void;
}

function getRiskTone(prob: number): {
  text: string;
  badgeBg: string;
  badgeText: string;
  label: string;
} {
  if (prob >= 50) {
    return {
      text: 'text-[#B91C1C]',
      badgeBg: 'bg-[#FEF2F2] border-[#FECACA]',
      badgeText: 'text-[#B91C1C]',
      label: 'Critical',
    };
  }
  if (prob >= 20) {
    return {
      text: 'text-[#B45309]',
      badgeBg: 'bg-[#FFFBEB] border-[#FDE68A]',
      badgeText: 'text-[#B45309]',
      label: 'Elevated',
    };
  }
  return {
    text: 'text-[#0F766E]',
    badgeBg: 'bg-[#F0FDFA] border-[#99F6E4]',
    badgeText: 'text-[#0F766E]',
    label: 'Low',
  };
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  dataset,
  baseline,
  simulated,
  topDrivers,
  interventions,
  selectedInterventions,
  totalActionSpend,
  onToggleIntervention,
  onApplyBestPlan,
  onResetPlan,
  onInspectTransaction,
  onOpenSimulatorTab,
}) => {
  const [showIqBand, setShowIqBand] = useState(true);
  const active = simulated ?? baseline;
  const hasActivePlan = simulated !== null;

  const probCards = [
    {
      title: '14-Day Shortfall Risk',
      base: baseline.prob14d,
      curr: active.prob14d,
    },
    {
      title: '30-Day Shortfall Risk',
      base: baseline.prob30d,
      curr: active.prob30d,
    },
    {
      title: '60-Day Shortfall Risk',
      base: baseline.prob60d,
      curr: active.prob60d,
    },
  ];

  const windowDisplay = (() => {
    const win = active.deficitWindow;
    if (!win.earliestDate || !win.latestDate || !win.medianDate) {
      return {
        primary: 'No Deficit Crossing',
        secondary: `P10 floor ${formatInrCompact(active.p10MinCash)}`,
        isSafe: true,
      };
    }
    return {
      primary: `${formatShortDate(win.earliestDate)} – ${formatShortDate(win.latestDate)}`,
      secondary: `Median ${formatShortDate(win.medianDate)} · P10 floor ${formatInrCompact(active.p10MinCash)}`,
      isSafe: false,
    };
  })();

  const netPlanBenefit = hasActivePlan
    ? Math.round(
        baseline.expectedShortfallCost - active.expectedShortfallCost - totalActionSpend
      )
    : 0;

  return (
    <div className="space-y-4">
      {/* 4-Card Probabilistic KPI Strip */}
      <section aria-label="Cash shortfall forecast summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {probCards.map((card) => {
          const tone = getRiskTone(card.curr);
          const delta = card.curr - card.base;
          return (
            <div
              key={card.title}
              className="rounded-md border border-[#E2E6ED] bg-white px-4 py-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[#475569]">
                  {card.title}
                </span>
                <span
                  className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone.badgeBg} ${tone.badgeText}`}
                >
                  {tone.label}
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2.5">
                <span
                  className={`font-mono text-2xl font-semibold tracking-tight tabular-nums ${tone.text}`}
                >
                  {Math.round(card.curr)}%
                </span>
                {hasActivePlan && Math.abs(delta) >= 0.5 && (
                  <span className="inline-flex items-center gap-0.5 font-mono text-xs font-medium text-[#0F766E] tabular-nums">
                    <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                    {Math.round(card.base)}% base
                  </span>
                )}
              </div>
            </div>
          );
        })}

        <div className="rounded-md border border-[#E2E6ED] bg-white px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-[#475569]">
              Deficit-Date Interval (80% CI)
            </span>
            {hasActivePlan && (
              <span className="inline-flex items-center rounded border border-[#99F6E4] bg-[#F0FDFA] px-1.5 py-0.5 text-[11px] font-medium text-[#0F766E]">
                Simulated
              </span>
            )}
          </div>
          <div className="mt-2">
            <div
              className={`font-mono text-[19px] font-semibold tracking-tight tabular-nums ${
                windowDisplay.isSafe ? 'text-[#0F766E]' : 'text-[#0F172A]'
              }`}
            >
              {windowDisplay.primary}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-[#64748B] tabular-nums">
              {windowDisplay.secondary}
            </div>
          </div>
        </div>
      </section>

      {/* Main 60-Day Probabilistic Cash Trajectory Chart */}
      <section className="isolated-panel rounded-md border border-[#E2E6ED] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E6ED] pb-3">
          <div>
            <h2 className="text-sm font-semibold text-[#0F172A]">
              60-Day Probabilistic Cash Trajectory
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#64748B] tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-[#0F172A]" />
                P50 Median
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-3 rounded-sm bg-[#1E40AF]/20" />
                P10–P90 Band
              </span>
              {simulated && (
                <span className="inline-flex items-center gap-1.5 font-medium text-[#0F766E]">
                  <span className="inline-block h-0.5 w-3 bg-[#0F766E]" />
                  With Selected Actions
                </span>
              )}
              <span className="font-mono">
                AR Open: {formatInrCompact(baseline.totalReceivables)}
              </span>
              <span className="font-mono">
                60d Payables: {formatInrCompact(baseline.totalObligations60d)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-[#E2E6ED] bg-[#F6F7F9] px-2.5 py-1 text-xs font-medium text-[#334155]">
              <input
                type="checkbox"
                checked={showIqBand}
                onChange={(e) => setShowIqBand(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#1E40AF]"
              />
              P25–P75 IQR
            </label>
          </div>
        </div>

        <CashFanChart
          baselineDaily={baseline.daily}
          simulatedDaily={simulated?.daily ?? null}
          safetyBuffer={dataset.profile.safetyBuffer}
          deficitWindow={baseline.deficitWindow}
          showInterquartile={showIqBand}
          height={300}
        />
      </section>

      {/* Bottom Split: Top 5 Risk Drivers & Cost-Aware Interventions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Top 5 Risk-Driving Transactions */}
        <section className="isolated-panel rounded-md border border-[#E2E6ED] bg-white lg:col-span-6">
          <div className="flex items-center justify-between border-b border-[#E2E6ED] px-4 py-3">
            <h2 className="text-sm font-semibold text-[#0F172A]">
              Top 5 Deficit-Driving Transactions
            </h2>
            <span className="font-mono text-[11px] text-[#64748B]">
              Counterfactual Attribution
            </span>
          </div>

          {topDrivers.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[#64748B]">
              No transactions generate material shortfall risk under current cash buffer.
            </div>
          ) : (
            <ul className="divide-y divide-[#E2E6ED]">
              {topDrivers.map((drv) => (
                <li key={drv.transactionId}>
                  <button
                    type="button"
                    onClick={() => onInspectTransaction(drv.transactionId)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#1E40AF]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#F1F3F7] font-mono text-[11px] font-semibold text-[#334155]">
                          {drv.rank}
                        </span>
                        <span className="font-mono text-xs font-semibold text-[#0F172A]">
                          {drv.refNumber}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            drv.kind === 'receivable'
                              ? 'bg-[#EFF6FF] text-[#1E40AF]'
                              : 'bg-[#FFFBEB] text-[#B45309]'
                          }`}
                        >
                          {drv.kind === 'receivable' ? 'Receivable' : 'Commitment'}
                        </span>
                        {drv.isCorrelatedCluster && (
                          <span className="rounded bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-medium text-[#B91C1C]">
                            Correlated Cluster
                          </span>
                        )}
                        {drv.isSparseHistory && (
                          <span className="rounded bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] font-medium text-[#475569]">
                            Cold-Start Buyer
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[#334155]">
                        {drv.plainSummary}
                      </p>
                    </div>

                    <div className="shrink-0 text-right font-mono tabular-nums">
                      <div className="text-xs font-semibold text-[#B91C1C]">
                        +{drv.riskContributionPts.toFixed(1)}% risk
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#64748B]">
                        {formatInrCompact(drv.shortfallImpactInr)} trough
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Ranked Cost-Aware Interventions (Interactive Live What-If) */}
        <section className="isolated-panel rounded-md border border-[#E2E6ED] bg-white lg:col-span-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E6ED] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-[#0F172A]">
                Cost-Aware Interventions
              </h2>
              {hasActivePlan && (
                <div className="mt-0.5 font-mono text-[11px] text-[#0F766E] tabular-nums">
                  Spend {formatInrCompact(totalActionSpend)} · Net Benefit{' '}
                  {netPlanBenefit >= 0 ? '+' : ''}
                  {formatInrCompact(netPlanBenefit)}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {hasActivePlan && (
                <button
                  type="button"
                  onClick={onResetPlan}
                  className="inline-flex items-center gap-1 rounded border border-[#E2E6ED] bg-white px-2 py-1 text-[11px] font-medium text-[#475569] hover:bg-[#F1F3F7]"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  Reset
                </button>
              )}
              <button
                type="button"
                onClick={onApplyBestPlan}
                className="inline-flex items-center gap-1 rounded bg-[#1E40AF] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#1E3A8A]"
              >
                Apply Best Plan
              </button>
              <button
                type="button"
                onClick={onOpenSimulatorTab}
                title="Tune intervention parameters"
                className="inline-flex items-center gap-1 rounded border border-[#E2E6ED] bg-[#F6F7F9] px-2 py-1 text-[11px] font-medium text-[#334155] hover:bg-[#E2E6ED]"
              >
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                Tune
              </button>
            </div>
          </div>

          <ul className="divide-y divide-[#E2E6ED]">
            {interventions.slice(0, 5).map((cand, index) => {
              const isSelected = selectedInterventions[cand.id] !== undefined;
              return (
                <li key={cand.id}>
                  <label
                    className={`flex cursor-pointer items-start justify-between gap-3 px-4 py-3 transition-colors ${
                      isSelected ? 'bg-[#F0FDFA]/60' : 'hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isSelected
                            ? 'border-[#0F766E] bg-[#0F766E] text-white'
                            : 'border-[#CBD5E1] bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleIntervention(cand)}
                          className="sr-only"
                        />
                        {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-[#64748B]">
                            #{index + 1}
                          </span>
                          <span className="text-xs font-semibold text-[#0F172A]">
                            {cand.title}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#475569]">
                          {cand.actionPreview}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right font-mono tabular-nums">
                      <div
                        className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
                          cand.netEconomicBenefitInr >= 0
                            ? 'text-[#0F766E]'
                            : 'text-[#475569]'
                        }`}
                      >
                        {cand.netEconomicBenefitInr >= 0 && (
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Net {cand.netEconomicBenefitInr >= 0 ? '+' : ''}
                        {formatInrCompact(cand.netEconomicBenefitInr)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#64748B]">
                        Cost {formatInrCompact(cand.directCostInr)} · -
                        {Math.max(cand.riskReduction30dPts, cand.riskReduction60dPts).toFixed(0)}
                        % risk
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
};
