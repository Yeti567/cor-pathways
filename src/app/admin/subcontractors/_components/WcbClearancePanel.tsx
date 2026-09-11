import { FileUp, Paperclip, Trash2 } from "lucide-react";
import { fileSubcontractorDocument, removeSubcontractorDocument } from "@/app/admin/subcontractors/actions";
import {
  getSubcontractorDocumentStatus,
  type ResolvedSubcontractorSlot,
} from "@/lib/subcontractor-requirements";
import {
  WCB_JURISDICTIONS,
  wcbClearanceRowTone,
  wcbClearanceSlotKey,
  wcbJurisdictionFromSlotKey,
  wcbJurisdictionLabel,
} from "@/lib/wcb-jurisdictions";
import type { Database } from "@/types/database";

type DocumentRow = Database["public"]["Tables"]["subcontractor_document"]["Row"];

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const labelClass = "space-y-2";
const labelTextClass = "text-sm font-medium text-[var(--ink)]";

const toneClass = {
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  muted: "bg-[var(--surface-muted)] text-[var(--ink-muted)] border-[var(--border)]",
  red: "bg-red-50 text-red-700 border-red-200",
} as const;

/**
 * The WCB clearance jurisdictions, as one panel with one upload form.
 *
 * WHY NOT SIX PANELS. Six slots rendered through the page's normal per-slot loop would
 * put six near-identical upload forms on the screen, and the WCB section would run
 * longer than the rest of the carrier's file put together. What the office actually does
 * is hold a letter and need to say which board issued it, so the jurisdiction is a FIELD
 * on one form rather than a choice of which of six forms to open.
 *
 * The dropdown writes `slotKey`, the same field the hidden input on every other slot
 * writes. So the server action, its validation, the supersede logic and the bulk loader
 * all see exactly what they saw before, and none of them had to learn what a
 * jurisdiction is.
 *
 * WHICH ROWS SHOW. The ones that COUNT plus the ones that EXIST: a jurisdiction this
 * carrier is expected to cover, or one that already has a letter filed. A province
 * nobody has claimed and nobody has filed stays out of the way, while still being in the
 * dropdown so the first one can be filed.
 */
export function WcbClearancePanel({
  historyBySlot,
  jurisdictionSlots,
  liveBySlot,
  reusableFiles,
  signedUrlByPath,
  subcontractorId,
}: {
  historyBySlot: Map<string, DocumentRow[]>;
  jurisdictionSlots: ResolvedSubcontractorSlot[];
  liveBySlot: Map<string, DocumentRow>;
  reusableFiles: { path: string; slotKey: string }[];
  signedUrlByPath: Map<string, string>;
  subcontractorId: string;
}) {
  if (jurisdictionSlots.length === 0) {
    return null;
  }

  const visible = jurisdictionSlots.filter((slot) => slot.required || liveBySlot.has(slot.key));

  return (
    <article aria-label="WCB clearance certificates" className="px-4 py-4">
      <div className="min-w-0">
        <p className="text-base font-semibold text-[var(--ink)]">WCB clearance certificates</p>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
          Workers&rsquo; compensation is provincial, so a clearance letter proves one board&rsquo;s account is in good
          standing and says nothing about any other. Set the jurisdictions this carrier runs in on their details, and
          each one is then tracked and chased on its own.
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-muted)]">
          No jurisdictions set for this carrier yet. Choose them under their details, or file a letter below and pick
          the province it came from.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {visible.map((slot) => {
            const jurisdiction = wcbJurisdictionFromSlotKey(slot.key);
            const live = liveBySlot.get(slot.key) ?? null;
            const history = historyBySlot.get(slot.key) ?? [];
            const status = live
              ? getSubcontractorDocumentStatus({ dueDate: live.due_date, reminderLeadDays: slot.reminderLeadDays })
              : null;

            const tone = wcbClearanceRowTone({
              hasDocument: live !== null,
              required: slot.required,
              statusTone: status?.tone ?? null,
            });

            const signedUrl = live?.storage_path ? signedUrlByPath.get(live.storage_path) : undefined;

            return (
              <li className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3" key={slot.key}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      {jurisdiction ? wcbJurisdictionLabel(jurisdiction) : slot.label}
                      {slot.required ? null : (
                        <span className="ml-2 text-xs font-normal text-[var(--ink-muted)]">
                          Not one of their jurisdictions
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                      {live
                        ? [
                            live.due_date ? `Expires ${live.due_date}` : "No expiry recorded",
                            live.issued_date ? `Issued ${live.issued_date}` : null,
                            live.document_number ? `Account ${live.document_number}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "Nothing on file"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${toneClass[tone]}`}
                    >
                      {live ? (status?.state === "current" ? "On file" : (status?.label ?? "On file")) : "Not on file"}
                    </span>
                    {signedUrl ? (
                      <a
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
                        href={signedUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <Paperclip className="h-4 w-4" aria-hidden="true" />
                        View
                      </a>
                    ) : null}
                    {live ? (
                      <form action={removeSubcontractorDocument}>
                        <input name="subcontractorId" type="hidden" value={subcontractorId} />
                        <input name="documentId" type="hidden" value={live.id} />
                        <button
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--danger)] transition hover:bg-red-50"
                          type="submit"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
                {history.length > 0 ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--primary)]">
                      Earlier copies ({history.length})
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {history.map((document) => (
                        <li className="text-xs text-[var(--ink-muted)]" key={document.id}>
                          {document.issued_date ? `Issued ${document.issued_date}` : "No issue date"}
                          {document.due_date ? ` · was due ${document.due_date}` : ""}
                          {document.superseded_by_id ? " · replaced" : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--primary)]">
          File a clearance certificate
        </summary>
        <form action={fileSubcontractorDocument} className="mt-3 space-y-3">
          <input name="subcontractorId" type="hidden" value={subcontractorId} />
          <label className={labelClass}>
            <span className={labelTextClass}>Which board issued it</span>
            <select className={inputClass} defaultValue="" name="slotKey" required>
              <option disabled value="">
                Choose a province or territory
              </option>
              {WCB_JURISDICTIONS.map((jurisdiction) => (
                <option key={jurisdiction.code} value={wcbClearanceSlotKey(jurisdiction.code)}>
                  {jurisdiction.label} ({jurisdiction.board})
                </option>
              ))}
            </select>
            <span className="block text-xs text-[var(--ink-muted)]">
              The letter is filed against this jurisdiction and renews on its own clock. Filing one for a province
              that is not on their list keeps it on file without counting it as a requirement.
            </span>
          </label>
          <label className={labelClass}>
            <span className={labelTextClass}>File</span>
            <input
              accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.doc,.docx"
              className={inputClass}
              name="file"
              type="file"
            />
          </label>
          {reusableFiles.length > 0 ? (
            <label className={labelClass}>
              <span className={labelTextClass}>Or reuse a file already uploaded</span>
              <select className={inputClass} defaultValue="" name="reuseStoragePath">
                <option value="">Upload a new file</option>
                {reusableFiles.map((entry) => (
                  <option key={entry.path} value={entry.path}>
                    {entry.path.split("/").pop()}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={labelTextClass}>Issued (optional)</span>
              <input className={inputClass} name="issuedDate" type="date" />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Expires</span>
              <input className={inputClass} name="expiryDate" required type="date" />
            </label>
          </div>
          <label className={labelClass}>
            <span className={labelTextClass}>WCB account number</span>
            <input className={inputClass} name="wcbAccount" type="text" />
            <span className="block text-xs text-[var(--ink-muted)]">
              Each board issues its own account number, so this is the one printed on this letter.
            </span>
          </label>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
            type="submit"
          >
            <FileUp className="h-4 w-4" aria-hidden="true" />
            File clearance certificate
          </button>
        </form>
      </details>
    </article>
  );
}
