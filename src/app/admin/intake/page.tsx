import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, BadgeCheck, ExternalLink } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { isIntakeReaderConfigured } from "@/lib/document-intake/extract";
import type { GroundingResult } from "@/lib/document-intake/ground";
import type { EquipmentDocType, FilingProposal } from "@/lib/document-intake/plan";
import type { IntakeExtraction } from "@/lib/document-intake/schema";
import { INTAKE_BUCKET } from "@/lib/document-intake/storage";
import { hasAttachedProof } from "@/lib/proof-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { fileAllReady, fileIntakeItem, retryIntakeItem, skipIntakeItem } from "./actions";
import { IntakeUploader } from "./IntakeUploader";

export const dynamic = "force-dynamic";
// Server Actions on this page file up to 100 documents in one click.
export const maxDuration = 120;

// Bulk document onboarding.
//
// The client hands over a pile; the app reads each file, works out what it is and which
// unit it belongs to, and offers the filing. Confident ones are one click for the whole
// list. Doubtful ones say why, in plain words, and wait for a person. Nothing is filed
// without one: the document is the proof, and a registration filed on the wrong trailer
// reads green and cannot be told from a right one until an auditor pulls it.

type IntakeRow = Database["public"]["Tables"]["document_intake"]["Row"];
type UnitOption = { id: string; license_plate: string | null; unit_number: string; vin_or_serial: string | null };
type WaitingDocument = { doc_type: string; equipment_id: string; id: string; title: string };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const DOC_TYPE_LABELS: Record<EquipmentDocType, string> = {
  certification: "Certification",
  cvip: "CVIP",
  insurance: "Insurance",
  other: "Other",
  permit: "Permit",
  registration: "Registration",
};

const inputClass = "w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-[var(--ink)]";
const primaryButton =
  "inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white";
const quietButton =
  "inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--ink)]";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function unitLabel(unit: UnitOption) {
  return unit.license_plate ? `${unit.unit_number} · ${unit.license_plate}` : unit.unit_number;
}

function proposalOf(row: IntakeRow) {
  return (row.proposal ?? {}) as Partial<FilingProposal> & { notes?: string[] };
}

function extractionOf(row: IntakeRow) {
  return (row.extraction ?? {}) as Partial<IntakeExtraction> & {
    confirmation?: "text" | "second_read" | "none";
    grounding?: GroundingResult;
    matched_on?: string[];
  };
}

// Whether the values read off the file were also looked up in the PDF's own text. A scan or
// a photo has no text layer, so it says so instead of implying a check that did not happen.
function checkLabel(row: IntakeRow) {
  const extraction = extractionOf(row);

  if (extraction.grounding?.checked && extraction.grounding.lookedUp) {
    return "Checked against the PDF's text";
  }

  return extraction.confirmation === "second_read" ? "Read twice, both readings agreed" : "Scan: not cross-checked";
}

function Count({ label, tone, value }: { label: string; tone?: "warn" | "good"; value: number }) {
  const color =
    value > 0 && tone === "warn" ? "text-[var(--warning)]" : value > 0 && tone === "good" ? "text-[var(--success)]" : "text-[var(--ink)]";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-sm text-[var(--ink-muted)]">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export default async function IntakePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const tenantId = context.appUser.tenant_id;
  const supabase = await createSupabaseServerClient();

  const [statusResult, readyResult, reviewResult, otherResult, filedResult, unitResult, typeResult] = await Promise.all([
    supabase.from("document_intake").select("status").eq("tenant_id", tenantId)
      .eq("subject", "unit").limit(5000),
    supabase
      .from("document_intake")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("subject", "unit")
      .eq("status", "ready")
      .order("created_at", { ascending: true })
      .limit(100)
      .returns<IntakeRow[]>(),
    supabase
      .from("document_intake")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("subject", "unit")
      .eq("status", "needs_review")
      .order("created_at", { ascending: true })
      .limit(100)
      .returns<IntakeRow[]>(),
    supabase
      .from("document_intake")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("subject", "unit")
      .in("status", ["failed", "skipped"])
      .order("updated_at", { ascending: false })
      .limit(50)
      .returns<IntakeRow[]>(),
    supabase
      .from("document_intake")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("subject", "unit")
      .eq("status", "filed")
      .order("filed_at", { ascending: false })
      .limit(25)
      .returns<IntakeRow[]>(),
    supabase
      .from("equipment")
      .select("id, unit_number, license_plate, vin_or_serial")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("unit_number", { ascending: true })
      .limit(1000)
      .returns<UnitOption[]>(),
    supabase
      .from("equipment_certification_types")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
  ]);

  const counts = { failed: 0, filed: 0, needs_review: 0, queued: 0, ready: 0, reading: 0, skipped: 0 };

  for (const entry of statusResult.data ?? []) {
    counts[entry.status as keyof typeof counts] += 1;
  }

  const ready = readyResult.data ?? [];
  const review = reviewResult.data ?? [];
  const other = otherResult.data ?? [];
  const filed = filedResult.data ?? [];
  const units = unitResult.data ?? [];
  const certificationTypes = typeResult.data ?? [];
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const pending = counts.queued + counts.reading;

  // The rows a scan could land on, for the units the files were matched to.
  const unitIds = [...new Set([...ready, ...review].map((row) => row.equipment_id).filter((id): id is string => Boolean(id)))];
  const waitingByUnit = new Map<string, WaitingDocument[]>();

  if (unitIds.length > 0) {
    const { data: documents } = await supabase
      .from("equipment_document")
      .select("id, equipment_id, doc_type, title, attachment_ids")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .in("equipment_id", unitIds)
      .returns<(WaitingDocument & { attachment_ids: string[] | null })[]>();

    for (const document of documents ?? []) {
      if (!hasAttachedProof(document.attachment_ids)) {
        waitingByUnit.set(document.equipment_id, [...(waitingByUnit.get(document.equipment_id) ?? []), document]);
      }
    }
  }

  // One-hour links so a reviewer can open the original beside the decision.
  const previewPaths = [...ready, ...review, ...other].map((row) => row.storage_path);
  const previewUrls = new Map<string, string>();

  if (previewPaths.length > 0) {
    const { data: signed } = await supabase.storage.from(INTAKE_BUCKET).createSignedUrls(previewPaths, 3600);

    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) {
        previewUrls.set(entry.path, entry.signedUrl);
      }
    }
  }

  return (
    <AdminShell eyebrow="Onboarding" tenantName={context.tenant?.name ?? "Company profile"} title="Document intake">
      {notice ? (
        <p className="mb-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {!isIntakeReaderConfigured() ? (
        <p className="mb-4 rounded-md border border-[var(--warning)] bg-amber-50 p-3 text-sm text-[var(--ink)]">
          The document reader is not set up for this company yet. Files can be uploaded and will wait; reading starts once
          the API key is added.
        </p>
      ) : null}

      <IntakeUploader queuedCount={pending} readerConfigured={isIntakeReaderConfigured()} tenantId={tenantId} />

      <div className="mt-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Count label="Received" value={total} />
        <Count label="Being read" tone="warn" value={pending} />
        <Count label="Ready to file" tone="good" value={counts.ready} />
        <Count label="Need you" tone="warn" value={counts.needs_review} />
        <Count label="Filed" tone="good" value={counts.filed} />
        <Count label="Set aside or failed" tone="warn" value={counts.skipped + counts.failed} />
      </div>

      <p className="mt-3 text-xs text-[var(--ink-muted)]">
        A load is done when &ldquo;Being read&rdquo;, &ldquo;Ready to file&rdquo; and &ldquo;Need you&rdquo; all read 0. Check
        the result against{" "}
        <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/needs-document">
          Needs Document
        </Link>
        , which lists every record still waiting on its scan. Filed documents live with their unit; nothing is kept here
        except this receipt.
      </p>
      <p className="mt-2 text-sm text-[var(--ink)]">
        When this pile is done,{" "}
        <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/equipment/finish">
          Finish your units
        </Link>{" "}
        takes you through whatever each unit still needs, one unit at a time, until it turns green.
      </p>

      {ready.length > 0 ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Ready to file ({counts.ready})</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Each was read clearly and matched to exactly one unit. Look down the list, then file them all.
              </p>
            </div>
            <form action={fileAllReady}>
              <button className={primaryButton} type="submit">
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                File all {Math.min(ready.length, 100)} ready
              </button>
            </form>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-[var(--ink-muted)]">
                <tr>
                  <th className="py-2 pr-3">File</th>
                  <th className="py-2 pr-3">Unit</th>
                  <th className="py-2 pr-3">Filing</th>
                  <th className="py-2 pr-3">Dates</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {ready.map((row) => {
                  const proposal = proposalOf(row);
                  const unit = row.equipment_id ? unitById.get(row.equipment_id) : null;
                  const url = previewUrls.get(row.storage_path);

                  return (
                    <tr className="border-t border-[var(--border)] align-top" key={row.id}>
                      <td className="max-w-[16rem] truncate py-2 pr-3 text-[var(--ink)]" title={row.original_name}>
                        {row.original_name}
                        <span className="block text-xs text-[var(--ink-muted)]">{checkLabel(row)}</span>
                      </td>
                      <td className="py-2 pr-3 font-semibold text-[var(--ink)]">{unit ? unitLabel(unit) : "-"}</td>
                      <td className="py-2 pr-3 text-[var(--ink)]">
                        {proposal.docType ? DOC_TYPE_LABELS[proposal.docType] : "-"}
                        <span className="block text-xs text-[var(--ink-muted)]">
                          {proposal.action === "attach_to_existing" ? "Fills the row waiting for it" : "Adds a new document"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[var(--ink)]">
                        {proposal.expiryDate ? `Expires ${proposal.expiryDate}` : "No expiry"}
                        {(proposal.notes ?? []).map((note) => (
                          <span className="block text-xs text-[var(--warning)]" key={note}>
                            {note}
                          </span>
                        ))}
                      </td>
                      <td className="py-2 text-right">
                        {url ? (
                          <a
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)] hover:underline"
                            href={url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {review.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Need you ({counts.needs_review})</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            The reason is shown on each. Open the original, correct anything that is wrong, and file it, or set it aside.
          </p>

          <div className="mt-3 space-y-4">
            {review.map((row) => {
              const proposal = proposalOf(row);
              const extraction = extractionOf(row);
              const url = previewUrls.get(row.storage_path);
              const selectedUnit = row.equipment_id ?? "";
              const waiting = row.equipment_id ? (waitingByUnit.get(row.equipment_id) ?? []) : [];
              const refused = row.doc_type === "medical" || row.doc_type === "driver_personal";

              return (
                <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" key={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="break-all text-sm font-semibold text-[var(--ink)]">{row.original_name}</h3>
                    {url ? (
                      <a
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)] hover:underline"
                        href={url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open original <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>

                  <ul className="mt-2 space-y-1">
                    {row.review_reasons.map((reason) => (
                      <li className="flex items-start gap-2 text-sm text-[var(--ink)]" key={reason}>
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
                        {reason}
                      </li>
                    ))}
                  </ul>

                  {!refused ? (
                    <p className="mt-2 text-xs text-[var(--ink-muted)]">
                      Read as: {extraction.document_kind ?? "unknown"}
                      {extraction.vin ? ` · VIN ${extraction.vin}` : ""}
                      {extraction.license_plate ? ` · plate ${extraction.license_plate}` : ""}
                      {extraction.unit_number ? ` · unit ${extraction.unit_number}` : ""}
                      {typeof extraction.confidence === "number" ? ` · ${Math.round(extraction.confidence * 100)}% sure` : ""}
                      {` · ${checkLabel(row)}`}
                    </p>
                  ) : null}

                  {refused ? (
                    <form action={skipIntakeItem} className="mt-3">
                      <input name="intakeId" type="hidden" value={row.id} />
                      <button className={quietButton} type="submit">
                        Set aside
                      </button>
                    </form>
                  ) : (
                    <form action={fileIntakeItem} className="mt-3 grid gap-3 md:grid-cols-6">
                      <input name="intakeId" type="hidden" value={row.id} />

                      <label className="md:col-span-2">
                        <span className="text-xs font-semibold text-[var(--ink-muted)]">Unit</span>
                        <select className={inputClass} defaultValue={selectedUnit} name="equipmentId" required>
                          <option value="">Choose a unit…</option>
                          {units.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unitLabel(unit)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span className="text-xs font-semibold text-[var(--ink-muted)]">Type</span>
                        <select className={inputClass} defaultValue={proposal.docType ?? "other"} name="docType">
                          {(Object.keys(DOC_TYPE_LABELS) as EquipmentDocType[]).map((type) => (
                            <option key={type} value={type}>
                              {DOC_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="md:col-span-3">
                        <span className="text-xs font-semibold text-[var(--ink-muted)]">Certification type (certifications only)</span>
                        <select className={inputClass} defaultValue={proposal.certificationTypeId ?? ""} name="certificationTypeId">
                          <option value="">None</option>
                          {certificationTypes.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="md:col-span-3">
                        <span className="text-xs font-semibold text-[var(--ink-muted)]">Put it on</span>
                        <select
                          className={inputClass}
                          defaultValue={proposal.action === "attach_to_existing" ? (proposal.targetDocumentId ?? "new") : "new"}
                          name="targetDocumentId"
                        >
                          <option value="new">Add as a new document</option>
                          {waiting.map((document) => (
                            <option key={document.id} value={document.id}>
                              Row waiting for its scan: {document.title}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="md:col-span-3">
                        <span className="text-xs font-semibold text-[var(--ink-muted)]">Title</span>
                        <input className={inputClass} defaultValue={proposal.title ?? ""} name="title" required />
                      </label>

                      <label className="md:col-span-1">
                        <span className="text-xs font-semibold text-[var(--ink-muted)]">Issued</span>
                        <input className={inputClass} defaultValue={proposal.issuedDate ?? ""} name="issuedDate" type="date" />
                      </label>

                      <label className="md:col-span-2">
                        <span className="text-xs font-semibold text-[var(--ink-muted)]">Expires (blank if it does not)</span>
                        <input className={inputClass} defaultValue={proposal.expiryDate ?? ""} name="expiryDate" type="date" />
                      </label>

                      <div className="flex items-end gap-2 md:col-span-6">
                        <button className={primaryButton} type="submit">
                          File it
                        </button>
                        <button className={quietButton} formAction={skipIntakeItem} formNoValidate type="submit">
                          Set aside
                        </button>
                      </div>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {other.length > 0 ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Set aside or failed ({other.length})</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {other.map((row) => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" key={row.id}>
                <span className="min-w-0">
                  <span className="block break-all font-semibold text-[var(--ink)]">{row.original_name}</span>
                  <span className="block text-xs text-[var(--ink-muted)]">
                    {row.status === "failed" ? "Could not be read" : "Set aside"}
                    {row.error || row.review_reasons[0] ? `: ${row.error ?? row.review_reasons[0]}` : ""}
                  </span>
                </span>
                <form action={retryIntakeItem}>
                  <input name="intakeId" type="hidden" value={row.id} />
                  <button className={quietButton} type="submit">
                    Read again
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {filed.length > 0 ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Recently filed</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {filed.map((row) => {
              const unit = row.equipment_id ? unitById.get(row.equipment_id) : null;

              return (
                <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" key={row.id}>
                  <span className="break-all text-[var(--ink)]">{row.original_name}</span>
                  {unit && row.equipment_id ? (
                    <Link
                      className="font-semibold text-[var(--primary)] hover:underline"
                      href={`/admin/equipment/${row.equipment_id}?tab=documents`}
                    >
                      {unitLabel(unit)}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </AdminShell>
  );
}
