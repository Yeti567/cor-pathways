"use client";

import { useState } from "react";
import { equipmentDocumentTypeOptions } from "@/lib/equipment";

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:bg-[var(--surface-muted)] disabled:text-[var(--ink-muted)]";

type EquipmentCertificationTypeOption = { id: string; name: string };

/**
 * Title, document type, and the certification-type picker for the Add Document form.
 *
 * These three fields move into a client island so the certification-type dropdown can
 * appear only when the document type is "Certification" (mirroring the worker Upload
 * Ticket flow), and so the title stops being required once a certification type will
 * supply the name. The rest of the form (dates, reminder lead, file, submit) stays in
 * the server-rendered form around this component.
 */
export function AddEquipmentDocumentFields({
  certificationTypes,
}: {
  certificationTypes: EquipmentCertificationTypeOption[];
}) {
  const [docType, setDocType] = useState<string>("registration");
  const isCertification = docType === "certification";

  return (
    <>
      <label className="space-y-2">
        <span className="text-sm font-medium text-[var(--ink)]">Title</span>
        <input
          className={inputClass}
          name="title"
          placeholder={isCertification ? "Optional when a certification type is chosen" : "Registration"}
          required={!isCertification}
        />
      </label>
      <label className="space-y-2">
        <span className="text-sm font-medium text-[var(--ink)]">Document type</span>
        <select
          className={inputClass}
          name="docType"
          onChange={(event) => setDocType(event.target.value)}
          value={docType}
        >
          {equipmentDocumentTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {isCertification ? (
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Certification type</span>
          <select className={inputClass} defaultValue="" name="certificationTypeId">
            <option value="">Choose a certification (or type a title above)</option>
            {certificationTypes.map((certificationType) => (
              <option key={certificationType.id} value={certificationType.id}>
                {certificationType.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-[var(--ink-muted)]">
            Picks the certification this file records: CVIP, picker inspection, tank or pressure test, and more. Add
            each one separately, so a unit can carry as many as it needs: a picker truck files both a CVIP and a picker
            inspection. Every certification is tracked on its own expiry and warns before the date you set below.
          </span>
        </label>
      ) : null}
    </>
  );
}
