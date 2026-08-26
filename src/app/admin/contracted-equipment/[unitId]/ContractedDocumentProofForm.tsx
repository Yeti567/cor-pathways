"use client";

import { Save, Upload } from "lucide-react";
import { useState } from "react";
import { ContractedUploadField } from "@/app/admin/_components/ContractedUploadField";
import { attachContractedEquipmentDocumentProof } from "@/app/admin/contracted-equipment/actions";

type Props = {
  documentId: string;
  expiryDate: string | null;
  hasProof: boolean;
  inputClass: string;
  issuedDate: string | null;
  subcontractorId: string;
  submitClass: string;
  tenantId: string;
  title: string;
  unitId: string;
};

/**
 * Files the scan onto a document the unit already holds.
 *
 * This is the control that answers a waiting compliance row. Adding a second document
 * for the same file leaves that row still waiting, so the proof goes here, on the row
 * itself, and the dates come with it because the certificate being filed is a better
 * source for them than the spreadsheet the row was loaded from.
 */
export function ContractedDocumentProofForm({
  documentId,
  expiryDate,
  hasProof,
  inputClass,
  issuedDate,
  subcontractorId,
  submitClass,
  tenantId,
  title,
  unitId,
}: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Upload className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
        {hasProof ? "Replace or edit" : "Upload document"}
        <span className="sr-only"> for {title}</span>
      </button>
    );
  }

  return (
    <form
      action={attachContractedEquipmentDocumentProof}
      className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3"
    >
      <input name="documentId" type="hidden" value={documentId} />
      <input name="unitId" type="hidden" value={unitId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Issued date</span>
          <input className={inputClass} defaultValue={issuedDate ?? ""} name="issuedDate" type="date" />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Expiry date</span>
          {/*
            Not required, unlike the fleet's own version. A fire extinguisher tag carrying
            a serial and no printed date is a real certificate, and demanding an expiry
            here is what forces somebody to invent one.
          */}
          <input className={inputClass} defaultValue={expiryDate ?? ""} name="expiryDate" type="date" />
          <span className="block text-xs text-[var(--ink-muted)]">Leave empty if it does not expire.</span>
        </label>
      </div>

      <div className="mt-3 grid gap-3">
        <ContractedUploadField
          hint="The scan is filed against this document, so the compliance status it drives can go green."
          inputClass={inputClass}
          label="Scan"
          location={{
            tenantId,
            subcontractorId,
            subjectId: unitId,
            scope: "contracted-equipment",
          }}
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
