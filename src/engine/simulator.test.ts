import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../data/scenarios';
import { exportLedgerToCsv, parseUploadedLedgerCsv } from '../utils/csv';
import { computeBaselineComparison } from './baselines';
import { generateRankedInterventions } from './interventions';
import {
  applyInterventionsToDataset,
  computeTopRiskDrivers,
  getEffectiveCustomerParams,
  runMonteCarloSimulation,
} from './simulator';

describe('Runway AI Simulation & Decision Engine', () => {
  it('produces distinct calibrated shortfall probabilities across scenarios', () => {
    const kaveri = runMonteCarloSimulation(SCENARIOS['kaveri-cascade']);
    const laxmi = runMonteCarloSimulation(SCENARIOS['laxmi-crunch']);
    const narmada = runMonteCarloSimulation(SCENARIOS['narmada-healthy']);

    expect(laxmi.prob14d).toBeGreaterThan(kaveri.prob14d);
    expect(kaveri.prob30d).toBeGreaterThan(35);
    expect(kaveri.prob60d).toBeGreaterThan(50);
    expect(narmada.prob30d).toBeLessThan(15);
    expect(narmada.prob60d).toBeLessThan(25);

    for (const pt of kaveri.daily) {
      expect(pt.p10).toBeLessThanOrEqual(pt.p25);
      expect(pt.p25).toBeLessThanOrEqual(pt.p50);
      expect(pt.p50).toBeLessThanOrEqual(pt.p75);
      expect(pt.p75).toBeLessThanOrEqual(pt.p90);
    }
  });

  it('applies Bayesian shrinkage prior for cold-start sparse customers', () => {
    const newCust = SCENARIOS['kaveri-cascade'].customers.find((c) => c.tier === 'new')!;
    const params = getEffectiveCustomerParams(newCust);
    expect(params.isSparse).toBe(true);
    expect(params.meanDelay).toBeGreaterThan(8);
    expect(params.sigmaDays).toBeGreaterThan(8);
  });

  it('attributes Top 5 deficit-driving transactions and prices interventions with net benefit', () => {
    const dataset = SCENARIOS['kaveri-cascade'];
    const base = runMonteCarloSimulation(dataset);
    const drivers = computeTopRiskDrivers(dataset, base);

    expect(drivers.length).toBeGreaterThan(0);
    expect(drivers.length).toBeLessThanOrEqual(5);
    expect(drivers[0].rank).toBe(1);

    const ranked = generateRankedInterventions(dataset, base);
    expect(ranked.length).toBeGreaterThanOrEqual(4);
    expect(ranked[0].riskReduction60dPts + ranked[0].riskReduction30dPts).toBeGreaterThan(0);

    const applied = applyInterventionsToDataset(dataset, ranked, {
      [ranked[0].id]: ranked[0].defaultIntensity,
      [ranked[1].id]: ranked[1].defaultIntensity,
    });
    const post = runMonteCarloSimulation(dataset, {
      invoicesOverride: applied.invoices,
      commitmentsOverride: applied.commitments,
      invoiceDelayMultipliers: applied.invoiceDelayMultipliers,
      forcedInvoiceSettlementDay: applied.forcedInvoiceSettlementDay,
    });

    expect(post.prob60d).toBeLessThan(base.prob60d);
    expect(post.p10MinCash).toBeGreaterThan(base.p10MinCash);
  });

  it('computes baseline comparison and validates CSV round-trip and error guards', () => {
    const dataset = SCENARIOS['kaveri-cascade'];
    const base = runMonteCarloSimulation(dataset);
    const baselines = computeBaselineComparison(dataset, base);
    expect(baselines).toHaveLength(4);
    expect(baselines[0].modelName).toBe('Runway AI');
    expect(baselines[0].brierScore).toBeLessThan(baselines[1].brierScore);

    const csv = exportLedgerToCsv(dataset);
    const parsed = parseUploadedLedgerCsv(csv, dataset);
    expect(parsed.importedInvoices).toBe(dataset.invoices.length);
    expect(parsed.importedCommitments).toBe(dataset.commitments.length);

    expect(() =>
      parseUploadedLedgerCsv(
        'record_type,ref_number,counterparty,due_date,amount_inr\nINVOICE,INV-1,Acme,11-11-2026,50000',
        dataset
      )
    ).toThrow(/YYYY-MM-DD/);
  });
});
