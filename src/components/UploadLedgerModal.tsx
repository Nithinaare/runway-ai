import React, { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { LedgerDataset } from '../types/treasury';
import { exportLedgerToCsv, parseUploadedLedgerCsv } from '../utils/csv';
import { ModalDialog } from './ModalDialog';

interface UploadLedgerModalProps {
  open: boolean;
  onClose: () => void;
  dataset: LedgerDataset;
  onImportDataset: (next: LedgerDataset, summaryLabel: string) => void;
}

export const UploadLedgerModal: React.FC<UploadLedgerModalProps> = ({
  open,
  onClose,
  dataset,
  onImportDataset,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<{
    filename: string;
    dataset: LedgerDataset;
    invoices: number;
    commitments: number;
  } | null>(null);

  const handleDownloadSample = () => {
    const csv = exportLedgerToCsv(dataset);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dataset.profile.id}-ledger.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPreviewInfo(null);

    try {
      const text = await file.text();
      const parsed = parseUploadedLedgerCsv(text, dataset);
      setPreviewInfo({
        filename: file.name,
        dataset: parsed.dataset,
        invoices: parsed.importedInvoices,
        commitments: parsed.importedCommitments,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse ledger CSV.');
    }
  };

  const handleConfirmImport = () => {
    if (!previewInfo) return;
    onImportDataset(
      previewInfo.dataset,
      `Imported ${previewInfo.filename} (${previewInfo.invoices} AR, ${previewInfo.commitments} AP)`
    );
    setPreviewInfo(null);
    setError(null);
    onClose();
  };

  return (
    <ModalDialog
      open={open}
      onClose={() => {
        setError(null);
        setPreviewInfo(null);
        onClose();
      }}
      titleId="upload-modal-title"
      title="Ingest Transaction Ledger (CSV)"
    >
      <div className="space-y-4 text-xs">
        <div className="flex items-center justify-between rounded-md border border-[#E2E6ED] bg-[#F8FAFC] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-[#1E40AF]" aria-hidden="true" />
            <div>
              <div className="font-medium text-[#0F172A]">
                Order-to-Cash CSV Schema
              </div>
              <div className="font-mono text-[11px] text-[#64748B]">
                record_type, ref_number, counterparty, due_date, amount_inr
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDownloadSample}
            className="inline-flex items-center gap-1.5 rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#0F172A] hover:bg-[#F1F3F7]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download CSV
          </button>
        </div>

        <div>
          <label
            htmlFor="ledger-csv-file"
            className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-[#94A3B8] bg-[#F6F7F9] px-4 py-7 text-center hover:border-[#1E40AF] hover:bg-[#EFF6FF]/40"
          >
            <Upload className="h-5 w-5 text-[#475569]" aria-hidden="true" />
            <span className="mt-2 font-medium text-[#0F172A]">
              Choose CSV ledger file
            </span>
            <span className="mt-0.5 text-[11px] text-[#64748B]">
              Ingests customer invoices, buyer clusters, history & supplier POs
            </span>
            <input
              ref={fileInputRef}
              id="ledger-csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="sr-only"
            />
          </label>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]"
          >
            {error}
          </div>
        )}

        {previewInfo && (
          <div className="rounded-md border border-[#99F6E4] bg-[#F0FDFA] px-3.5 py-2.5 font-mono text-xs text-[#0F766E] tabular-nums">
            Ready: {previewInfo.filename} — {previewInfo.invoices} receivables,{' '}
            {previewInfo.commitments} commitments validated.
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[#E2E6ED] pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#E2E6ED] bg-white px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#F1F3F7]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!previewInfo}
            onClick={handleConfirmImport}
            className="rounded-md bg-[#1E40AF] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Run Forecast on Ledger
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
