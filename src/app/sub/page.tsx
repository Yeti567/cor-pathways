import { FileUp, LogOut, ShieldCheck } from "lucide-react";
import { signOut } from "@/app/actions";
import { submitSubcontractorDocument, updateSubcontractorContactDetails } from "@/app/sub/actions";
import { requireSubcontractorUser } from "@/lib/current-user";
import {
  getSubcontractorDocumentStatus,
  resolveSubcontractorSlots,
  slotCaptures,
  summariseSubcontractorCompliance,
  SUBCONTRACTOR_SLOT_GROUPS,
  type ResolvedSubcontractorSlot,
  type SubcontractorRequirementSetting,
} from "@/lib/subcontractor-requirements";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type SubcontractorRow = Database["public"]["Tables"]["subcontractor"]["Row"];
type DocumentRow = Database["public"]["Tables"]["subcontractor_document"]["Row"];
type SettingRow = Database["public"]["Tables"]["subcontractor_requirement_setting"]["Row"];

const toneClass = {
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  muted: "bg-[var(--surface-muted)] text-[var(--ink-muted)] border-[var(--border)]",
  red: "bg-red-50 text-red-700 border-red-200",
} as const;

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const labelClass = "space-y-2";
const labelTextClass = "text-sm font-medium text-[var(--ink)]";

function money(value: number | null) {
  if (value === null) {
    return null;
  }

  return new Intl.NumberFormat("en-CA", { currency: "CAD", maximumFractionDigits: 0, style: "currency" }).format(value);
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The upload form for one requirement, rendered from the slot definition.
 *
 * Asks the carrier only for what is printed on the paperwork in front of them. Nothing
 * judgemental is collected here: the safety rating and the WCB rates are read off the
 * document by whoever reviews it, because a carrier grading itself is not evidence.
 */
function PortalSlotForm({ slot, subcontractorId }: { slot: ResolvedSubcontractorSlot; subcontractorId: string }) {
  return (
    <form action={submitSubcontractorDocument} className="mt-3 space-y-3">
      <input name="subcontractorId" type="hidden" value={subcontractorId} />
      <input name="slotKey" type="hidden" value={slot.key} />

      <label className={labelClass}>
        <span className={labelTextClass}>Your file</span>
        <input
          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.doc,.docx"
          className={inputClass}
          name="file"
          required
          type="file"
        />
        <span className="block text-xs text-[var(--ink-muted)]">A PDF from your broker, or a clear photo.</span>
      </label>

      {slot.dueMode !== "none" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            <span className={labelTextClass}>Issued{slot.dueMode === "interval" ? "" : " (optional)"}</span>
            <input className={inputClass} name="issuedDate" required={slot.dueMode === "interval"} type="date" />
          </label>
          {slot.dueMode === "expiry" ? (
            <label className={labelClass}>
              <span className={labelTextClass}>Expires</span>
              <input className={inputClass} name="expiryDate" required type="date" />
            </label>
          ) : null}
        </div>
      ) : null}

      {slotCaptures(slot, "policy_number") || slotCaptures(slot, "nsc_number") ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            <span className={labelTextClass}>{slotCaptures(slot, "nsc_number") ? "NSC number" : "Policy number"}</span>
            <input className={inputClass} name="documentNumber" />
          </label>
          {slotCaptures(slot, "insurer") ? (
            <label className={labelClass}>
              <span className={labelTextClass}>Insurer</span>
              <input className={inputClass} name="insurer" />
            </label>
          ) : null}
        </div>
      ) : null}

      {slotCaptures(slot, "coverage_amount") ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            <span className={labelTextClass}>Coverage limit</span>
            <input
              className={inputClass}
              inputMode="decimal"
              min="0"
              name="coverageAmount"
              placeholder={slot.minimumCoverageAmount !== null ? String(slot.minimumCoverageAmount) : "2000000"}
              step="1"
              type="number"
            />
          </label>
          {slotCaptures(slot, "deductible") ? (
            <label className={labelClass}>
              <span className={labelTextClass}>Deductible</span>
              <input className={inputClass} inputMode="decimal" min="0" name="deductibleAmount" step="1" type="number" />
            </label>
          ) : null}
        </div>
      ) : null}

      {slotCaptures(slot, "additional_insured") ? (
        <label className="flex items-start gap-2">
          <input className="h-4 w-4 rounded border-[var(--border)] text-[var(--primary)]" name="additionalInsured" type="checkbox" />
          <span className="text-sm text-[var(--ink)]">This policy names them as additional insured</span>
        </label>
      ) : null}

      <button
        className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
        type="submit"
      >
        <FileUp className="h-4 w-4" aria-hidden="true" />
        Send it
      </button>
    </form>
  );
}

/**
 * The hiring company's name, and only their name.
 *
 * A carrier needs to know who is asking, but public.tenants also holds the plan, the
 * subscription status, and that company's own safety fitness details. Rather than grant
 * a select policy over all of that and rely on never selecting the wrong column, the one
 * field the portal displays is fetched server side with the service role, keyed on a
 * tenant id that came from the carrier's own access row.
 */
async function fetchHiringCompanyNames(tenantIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  if (tenantIds.length === 0) {
    return names;
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return names;
  }

  const { data } = await admin.from("tenants").select("id, name").in("id", tenantIds);

  for (const row of data ?? []) {
    names.set(row.id, row.name);
  }

  return names;
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SubcontractorPortalPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireSubcontractorUser();
  const supabase = await createSupabaseServerClient();

  const subcontractorIds = context.access.map((row) => row.subcontractor_id);
  const tenantIds = [...new Set(context.access.map((row) => row.tenant_id))];

  // Every one of these reads is filtered again by row level security. The explicit
  // .in() is not the security boundary, it is just how the right rows are asked for.
  const [{ data: carriers }, { data: documents }, { data: settings }, companyNames] = await Promise.all([
    supabase.from("subcontractor").select("*").in("id", subcontractorIds).returns<SubcontractorRow[]>(),
    supabase
      .from("subcontractor_document")
      .select("*")
      .in("subcontractor_id", subcontractorIds)
      .is("deleted_at", null)
      .returns<DocumentRow[]>(),
    supabase
      .from("subcontractor_requirement_setting")
      .select("*")
      .in("tenant_id", tenantIds)
      .returns<SettingRow[]>(),
    fetchHiringCompanyNames(tenantIds),
  ]);

  const carrierRows = carriers ?? [];
  const documentRows = documents ?? [];
  const settingRows = settings ?? [];

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--primary)]">Carrier portal</p>
            <h1 className="mt-1 text-2xl font-bold text-[var(--ink)]">{context.subcontractorUser.full_name}</h1>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{context.subcontractorUser.email}</p>
          </div>
          <form action={signOut}>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              type="submit"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        {notice ? (
          <p className="rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">{error}</p>
        ) : null}

        {carrierRows.length === 0 ? (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <p className="text-sm text-[var(--ink-muted)]">
              Nothing is assigned to this login yet. If you were expecting to file documents, contact the company that
              invited you.
            </p>
          </section>
        ) : null}

        {carrierRows.map((carrier) => {
          const access = context.access.find((row) => row.subcontractor_id === carrier.id);
          const companyName = access ? (companyNames.get(access.tenant_id) ?? "the hiring company") : "the hiring company";
          const carrierSettings: SubcontractorRequirementSetting[] = settingRows
            .filter((row) => row.tenant_id === access?.tenant_id)
            .map((row) => ({
              enabled: row.enabled,
              intervalMonths: row.interval_months,
              minimumCoverageAmount: row.minimum_coverage_amount === null ? null : Number(row.minimum_coverage_amount),
              reminderLeadDays: row.reminder_lead_days,
              required: row.required,
              slotKey: row.slot_key,
            }));
          const slots = resolveSubcontractorSlots(carrierSettings);
          const carrierDocuments = documentRows.filter((row) => row.subcontractor_id === carrier.id);
          const summary = summariseSubcontractorCompliance(
            carrierDocuments.map((document) => ({
              coverageAmount: document.coverage_amount === null ? null : Number(document.coverage_amount),
              dueDate: document.due_date,
              reviewStatus: document.review_status,
              slotKey: document.slot_key,
            })),
            slots,
          );
          const underLimitSlotKeys = new Set(summary.underLimit.map((entry) => entry.slot.key));
          // What is actually on file, and what is merely sent, are different things and
          // have to stay separate. Grouping them together let an upload awaiting review
          // paint the slot as received, which is the single most misleading thing this
          // page could say: the carrier stops chasing, and the hiring company still has
          // nothing. Only an approved document counts as cover.
          const liveBySlot = new Map<string, DocumentRow>();
          const pendingBySlot = new Map<string, DocumentRow>();
          const rejectedBySlot = new Map<string, DocumentRow>();

          for (const document of carrierDocuments) {
            if (document.review_status === "pending") {
              if (!pendingBySlot.has(document.slot_key)) {
                pendingBySlot.set(document.slot_key, document);
              }

              continue;
            }

            if (document.review_status === "rejected") {
              if (!rejectedBySlot.has(document.slot_key)) {
                rejectedBySlot.set(document.slot_key, document);
              }

              continue;
            }

            if (document.superseded_by_id === null && !liveBySlot.has(document.slot_key)) {
              liveBySlot.set(document.slot_key, document);
            }
          }

          return (
            <div className="space-y-5" key={carrier.id}>
              <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--ink)]">{carrier.legal_name}</h2>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                      What {companyName} needs on file to keep you hauling. {summary.satisfiedCount} of{" "}
                      {summary.requiredCount} are current.
                    </p>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      Upload anything that is missing or about to run out. Nothing counts until {companyName} has
                      checked it, so a document you send will show as awaiting review for a little while.
                    </p>
                  </div>
                </div>
              </section>

              {SUBCONTRACTOR_SLOT_GROUPS.map((group) => {
                const groupSlots = slots.filter((slot) => slot.group === group.key);

                if (groupSlots.length === 0) {
                  return null;
                }

                return (
                  <section
                    className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm"
                    key={`${carrier.id}-${group.key}`}
                  >
                    <h3 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      {group.label}
                    </h3>
                    <div className="divide-y divide-[var(--border)]">
                      {groupSlots.map((slot) => {
                        const live = liveBySlot.get(slot.key) ?? null;
                        const pending = pendingBySlot.get(slot.key) ?? null;
                        const rejected = rejectedBySlot.get(slot.key) ?? null;
                        const status = live
                          ? getSubcontractorDocumentStatus({
                              dueDate: live.due_date,
                              reminderLeadDays: slot.reminderLeadDays,
                            })
                          : null;
                        const underLimit = underLimitSlotKeys.has(slot.key);
                        // A slot with something awaiting review says so, whatever else is
                        // true of it, because that is the state the carrier most needs to
                        // read correctly: sent, not yet accepted, nothing to do but wait.
                        const tone = pending
                          ? "amber"
                          : underLimit
                            ? "red"
                            : status?.tone === "red"
                              ? "red"
                              : status?.tone === "amber"
                                ? "amber"
                                : live
                                  ? "green"
                                  : "muted";

                        return (
                          <article aria-label={slot.label} className="px-4 py-4" key={slot.key}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-base font-semibold text-[var(--ink)]">
                                  {slot.label}
                                  {slot.required ? null : (
                                    <span className="ml-2 text-xs font-normal text-[var(--ink-muted)]">Optional</span>
                                  )}
                                </p>
                                <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">{slot.description}</p>
                                {slot.minimumCoverageAmount !== null ? (
                                  <p className="mt-1 text-sm text-[var(--ink)]">
                                    Minimum limit required: {money(slot.minimumCoverageAmount)}
                                  </p>
                                ) : null}
                              </div>
                              <span
                                className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${toneClass[tone]}`}
                              >
                                {pending
                                  ? "Awaiting review"
                                  : underLimit
                                    ? "Under the limit"
                                    : live
                                      ? status?.state === "current"
                                        ? "Received"
                                        : status?.label
                                      : "Not received"}
                              </span>
                            </div>

                            {live ? (
                              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                                On file
                                {live.due_date ? ` · next due ${live.due_date}` : " · no renewal date"}
                                {money(live.coverage_amount) ? ` · ${money(live.coverage_amount)}` : ""}
                              </p>
                            ) : null}

                            {pending ? (
                              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                                Sent {pending.created_at.slice(0, 10)} and waiting to be checked. Nothing more to do
                                unless it comes back.
                              </p>
                            ) : null}

                            {rejected?.rejection_reason && !pending ? (
                              <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                                Sent back: {rejected.rejection_reason}
                              </p>
                            ) : null}

                            <details className="mt-3">
                              <summary className="cursor-pointer text-sm font-semibold text-[var(--primary)]">
                                {pending ? "Send a different one" : live ? "Send a newer one" : "Send this"}
                              </summary>
                              <PortalSlotForm slot={slot} subcontractorId={carrier.id} />
                            </details>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                <h3 className="text-base font-semibold text-[var(--ink)]">How to reach you</h3>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  Keep this current so renewal reminders land somewhere useful. Adding your broker means they can be
                  asked for a certificate directly instead of it coming back to you.
                </p>
                <form action={updateSubcontractorContactDetails} className="mt-4 space-y-3">
                  <input name="subcontractorId" type="hidden" value={carrier.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>
                      <span className={labelTextClass}>Your name</span>
                      <input className={inputClass} defaultValue={carrier.contact_name ?? ""} name="contactName" />
                    </label>
                    <label className={labelClass}>
                      <span className={labelTextClass}>Phone</span>
                      <input
                        className={inputClass}
                        defaultValue={carrier.contact_phone ?? ""}
                        name="contactPhone"
                        type="tel"
                      />
                    </label>
                  </div>
                  <label className={labelClass}>
                    <span className={labelTextClass}>Email</span>
                    <input
                      className={inputClass}
                      defaultValue={carrier.contact_email ?? ""}
                      name="contactEmail"
                      type="email"
                    />
                  </label>
                  <fieldset className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      Your insurance broker
                    </legend>
                    <input
                      className={inputClass}
                      defaultValue={carrier.broker_name ?? ""}
                      name="brokerName"
                      placeholder="Brokerage"
                    />
                    <input
                      className={inputClass}
                      defaultValue={carrier.broker_email ?? ""}
                      name="brokerEmail"
                      placeholder="Email"
                      type="email"
                    />
                    <input
                      className={inputClass}
                      defaultValue={carrier.broker_phone ?? ""}
                      name="brokerPhone"
                      placeholder="Phone"
                      type="tel"
                    />
                  </fieldset>
                  <button
                    className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                    type="submit"
                  >
                    Save my details
                  </button>
                </form>
              </section>
            </div>
          );
        })}
      </div>
    </main>
  );
}
