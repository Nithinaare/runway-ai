import React from 'react';
import { Check, RotateCcw } from 'lucide-react';
import {
  InterventionCandidate,
  LedgerDataset,
  SimulationSummary,
} from '../types/treasury';
import { formatInrCompact, formatInrExact } from '../utils/format';
import { CashFanChart } from './CashFanChart';

interface SimulatorViewProps {
  dataset: LedgerDataset;
  baseline: SimulationSummary;
  simulated: SimulationSummary | null;
  interventions: InterventionCandidate[];
  selectedInterventions: Record<string, number>;
  intensityOverrides: Record<string, number>;
  totalActionSpend: number;
  onToggleIntervention: (cand: InterventionCandidate) => void;
  onChangeIntensity: (candId: string, intensity: number) => void;
  onApplyBestPlan: () => void;
  onResetPlan: () => void;
}

const TYPE_LABELS: Record<InterventionCandidate['type'], string> = {
  chase_invoice: 'AR Collection',
  discount_invoice: 'Early Discount',
  stagger_po: 'Stagger PO',
  renegotiate_supplier: 'Credit Extension',
};

export const SimulatorView: React.FC<SimulatorViewProps> = ({
  dataset,
  baseline,
  simulated,
  interventions,
  selectedInterventions,
  intensityOverrides,
  totalActionSpend,
  onToggleIntervention,
  onChangeIntensity,
  onApplyBestPlan,
  onResetPlan,
}) => {
  const active = simulated ?? baseline;
  const costAvoided = Math.max(
    0,
    Math.round(baseline.expectedShortfallCost - active.expectedShortfallCost)
  );
  const netBenefit = costAvoided - totalActionSpend;
  const troughLift = Math.round(active.p10MinCash - baseline.p10MinCash);

  return (
    <div className="space-y-4">
      {/* Economic Impact Strip */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-md border border-[#E2E6ED] bg-white px-4 py-3">
          <div className="text-[11px] font-medium text-[#64748B]">
            30d / 60d Shortfall Risk
          </div>
          <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-semibold text-[#0F172A]">
              {Math.round(active.prob30d)}% / {Math.round(active.prob60d)}%
            </span>
            {simulated && (
              <span className="text-xs text-[#0F766E]">
                (from {Math.round(baseline.prob30d)}%/{Math.round(baseline.prob60d)}%)
              </span>
            )}
          </div>
        </div>

        <div className="rounded-md border border-[#E2E6ED] bg-white px-4 py-3">
          <div className="text-[11px] font-medium text-[#64748B]">
            Total Action Spend
          </div>
          <div className="mt-1.5 font-mono text-lg font-semibold text-[#0F172A] tabular-nums">
            {formatInrExact(totalActionSpend)}
          </div>
        </div>

        <div className="rounded-md border border-[#E2E6ED] bg-white px-4 py-3">
          <div className="text-[11px] font-medium text-[#64748B]">
            Shortfall Cost Avoided
          </div>
          <div className="mt-1.5 font-mono text-lg font-semibold text-[#0F766E] tabular-nums">
            {formatInrExact(costAvoided)}
          </div>
        </div>

        <div className="rounded-md border border-[#E2E6ED] bg-white px-4 py-3">
          <div className="text-[11px] font-medium text-[#64748B]">
            Net Economic Benefit
          </div>
          <div
            className={`mt-1.5 font-mono text-lg font-semibold tabular-nums ${
              netBenefit >= 0 ? 'text-[#0F766E]' : 'text-[#B91C1C]'
            }`}
          >
            {netBenefit >= 0 ? '+' : ''}
            {formatInrExact(netBenefit)}
          </div>
        </div>

        <div className="rounded-md border border-[#E2E6ED] bg-white px-4 py-3">
          <div className="text-[11px] font-medium text-[#64748B]">
            P10 Cash Trough Lift
          </div>
          <div
            className={`mt-1.5 font-mono text-lg font-semibold tabular-nums ${
              troughLift >= 0 ? 'text-[#0F766E]' : 'text-[#0F172A]'
            }`}
          >
            {troughLift >= 0 ? '+' : ''}
            {formatInrCompact(troughLift)}
          </div>
        </div>
      </section>

      {/* Main Chart Comparison */}
      <section className="isolated-panel rounded-md border border-[#E2E6ED] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E6ED] pb-2.5">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-[#0F172A]">
              Baseline vs. Post-Intervention Cash Trajectory
            </h2>
            <span className="font-mono text-xs text-[#64748B] tabular-nums">
              P10 Floor: {formatInrCompact(baseline.p10MinCash)} →{' '}
              <strong className="text-[#0F766E]">{formatInrCompact(active.p10MinCash)}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {simulated && (
              <button
                type="button"
                onClick={onResetPlan}
                className="inline-flex items-center gap-1 rounded border border-[#E2E6ED] bg-white px-2.5 py-1 text-xs font-medium text-[#475569] hover:bg-[#F1F3F7]"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset Plan
              </button>
            )}
            <button
              type="button"
              onClick={onApplyBestPlan}
              className="rounded bg-[#1E40AF] px-3 py-1 text-xs font-medium text-white hover:bg-[#1E3A8A]"
            >
              Select Optimal Mix
            </button>
          </div>
        </div>

        <CashFanChart
          baselineDaily={baseline.daily}
          simulatedDaily={simulated?.daily ?? null}
          safetyBuffer={dataset.profile.safetyBuffer}
          deficitWindow={baseline.deficitWindow}
          showInterquartile={false}
          height={250}
        />
      </section>

      {/* Interactive Priced Intervention Matrix */}
      <section className="isolated-panel rounded-md border border-[#E2E6ED] bg-white">
        <div className="flex items-center justify-between border-b border-[#E2E6ED] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#0F172A]">
            Priced Interventions Ranked by Net Financial Benefit
          </h2>
          <span className="font-mono text-[11px] text-[#64748B]">
            {Object.keys(selectedInterventions).length} of {interventions.length} active
          </span>
        </div>

        <div className="divide-y divide-[#E2E6ED]">
          {interventions.map((cand, idx) => {
            const isSelected = selectedInterventions[cand.id] !== undefined;
            const currentIntensity =
              intensityOverrides[cand.id] ??
              selectedInterventions[cand.id] ??
              cand.defaultIntensity;

            return (
              <div
                key={cand.id}
                className={`grid grid-cols-1 items-center gap-4 px-4 py-3.5 lg:grid-cols-12 ${
                  isSelected ? 'bg-[#F0FDFA]/50' : ''
                }`}
              >
                <div className="flex items-start gap-3 lg:col-span-5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isSelected}
                    aria-label={`Toggle ${cand.title}`}
                    onClick={() => onToggleIntervention(cand)}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      isSelected
                        ? 'border-[#0F766E] bg-[#0F766E] text-white'
                        : 'border-[#CBD5E1] bg-white hover:border-[#64748B]'
                    }`}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-[#64748B]">
                        #{idx + 1}
                      </span>
                      <span className="text-xs font-semibold text-[#0F172A]">
                        {cand.title}
                      </span>
                      <span className="rounded bg-[#F1F3F7] px-1.5 py-0.5 text-[10px] font-medium text-[#475569]">
                        {TYPE_LABELS[cand.type]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#64748B]">
                      {cand.actionPreview}
                    </p>
                  </div>
                </div>

                {/* Parameter Tuning Slider */}
                <div className="lg:col-span-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#475569]">{cand.parameterLabel}</span>
                    <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                      {currentIntensity}
                      {cand.intensityUnit === '%' ? '%' : 'd'}
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label={`${cand.parameterLabel} for ${cand.title}`}
                    min={cand.minIntensity}
                    max={cand.maxIntensity}
                    step={cand.stepIntensity}
                    value={currentIntensity}
                    onChange={(e) =>
                      onChangeIntensity(cand.id, Number(e.target.value))
                    }
                    className="runway-range mt-1.5 w-full"
                  />
                </div>

                {/* Priced Economics Columns */}
                <div className="grid grid-cols-4 gap-2 text-right font-mono text-xs tabular-nums lg:col-span-4">
                  <div>
                    <div className="font-sans text-[10px] text-[#64748B]">Cost</div>
                    <div className="font-medium text-[#0F172A]">
                      {formatInrCompact(cand.directCostInr)}
                    </div>
                  </div>
                  <div>
                    <div className="font-sans text-[10px] text-[#64748B]">30d/60d Drop</div>
                    <div className="font-medium text-[#1E40AF]">
                      -{cand.riskReduction30dPts.toFixed(0)}% / -{cand.riskReduction60dPts.toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div className="font-sans text-[10px] text-[#64748B]">₹ / Risk Pt</div>
                    <div className="text-[#475569]">
                      {formatInrCompact(cand.costPerRiskPtInr)}
                    </div>
                  </div>
                  <div>
                    <div className="font-sans text-[10px] text-[#64748B]">Net Benefit</div>
                    <div
                      className={`font-semibold ${
                        cand.netEconomicBenefitInr >= 0
                          ? 'text-[#0F766E]'
                          : 'text-[#B91C1C]'
                      }`}
                    >
                      {cand.netEconomicBenefitInr >= 0 ? '+' : ''}
                      {formatInrCompact(cand.netEconomicBenefitInr)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
