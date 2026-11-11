import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Link2 } from 'lucide-react';
import { getEffectiveCustomerParams } from '../engine/simulator';
import {
  InterventionCandidate,
  LedgerDataset,
  RiskDriver,
} from '../types/treasury';
import {
  addDaysIso,
  diffDaysIso,
  formatInrCompact,
  formatInrExact,
  formatShortDate,
} from '../utils/format';

interface RiskTraceViewProps {
  dataset: LedgerDataset;
  topDrivers: RiskDriver[];
  interventions: InterventionCandidate[];
  selectedTxId: string | null;
  onSelectTx: (id: string) => void;
  onJumpToAction: (targetId: string) => void;
}

type FilterKind = 'all' | 'receivable' | 'obligation' | 'high_risk';
type SortKey = 'ref' | 'counterparty' | 'dueOffset' | 'amount' | 'riskPts';

interface LedgerRow {
  id: string;
  refNumber: string;
  kind: 'receivable' | 'obligation';
  counterparty: string;
  clusterOrCat: string;
  linkedChain: string;
  dueDate: string;
  dueOffset: number;
  amount: number;
  statusOrPrio: string;
  expectedDelayDays: number;
  sigmaDays: number;
  isSparse: boolean;
  isCorrelated: boolean;
  riskPts: number;
  description: string;
}

const textCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export const RiskTraceView: React.FC<RiskTraceViewProps> = ({
  dataset,
  topDrivers,
  interventions,
  selectedTxId,
  onSelectTx,
  onJumpToAction,
}) => {
  const [filter, setFilter] = useState<FilterKind>('all');
  const [sortKey, setSortKey] = useState<SortKey>('dueOffset');
  const [sortDir, setSortDir] = useState<'ascending' | 'descending'>('ascending');
  const [statusMessage, setStatusMessage] = useState('');

  const customerMap = useMemo(
    () => new Map(dataset.customers.map((c) => [c.id, c])),
    [dataset.customers]
  );
  const poMap = useMemo(
    () => new Map(dataset.purchaseOrders.map((p) => [p.id, p])),
    [dataset.purchaseOrders]
  );
  const commitmentMap = useMemo(
    () => new Map(dataset.commitments.map((c) => [c.id, c])),
    [dataset.commitments]
  );
  const driverMap = useMemo(
    () => new Map(topDrivers.map((d) => [d.transactionId, d])),
    [topDrivers]
  );

  // Correlated cluster summary
  const clusterSummaries = useMemo(() => {
    const map = new Map<
      string,
      {
        clusterId: string;
        customers: Set<string>;
        invoiceCount: number;
        exposure: number;
        weightedDelaySum: number;
        hasSparse: boolean;
      }
    >();

    for (const inv of dataset.invoices) {
      const cust = customerMap.get(inv.customerId);
      const cid = cust?.clusterId ?? 'Independent';
      const params = cust
        ? getEffectiveCustomerParams(cust)
        : { meanDelay: 11.5, sigmaDays: 10.5, tailProb: 0.08, isSparse: true };

      const entry = map.get(cid) ?? {
        clusterId: cid,
        customers: new Set<string>(),
        invoiceCount: 0,
        exposure: 0,
        weightedDelaySum: 0,
        hasSparse: false,
      };
      entry.customers.add(cust?.name ?? inv.customerId);
      entry.invoiceCount += 1;
      entry.exposure += inv.amount;
      entry.weightedDelaySum += inv.amount * params.meanDelay;
      if (params.isSparse) entry.hasSparse = true;
      map.set(cid, entry);
    }

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        avgDelay: item.exposure > 0 ? Math.round(item.weightedDelaySum / item.exposure) : 0,
      }))
      .sort((a, b) => b.exposure - a.exposure);
  }, [dataset.invoices, customerMap]);

  const rows = useMemo<LedgerRow[]>(() => {
    const clusterInvoiceCount = new Map<string, number>();
    for (const inv of dataset.invoices) {
      const cid = customerMap.get(inv.customerId)?.clusterId ?? 'Independent';
      clusterInvoiceCount.set(cid, (clusterInvoiceCount.get(cid) ?? 0) + 1);
    }

    const result: LedgerRow[] = [];

    for (const inv of dataset.invoices) {
      const cust = customerMap.get(inv.customerId);
      const po = poMap.get(inv.poId);
      const linkedComms = inv.linkedCommitmentIds
        .map((id) => commitmentMap.get(id)?.refNumber)
        .filter(Boolean);
      const params = cust
        ? getEffectiveCustomerParams(cust)
        : { meanDelay: 11.5, sigmaDays: 10.5, tailProb: 0.08, isSparse: true };
      const cid = cust?.clusterId ?? 'Independent';
      const drv = driverMap.get(inv.id);

      const chainParts = [po?.poNumber ?? inv.poId, ...linkedComms].filter(Boolean);

      result.push({
        id: inv.id,
        refNumber: inv.invoiceNumber,
        kind: 'receivable',
        counterparty: cust?.name ?? inv.customerId,
        clusterOrCat: cid,
        linkedChain: chainParts.join(' → ') || 'Direct Invoice',
        dueDate: inv.dueDate,
        dueOffset: diffDaysIso(dataset.profile.asOfDate, inv.dueDate),
        amount: inv.amount,
        statusOrPrio: inv.status,
        expectedDelayDays: Math.round(params.meanDelay),
        sigmaDays: Math.round(params.sigmaDays),
        isSparse: params.isSparse,
        isCorrelated: cid !== 'Independent' && (clusterInvoiceCount.get(cid) ?? 0) > 1,
        riskPts: drv?.riskContributionPts ?? 0,
        description: inv.description,
      });
    }

    for (const c of dataset.commitments) {
      const po = c.linkedCustomerPoId ? poMap.get(c.linkedCustomerPoId) : undefined;
      const drv = driverMap.get(c.id);
      result.push({
        id: c.id,
        refNumber: c.refNumber,
        kind: 'obligation',
        counterparty: c.vendorName,
        clusterOrCat: c.category.replace('_', ' '),
        linkedChain: po ? `${po.poNumber} supply` : 'Operating commitment',
        dueDate: c.dueDate,
        dueOffset: diffDaysIso(dataset.profile.asOfDate, c.dueDate),
        amount: c.amount,
        statusOrPrio: c.priority,
        expectedDelayDays: 0,
        sigmaDays: 0,
        isSparse: false,
        isCorrelated: false,
        riskPts: drv?.riskContributionPts ?? 0,
        description: c.description,
      });
    }

    return result;
  }, [dataset, customerMap, poMap, commitmentMap, driverMap]);

  const filteredAndSorted = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (filter === 'receivable') return r.kind === 'receivable';
      if (filter === 'obligation') return r.kind === 'obligation';
      if (filter === 'high_risk') return r.riskPts > 0 || r.isCorrelated || r.isSparse;
      return true;
    });

    const factor = sortDir === 'ascending' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'amount') return factor * (a.amount - b.amount);
      if (sortKey === 'dueOffset') return factor * (a.dueOffset - b.dueOffset);
      if (sortKey === 'riskPts') return factor * (a.riskPts - b.riskPts);
      if (sortKey === 'counterparty') {
        return factor * textCollator.compare(a.counterparty, b.counterparty);
      }
      return factor * textCollator.compare(a.refNumber, b.refNumber);
    });
  }, [rows, filter, sortKey, sortDir]);

  const activeTx = useMemo(
    () => rows.find((r) => r.id === selectedTxId) ?? filteredAndSorted[0] ?? null,
    [rows, selectedTxId, filteredAndSorted]
  );

  const matchingInterventions = useMemo(() => {
    if (!activeTx) return [];
    return interventions.filter((i) => i.targetId === activeTx.id);
  }, [interventions, activeTx]);

  const handleSort = (key: SortKey, label: string) => {
    const nextDir: 'ascending' | 'descending' =
      sortKey === key && sortDir === 'ascending' ? 'descending' : 'ascending';
    setSortKey(key);
    setSortDir(nextDir);
    setStatusMessage(
      `Sorted by ${label}, ${nextDir}, ${filteredAndSorted.length} rows`
    );
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="h-3 w-3 text-[#94A3B8]" aria-hidden="true" />;
    }
    return sortDir === 'ascending' ? (
      <ArrowUp className="h-3 w-3 text-[#1E40AF]" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3 w-3 text-[#1E40AF]" aria-hidden="true" />
    );
  };

  const counts = {
    all: rows.length,
    receivable: rows.filter((r) => r.kind === 'receivable').length,
    obligation: rows.filter((r) => r.kind === 'obligation').length,
    high_risk: rows.filter((r) => r.riskPts > 0 || r.isCorrelated || r.isSparse).length,
  };

  return (
    <div className="space-y-4">
      {/* Correlated Buyer Cluster Exposure Strip */}
      <section aria-label="Correlated receivable clusters">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {clusterSummaries.slice(0, 3).map((cluster) => (
            <div
              key={cluster.clusterId}
              className="rounded-md border border-[#E2E6ED] bg-white px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-xs font-semibold text-[#0F172A]">
                  {cluster.clusterId}
                </span>
                {cluster.invoiceCount > 1 && cluster.clusterId !== 'Independent' ? (
                  <span className="shrink-0 rounded bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-medium text-[#B91C1C]">
                    Linked Drag ({cluster.invoiceCount} inv)
                  </span>
                ) : cluster.hasSparse ? (
                  <span className="shrink-0 rounded bg-[#FFFBEB] px-1.5 py-0.5 text-[10px] font-medium text-[#B45309]">
                    Sparse Prior
                  </span>
                ) : (
                  <span className="shrink-0 rounded bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] font-medium text-[#475569]">
                    Uncorrelated
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-baseline justify-between font-mono tabular-nums">
                <span className="text-lg font-semibold text-[#0F172A]">
                  {formatInrCompact(cluster.exposure)}
                </span>
                <span className="text-xs text-[#64748B]">
                  avg +{cluster.avgDelay}d lag · {cluster.customers.size} buyer
                  {cluster.customers.size > 1 ? 's' : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Main Ledger + Transaction Inspector Split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section className="isolated-panel min-w-0 rounded-md border border-[#E2E6ED] bg-white lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E6ED] px-4 py-3">
            <h2 id="ledger-table-caption" className="text-sm font-semibold text-[#0F172A]">
              Order-to-Cash Linked Ledger
            </h2>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ['all', `All (${counts.all})`],
                  ['receivable', `Receivables (${counts.receivable})`],
                  ['obligation', `Payables (${counts.obligation})`],
                  ['high_risk', `Risk Drivers (${counts.high_risk})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    filter === key
                      ? 'bg-[#0F172A] text-white'
                      : 'bg-[#F1F3F7] text-[#475569] hover:bg-[#E2E6ED]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div role="status" className="visually-hidden">
            {statusMessage}
          </div>

          <div
            tabIndex={0}
            role="region"
            aria-labelledby="ledger-table-caption"
            className="table-wrapper"
          >
            <table className="ledger-table text-xs">
              <caption className="visually-hidden">
                Order-to-Cash Linked Ledger of customer receivables and supplier commitments
              </caption>
              <thead>
                <tr className="border-b border-[#E2E6ED]">
                  <th
                    scope="col"
                    aria-sort={sortKey === 'ref' ? sortDir : undefined}
                  >
                    <button type="button" onClick={() => handleSort('ref', 'Reference')}>
                      Ref {renderSortIcon('ref')}
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={sortKey === 'counterparty' ? sortDir : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort('counterparty', 'Counterparty')}
                    >
                      Counterparty {renderSortIcon('counterparty')}
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold text-[#334155]">
                    O2C Link
                  </th>
                  <th
                    scope="col"
                    aria-sort={sortKey === 'dueOffset' ? sortDir : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort('dueOffset', 'Due Date')}
                    >
                      Due {renderSortIcon('dueOffset')}
                    </button>
                  </th>
                  <th
                    scope="col"
                    data-align="right"
                    aria-sort={sortKey === 'amount' ? sortDir : undefined}
                  >
                    <button type="button" onClick={() => handleSort('amount', 'Amount')}>
                      Amount {renderSortIcon('amount')}
                    </button>
                  </th>
                  <th
                    scope="col"
                    data-align="right"
                    aria-sort={sortKey === 'riskPts' ? sortDir : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort('riskPts', 'Risk Impact')}
                    >
                      Risk Share {renderSortIcon('riskPts')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E6ED]">
                {filteredAndSorted.map((row) => {
                  const isActive = activeTx?.id === row.id;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => onSelectTx(row.id)}
                      className={`cursor-pointer transition-colors ${
                        isActive ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <td data-label="Ref" className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold text-[#0F172A]">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${
                              row.kind === 'receivable' ? 'bg-[#1E40AF]' : 'bg-[#B45309]'
                            }`}
                          />
                          {row.refNumber}
                        </span>
                      </td>
                      <td data-label="Counterparty" className="px-3 py-2.5">
                        <div className="font-medium text-[#0F172A]">{row.counterparty}</div>
                        <div className="text-[11px] text-[#64748B]">
                          {row.clusterOrCat}
                          {row.isSparse ? ' · Cold-start' : ''}
                        </div>
                      </td>
                      <td data-label="O2C Link" className="px-3 py-2.5 font-mono text-[11px] text-[#475569]">
                        <span className="inline-flex items-center gap-1">
                          <Link2 className="h-3 w-3 text-[#94A3B8]" aria-hidden="true" />
                          {row.linkedChain}
                        </span>
                      </td>
                      <td data-label="Due" className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums">
                        <div className="text-[#0F172A]">{formatShortDate(row.dueDate)}</div>
                        <div
                          className={`text-[11px] ${
                            row.dueOffset < 0 ? 'font-medium text-[#B91C1C]' : 'text-[#64748B]'
                          }`}
                        >
                          {row.dueOffset < 0
                            ? `${Math.abs(row.dueOffset)}d overdue`
                            : `Day +${row.dueOffset}`}
                        </div>
                      </td>
                      <td
                        data-label="Amount"
                        className={`whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${
                          row.kind === 'receivable' ? 'text-[#0F766E]' : 'text-[#0F172A]'
                        }`}
                      >
                        {row.kind === 'receivable' ? '+' : '-'}
                        {formatInrCompact(row.amount)}
                      </td>
                      <td data-label="Risk Share" className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                        {row.riskPts > 0 ? (
                          <span className="inline-flex rounded bg-[#FEF2F2] px-1.5 py-0.5 text-[11px] font-semibold text-[#B91C1C]">
                            +{row.riskPts.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#94A3B8]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Transaction Inspector Panel */}
        <aside className="min-w-0 rounded-md border border-[#E2E6ED] bg-white p-4 lg:col-span-4">
          {activeTx ? (
            <div className="space-y-4">
              <div className="border-b border-[#E2E6ED] pb-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-[#0F172A]">
                    {activeTx.refNumber}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                      activeTx.kind === 'receivable'
                        ? 'bg-[#EFF6FF] text-[#1E40AF]'
                        : 'bg-[#FFFBEB] text-[#B45309]'
                    }`}
                  >
                    {activeTx.kind === 'receivable' ? 'Customer Receivable' : 'Supplier Commitment'}
                  </span>
                </div>
                <div className="mt-1 text-sm font-medium text-[#0F172A]">
                  {activeTx.counterparty}
                </div>
                <div className="text-xs text-[#64748B]">{activeTx.description}</div>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-xs tabular-nums">
                <div className="rounded bg-[#F6F7F9] p-2.5">
                  <dt className="text-[11px] text-[#64748B]">Face Value</dt>
                  <dd className="mt-0.5 font-mono text-sm font-semibold text-[#0F172A]">
                    {formatInrExact(activeTx.amount)}
                  </dd>
                </div>
                <div className="rounded bg-[#F6F7F9] p-2.5">
                  <dt className="text-[11px] text-[#64748B]">Contract Due</dt>
                  <dd className="mt-0.5 font-mono text-sm font-semibold text-[#0F172A]">
                    {formatShortDate(activeTx.dueDate)}
                  </dd>
                </div>

                {activeTx.kind === 'receivable' ? (
                  <>
                    <div className="rounded bg-[#F6F7F9] p-2.5">
                      <dt className="text-[11px] text-[#64748B]">Expected Lag</dt>
                      <dd className="mt-0.5 font-mono text-sm font-semibold text-[#B45309]">
                        +{activeTx.expectedDelayDays}d (±{activeTx.sigmaDays}d)
                      </dd>
                    </div>
                    <div className="rounded bg-[#F6F7F9] p-2.5">
                      <dt className="text-[11px] text-[#64748B]">P90 Settlement</dt>
                      <dd className="mt-0.5 font-mono text-sm font-semibold text-[#0F172A]">
                        {formatShortDate(
                          addDaysIso(
                            activeTx.dueOffset < 0
                              ? dataset.profile.asOfDate
                              : activeTx.dueDate,
                            activeTx.expectedDelayDays + Math.round(activeTx.sigmaDays * 1.28)
                          )
                        )}
                      </dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded bg-[#F6F7F9] p-2.5">
                      <dt className="text-[11px] text-[#64748B]">Flexibility</dt>
                      <dd className="mt-0.5 font-mono text-sm font-semibold capitalize text-[#0F172A]">
                        {activeTx.statusOrPrio}
                      </dd>
                    </div>
                    <div className="rounded bg-[#F6F7F9] p-2.5">
                      <dt className="text-[11px] text-[#64748B]">Category</dt>
                      <dd className="mt-0.5 font-mono text-sm font-semibold capitalize text-[#0F172A]">
                        {activeTx.clusterOrCat}
                      </dd>
                    </div>
                  </>
                )}
              </dl>

              <div className="rounded border border-[#E2E6ED] bg-[#F8FAFC] p-3">
                <div className="text-[11px] font-semibold text-[#475569]">
                  Order-to-Cash Dependency Chain
                </div>
                <div className="mt-1 font-mono text-xs text-[#0F172A]">
                  {activeTx.linkedChain}
                </div>
                {activeTx.isCorrelated && (
                  <div className="mt-1.5 text-[11px] text-[#B91C1C]">
                    Correlated inside {activeTx.clusterOrCat} cluster (shared payment shock).
                  </div>
                )}
                {activeTx.isSparse && (
                  <div className="mt-1.5 text-[11px] text-[#B45309]">
                    Sparse payment history: wide shrinkage uncertainty prior applied.
                  </div>
                )}
              </div>

              {matchingInterventions.length > 0 && (
                <div className="space-y-2 border-t border-[#E2E6ED] pt-3">
                  <div className="text-[11px] font-semibold text-[#475569]">
                    Available Interventions
                  </div>
                  {matchingInterventions.map((cand) => (
                    <div
                      key={cand.id}
                      className="flex items-center justify-between gap-2 rounded border border-[#E2E6ED] px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-[#0F172A]">{cand.title}</div>
                        <div className="font-mono text-[11px] text-[#0F766E] tabular-nums">
                          Net {cand.netEconomicBenefitInr >= 0 ? '+' : ''}
                          {formatInrCompact(cand.netEconomicBenefitInr)} · Cost{' '}
                          {formatInrCompact(cand.directCostInr)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onJumpToAction(cand.id)}
                        className="shrink-0 rounded bg-[#1E40AF] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#1E3A8A]"
                      >
                        Simulate
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-[#64748B]">
              Select a transaction row to inspect its Order-to-Cash trace.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
