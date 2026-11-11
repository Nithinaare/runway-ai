const inrExactFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function formatInrExact(amount: number): string {
  const rounded = Math.round(amount);
  return inrExactFormatter.format(rounded);
}

/**
 * Formats INR in compact Indian notation (Cr / L / K) for charts, KPIs, and dense tables.
 */
export function formatInrCompact(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1e7) {
    return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  }
  if (abs >= 1e5) {
    return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  }
  if (abs >= 1e3) {
    return `${sign}₹${(abs / 1e3).toFixed(1)} K`;
  }
  return `${sign}₹${Math.round(abs)}`;
}

export function formatPct(val: number, decimals = 0): string {
  return `${val.toFixed(decimals)}%`;
}

export function addDaysIso(baseIso: string, offsetDays: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return dt.toISOString().slice(0, 10);
}

export function diffDaysIso(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86400000);
}

export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}
