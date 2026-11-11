import {
  CompanyProfile,
  Customer,
  DailyForecastPoint,
  DeficitWindow,
  InterventionCandidate,
  Invoice,
  LedgerDataset,
  RiskDriver,
  SimulationSummary,
  SupplierCommitment,
} from '../types/treasury';
import { addDaysIso, diffDaysIso, formatInrCompact, formatShortDate } from '../utils/format';
import { createSeededRng, hashString, sampleStandardNormal } from './prng';

export const HORIZON_DAYS = 60;
const MONTE_CARLO_PATHS = 600;

export interface ActiveInterventionSelection {
  id: string;
  intensity: number; // % or days depending on intervention type
}

export interface AppliedPlanResult {
  invoices: Invoice[];
  commitments: SupplierCommitment[];
  customerOverrides: Record<string, Partial<Customer>>;
  invoiceDelayMultipliers: Record<string, number>;
  forcedInvoiceSettlementDay: Record<string, number>;
  directCostInr: number;
}

/**
 * Bayesian shrinkage prior for sparse/new customers so missing payment history
 * widens uncertainty instead of optimistically assuming on-time settlement.
 */
export function getEffectiveCustomerParams(customer: Customer): {
  meanDelay: number;
  sigmaDays: number;
  tailProb: number;
  isSparse: boolean;
} {
  const priorMean = 11.5;
  const priorSigma = 10.5;
  const priorTail = 0.08;
  const n = Math.max(0, customer.historicalInvoicesCount);
  const weight = n / (n + 4);

  return {
    meanDelay: weight * customer.meanDelayDays + (1 - weight) * priorMean,
    sigmaDays: weight * customer.delayVolatility + (1 - weight) * priorSigma,
    tailProb: weight * customer.tailDisputeProb + (1 - weight) * priorTail,
    isSparse: n < 3,
  };
}

/**
 * Estimates the financial cost of a simulated cash shortfall path:
 * emergency working capital / informal bridge borrowing + supplier delay friction.
 */
function computePathShortfallCost(peakDeficitInr: number, daysNegative: number): number {
  if (peakDeficitInr <= 0) return 0;
  const annualizedRate = 0.22;
  const setupFeeRate = 0.015;
  const disruptionRate = 0.032;
  const durationFactor = Math.max(7, daysNegative) / 365;
  return peakDeficitInr * (annualizedRate * durationFactor + setupFeeRate + disruptionRate);
}

function percentile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function percentileNum(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function runMonteCarloSimulation(
  dataset: LedgerDataset,
  options?: {
    paths?: number;
    seedSalt?: string;
    invoiceDelayMultipliers?: Record<string, number>;
    forcedInvoiceSettlementDay?: Record<string, number>;
    invoicesOverride?: Invoice[];
    commitmentsOverride?: SupplierCommitment[];
    forceOnTimeInvoiceId?: string;
    excludeCommitmentId?: string;
  }
): SimulationSummary {
  const numPaths = options?.paths ?? MONTE_CARLO_PATHS;
  const profile: CompanyProfile = dataset.profile;
  const invoices = options?.invoicesOverride ?? dataset.invoices;
  const commitments = options?.commitmentsOverride ?? dataset.commitments;
  const customerMap = new Map<string, Customer>(
    dataset.customers.map((c) => [c.id, c])
  );

  const seed = hashString(
    `${profile.id}:${profile.asOfDate}:${profile.openingCash}:${options?.seedSalt ?? 'base'}`
  );
  const rng = createSeededRng(seed);

  // Precompute deterministic scheduled outflows by day [0..HORIZON_DAYS]
  const dailyOutflow = new Float64Array(HORIZON_DAYS + 1);
  let totalObligations60d = 0;

  for (const c of commitments) {
    if (c.id === options?.excludeCommitmentId) continue;
    const dayOffset = diffDaysIso(profile.asOfDate, c.dueDate);
    if (dayOffset > HORIZON_DAYS) continue;
    const effectiveDay = Math.max(0, dayOffset);
    dailyOutflow[effectiveDay] += c.amount;
    totalObligations60d += c.amount;
  }

  // Precompute invoice metadata for fast inner loop
  const invoiceMeta = invoices
    .filter((inv) => inv.amount > 0)
    .map((inv) => {
      const cust = customerMap.get(inv.customerId) ?? {
        id: inv.customerId,
        name: 'Unknown Customer',
        tier: 'new' as const,
        clusterId: 'Independent',
        historicalInvoicesCount: 0,
        meanDelayDays: 12,
        delayVolatility: 10,
        tailDisputeProb: 0.08,
      };
      const params = getEffectiveCustomerParams(cust);
      const dueOffset = diffDaysIso(profile.asOfDate, inv.dueDate);
      return {
        inv,
        cust,
        params,
        dueOffset,
      };
    });

  const totalReceivables = invoiceMeta.reduce((acc, m) => acc + m.inv.amount, 0);

  // Unique clusters & customers for correlated latent factors
  const uniqueClusters = Array.from(new Set(invoiceMeta.map((m) => m.cust.clusterId)));
  const uniqueCustomers = Array.from(new Set(invoiceMeta.map((m) => m.cust.id)));

  // Matrix of cash balances: [day][path] for fast percentile sorting
  const dayBalances: Float64Array[] = Array.from(
    { length: HORIZON_DAYS + 1 },
    () => new Float64Array(numPaths)
  );
  const dayInflowsSum = new Float64Array(HORIZON_DAYS + 1);

  let count14d = 0;
  let count30d = 0;
  let count60d = 0;
  let countBuffer30d = 0;
  const firstDeficitDays: number[] = [];
  const pathMinCash = new Float64Array(numPaths);
  let shortfallCostSum = 0;

  const pathInflow = new Float64Array(HORIZON_DAYS + 1);
  const clusterZ = new Map<string, number>();
  const customerZ = new Map<string, number>();

  for (let p = 0; p < numPaths; p += 1) {
    pathInflow.fill(0);

    const macroZ = sampleStandardNormal(rng);
    for (const cid of uniqueClusters) {
      clusterZ.set(cid, sampleStandardNormal(rng));
    }
    for (const custId of uniqueCustomers) {
      const custObj = customerMap.get(custId);
      const cZ = clusterZ.get(custObj?.clusterId ?? 'Independent') ?? 0;
      const idioZ = sampleStandardNormal(rng);
      // Anchor cluster correlation rho_cluster = 0.46, macro = 0.14, idiosyncratic = 0.40
      const combined =
        Math.sqrt(0.46) * cZ + Math.sqrt(0.14) * macroZ + Math.sqrt(0.4) * idioZ;
      customerZ.set(custId, combined);
    }

    for (const meta of invoiceMeta) {
      const { inv, cust, params, dueOffset } = meta;
      let arrivalDay: number;

      if (options?.forceOnTimeInvoiceId === inv.id) {
        arrivalDay = Math.max(1, dueOffset);
      } else if (options?.forcedInvoiceSettlementDay?.[inv.id] !== undefined) {
        arrivalDay = options.forcedInvoiceSettlementDay[inv.id];
      } else {
        const custLatent = customerZ.get(cust.id) ?? 0;
        const invNoise = sampleStandardNormal(rng);
        const delayMult = options?.invoiceDelayMultipliers?.[inv.id] ?? 1;

        // Combine customer factor (75%) + invoice noise (25%)
        const z = Math.sqrt(0.75) * custLatent + Math.sqrt(0.25) * invNoise;

        // Right-skewed arrival delay via soft-plus / log-normal shift
        const rawDelay = Math.max(
          0,
          params.meanDelay * delayMult + z * (params.sigmaDays * (0.5 + 0.5 * delayMult))
        );

        // Correlated tail event (e.g. quality hold / customer cash freeze)
        let tailExtra = 0;
        const effectiveTailProb = params.tailProb * delayMult;
        if (custLatent > 1.25 && rng() < effectiveTailProb * 2.1) {
          tailExtra = 10 + rng() * 14;
        } else if (rng() < effectiveTailProb * 0.5) {
          tailExtra = 8 + rng() * 12;
        }

        if (dueOffset < 0) {
          // Already overdue: customer still pays after remaining residual delay from today
          const remainingMean = Math.max(3, params.meanDelay * 0.65 * delayMult);
          const residual = Math.max(
            1,
            Math.round(remainingMean + z * params.sigmaDays * 0.55 * delayMult + tailExtra * 0.5)
          );
          arrivalDay = residual;
        } else {
          arrivalDay = Math.max(1, Math.round(dueOffset + rawDelay + tailExtra));
        }
      }

      if (arrivalDay >= 0 && arrivalDay <= HORIZON_DAYS) {
        pathInflow[arrivalDay] += inv.amount;
        dayInflowsSum[arrivalDay] += inv.amount;
      }
    }

    let cash = profile.openingCash;
    let hit14 = false;
    let hit30 = false;
    let hit60 = false;
    let hitBuffer30 = false;
    let firstNegDay: number | null = null;
    let minCash = cash;
    let daysNeg = 0;

    for (let d = 0; d <= HORIZON_DAYS; d += 1) {
      cash = cash + pathInflow[d] - dailyOutflow[d];
      dayBalances[d][p] = cash;

      if (cash < minCash) minCash = cash;
      if (cash < 0) {
        daysNeg += 1;
        if (firstNegDay === null) firstNegDay = d;
        if (d <= 14) hit14 = true;
        if (d <= 30) hit30 = true;
        hit60 = true;
      }
      if (d <= 30 && cash < profile.safetyBuffer) {
        hitBuffer30 = true;
      }
    }

    if (hit14) count14d += 1;
    if (hit30) count30d += 1;
    if (hit60) count60d += 1;
    if (hitBuffer30) countBuffer30d += 1;
    if (firstNegDay !== null) firstDeficitDays.push(firstNegDay);
    pathMinCash[p] = minCash;
    shortfallCostSum += computePathShortfallCost(Math.max(0, -minCash), daysNeg);
  }

  const daily: DailyForecastPoint[] = [];
  for (let d = 0; d <= HORIZON_DAYS; d += 1) {
    const sorted = dayBalances[d].slice().sort();
    let sum = 0;
    for (let i = 0; i < numPaths; i += 1) sum += sorted[i];
    daily.push({
      day: d,
      date: addDaysIso(profile.asOfDate, d),
      p10: percentile(sorted, 0.1),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
      mean: sum / numPaths,
      expectedInflow: dayInflowsSum[d] / numPaths,
      expectedOutflow: dailyOutflow[d],
    });
  }

  const sortedMinCash = pathMinCash.slice().sort();
  firstDeficitDays.sort((a, b) => a - b);

  let deficitWindow: DeficitWindow = {
    earliestDay: null,
    medianDay: null,
    latestDay: null,
    earliestDate: null,
    medianDate: null,
    latestDate: null,
  };

  if (firstDeficitDays.length >= Math.max(3, numPaths * 0.03)) {
    const eDay = Math.round(percentileNum(firstDeficitDays, 0.1));
    const mDay = Math.round(percentileNum(firstDeficitDays, 0.5));
    const lDay = Math.round(percentileNum(firstDeficitDays, 0.9));
    deficitWindow = {
      earliestDay: eDay,
      medianDay: mDay,
      latestDay: lDay,
      earliestDate: addDaysIso(profile.asOfDate, eDay),
      medianDate: addDaysIso(profile.asOfDate, mDay),
      latestDate: addDaysIso(profile.asOfDate, lDay),
    };
  }

  return {
    prob14d: (count14d / numPaths) * 100,
    prob30d: (count30d / numPaths) * 100,
    prob60d: (count60d / numPaths) * 100,
    bufferBreach30d: (countBuffer30d / numPaths) * 100,
    deficitWindow,
    p10MinCash: percentile(sortedMinCash, 0.1),
    p50MinCash: percentile(sortedMinCash, 0.5),
    expectedShortfallCost: shortfallCostSum / numPaths,
    totalReceivables,
    totalObligations60d,
    daily,
  };
}

/**
 * Counterfactual transaction-level risk attribution:
 * Isolates the top 5 receivables and obligations contributing most to deficit probability
 * and P10 shortfall severity, then explains each in plain shop-owner language.
 */
export function computeTopRiskDrivers(
  dataset: LedgerDataset,
  baseline: SimulationSummary
): RiskDriver[] {
  const customerMap = new Map(dataset.customers.map((c) => [c.id, c]));
  const clusterCounts = new Map<string, number>();
  for (const inv of dataset.invoices) {
    const cust = customerMap.get(inv.customerId);
    if (cust) {
      clusterCounts.set(cust.clusterId, (clusterCounts.get(cust.clusterId) ?? 0) + 1);
    }
  }

  const drivers: RiskDriver[] = [];

  for (const inv of dataset.invoices) {
    if (inv.amount <= 0) continue;
    const cust = customerMap.get(inv.customerId);
    const params = cust
      ? getEffectiveCustomerParams(cust)
      : { meanDelay: 12, sigmaDays: 10, tailProb: 0.08, isSparse: true };

    const cf = runMonteCarloSimulation(dataset, {
      paths: 220,
      seedSalt: 'base',
      forceOnTimeInvoiceId: inv.id,
    });

    const riskDrop = Math.max(0, baseline.prob60d - cf.prob60d);
    const troughGain = Math.max(0, cf.p10MinCash - baseline.p10MinCash);
    const dueOffset = diffDaysIso(dataset.profile.asOfDate, inv.dueDate);
    const linkedCount = inv.linkedCommitmentIds.length;
    const clusterId = cust?.clusterId ?? 'Independent';
    const isCorrelatedCluster =
      clusterId !== 'Independent' && (clusterCounts.get(clusterId) ?? 0) > 1;

    // Combined score balances deficit probability drop & rupees of trough protection
    const score = riskDrop * 12000 + troughGain * 0.35;
    if (score <= 0 && riskDrop < 0.2) continue;

    const statusTag =
      dueOffset < 0
        ? `already ${Math.abs(dueOffset)}d overdue`
        : `due ${formatShortDate(inv.dueDate)} (Day +${dueOffset})`;
    const clusterNote = isCorrelatedCluster
      ? `; delays drag ${(clusterCounts.get(clusterId) ?? 1) - 1} other ${clusterId} invoice(s)`
      : '';
    const sparseNote = params.isSparse
      ? '; new buyer with zero payment history (high uncertainty)'
      : '';

    drivers.push({
      rank: 0,
      transactionId: inv.id,
      refNumber: inv.invoiceNumber,
      kind: 'receivable',
      counterparty: cust?.name ?? inv.customerId,
      clusterId,
      amount: inv.amount,
      dueDate: inv.dueDate,
      dueDayOffset: dueOffset,
      expectedDelayDays: Math.round(params.meanDelay),
      riskContributionPts: Number(riskDrop.toFixed(1)),
      shortfallImpactInr: Math.round(troughGain),
      isCorrelatedCluster,
      isSparseHistory: params.isSparse,
      linkedCount,
      plainSummary: `${cust?.name ?? inv.customerId} (${formatInrCompact(inv.amount)}) ${statusTag}, trending ~${Math.round(params.meanDelay)}d late${clusterNote}${sparseNote}`,
    });
  }

  for (const comm of dataset.commitments) {
    const dueOffset = diffDaysIso(dataset.profile.asOfDate, comm.dueDate);
    if (dueOffset < -2 || dueOffset > HORIZON_DAYS) continue;

    const cf = runMonteCarloSimulation(dataset, {
      paths: 220,
      seedSalt: 'base',
      excludeCommitmentId: comm.id,
    });

    const riskDrop = Math.max(0, baseline.prob60d - cf.prob60d);
    const troughGain = Math.max(0, cf.p10MinCash - baseline.p10MinCash);
    const score = riskDrop * 12000 + troughGain * 0.35;
    if (score <= 0 && riskDrop < 0.2) continue;

    const flexLabel =
      comm.priority === 'hard'
        ? 'non-deferrable obligation'
        : comm.priority === 'negotiable'
          ? 'negotiable credit terms'
          : 'staggerable material PO';

    drivers.push({
      rank: 0,
      transactionId: comm.id,
      refNumber: comm.refNumber,
      kind: 'obligation',
      counterparty: comm.vendorName,
      clusterId: comm.category,
      amount: comm.amount,
      dueDate: comm.dueDate,
      dueDayOffset: dueOffset,
      expectedDelayDays: 0,
      riskContributionPts: Number(riskDrop.toFixed(1)),
      shortfallImpactInr: Math.round(troughGain),
      isCorrelatedCluster: false,
      isSparseHistory: false,
      linkedCount: comm.linkedCustomerPoId ? 1 : 0,
      plainSummary: `${comm.vendorName} (${formatInrCompact(comm.amount)}) due ${formatShortDate(comm.dueDate)} (Day +${Math.max(0, dueOffset)}) — ${flexLabel}`,
    });
  }

  drivers.sort((a, b) => {
    const scoreA = a.riskContributionPts * 15000 + a.shortfallImpactInr * 0.4;
    const scoreB = b.riskContributionPts * 15000 + b.shortfallImpactInr * 0.4;
    return scoreB - scoreA;
  });

  return drivers.slice(0, 5).map((d, idx) => ({ ...d, rank: idx + 1 }));
}

/**
 * Applies selected user interventions (with adjustable intensities) to produce
 * modified invoices/commitments and delay overrides for live re-simulation.
 */
export function applyInterventionsToDataset(
  dataset: LedgerDataset,
  candidates: InterventionCandidate[],
  selectedMap: Record<string, number>
): AppliedPlanResult {
  const invoices: Invoice[] = dataset.invoices.map((inv) => ({ ...inv }));
  const commitments: SupplierCommitment[] = dataset.commitments.map((c) => ({ ...c }));
  const invoiceDelayMultipliers: Record<string, number> = {};
  const forcedInvoiceSettlementDay: Record<string, number> = {};
  let directCostInr = 0;

  for (const cand of candidates) {
    const intensity = selectedMap[cand.id];
    if (intensity === undefined) continue;

    if (cand.type === 'chase_invoice') {
      // Escalated follow-up reduces expected delay & tail variance; intensity = effort tier %
      const mult = Math.max(0.28, 1 - (intensity / 100) * 0.72);
      invoiceDelayMultipliers[cand.targetId] = mult;
      directCostInr += Math.round(1200 + (intensity / 100) * 2300);
    } else if (cand.type === 'discount_invoice') {
      // Early-payment discount settles invoice on Day +3/+4 minus discount fee
      const inv = invoices.find((i) => i.id === cand.targetId);
      if (inv) {
        const fee = Math.round(inv.amount * (intensity / 100));
        inv.amount = Math.max(0, inv.amount - fee);
        forcedInvoiceSettlementDay[inv.id] = intensity >= 2 ? 3 : 5;
        directCostInr += fee;
      }
    } else if (cand.type === 'stagger_po') {
      // Split PO into two tranches: (100 - split%) on due date, split% deferred +20 days
      const idx = commitments.findIndex((c) => c.id === cand.targetId);
      if (idx >= 0) {
        const orig = commitments[idx];
        const deferredFrac = Math.min(0.75, Math.max(0.2, intensity / 100));
        const immediateAmt = Math.round(orig.amount * (1 - deferredFrac));
        const deferredAmt = orig.amount - immediateAmt;
        const rebateLoss = Math.round(deferredAmt * 0.032);
        commitments[idx] = {
          ...orig,
          amount: immediateAmt,
          description: `${orig.description} (Tranche 1)`,
        };
        commitments.push({
          ...orig,
          id: `${orig.id}-split`,
          refNumber: `${orig.refNumber}-B`,
          dueDate: addDaysIso(orig.dueDate, 20),
          amount: deferredAmt + rebateLoss,
          description: `${orig.description} (Tranche 2 +20d)`,
        });
        directCostInr += rebateLoss;
      }
    } else if (cand.type === 'renegotiate_supplier') {
      // Extend supplier payment due date by +intensity days for a negotiated credit surcharge
      const comm = commitments.find((c) => c.id === cand.targetId);
      if (comm) {
        const surcharge = Math.round(comm.amount * (intensity / 30) * 0.022);
        comm.dueDate = addDaysIso(comm.dueDate, intensity);
        comm.amount += surcharge;
        directCostInr += surcharge;
      }
    }
  }

  return {
    invoices,
    commitments,
    customerOverrides: {},
    invoiceDelayMultipliers,
    forcedInvoiceSettlementDay,
    directCostInr,
  };
}
