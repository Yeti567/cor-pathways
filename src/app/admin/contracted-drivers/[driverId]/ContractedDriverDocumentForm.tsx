"use client";

import { Save, Upload } from "lucide-react";
import { useState } from "react";
import { ContractedUploadField } from "@/app/admin/_components/ContractedUploadField";
import { attachContractedDriverDocument } from "@/app/admin/contracted-drivers/actions";
import type { ContractedDriverDocumentType } from "@/types/database";

type Props = {
  docType: ContractedDriverDocumentType;
  driverId: string;
  hasProof: boolean;
  inputClass: string;
  label: string;
  subcontractorId: string;
  submitClass: string;
  tenantId: string;
  /** The date the driver row carries, offered as the default so the two agree by default. */
  trackedDate: string | null;
};

/**
 * File the scan behind a licence, abstract or CSO.
 *
 * The dates asked for are the ones printed ON THE DOCUMENT, not the ones being tracked.
 * They default to what the driver row already says, because most of the time the document
 * is where that date came from; where they differ, the difference is the point, and the
 * driver file shows it rather than resolving it.
 */
export function ContractedDriverDocumentForm({
  docType,
  driverId,
  hasProof,
  inputClass,
  label,
  subcontractorId,
  submitClass,
  tenantId,
  trackedDate,
}: Props) {
  const [open, setOpen] = useState(false);

  // Only a licence has an expiry to record. A CSO prints "EXPIRES: N/A", and an abstract
  // does not expire at all -- it goes stale. Offering the field would invite someone to
  // invent a date to fill it.
  const tracksExpiry = docType === "license";

  if (!open) {
    return (
      <button
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Upload className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
        {hasProof ? "File a newer one" : "Upload document"}
        <span className="sr-only"> for {label}</span>
      </button>
    );
  }

  return (
    <form
      action={attachContractedDriverDocument}
      className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3"
    >
      <input name="driverId" type="hidden" value={driverId} />
      <input name="docType" type="hidden" value={docType} />

      <p className="text-xs text-[var(--ink-muted)]">
        Enter the dates as they are printed on the document. They are kept beside the tracked date rather than
        replacing it, so a disagreement shows up instead of being overwritten.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">
            {tracksExpiry ? "Issued" : "Date on the document"}
          </span>
          <input
            className={inputClass}
            defaultValue={tracksExpiry ? "" : (trackedDate ?? "")}
            name="issuedDate"
            type="date"
          />
        </label>

        {tracksExpiry ? (
          <label className="space-y-2">
            <span className="text-xs font-medium text-[var(--ink)]">Expires</span>
            <input className={inputClass} defaultValue={trackedDate ?? ""} name="expiryDate" type="date" />
          </label>
        ) : null}

        <label className="space-y-2 sm:col-span-2">
          <span className="text-xs font-medium text-[var(--ink)]">Description</span>
          <input
            className={inputClass}
            name="title"
            placeholder={label}
            // Optional: the action falls back to the document's own name. It earns its
            // place when there are several, where "2025 abstract" beats three identical
            // rows distinguishable only by date.
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3">
        <ContractedUploadField
          hint="The scan itself. Required: this record exists to hold it."
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
          submitLabel="File document"
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
