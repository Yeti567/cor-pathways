import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, BadgeCheck, CheckCircle2, ExternalLink } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { fileAllReadyTickets, fileTicketItem, retryIntakeItem, skipIntakeItem } from "@/app/admin/intake/actions";
import { IntakeUploader } from "@/app/admin/intake/IntakeUploader";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { isIntakeReaderConfigured } from "@/lib/document-intake/extract";
import { INTAKE_BUCKET } from "@/lib/document-intake/storage";
import { loadTicketContext, personKey } from "@/lib/document-intake/ticket-process";
import type { TicketPerson } from "@/lib/document-intake/ticket-match";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// Add your people's tickets: the ticket half of the drop box.
//
// Drop the pile; each ticket is read, matched to a person and planned. A ticket whose name
// matched exactly one person, read twice the same way, can be saved with the others in one
// click. Every other one asks "Is this John Smith's ticket?" and nothing is saved until
// someone clicks Yes.

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type IntakeRow = Database["public"]["Tables"]["document_intake"]["Row"];

type TicketExtractionView = {
  candidates?: (TicketPerson & { key: string })[];
  document_kind?: string;
  expiry_date?: string | null;
  holder_name?: string | null;
  issued_date?: string | null;
  issuing_company?: string | null;
  match_status?: "matched" | "suggested" | "unmatched";
  person?: (TicketPerson & { key: string }) | null;
  ticket_name?: string | null;
};

type TicketProposalView = {
  action?: "attach" | "new" | "none";
  certificationTypeId?: string | null;
  detail?: string | null;
  expiresOn?: string | null;
  issuedOn?: string | null;
  name?: string;
  notes?: string[];
  targetRecordId?: string | null;
};

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]";
const primaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]";
const quietButton =
  "inline-flex h-11 items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function personLabel(person: Pick<TicketPerson, "carrier" | "fullName" | "kind">) {
  return person.kind === "contracted" ? `${person.fullName} (${person.carrier ?? "contractor"})` : person.fullName;
}

function Count({ label, tone, value }: { label: string; tone?: "good" | "warn"; value: number }) {
  const color = value === 0 ? "text-[var(--ink)]" : tone === "good" ? "text-[var(--success)]" : tone === "warn" ? "text-[var(--warning)]" : "text-[var(--ink)]";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-sm text-[var(--ink-muted)]">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export default async function TicketIntakePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const tenantId = context.appUser.tenant_id;
  const supabase = await createSupabaseServerClient();
  const tickets = () => supabase.from("document_intake").select("*").eq("tenant_id", tenantId).eq("subject", "ticket");

  const [statusResult, readyResult, reviewResult, otherResult, people] = await Promise.all([
    supabase.from("document_intake").select("status").eq("tenant_id", tenantId).eq("subject", "ticket").limit(5000),
    tickets().eq("status", "ready").order("created_at", { ascending: true }).limit(100).returns<IntakeRow[]>(),
    tickets().eq("status", "needs_review").order("created_at", { ascending: true }).limit(100).returns<IntakeRow[]>(),
    tickets().in("status", ["failed", "skipped"]).order("updated_at", { ascending: false }).limit(50).returns<IntakeRow[]>(),
    loadTicketContext(supabase, tenantId),
  ]);

  const counts = { failed: 0, filed: 0, needs_review: 0, queued: 0, ready: 0, reading: 0, skipped: 0 };

  for (const entry of statusResult.data ?? []) {
    counts[entry.status as keyof typeof counts] += 1;
  }

  const ready = readyResult.data ?? [];
  const review = reviewResult.data ?? [];
  const other = otherResult.data ?? [];
  const pending = counts.queued + counts.reading;
  const everyone = [...people.people].sort((a, b) => a.fullName.localeCompare(b.fullName));

  const previewUrls = new Map<string, string>();
  const paths = [...ready, ...review, ...other].map((row) => row.storage_path);

  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from(INTAKE_BUCKET).createSignedUrls(paths, 3600);

    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) {
        previewUrls.set(entry.path, entry.signedUrl);
      }
    }
  }

  return (
    <AdminShell eyebrow="Onboarding" tenantName={context.tenant?.name ?? "Company profile"} title="Add your people's tickets">
      {notice ? <p className="mb-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">{notice}</p> : null}
      {error ? <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">{error}</p> : null}

      <p className="mb-4 max-w-2xl text-sm text-[var(--ink-muted)]">
        Drop in everyone&rsquo;s tickets at once. Each one is read and matched to a person. When a name isn&rsquo;t a
        certain match, you&rsquo;ll be asked whose ticket it is, and nothing is saved until you say yes. People need to be in
        the app first:{" "}
        <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/people/add">
          add your people
        </Link>
        .
      </p>

      <IntakeUploader queuedCount={pending} readerConfigured={isIntakeReaderConfigured()} subject="ticket" tenantId={tenantId} />

      <div className="mt-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Count label="Being read" tone="warn" value={pending} />
        <Count label="Ready to save" tone="good" value={counts.ready} />
        <Count label="Need you" tone="warn" value={counts.needs_review} />
        <Count label="Saved" tone="good" value={counts.filed} />
        <Count label="Set aside or failed" tone="warn" value={counts.skipped + counts.failed} />
      </div>

      {ready.length > 0 ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Ready to save ({counts.ready})</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Each name matched exactly one person and the ticket read the same way twice. Look down the list, then save
                them all.
              </p>
            </div>
            <form action={fileAllReadyTickets}>
              <button className={primaryButton} type="submit">
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                Save all {Math.min(ready.length, 100)}
              </button>
            </form>
          </div>
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {ready.map((row) => {
              const extraction = (row.extraction ?? {}) as TicketExtractionView;
              const proposal = (row.proposal ?? {}) as TicketProposalView;
              const url = previewUrls.get(row.storage_path);

              return (
                <li className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm" key={row.id}>
                  <span>
                    <span className="font-semibold text-[var(--ink)]">{extraction.person ? personLabel(extraction.person) : "-"}</span>
                    <span className="text-[var(--ink)]"> · {proposal.name}</span>
                    <span className="text-[var(--ink-muted)]">{proposal.expiresOn ? ` · expires ${proposal.expiresOn}` : " · no expiry"}</span>
                    {(proposal.notes ?? []).map((note) => (
                      <span className="block text-xs text-[var(--warning)]" key={note}>
                        {note}
                      </span>
                    ))}
                  </span>
                  {url ? (
                    <a className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)] hover:underline" href={url} rel="noreferrer" target="_blank">
                      Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {review.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Need you ({counts.needs_review})</h2>
          <div className="mt-3 space-y-4">
            {review.map((row) => {
              const extraction = (row.extraction ?? {}) as TicketExtractionView;
              const proposal = (row.proposal ?? {}) as TicketProposalView;
              const url = previewUrls.get(row.storage_path);
              const refused = row.doc_type === "medical" || row.doc_type === "identity" || proposal.action === "none";
              const suggested = extraction.person ?? null;
              const likely = (extraction.candidates ?? []).filter((candidate) => candidate.key);
              const likelyKeys = new Set(likely.map((candidate) => candidate.key));

              return (
                <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" key={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="break-all text-sm font-semibold text-[var(--ink)]">{row.original_name}</h3>
                    {url ? (
                      <a className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)] hover:underline" href={url} rel="noreferrer" target="_blank">
                        Open the ticket <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>

                  {!refused ? (
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">
                      Read as: {extraction.ticket_name ?? "unknown ticket"}
                      {extraction.holder_name ? ` · name on it: "${extraction.holder_name}"` : ""}
                      {extraction.issuing_company ? ` · ${extraction.issuing_company}` : ""}
                    </p>
                  ) : null}

                  <ul className="mt-2 space-y-1">
                    {row.review_reasons.map((reason) => (
                      <li className="flex items-start gap-2 text-sm text-[var(--ink)]" key={reason}>
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
                        {reason}
                      </li>
                    ))}
                  </ul>

                  {refused ? (
                    <form action={skipIntakeItem} className="mt-3">
                      <input name="intakeId" type="hidden" value={row.id} />
                      <input name="from" type="hidden" value="tickets" />
                      <button className={quietButton} type="submit">
                        Set aside
                      </button>
                    </form>
                  ) : (
                    <form action={fileTicketItem} className="mt-3 grid gap-3">
                      <input name="intakeId" type="hidden" value={row.id} />
                      <input name="confirm" type="hidden" value="yes" />
                      <input name="targetRecordId" type="hidden" value={proposal.targetRecordId ?? ""} />
                      <input name="detail" type="hidden" value={proposal.detail ?? ""} />

                      <div className="rounded-md border border-[var(--primary)] bg-[var(--surface-muted)] p-3">
                        <p className="text-base font-semibold text-[var(--ink)]">
                          {suggested ? `Is this ${personLabel(suggested)}'s ticket?` : "Whose ticket is this?"}
                        </p>
                        <label className="mt-2 block">
                          <span className="sr-only">Person</span>
                          <select className={inputClass} defaultValue={suggested ? personKey(suggested) : ""} name="personKey" required>
                            <option value="">Choose the person…</option>
                            {likely.length > 0 ? (
                              <optgroup label="Most likely">
                                {likely.map((candidate) => (
                                  <option key={candidate.key} value={candidate.key}>
                                    {personLabel(candidate)}
                                  </option>
                                ))}
                              </optgroup>
                            ) : null}
                            <optgroup label="Everyone">
                              {everyone
                                .filter((person) => !likelyKeys.has(personKey(person)))
                                .map((person) => (
                                  <option key={personKey(person)} value={personKey(person)}>
                                    {personLabel(person)}
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                        </label>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="lg:col-span-2">
                          <span className="text-xs font-semibold text-[var(--ink-muted)]">Ticket</span>
                          <select className={inputClass} defaultValue={proposal.certificationTypeId ?? ""} name="certificationTypeId">
                            <option value="">Not on our list (use the name below)</option>
                            {people.types.map((type) => (
                              <option key={type.id} value={type.id}>
                                {type.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="lg:col-span-2">
                          <span className="text-xs font-semibold text-[var(--ink-muted)]">Name on the record</span>
                          <input className={inputClass} defaultValue={proposal.name ?? extraction.ticket_name ?? ""} name="name" />
                        </label>
                        <label>
                          <span className="text-xs font-semibold text-[var(--ink-muted)]">Issued</span>
                          <input className={inputClass} defaultValue={proposal.issuedOn ?? ""} name="issuedOn" type="date" />
                        </label>
                        <label>
                          <span className="text-xs font-semibold text-[var(--ink-muted)]">Expires</span>
                          <input className={inputClass} defaultValue={proposal.expiresOn ?? ""} name="expiresOn" type="date" />
                        </label>
                      </div>
                      {(proposal.notes ?? []).map((note) => (
                        <p className="text-xs text-[var(--warning)]" key={note}>
                          {note}
                        </p>
                      ))}

                      <div className="flex flex-wrap gap-3">
                        <button className={primaryButton} type="submit">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Yes, save it to this person
                        </button>
                      </div>
                    </form>
                  )}

                  {!refused ? (
                    <form action={skipIntakeItem} className="mt-2">
                      <input name="intakeId" type="hidden" value={row.id} />
                      <input name="from" type="hidden" value="tickets" />
                      <button className="text-sm font-semibold text-[var(--ink-muted)] underline" type="submit">
                        Set this one aside
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {other.length > 0 ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Set aside or could not be read</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {other.map((row) => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" key={row.id}>
                <span className="break-all text-[var(--ink)]">
                  {row.original_name}
                  <span className="block text-xs text-[var(--ink-muted)]">{row.error ?? row.review_reasons[0] ?? row.status}</span>
                </span>
                <form action={retryIntakeItem}>
                  <input name="intakeId" type="hidden" value={row.id} />
                  <input name="from" type="hidden" value="tickets" />
                  <button className="text-xs font-semibold text-[var(--primary)] hover:underline" type="submit">
                    Read it again
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </AdminShell>
  );
}
