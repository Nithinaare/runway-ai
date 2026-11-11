export type CustomerTier = 'anchor' | 'regular' | 'new';

export interface CompanyProfile {
  id: string;
  name: string;
  gstin: string;
  sector: string;
  location: string;
  asOfDate: string; // ISO YYYY-MM-DD
  openingCash: number; // INR
  safetyBuffer: number; // INR minimum operating threshold
}

export interface Customer {
  id: string;
  name: string;
  tier: CustomerTier;
  clusterId: string;
  historicalInvoicesCount: number;
  meanDelayDays: number;
  delayVolatility: number; // std dev in days
  tailDisputeProb: number; // probability of severe >25d dispute/hold
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  customerId: string;
  orderValue: number;
  orderDate: string;
  status: 'in_production' | 'dispatched' | 'invoiced';
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  poId: string;
  issueDate: string;
  dueDate: string; // ISO YYYY-MM-DD
  amount: number; // remaining receivable INR
  status: 'open' | 'overdue' | 'partial';
  linkedCommitmentIds: string[];
  description: string;
}

export type CommitmentCategory =
  | 'raw_material'
  | 'payroll'
  | 'gst_statutory'
  | 'utility_rent'
  | 'emi';

export type CommitmentPriority = 'hard' | 'negotiable' | 'deferrable';

export interface SupplierCommitment {
  id: string;
  refNumber: string;
  vendorName: string;
  category: CommitmentCategory;
  dueDate: string; // ISO YYYY-MM-DD
  amount: number; // INR
  priority: CommitmentPriority;
  linkedCustomerPoId?: string;
  description: string;
}

export interface LedgerDataset {
  profile: CompanyProfile;
  customers: Customer[];
  purchaseOrders: PurchaseOrder[];
  invoices: Invoice[];
  commitments: SupplierCommitment[];
  historicalCalibration: CalibrationPoint[];
  bankBalanceSeries: number[]; // trailing 30 daily closing balances for TS baseline
}

export interface DailyForecastPoint {
  day: number;
  date: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
  expectedInflow: number;
  expectedOutflow: number;
}

export interface DeficitWindow {
  earliestDay: number | null; // P10 crossing day
  medianDay: number | null; // P50 crossing day
  latestDay: number | null; // P90 crossing day
  earliestDate: string | null;
  medianDate: string | null;
  latestDate: string | null;
}

export interface RiskDriver {
  rank: number;
  transactionId: string;
  refNumber: string;
  kind: 'receivable' | 'obligation';
  counterparty: string;
  clusterId: string;
  amount: number;
  dueDate: string;
  dueDayOffset: number;
  expectedDelayDays: number;
  riskContributionPts: number; // percentage-point drop in 60d deficit prob if neutralized
  shortfallImpactInr: number; // improvement in P10 trough if neutralized
  isCorrelatedCluster: boolean;
  isSparseHistory: boolean;
  linkedCount: number;
  plainSummary: string;
}

export type InterventionType =
  | 'chase_invoice'
  | 'discount_invoice'
  | 'stagger_po'
  | 'renegotiate_supplier';

export interface InterventionCandidate {
  id: string;
  type: InterventionType;
  targetId: string;
  targetRef: string;
  counterparty: string;
  title: string;
  parameterLabel: string;
  defaultIntensity: number; // e.g. discount % or split % or extension days
  minIntensity: number;
  maxIntensity: number;
  stepIntensity: number;
  intensityUnit: '%' | 'days';
  directCostInr: number;
  riskReduction14dPts: number;
  riskReduction30dPts: number;
  riskReduction60dPts: number;
  p10TroughGainInr: number;
  shortfallCostAvoidedInr: number;
  netEconomicBenefitInr: number;
  costPerRiskPtInr: number;
  actionPreview: string;
}

export interface SimulationSummary {
  prob14d: number; // 0..100
  prob30d: number; // 0..100
  prob60d: number; // 0..100
  bufferBreach30d: number; // 0..100
  deficitWindow: DeficitWindow;
  p10MinCash: number;
  p50MinCash: number;
  expectedShortfallCost: number;
  totalReceivables: number;
  totalObligations60d: number;
  daily: DailyForecastPoint[];
}

export interface BaselineMetric {
  modelName: string;
  methodTag: string;
  predicted30dRisk: number;
  predicted60dRisk: number;
  predictedMinCash: number;
  brierScore: number;
  eceError: number; // Expected Calibration Error %
  avgLeadTimeDays: number;
  missedCrunchRate: number; // % of actual shortfalls missed
}

export interface CalibrationPoint {
  bucketLabel: string;
  predictedPct: number;
  observedPct: number;
  sampleCount: number;
}
