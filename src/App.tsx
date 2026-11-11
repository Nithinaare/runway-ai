import React, { useMemo, useState } from 'react';
import { Settings2, Upload } from 'lucide-react';
import { CalibrationView } from './components/CalibrationView';
import { OverviewView } from './components/OverviewView';
import { RiskTraceView } from './components/RiskTraceView';
import { SetupModal } from './components/SetupModal';
import { SimulatorView } from './components/SimulatorView';
import { UploadLedgerModal } from './components/UploadLedgerModal';
import { SCENARIOS } from './data/scenarios';
import { computeBaselineComparison } from './engine/baselines';
import { generateRankedInterventions } from './engine/interventions';
import {
  applyInterventionsToDataset,
  computeTopRiskDrivers,
  runMonteCarloSimulation,
} from './engine/simulator';
import { CompanyProfile, InterventionCandidate, LedgerDataset } from './types/treasury';
import { formatInrCompact, formatShortDate } from './utils/format';

type WorkspaceView = 'overview' | 'trace' | 'simulator' | 'calibration';

const NAV_ITEMS: Array<{ id: WorkspaceView; label: string }> = [
  { id: 'overview', label: 'Cash-Risk Overview' },
  { id: 'trace', label: 'Risk Trace & O2C' },
  { id: 'simulator', label: 'What-If Simulator' },
  { id: 'calibration', label: 'Calibration & Baselines' },
];

export const App: React.FC = () => {
  const [scenarioKey, setScenarioKey] = useState<string>('kaveri-cascade');
  const [datasets, setDatasets] = useState<Record<string, LedgerDataset>>(SCENARIOS);
  const [activeView, setActiveView] = useState<WorkspaceView>('overview');

  const [selectedInterventions, setSelectedInterventions] = useState<
    Record<string, number>
  >({});
  const [intensityOverrides, setIntensityOverrides] = useState<
    Record<string, number>
  >({});
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  const [setupOpen, setSetupOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const dataset = datasets[scenarioKey] ?? datasets['kaveri-cascade'];

  // Baseline Monte Carlo forecast
  const baselineSim = useMemo(
    () => runMonteCarloSimulation(dataset, { seedSalt: 'base' }),
    [dataset]
  );

  // Counterfactual Top-5 risk attribution
  const topDrivers = useMemo(
    () => computeTopRiskDrivers(dataset, baselineSim),
    [dataset, baselineSim]
  );

  // Cost-aware ranked candidate interventions
  const rankedInterventions = useMemo(
    () => generateRankedInterventions(dataset, baselineSim, intensityOverrides),
    [dataset, baselineSim, intensityOverrides]
  );

  // Live Post-Intervention simulation
  const { simulatedSim, totalActionSpend } = useMemo(() => {
    const activeEntries = Object.entries(selectedInterventions);
    if (activeEntries.length === 0) {
      return { simulatedSim: null, totalActionSpend: 0 };
    }
    const effectiveMap: Record<string, number> = {};
    for (const [id, val] of activeEntries) {
      effectiveMap[id] = intensityOverrides[id] ?? val;
    }
    const applied = applyInterventionsToDataset(
      dataset,
      rankedInterventions,
      effectiveMap
    );
    const sim = runMonteCarloSimulation(dataset, {
      seedSalt: 'base',
      invoicesOverride: applied.invoices,
      commitmentsOverride: applied.commitments,
      invoiceDelayMultipliers: applied.invoiceDelayMultipliers,
      forcedInvoiceSettlementDay: applied.forcedInvoiceSettlementDay,
    });
    return {
      simulatedSim: sim,
      totalActionSpend: applied.directCostInr,
    };
  }, [dataset, rankedInterventions, selectedInterventions, intensityOverrides]);

  // Baseline model comparisons
  const baselineMetrics = useMemo(
    () => computeBaselineComparison(dataset, baselineSim),
    [dataset, baselineSim]
  );

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  const handleSelectScenario = (key: string) => {
    setScenarioKey(key);
    setSelectedInterventions({});
    setIntensityOverrides({});
    setSelectedTxId(null);
  };

  const handleToggleIntervention = (cand: InterventionCandidate) => {
    setSelectedInterventions((prev) => {
      const next = { ...prev };
      if (next[cand.id] !== undefined) {
        delete next[cand.id];
      } else {
        next[cand.id] = intensityOverrides[cand.id] ?? cand.defaultIntensity;
      }
      return next;
    });
  };

  const handleChangeIntensity = (candId: string, intensity: number) => {
    setIntensityOverrides((prev) => ({ ...prev, [candId]: intensity }));
    setSelectedInterventions((prev) => {
      if (prev[candId] === undefined) return prev;
      return { ...prev, [candId]: intensity };
    });
  };

  const handleApplyBestPlan = () => {
    const next: Record<string, number> = {};
    const positives = rankedInterventions.filter(
      (c) => c.netEconomicBenefitInr > 0 || c.riskReduction60dPts >= 8
    );
    for (const cand of positives.slice(0, 2)) {
      next[cand.id] = intensityOverrides[cand.id] ?? cand.defaultIntensity;
    }
    if (Object.keys(next).length === 0 && rankedInterventions[0]) {
      next[rankedInterventions[0].id] = rankedInterventions[0].defaultIntensity;
    }
    setSelectedInterventions(next);
  };

  const handleResetPlan = () => {
    setSelectedInterventions({});
  };

  const handleSaveProfile = (updatedProfile: CompanyProfile) => {
    setDatasets((prev) => ({
      ...prev,
      [scenarioKey]: {
        ...prev[scenarioKey],
        profile: updatedProfile,
      },
    }));
    triggerToast('Updated company baseline and recalculated forecast');
  };

  const handleImportDataset = (nextDataset: LedgerDataset, summaryLabel: string) => {
    const newKey = nextDataset.profile.id;
    setDatasets((prev) => ({
      ...prev,
      [newKey]: nextDataset,
    }));
    setScenarioKey(newKey);
    setSelectedInterventions({});
    setIntensityOverrides({});
    setSelectedTxId(null);
    setActiveView('overview');
    triggerToast(summaryLabel);
  };

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]">
      {/* Sticky Production Header */}
      <header className="sticky top-0 z-30 border-b border-[#E2E6ED] bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          {/* Brand + Scenario Switcher */}
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex shrink-0 items-center gap-2">
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6 shrink-0"
                aria-hidden="true"
              >
                <rect x="2" y="3" width="20" height="18" rx="4" fill="#0F172A" />
                <path
                  d="M6 15.5L10.5 11L13.5 13.5L18 8.5"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                <line
                  x1="6"
                  y1="17.5"
                  x2="18"
                  y2="17.5"
                  stroke="#38BDF8"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-[15px] font-semibold tracking-tight text-[#0F172A]">
                Runway AI
              </span>
            </div>

            <div className="h-5 w-px shrink-0 bg-[#E2E6ED]" aria-hidden="true" />

            <label htmlFor="scenario-select" className="visually-hidden">
              Select MSME Ledger Scenario
            </label>
            <select
              id="scenario-select"
              value={scenarioKey}
              onChange={(e) => handleSelectScenario(e.target.value)}
              className="max-w-[215px] truncate rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus:border-[#1E40AF] focus:outline-none md:max-w-[270px]"
            >
              {Object.entries(datasets).map(([key, ds]) => (
                <option key={key} value={key}>
                  {ds.profile.name}
                </option>
              ))}
            </select>
          </div>

          {/* Right Controls: Opening Cash + Setup + CSV Upload */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className="hidden items-center gap-1.5 rounded-md border border-[#E2E6ED] bg-[#F8FAFC] px-2.5 py-1.5 font-mono text-xs text-[#334155] hover:border-[#CBD5E1] md:inline-flex tabular-nums"
              title="Edit opening cash balance and buffer"
            >
              <span className="font-sans text-[#64748B]">Cash:</span>
              <span className="font-semibold text-[#0F172A]">
                {formatInrCompact(dataset.profile.openingCash)}
              </span>
              <span className="hidden text-[#CBD5E1] lg:inline">|</span>
              <span className="hidden font-sans text-[#64748B] lg:inline">As of</span>
              <span className="hidden lg:inline">{formatShortDate(dataset.profile.asOfDate)}</span>
            </button>

            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F1F3F7]"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              Setup
            </button>

            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1E293B]"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Upload Ledger
            </button>
          </div>
        </div>

        {/* Workspace Navigation Bar */}
        <div className="border-t border-[#E2E6ED] bg-[#FAFBFD]">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
            <nav
              aria-label="Primary workspace views"
              className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto md:overflow-visible"
            >
              {NAV_ITEMS.map((item) => {
                const isActive = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setActiveView(item.id)}
                    className={`relative whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-medium transition-colors sm:px-3.5 ${
                      isActive
                        ? 'border-[#1E40AF] text-[#0F172A]'
                        : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
                    }`}
                  >
                    {item.label}
                    {item.id === 'simulator' &&
                      Object.keys(selectedInterventions).length > 0 && (
                        <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#0F766E] px-1 font-mono text-[10px] text-white">
                          {Object.keys(selectedInterventions).length}
                        </span>
                      )}
                  </button>
                );
              })}
            </nav>

            <div className="hidden min-w-0 items-center gap-3 text-[11px] text-[#64748B] xl:flex">
              <span className="shrink-0 font-mono">{dataset.profile.gstin}</span>
              <span className="truncate">{dataset.profile.sector}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-5">
        {toastMessage && (
          <div
            role="status"
            className="mb-3 rounded-md border border-[#99F6E4] bg-[#F0FDFA] px-3.5 py-2 text-xs font-medium text-[#0F766E]"
          >
            {toastMessage}
          </div>
        )}

        {activeView === 'overview' && (
          <OverviewView
            dataset={dataset}
            baseline={baselineSim}
            simulated={simulatedSim}
            topDrivers={topDrivers}
            interventions={rankedInterventions}
            selectedInterventions={selectedInterventions}
            totalActionSpend={totalActionSpend}
            onToggleIntervention={handleToggleIntervention}
            onApplyBestPlan={handleApplyBestPlan}
            onResetPlan={handleResetPlan}
            onInspectTransaction={(txId) => {
              setSelectedTxId(txId);
              setActiveView('trace');
            }}
            onOpenSimulatorTab={() => setActiveView('simulator')}
          />
        )}

        {activeView === 'trace' && (
          <RiskTraceView
            dataset={dataset}
            topDrivers={topDrivers}
            interventions={rankedInterventions}
            selectedTxId={selectedTxId}
            onSelectTx={setSelectedTxId}
            onJumpToAction={(candId) => {
              const cand = rankedInterventions.find((c) => c.id === candId);
              if (cand) {
                setSelectedInterventions((prev) => ({
                  ...prev,
                  [cand.id]: intensityOverrides[cand.id] ?? cand.defaultIntensity,
                }));
              }
              setActiveView('simulator');
            }}
          />
        )}

        {activeView === 'simulator' && (
          <SimulatorView
            dataset={dataset}
            baseline={baselineSim}
            simulated={simulatedSim}
            interventions={rankedInterventions}
            selectedInterventions={selectedInterventions}
            intensityOverrides={intensityOverrides}
            totalActionSpend={totalActionSpend}
            onToggleIntervention={handleToggleIntervention}
            onChangeIntensity={handleChangeIntensity}
            onApplyBestPlan={handleApplyBestPlan}
            onResetPlan={handleResetPlan}
          />
        )}

        {activeView === 'calibration' && (
          <CalibrationView
            baselines={baselineMetrics}
            calibration={dataset.historicalCalibration}
          />
        )}
      </main>

      {/* Native <dialog> Modals */}
      <SetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        profile={dataset.profile}
        onSave={handleSaveProfile}
      />

      <UploadLedgerModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        dataset={dataset}
        onImportDataset={handleImportDataset}
      />
    </div>
  );
};

export default App;
