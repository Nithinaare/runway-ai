import React, { useEffect, useState } from 'react';
import { CompanyProfile } from '../types/treasury';
import { ModalDialog } from './ModalDialog';

interface SetupModalProps {
  open: boolean;
  onClose: () => void;
  profile: CompanyProfile;
  onSave: (updated: CompanyProfile) => void;
}

export const SetupModal: React.FC<SetupModalProps> = ({
  open,
  onClose,
  profile,
  onSave,
}) => {
  const [name, setName] = useState(profile.name);
  const [gstin, setGstin] = useState(profile.gstin);
  const [openingCash, setOpeningCash] = useState(String(profile.openingCash));
  const [safetyBuffer, setSafetyBuffer] = useState(String(profile.safetyBuffer));
  const [asOfDate, setAsOfDate] = useState(profile.asOfDate);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      setName(profile.name);
      setGstin(profile.gstin);
      setOpeningCash(String(profile.openingCash));
      setSafetyBuffer(String(profile.safetyBuffer));
      setAsOfDate(profile.asOfDate);
      setTouched({});
    }
  }, [open, profile]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) {
      setTouched({
        name: true,
        gstin: true,
        openingCash: true,
        safetyBuffer: true,
        asOfDate: true,
      });
      const firstInvalid = form.querySelector<HTMLElement>(':invalid');
      firstInvalid?.focus();
      return;
    }

    onSave({
      ...profile,
      name: name.trim(),
      gstin: gstin.trim().toUpperCase(),
      openingCash: Math.max(0, Number(openingCash)),
      safetyBuffer: Math.max(0, Number(safetyBuffer)),
      asOfDate,
    });
    onClose();
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      titleId="setup-modal-title"
      title="Business Setup & Cash Baseline"
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-3.5 text-xs">
        <div>
          <label htmlFor="setup-name" className="block font-medium text-[#0F172A]">
            Manufacturer Name
          </label>
          <span id="setup-name-hint" className="mt-0.5 block text-[11px] text-[#64748B]">
            Registered MSME entity name
          </span>
          <input
            id="setup-name"
            type="text"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            aria-describedby="setup-name-hint"
            aria-invalid={touched.name && name.trim().length < 2 ? 'true' : 'false'}
            className="field-input mt-1"
            autoFocus
          />
          <div className="field-error">Enter a valid company name (min 2 characters).</div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="setup-gstin" className="block font-medium text-[#0F172A]">
              GSTIN
            </label>
            <span id="setup-gstin-hint" className="mt-0.5 block text-[11px] text-[#64748B]">
              15-character alphanumeric GSTIN
            </span>
            <input
              id="setup-gstin"
              type="text"
              required
              pattern="[0-9A-Za-z]{15}"
              value={gstin}
              onChange={(e) => setGstin(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, gstin: true }))}
              aria-describedby="setup-gstin-hint"
              aria-invalid={
                touched.gstin && !/^[0-9A-Za-z]{15}$/.test(gstin.trim())
                  ? 'true'
                  : 'false'
              }
              className="field-input mt-1 font-mono uppercase"
            />
            <div className="field-error">Enter a 15-character GSTIN code.</div>
          </div>

          <div>
            <label htmlFor="setup-date" className="block font-medium text-[#0F172A]">
              Forecast As-Of Date
            </label>
            <span id="setup-date-hint" className="mt-0.5 block text-[11px] text-[#64748B]">
              Day 0 anchor date
            </span>
            <input
              id="setup-date"
              type="date"
              required
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              aria-describedby="setup-date-hint"
              className="field-input mt-1 font-mono"
            />
            <div className="field-error">Select a valid forecast date.</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="setup-cash" className="block font-medium text-[#0F172A]">
              Opening Bank Cash (₹)
            </label>
            <span id="setup-cash-hint" className="mt-0.5 block text-[11px] text-[#64748B]">
              Available liquid balance in INR
            </span>
            <input
              id="setup-cash"
              type="number"
              required
              min={0}
              step={10000}
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, openingCash: true }))}
              aria-describedby="setup-cash-hint"
              aria-invalid={
                touched.openingCash && Number(openingCash) < 0 ? 'true' : 'false'
              }
              className="field-input mt-1 font-mono"
            />
            <div className="field-error">Opening balance must be ₹0 or greater.</div>
          </div>

          <div>
            <label htmlFor="setup-buffer" className="block font-medium text-[#0F172A]">
              Safety Cash Buffer (₹)
            </label>
            <span id="setup-buffer-hint" className="mt-0.5 block text-[11px] text-[#64748B]">
              Minimum operating cash floor
            </span>
            <input
              id="setup-buffer"
              type="number"
              required
              min={0}
              step={10000}
              value={safetyBuffer}
              onChange={(e) => setSafetyBuffer(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, safetyBuffer: true }))}
              aria-describedby="setup-buffer-hint"
              aria-invalid={
                touched.safetyBuffer && Number(safetyBuffer) < 0 ? 'true' : 'false'
              }
              className="field-input mt-1 font-mono"
            />
            <div className="field-error">Safety buffer must be ₹0 or greater.</div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#E2E6ED] pt-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#E2E6ED] bg-white px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#F1F3F7]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-[#1E40AF] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#1E3A8A]"
          >
            Save & Recalculate
          </button>
        </div>
      </form>
    </ModalDialog>
  );
};
