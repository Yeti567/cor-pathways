"use client";

import { CheckCircle2, Save } from "lucide-react";
import { useState } from "react";
import { attachEquipmentDocumentProof, createEquipmentDocument, waiveUnitCertification } from "@/app/admin/actions";
import { EquipmentAttachmentUploadField } from "@/app/admin/equipment/[equipmentId]/EquipmentAttachmentUploadField";
import { equipmentAttachmentMimeTypes } from "@/lib/equipment";
import type { FinishTask } from "@/lib/unit-finish";

// One thing a unit still needs, with the box to answer it right there. The person never
// has to know which table a CVIP lives in or that a scan belongs on the row that is
// waiting for it: the card already knows, and posts to the action that does it.

type Props = {
  description: string;
  equipmentId: string;
  returnTo: string;
  task: FinishTask;
  tenantId: string;
  unitLabel: string;
};

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const submitClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:opacity-60";

function tone(task: FinishTask) {
  if (task.state === "missing" || task.state === "expired") {
    return { border: "border-l-[var(--danger)]", chip: "bg-red-50 text-[var(--danger)]", word: task.state === "missing" ? "Missing" : "Expired" };
  }

  if (task.canWait) {
    return { border: "border-l-[var(--success)]", chip: "bg-emerald-50 text-[var(--success)]", word: "Renew soon" };
  }

  return { border: "border-l-[var(--warning)]", chip: "bg-amber-50 text-[var(--warning)]", word: "Needs the document" };
}

export function FinishTaskCard({ description, equipmentId, returnTo, task, tenantId, unitLabel }: Props) {
  const [waiving, setWaiving] = useState(false);
  const look = tone(task);
  const attach = task.mode === "attach" && task.documentId;

  return (
    <li className={`rounded-lg border border-[var(--border)] border-l-4 ${look.border} bg-[var(--surface)] p-4 shadow-sm`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--ink)]">{task.label}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${look.chip}`}>{look.word}</span>
      </div>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">{description}</p>

      <form action={attach ? attachEquipmentDocumentProof : createEquipmentDocument} className="mt-3 grid gap-3">
        <input name="equipmentId" type="hidden" value={equipmentId} />
        <input name="returnTo" type="hidden" value={returnTo} />
        {attach ? (
          <input name="documentId" type="hidden" value={task.documentId ?? ""} />
        ) : (
          <>
            <input name="docType" type="hidden" value={task.docType} />
            <input name="title" type="hidden" value={task.label} />
            <input name="certificationTypeId" type="hidden" value={task.certificationTypeId ?? ""} />
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--ink)]">Date issued or inspected</span>
            <input className={inputClass} defaultValue={attach ? (task.issuedDate ?? "") : ""} name="issuedDate" type="date" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--ink)]">Expiry date</span>
            <input className={inputClass} defaultValue={attach ? (task.expiryDate ?? "") : ""} name="expiryDate" type="date" />
            <span className="block text-xs text-[var(--ink-muted)]">Leave it empty if the document does not expire.</span>
          </label>
        </div>

        <EquipmentAttachmentUploadField
          accept="application/pdf,image/*"
          allowedMimeTypes={equipmentAttachmentMimeTypes}
          equipmentId={equipmentId}
          folder="documents"
          hint="A PDF, a scan, or a photo taken with your phone."
          inputClass={inputClass}
          label="The document"
          submitClass={submitClass}
          submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
          submitLabel="Save"
          tenantId={tenantId}
        />
      </form>

      {task.waivable ? (
        waiving ? (
          <form action={waiveUnitCertification} className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <input name="equipmentId" type="hidden" value={equipmentId} />
            <input name="certificationTypeId" type="hidden" value={task.certificationTypeId ?? ""} />
            <input name="returnTo" type="hidden" value={returnTo} />
            <label className="flex items-start gap-2 text-sm text-[var(--ink)]">
              <input className="mt-1 h-4 w-4" name="confirm" required type="checkbox" value="yes" />
              <span>
                Yes, {unitLabel} does not need a {task.label.toLowerCase()}. It will stop being asked for on this unit, and
                your name is recorded with this answer.
              </span>
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={submitClass} type="submit">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Confirm
              </button>
              <button
                className="h-11 rounded-md px-3 text-sm font-semibold text-[var(--ink-muted)] underline"
                onClick={() => setWaiving(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            className="mt-3 text-sm font-semibold text-[var(--ink-muted)] underline transition hover:text-[var(--ink)]"
            onClick={() => setWaiving(true)}
            type="button"
          >
            This unit doesn&rsquo;t have one
          </button>
        )
      ) : null}
    </li>
  );
}
