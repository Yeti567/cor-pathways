"use client";

import { ClipboardCheck, FilePlus2 } from "lucide-react";
import { useState } from "react";
import { ContractedUploadField } from "@/app/admin/_components/ContractedUploadField";
import { createContractedDriverObservation } from "@/app/admin/contracted-drivers/actions";
import type { ContractedDriverObservationType } from "@/types/database";

type Props = {
  driverId: string;
  inputClass: string;
  subcontractorId: string;
  submitClass: string;
  tenantId: string;
};

/**
 * File a client's audit or evaluation of this driver.
 *
 * Collapsed until asked for, like the other forms on this page: most visits to a driver
 * file are to read it, and a nine-field form sitting open pushes the record itself off
 * the screen.
 */
export function ContractedObservationForm({
  driverId,
  inputClass,
  subcontractorId,
  submitClass,
  tenantId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ContractedDriverObservationType>("audit");

  if (!open) {
    return (
      <button
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <ClipboardCheck className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
        File an observation
      </button>
    );
  }

  return (
    <form
      action={createContractedDriverObservation}
      className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3"
    >
      <input name="driverId" type="hidden" value={driverId} />

      <p className="text-xs text-[var(--ink-muted)]">
        What a client saw the driver do. This is history: it is kept whatever else happens, a later one never
        replaces it, and it does not count against the driver&apos;s compliance.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Kind</span>
          <select
            className={inputClass}
            name="observationType"
            onChange={(event) => setType(event.target.value as ContractedDriverObservationType)}
            value={type}
          >
            <option value="audit">Audit — a task was watched</option>
            <option value="evaluation">Evaluation — a formal assessment</option>
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">What the report calls it</span>
          <input className={inputClass} name="title" placeholder="PPE audit" required />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Observed</span>
          <input className={inputClass} name="observedOn" required type="date" />
          {/*
            The report routinely arrives days after the work. Both dates are asked for
            because filing an observation under the day the email landed puts it on a day
            the driver may not have been on site.
          */}
          <span className="block text-xs text-[var(--ink-muted)]">The day the work was watched.</span>
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Reported</span>
          <input className={inputClass} name="reportedOn" type="date" />
          <span className="block text-xs text-[var(--ink-muted)]">Only if the write-up came later.</span>
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Client</span>
          <input className={inputClass} name="issuingCompany" placeholder="The client whose site it is" />
          <span className="block text-xs text-[var(--ink-muted)]">
            Whose site. Site standing is worked out per client, so a report without one cannot set one.
          </span>
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Observer</span>
          <input className={inputClass} name="observer" placeholder="Who watched" />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Where</span>
          <input className={inputClass} name="location" placeholder="Truck unload, riser 1" />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Outcome</span>
          <select className={inputClass} defaultValue="clear" name="outcome">
            <option value="clear">{type === "evaluation" ? "Passed" : "Nothing found"}</option>
            <option value="deficiencies">Deficiencies noted</option>
            <option value="failed">Not passed</option>
          </select>
        </label>

        {/*
          Offered on an audit too. A site observer can restrict a driver on the spot and
          write it into the audit email -- one in the first batch cut a driver to 8am-4pm
          three days after an evaluation had granted him unlimited access. Leave it at
          "not stated", which is what most reports say.
        */}
        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--ink)]">Access</span>
          <select className={inputClass} defaultValue="" name="siteAccess">
            <option value="">Not stated</option>
            <option value="unlimited">Unlimited access</option>
            <option value="limited">Limited access</option>
            <option value="suspended">Access suspended</option>
          </select>
          <span className="block text-xs text-[var(--ink-muted)]">
            Only if the report says so. The most recent report that does sets the driver&apos;s standing at that
            site.
          </span>
        </label>

        <label className="space-y-2 sm:col-span-2">
          <span className="text-xs font-medium text-[var(--ink)]">What was found</span>
          <textarea className={`${inputClass} h-20 py-2`} name="findings" placeholder="In the report's own words" />
        </label>

        <label className="space-y-2 sm:col-span-2">
          <span className="text-xs font-medium text-[var(--ink)]">Action taken</span>
          <textarea className={`${inputClass} h-20 py-2`} name="actionTaken" />
        </label>
      </div>

      <div className="mt-3 grid gap-3">
        <ContractedUploadField
          hint="The report itself. Optional — the record can be written down before the PDF arrives."
          inputClass={inputClass}
          label="Report"
          location={{
            tenantId,
            subcontractorId,
            subjectId: driverId,
            scope: "contracted-drivers",
          }}
          single
          submitClass={submitClass}
          submitIcon={<FilePlus2 className="h-4 w-4" aria-hidden="true" />}
          submitLabel="File observation"
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
