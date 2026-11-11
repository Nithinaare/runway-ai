import {
  CommitmentCategory,
  CommitmentPriority,
  Customer,
  Invoice,
  LedgerDataset,
  PurchaseOrder,
  SupplierCommitment,
} from '../types/treasury';
import { diffDaysIso } from './format';

/**
 * Exports a unified single-CSV representation of receivables and supplier commitments
 * so users can download a realistic template, edit rows, and re-upload it.
 */
export function exportLedgerToCsv(dataset: LedgerDataset): string {
  const customerMap = new Map(dataset.customers.map((c) => [c.id, c]));
  const header = [
    'record_type',
    'ref_number',
    'counterparty',
    'cluster_or_category',
    'due_date',
    'amount_inr',
    'hist_delay_days',
    'hist_count',
    'priority_or_status',
    'linked_ref',
    'description',
  ].join(',');

  const escape = (v: string | number) => {
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows: string[] = [header];

  for (const inv of dataset.invoices) {
    const cust = customerMap.get(inv.customerId);
    rows.push(
      [
        'INVOICE',
        inv.invoiceNumber,
        cust?.name ?? inv.customerId,
        cust?.clusterId ?? 'Independent',
        inv.dueDate,
        inv.amount,
        cust?.meanDelayDays ?? 10,
        cust?.historicalInvoicesCount ?? 0,
        inv.status,
        inv.poId,
        inv.description,
      ]
        .map(escape)
        .join(',')
    );
  }

  for (const c of dataset.commitments) {
    rows.push(
      [
        'COMMITMENT',
        c.refNumber,
        c.vendorName,
        c.category,
        c.dueDate,
        c.amount,
        0,
        0,
        c.priority,
        c.linkedCustomerPoId ?? '',
        c.description,
      ]
        .map(escape)
        .join(',')
    );
  }

  return rows.join('\n');
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseUploadedLedgerCsv(
  csvText: string,
  baseDataset: LedgerDataset
): { dataset: LedgerDataset; importedInvoices: number; importedCommitments: number } {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one transaction row.');
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => headers.indexOf(name);

  const idxType = col('record_type');
  const idxRef = col('ref_number');
  const idxParty = col('counterparty');
  const idxCluster = col('cluster_or_category');
  const idxDue = col('due_date');
  const idxAmt = col('amount_inr');
  const idxDelay = col('hist_delay_days');
  const idxHistCnt = col('hist_count');
  const idxPrio = col('priority_or_status');
  const idxLinked = col('linked_ref');
  const idxDesc = col('description');

  if (idxType < 0 || idxRef < 0 || idxParty < 0 || idxDue < 0 || idxAmt < 0) {
    throw new Error(
      'Missing required columns: record_type, ref_number, counterparty, due_date, amount_inr.'
    );
  }

  const customerMap = new Map<string, Customer>();
  const invoices: Invoice[] = [];
  const commitments: SupplierCommitment[] = [];
  const poMap = new Map<string, PurchaseOrder>();

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const recType = (cells[idxType] ?? '').toUpperCase();
    const ref = cells[idxRef] || `ROW-${i}`;
    const party = cells[idxParty] || 'Counterparty';
    const clusterOrCat = cells[idxCluster] || 'Independent';
    const dueDate = cells[idxDue] || baseDataset.profile.asOfDate;
    const amount = Number(cells[idxAmt]);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Row ${i + 1}: invalid positive amount_inr "${cells[idxAmt]}".`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new Error(`Row ${i + 1}: due_date "${dueDate}" must use YYYY-MM-DD format.`);
    }

    if (recType === 'INVOICE') {
      const custKey = party.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const custId = `cust-${custKey}`;
      const meanDelay = Math.max(0, Number(cells[idxDelay] ?? 8) || 0);
      const histCount = Math.max(0, Number(cells[idxHistCnt] ?? 4) || 0);

      if (!customerMap.has(custId)) {
        customerMap.set(custId, {
          id: custId,
          name: party,
          tier: histCount === 0 ? 'new' : amount >= 500000 ? 'anchor' : 'regular',
          clusterId: clusterOrCat || 'Independent',
          historicalInvoicesCount: histCount,
          meanDelayDays: meanDelay,
          delayVolatility: Math.max(3, Math.round(meanDelay * 0.55)),
          tailDisputeProb: meanDelay > 10 ? 0.1 : 0.04,
        });
      }

      const linkedPoId = cells[idxLinked] || `po-csv-${i}`;
      if (!poMap.has(linkedPoId)) {
        poMap.set(linkedPoId, {
          id: linkedPoId,
          poNumber: linkedPoId.toUpperCase(),
          customerId: custId,
          orderValue: amount,
          orderDate: baseDataset.profile.asOfDate,
          status: 'invoiced',
        });
      }

      const rawStatus = (cells[idxPrio] ?? '').toLowerCase();
      const dueOffset = diffDaysIso(baseDataset.profile.asOfDate, dueDate);
      const status: Invoice['status'] =
        rawStatus === 'overdue' || dueOffset < 0
          ? 'overdue'
          : rawStatus === 'partial'
            ? 'partial'
            : 'open';

      invoices.push({
        id: `inv-csv-${i}`,
        invoiceNumber: ref,
        customerId: custId,
        poId: linkedPoId,
        issueDate: baseDataset.profile.asOfDate,
        dueDate,
        amount,
        status,
        linkedCommitmentIds: [],
        description: cells[idxDesc] || `${party} receivable`,
      });
    } else if (recType === 'COMMITMENT') {
      const validCats: CommitmentCategory[] = [
        'raw_material',
        'payroll',
        'gst_statutory',
        'utility_rent',
        'emi',
      ];
      const cat = validCats.includes(clusterOrCat as CommitmentCategory)
        ? (clusterOrCat as CommitmentCategory)
        : 'raw_material';

      const rawPrio = (cells[idxPrio] ?? '').toLowerCase();
      const validPrios: CommitmentPriority[] = ['hard', 'negotiable', 'deferrable'];
      const priority = validPrios.includes(rawPrio as CommitmentPriority)
        ? (rawPrio as CommitmentPriority)
        : 'negotiable';

      commitments.push({
        id: `comm-csv-${i}`,
        refNumber: ref,
        vendorName: party,
        category: cat,
        dueDate,
        amount,
        priority,
        linkedCustomerPoId: cells[idxLinked] || undefined,
        description: cells[idxDesc] || `${party} obligation`,
      });
    } else {
      throw new Error(`Row ${i + 1}: record_type must be INVOICE or COMMITMENT.`);
    }
  }

  if (invoices.length === 0 && commitments.length === 0) {
    throw new Error('No valid INVOICE or COMMITMENT rows parsed.');
  }

  return {
    dataset: {
      ...baseDataset,
      profile: {
        ...baseDataset.profile,
        id: `uploaded-${Date.now()}`,
      },
      customers: Array.from(customerMap.values()),
      purchaseOrders: Array.from(poMap.values()),
      invoices,
      commitments,
    },
    importedInvoices: invoices.length,
    importedCommitments: commitments.length,
  };
}
