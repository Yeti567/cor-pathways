"use client";

import { Save, Upload } from "lucide-react";
import { useState } from "react";
import { ContractedUploadField } from "@/app/admin/_components/ContractedUploadField";
import { attachContractedDriverCertificationProof } from "@/app/admin/contracted-drivers/actions";

type Props = {
  certificationId: string;
  driverId: string;
  expiresOn: string | null;
  hasProof: boolean;
  inputClass: string;
  issuedOn: string | null;
  label: string;
  subcontractorId: string;
  submitClass: string;
  tenantId: string;
};

/** The per-row upload. Same reasoning as the unit document version. */
export function ContractedTicketProofForm({
  certificationId,
  driverId,
  expiresOn,
  hasProof,
  inputClass,
  issuedOn,
  label,
  subcontractorId,
  submitClass,
  tenantId,
}: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Upload className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
        {hasProof ? "Replace or edit" : "Upload document"}
        <span className="sr-only"> for {label}</span>
      </button>
    );
  }

  return (
    <form
      action={attachContractedDriverCertificationProof}
      className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3"
    >
      <input name="certificationId" type="hidden" value={certificationId} />
      <input name="driverId" type="hidden" value={driverId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Issued</span>
          <input className={inputClass} defaultValue={issuedOn ?? ""} name="issuedOn" type="date" />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Expires</span>
          <input className={inputClass} defaultValue={expiresOn ?? ""} name="expiresOn" type="date" />
          <span className="block text-xs text-[var(--ink-muted)]">Leave empty if it does not expire.</span>
        </label>
      </div>

      <div className="mt-3 grid gap-3">
        <ContractedUploadField
          hint="Filed against this record, so the ticket can read as proven."
          inputClass={inputClass}
          label="Scan"
          location={{
            tenantId,
            subcontractorId,
            subjectId: driverId,
            scope: "contracted-drivers",
          }}
          single
          submitClass={submitClass}
          submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
          submitLabel="Save"
        />
      </div>

      <button
        className="mt-2 text-xs font-semibold text-[var(--ink-muted)] underline transition hover:text-[var(--ink)]"
        onClick={() => setOpen(false)}
        type="button"
      >
        Cancel
      </button>
    </form>
  );
}
