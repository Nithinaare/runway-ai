import {
  InterventionCandidate,
  InterventionType,
  LedgerDataset,
  SimulationSummary,
} from '../types/treasury';
import { diffDaysIso, formatInrCompact } from '../utils/format';
import {
  applyInterventionsToDataset,
  HORIZON_DAYS,
  runMonteCarloSimulation,
} from './simulator';

interface RawCandidateSpec {
  id: string;
  type: InterventionType;
  targetId: string;
  targetRef: string;
  counterparty: string;
  title: string;
  parameterLabel: string;
  defaultIntensity: number;
  minIntensity: number;
  maxIntensity: number;
  stepIntensity: number;
  intensityUnit: '%' | 'days';
  actionPreview: string;
}

export function evaluateSingleIntervention(
  dataset: LedgerDataset,
  baseline: SimulationSummary,
  spec: RawCandidateSpec,
  intensity: number
): InterventionCandidate {
  const placeholder: InterventionCandidate = {
    ...spec,
    directCostInr: 0,
    riskReduction14dPts: 0,
    riskReduction30dPts: 0,
    riskReduction60dPts: 0,
    p10TroughGainInr: 0,
    shortfallCostAvoidedInr: 0,
    netEconomicBenefitInr: 0,
    costPerRiskPtInr: 0,
  };

  const applied = applyInterventionsToDataset(dataset, [placeholder], {
    [spec.id]: intensity,
  });

  const postSim = runMonteCarloSimulation(dataset, {
    paths: 320,
    seedSalt: 'base',
    invoicesOverride: applied.invoices,
    commitmentsOverride: applied.commitments,
    invoiceDelayMultipliers: applied.invoiceDelayMultipliers,
    forcedInvoiceSettlementDay: applied.forcedInvoiceSettlementDay,
  });

  const riskDrop14 = Math.max(0, baseline.prob14d - postSim.prob14d);
  const riskDrop30 = Math.max(0, baseline.prob30d - postSim.prob30d);
  const riskDrop60 = Math.max(0, baseline.prob60d - postSim.prob60d);
  const troughGain = postSim.p10MinCash - baseline.p10MinCash;
  const avoidedCost = Math.max(
    0,
    baseline.expectedShortfallCost - postSim.expectedShortfallCost
  );
  const netBenefit = avoidedCost - applied.directCostInr;
  const maxRiskDrop = Math.max(riskDrop30, riskDrop60, 0.1);

  return {
    ...spec,
    defaultIntensity: intensity,
    directCostInr: applied.directCostInr,
    riskReduction14dPts: Number(riskDrop14.toFixed(1)),
    riskReduction30dPts: Number(riskDrop30.toFixed(1)),
    riskReduction60dPts: Number(riskDrop60.toFixed(1)),
    p10TroughGainInr: Math.round(troughGain),
    shortfallCostAvoidedInr: Math.round(avoidedCost),
    netEconomicBenefitInr: Math.round(netBenefit),
    costPerRiskPtInr: Math.round(applied.directCostInr / maxRiskDrop),
  };
}

export function generateRankedInterventions(
  dataset: LedgerDataset,
  baseline: SimulationSummary,
  intensityOverrides?: Record<string, number>
): InterventionCandidate[] {
  const customerMap = new Map(dataset.customers.map((c) => [c.id, c]));
  const specs: RawCandidateSpec[] = [];

  // 1. Chase top overdue / late-trending invoices
  const sortedInvoices = [...dataset.invoices]
    .filter((i) => i.amount >= 150000)
    .sort((a, b) => {
      const dueA = diffDaysIso(dataset.profile.asOfDate, a.dueDate);
      const dueB = diffDaysIso(dataset.profile.asOfDate, b.dueDate);
      return b.amount * (dueA < 0 ? 1.5 : 1) - a.amount * (dueB < 0 ? 1.5 : 1);
    });

  for (const inv of sortedInvoices.slice(0, 2)) {
    const cust = customerMap.get(inv.customerId);
    specs.push({
      id: `chase:${inv.id}`,
      type: 'chase_invoice',
      targetId: inv.id,
      targetRef: inv.invoiceNumber,
      counterparty: cust?.name ?? inv.customerId,
      title: `Escalate collection on ${inv.invoiceNumber}`,
      parameterLabel: 'Follow-up intensity',
      defaultIntensity: 80,
      minIntensity: 40,
      maxIntensity: 100,
      stepIntensity: 10,
      intensityUnit: '%',
      actionPreview: `Senior AR follow-up + payment schedule lock with ${cust?.name ?? inv.customerId} on ${formatInrCompact(inv.amount)}`,
    });
  }

  // 2. Early-payment discount on major upcoming receivables
  const discountCandidates = [...dataset.invoices]
    .filter((i) => i.amount >= 250000)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 2);

  for (const inv of discountCandidates) {
    const cust = customerMap.get(inv.customerId);
    specs.push({
      id: `discount:${inv.id}`,
      type: 'discount_invoice',
      targetId: inv.id,
      targetRef: inv.invoiceNumber,
      counterparty: cust?.name ?? inv.customerId,
      title: `Early-pay discount on ${inv.invoiceNumber}`,
      parameterLabel: 'Cash discount rate',
      defaultIntensity: 2.0,
      minIntensity: 1.0,
      maxIntensity: 4.0,
      stepIntensity: 0.5,
      intensityUnit: '%',
      actionPreview: `Offer early settlement rebate for T+3 NEFT/RTGS clearing on ${formatInrCompact(inv.amount)}`,
    });
  }

  // 3. Stagger deferrable raw-material purchase orders
  const deferrablePos = dataset.commitments
    .filter((c) => {
      const offset = diffDaysIso(dataset.profile.asOfDate, c.dueDate);
      return c.priority === 'deferrable' && offset >= 0 && offset <= HORIZON_DAYS;
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 2);

  for (const po of deferrablePos) {
    specs.push({
      id: `stagger:${po.id}`,
      type: 'stagger_po',
      targetId: po.id,
      targetRef: po.refNumber,
      counterparty: po.vendorName,
      title: `Split & stagger ${po.refNumber}`,
      parameterLabel: 'Deferral tranche (+20d)',
      defaultIntensity: 50,
      minIntensity: 25,
      maxIntensity: 75,
      stepIntensity: 5,
      intensityUnit: '%',
      actionPreview: `Split ${formatInrCompact(po.amount)} batch with ${po.vendorName}; shift deferred tranche +20 days`,
    });
  }

  // 4. Renegotiate supplier credit terms on negotiable payables
  const negotiablePayables = dataset.commitments
    .filter((c) => {
      const offset = diffDaysIso(dataset.profile.asOfDate, c.dueDate);
      return c.priority === 'negotiable' && offset >= 0 && offset <= HORIZON_DAYS;
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 2);

  for (const comm of negotiablePayables) {
    specs.push({
      id: `reneg:${comm.id}`,
      type: 'renegotiate_supplier',
      targetId: comm.id,
      targetRef: comm.refNumber,
      counterparty: comm.vendorName,
      title: `Extend terms on ${comm.refNumber}`,
      parameterLabel: 'Credit extension',
      defaultIntensity: 14,
      minIntensity: 7,
      maxIntensity: 21,
      stepIntensity: 7,
      intensityUnit: 'days',
      actionPreview: `Negotiate extended credit window on ${formatInrCompact(comm.amount)} payable to ${comm.vendorName}`,
    });
  }

  const evaluated = specs.map((spec) => {
    const intensity = intensityOverrides?.[spec.id] ?? spec.defaultIntensity;
    return evaluateSingleIntervention(dataset, baseline, spec, intensity);
  });

  // Sort by Net Economic Benefit descending, breaking ties by 60d risk reduction
  evaluated.sort((a, b) => {
    if (Math.abs(b.netEconomicBenefitInr - a.netEconomicBenefitInr) > 500) {
      return b.netEconomicBenefitInr - a.netEconomicBenefitInr;
    }
    return b.riskReduction60dPts - a.riskReduction60dPts;
  });

  return evaluated;
}
