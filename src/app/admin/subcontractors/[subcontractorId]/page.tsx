import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Check, FileDown, FileUp, Inbox, KeyRound, Paperclip, Send, Trash2, X } from "lucide-react";
import {
  fileSubcontractorDocument,
  inviteSubcontractorUser,
  removeSubcontractorDocument,
  reviewSubcontractorDocument,
  revokeSubcontractorUser,
  updateSubcontractor,
} from "@/app/admin/subcontractors/actions";
import { loadResolvedSubcontractorSlots } from "@/app/admin/subcontractors/_lib/settings";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  getSubcontractorDocumentStatus,
  resolveIntervalMonths,
  slotCaptures,
  summariseSubcontractorCompliance,
  SUBCONTRACTOR_MONITORING_STATUSES,
  SUBCONTRACTOR_SAFETY_RATINGS,
  SUBCONTRACTOR_SLOT_GROUPS,
  SUBCONTRACTOR_STATE_LABELS,
  subcontractorStateTone,
  type ResolvedSubcontractorSlot,
} from "@/lib/subcontractor-requirements";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type SubcontractorRow = Database["public"]["Tables"]["subcontractor"]["Row"];
type DocumentRow = Database["public"]["Tables"]["subcontractor_document"]["Row"];
type PortalAccessRow = {
  id: string;
  allowed: boolean;
  invited_at: string;
  subcontractor_user_id: string;
  subcontractor_user: { email: string; full_name: string; active: boolean; last_seen_at: string | null } | null;
};

type PageProps = {
  params: Promise<{ subcontractorId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const labelClass = "space-y-2";
const labelTextClass = "text-sm font-medium text-[var(--ink)]";
const checkboxClass = "h-4 w-4 rounded border-[var(--border)] text-[var(--primary)]";

const toneClass = {
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  muted: "bg-[var(--surface-muted)] text-[var(--ink-muted)] border-[var(--border)]",
  red: "bg-red-50 text-red-700 border-red-200",
} as const;

function money(value: number | null) {
  if (value === null) {
    return null;
  }

  return new Intl.NumberFormat("en-CA", { currency: "CAD", maximumFractionDigits: 0, style: "currency" }).format(
    value,
  );
}

/**
 * The fields a slot asks for, rendered from the slot definition.
 *
 * Driving the form off `captures` rather than a hand-written form per slot is what keeps
 * eight upload panels honest: a slot cannot quietly ask for something it does not store,
 * and adding a field later is one entry in one array.
 */
function SlotFields({ intervalMonths, slot }: { intervalMonths: number | null; slot: ResolvedSubcontractorSlot }) {
  return (
    <>
      {slot.dueMode !== "none" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            <span className={labelTextClass}>
              Issued{slot.dueMode === "interval" ? "" : " (optional)"}
            </span>
            <input
              className={inputClass}
              name="issuedDate"
              required={slot.dueMode === "interval"}
              type="date"
            />
            {slot.dueMode === "interval" ? (
              <span className="block text-xs text-[var(--ink-muted)]">
                This document carries no expiry, so it falls due {intervalMonths} months after it was issued.
              </span>
            ) : null}
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
            <span className={labelTextClass}>
              Coverage limit
              {slot.minimumCoverageAmount !== null ? ` (you require ${money(slot.minimumCoverageAmount)})` : ""}
            </span>
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
          <input className={checkboxClass} name="additionalInsured" type="checkbox" />
          <span className="text-sm text-[var(--ink)]">
            We are named as additional insured
            <span className="block text-xs text-[var(--ink-muted)]">
              The most common gap on a subcontractor certificate, and the one that voids the cover you think you have.
            </span>
          </span>
        </label>
      ) : null}

      {slotCaptures(slot, "safety_rating") ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            <span className={labelTextClass}>Safety rating</span>
            <select className={inputClass} defaultValue="" name="safetyRating">
              <option value="">Not recorded</option>
              {SUBCONTRACTOR_SAFETY_RATINGS.map((rating) => (
                <option key={rating.value} value={rating.value}>
                  {rating.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            <span className={labelTextClass}>Monitoring</span>
            <select className={inputClass} defaultValue="" name="monitoringStatus">
              <option value="">Not recorded</option>
              {SUBCONTRACTOR_MONITORING_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {slotCaptures(slot, "wcb_account") ? (
        <label className={labelClass}>
          <span className={labelTextClass}>WCB account number</span>
          <input className={inputClass} name="wcbAccount" />
        </label>
      ) : null}

      {slotCaptures(slot, "industry_rate") ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            <span className={labelTextClass}>Their rate</span>
            <input className={inputClass} name="employerRate" placeholder="1.84" />
          </label>
          <label className={labelClass}>
            <span className={labelTextClass}>Industry rate</span>
            <input className={inputClass} name="industryRate" placeholder="2.11" />
          </label>
        </div>
      ) : null}
    </>
  );
}

export default async function SubcontractorDetailPage({ params, searchParams }: PageProps) {
  const { subcontractorId } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.subcontractors_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: subcontractor }, { data: documents }, { slots }, { data: portalAccess }] = await Promise.all([
    supabase
      .from("subcontractor")
      .select("*")
      .eq("id", subcontractorId)
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .maybeSingle<SubcontractorRow>(),
    supabase
      .from("subcontractor_document")
      .select("*")
      .eq("subcontractor_id", subcontractorId)
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .returns<DocumentRow[]>(),
    loadResolvedSubcontractorSlots(supabase, context.appUser.tenant_id),
    supabase
      .from("subcontractor_user_access")
      .select("id, allowed, invited_at, subcontractor_user_id, subcontractor_user(email, full_name, active, last_seen_at)")
      .eq("subcontractor_id", subcontractorId)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("invited_at", { ascending: true })
      .returns<PortalAccessRow[]>(),
  ]);

  if (!subcontractor) {
    notFound();
  }

  const documentRows = documents ?? [];
  const summary = summariseSubcontractorCompliance(
    documentRows.map((document) => ({
      coverageAmount: document.coverage_amount === null ? null : Number(document.coverage_amount),
      dueDate: document.due_date,
      reviewStatus: document.review_status,
      slotKey: document.slot_key,
    })),
    slots,
  );
  const underLimitSlotKeys = new Set(summary.underLimit.map((entry) => entry.slot.key));

  // One signed URL per distinct stored file. A shared broker certificate is referenced
  // by several slots, so signing per document row would sign the same object repeatedly.
  const distinctPaths = [...new Set(documentRows.map((document) => document.storage_path).filter(Boolean))] as string[];
  const signedUrlByPath = new Map<string, string>();

  await Promise.all(
    distinctPaths.map(async (path) => {
      const { data } = await supabase.storage.from("subcontractor-documents").createSignedUrl(path, 10 * 60);

      if (data?.signedUrl) {
        signedUrlByPath.set(path, data.signedUrl);
      }
    }),
  );

  // Anything the carrier sent that nobody has looked at yet. Pulled out of the per-slot
  // grouping and put at the top, because an unreviewed upload is the one thing on this
  // page that is waiting on the person reading it.
  const pending = documentRows.filter((document) => document.review_status === "pending");
  const pendingIds = new Set(pending.map((document) => document.id));

  const liveBySlot = new Map<string, DocumentRow>();
  const historyBySlot = new Map<string, DocumentRow[]>();

  for (const document of documentRows) {
    if (pendingIds.has(document.id)) {
      continue;
    }

    if (document.superseded_by_id === null && !liveBySlot.has(document.slot_key)) {
      liveBySlot.set(document.slot_key, document);
    } else {
      const existing = historyBySlot.get(document.slot_key);

      if (existing) {
        existing.push(document);
      } else {
        historyBySlot.set(document.slot_key, [document]);
      }
    }
  }

  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));

  const reusableFiles = documentRows
    .filter((document) => document.storage_path)
    .map((document) => ({ path: document.storage_path as string, slotKey: document.slot_key }))
    .filter((entry, index, all) => all.findIndex((other) => other.path === entry.path) === index);

  const tone = subcontractorStateTone(summary.state);

  return (
    <AdminShell
      eyebrow="Subcontractors"
      tenantName={context.tenant?.name ?? "Company profile"}
      title={subcontractor.legal_name}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
          href="/admin/subcontractors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All hired carriers
        </Link>
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href={`/admin/subcontractors/${subcontractor.id}/pack`}
        >
          <FileDown className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Export their file
        </Link>
      </div>

      {notice ? (
        <p className="mt-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--ink-muted)]">
              {summary.satisfiedCount} of {summary.requiredCount} documents current
              {subcontractor.safety_rating ? ` · Rated ${subcontractor.safety_rating}` : ""}
              {subcontractor.monitoring_status && subcontractor.monitoring_status !== "none"
                ? ` · ${subcontractor.monitoring_status}`
                : ""}
            </p>
            {subcontractor.broker_name ? (
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Broker: {subcontractor.broker_name}
                {subcontractor.broker_email ? ` · ${subcontractor.broker_email}` : ""}
                {subcontractor.broker_phone ? ` · ${subcontractor.broker_phone}` : ""}
              </p>
            ) : null}
          </div>
          <span
            className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${toneClass[tone]}`}
          >
            {SUBCONTRACTOR_STATE_LABELS[summary.state]}
          </span>
        </div>
      </section>

      {pending.length > 0 ? (
        <section className="mt-5 overflow-hidden rounded-lg border border-amber-200 bg-amber-50 shadow-sm">
          <h2 className="flex items-center gap-2 border-b border-amber-200 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-amber-800">
            <Inbox className="h-4 w-4" aria-hidden="true" />
            Waiting on you ({pending.length})
          </h2>
          <div className="divide-y divide-amber-200">
            {pending.map((document) => {
              const slot = slotByKey.get(document.slot_key);
              const signedUrl = document.storage_path ? signedUrlByPath.get(document.storage_path) : undefined;
              const belowMinimum =
                slot?.minimumCoverageAmount != null &&
                (document.coverage_amount === null || Number(document.coverage_amount) < slot.minimumCoverageAmount);

              return (
                <article aria-label={`Pending ${slot?.label ?? document.slot_key}`} className="px-4 py-4" key={document.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-[var(--ink)]">{slot?.label ?? document.slot_key}</p>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">
                        {document.expiry_date ? `Expires ${document.expiry_date}` : ""}
                        {document.issued_date ? ` · Issued ${document.issued_date}` : ""}
                        {document.document_number ? ` · ${document.document_number}` : ""}
                        {document.insurer ? ` · ${document.insurer}` : ""}
                        {money(document.coverage_amount) ? ` · ${money(document.coverage_amount)}` : ""}
                        {document.additional_insured ? " · names us" : ""}
                      </p>
                      {belowMinimum ? (
                        <p className="mt-2 text-sm font-semibold text-red-700">
                          This is under the {money(slot?.minimumCoverageAmount ?? null)} you require.
                        </p>
                      ) : null}
                    </div>
                    {signedUrl ? (
                      <a
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
                        href={signedUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <Paperclip className="h-4 w-4" aria-hidden="true" />
                        Open it
                      </a>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <form action={reviewSubcontractorDocument} className="space-y-2 rounded-md border border-[var(--border)] bg-white p-3">
                      <input name="subcontractorId" type="hidden" value={subcontractor.id} />
                      <input name="documentId" type="hidden" value={document.id} />
                      <input name="decision" type="hidden" value="approve" />
                      {slot && slotCaptures(slot, "safety_rating") ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-[var(--ink-muted)]">Safety rating</span>
                            <select className={inputClass} defaultValue="" name="safetyRating">
                              <option value="">Not recorded</option>
                              {SUBCONTRACTOR_SAFETY_RATINGS.map((rating) => (
                                <option key={rating.value} value={rating.value}>
                                  {rating.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-[var(--ink-muted)]">Monitoring</span>
                            <select className={inputClass} defaultValue="" name="monitoringStatus">
                              <option value="">Not recorded</option>
                              {SUBCONTRACTOR_MONITORING_STATUSES.map((status) => (
                                <option key={status.value} value={status.value}>
                                  {status.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ) : null}
                      <button
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                        type="submit"
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Accept
                      </button>
                    </form>

                    <form action={reviewSubcontractorDocument} className="space-y-2 rounded-md border border-[var(--border)] bg-white p-3">
                      <input name="subcontractorId" type="hidden" value={subcontractor.id} />
                      <input name="documentId" type="hidden" value={document.id} />
                      <input name="decision" type="hidden" value="reject" />
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-[var(--ink-muted)]">Why you are sending it back</span>
                        <input
                          className={inputClass}
                          name="rejectionReason"
                          placeholder="Expired, or the limit is too low"
                          required
                        />
                      </label>
                      <button
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--danger)] transition hover:bg-red-50"
                        type="submit"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        Send back
                      </button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          {SUBCONTRACTOR_SLOT_GROUPS.map((group) => {
            const groupSlots = slots.filter((slot) => slot.group === group.key);

            if (groupSlots.length === 0) {
              return null;
            }

            return (
              <section
                className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm"
                key={group.key}
              >
                <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  {group.label}
                </h2>
                <div className="divide-y divide-[var(--border)]">
                  {groupSlots.map((slot) => {
                    const live = liveBySlot.get(slot.key) ?? null;
                    const history = historyBySlot.get(slot.key) ?? [];
                    const status = live
                      ? getSubcontractorDocumentStatus({
                          dueDate: live.due_date,
                          reminderLeadDays: slot.reminderLeadDays,
                        })
                      : null;
                    const underLimit = underLimitSlotKeys.has(slot.key);
                    const statusTone = underLimit
                      ? "red"
                      : status?.tone === "red"
                        ? "red"
                        : status?.tone === "amber"
                          ? "amber"
                          : live
                            ? "green"
                            : "muted";
                    const signedUrl = live?.storage_path ? signedUrlByPath.get(live.storage_path) : undefined;
                    const intervalMonths = resolveIntervalMonths(
                      slot,
                      slot.key === "carrier_profile"
                        ? subcontractor.carrier_profile_interval_months
                        : slot.key === "wcb_rate_statement"
                          ? subcontractor.rate_statement_interval_months
                          : null,
                    );

                    return (
                      <article aria-label={slot.label} className="px-4 py-4" key={slot.key}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-base font-semibold text-[var(--ink)]">{slot.label}</p>
                            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">{slot.description}</p>
                          </div>
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${toneClass[statusTone]}`}
                          >
                            {underLimit
                              ? "Under your limit"
                              : live
                                ? status?.state === "current"
                                  ? "On file"
                                  : status?.label
                                : "Not on file"}
                          </span>
                        </div>

                        {underLimit ? (
                          <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                            {live?.coverage_amount === null
                              ? `No limit was recorded, and you require ${money(slot.minimumCoverageAmount)}. A certificate that cannot be shown to meet the bar does not meet it.`
                              : `Carries ${money(live?.coverage_amount ?? null)} against the ${money(slot.minimumCoverageAmount)} you require.`}
                          </p>
                        ) : null}

                        {live ? (
                          <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm text-[var(--ink)]">
                                {live.due_date ? `Due ${live.due_date}` : "No renewal date"}
                                {live.issued_date ? ` · Issued ${live.issued_date}` : ""}
                                {live.document_number ? ` · ${live.document_number}` : ""}
                                {live.insurer ? ` · ${live.insurer}` : ""}
                                {money(live.coverage_amount) ? ` · ${money(live.coverage_amount)}` : ""}
                                {live.additional_insured ? " · We are named" : ""}
                              </p>
                              <div className="flex items-center gap-2">
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
                                <form action={removeSubcontractorDocument}>
                                  <input name="subcontractorId" type="hidden" value={subcontractor.id} />
                                  <input name="documentId" type="hidden" value={live.id} />
                                  <button
                                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--danger)] transition hover:bg-red-50"
                                    type="submit"
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    Remove
                                  </button>
                                </form>
                              </div>
                            </div>
                            {slot.key === "cargo_insurance" && live.deductible_amount !== null ? (
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                Deductible {money(live.deductible_amount)}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {history.length > 0 ? (
                          <details className="mt-3">
                            <summary className="cursor-pointer text-sm font-semibold text-[var(--primary)]">
                              Earlier copies ({history.length})
                            </summary>
                            <ul className="mt-2 space-y-1">
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

                        <details className="mt-3">
                          <summary className="cursor-pointer text-sm font-semibold text-[var(--primary)]">
                            {live ? "File a renewal" : "File this document"}
                          </summary>
                          <form action={fileSubcontractorDocument} className="mt-3 space-y-3">
                            <input name="subcontractorId" type="hidden" value={subcontractor.id} />
                            <input name="slotKey" type="hidden" value={slot.key} />
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
                                <span className="block text-xs text-[var(--ink-muted)]">
                                  A broker certificate often covers auto, general liability, and cargo on one PDF.
                                  Point at it once and give each coverage its own limit and expiry.
                                </span>
                              </label>
                            ) : null}
                            <SlotFields intervalMonths={intervalMonths} slot={slot} />
                            <button
                              className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                              type="submit"
                            >
                              <FileUp className="h-4 w-4" aria-hidden="true" />
                              File {slot.label.toLowerCase()}
                            </button>
                          </form>
                        </details>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="h-fit space-y-5">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <KeyRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Portal access
          </h3>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Invite someone at {subcontractor.legal_name} to see what you need from them. They get a sign-in link, not a
            password, and they can only ever see this carrier.
          </p>

          {(portalAccess ?? []).length > 0 ? (
            <ul className="mt-4 space-y-2">
              {(portalAccess ?? []).map((access) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3"
                  key={access.id}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      {access.subcontractor_user?.full_name ?? "Invited contact"}
                      {access.allowed ? null : (
                        <span className="ml-2 inline-flex items-center rounded-md bg-white px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                          Revoked
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {access.subcontractor_user?.email}
                      {access.subcontractor_user?.last_seen_at
                        ? ` · last signed in ${access.subcontractor_user.last_seen_at.slice(0, 10)}`
                        : " · has not signed in yet"}
                    </p>
                  </div>
                  {access.allowed ? (
                    <form action={revokeSubcontractorUser}>
                      <input name="subcontractorId" type="hidden" value={subcontractor.id} />
                      <input name="accessId" type="hidden" value={access.id} />
                      <button
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--danger)] transition hover:bg-red-50"
                        type="submit"
                      >
                        Revoke
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <form action={inviteSubcontractorUser} className="mt-4 space-y-3">
            <input name="subcontractorId" type="hidden" value={subcontractor.id} />
            <label className={labelClass}>
              <span className={labelTextClass}>Their name</span>
              <input className={inputClass} name="fullName" placeholder="Dana Whitfield" required />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Their email</span>
              <input
                className={inputClass}
                defaultValue={subcontractor.contact_email ?? ""}
                name="email"
                required
                type="email"
              />
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              Send sign-in link
            </button>
            <p className="text-xs text-[var(--ink-muted)]">
              Sending again to the same address just issues a fresh link, so this is also the resend button.
            </p>
          </form>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h3 className="text-base font-semibold text-[var(--ink)]">Carrier details</h3>
          <form action={updateSubcontractor} className="mt-4 space-y-3">
            <input name="subcontractorId" type="hidden" value={subcontractor.id} />
            <label className={labelClass}>
              <span className={labelTextClass}>Legal name</span>
              <input className={inputClass} defaultValue={subcontractor.legal_name} name="legalName" required />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Operating name</span>
              <input className={inputClass} defaultValue={subcontractor.operating_name ?? ""} name="operatingName" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                <span className={labelTextClass}>Contact</span>
                <input className={inputClass} defaultValue={subcontractor.contact_name ?? ""} name="contactName" />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Phone</span>
                <input
                  className={inputClass}
                  defaultValue={subcontractor.contact_phone ?? ""}
                  name="contactPhone"
                  type="tel"
                />
              </label>
            </div>
            <label className={labelClass}>
              <span className={labelTextClass}>Email</span>
              <input
                className={inputClass}
                defaultValue={subcontractor.contact_email ?? ""}
                name="contactEmail"
                type="email"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                <span className={labelTextClass}>NSC number</span>
                <input className={inputClass} defaultValue={subcontractor.nsc_number ?? ""} name="nscNumber" />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>WCB account</span>
                <input
                  className={inputClass}
                  defaultValue={subcontractor.wcb_account_number ?? ""}
                  name="wcbAccountNumber"
                />
              </label>
            </div>

            <fieldset className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Insurance broker
              </legend>
              <p className="text-xs text-[var(--ink-muted)]">
                Renewal certificates come from the broker, not the carrier. When a renewal goes quiet, this is the
                fastest way to the document.
              </p>
              <input
                className={inputClass}
                defaultValue={subcontractor.broker_name ?? ""}
                name="brokerName"
                placeholder="Brokerage"
              />
              <input
                className={inputClass}
                defaultValue={subcontractor.broker_email ?? ""}
                name="brokerEmail"
                placeholder="Email"
                type="email"
              />
              <input
                className={inputClass}
                defaultValue={subcontractor.broker_phone ?? ""}
                name="brokerPhone"
                placeholder="Phone"
                type="tel"
              />
            </fieldset>

            <label className={labelClass}>
              <span className={labelTextClass}>Notes</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white p-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={subcontractor.notes ?? ""}
                name="notes"
              />
            </label>

            <label className="flex items-center gap-2">
              <input
                className={checkboxClass}
                defaultChecked={!subcontractor.active}
                name="archived"
                type="checkbox"
              />
              <span className="text-sm text-[var(--ink)]">Archived (no longer hired)</span>
            </label>

            <button
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              Save carrier
            </button>
          </form>
        </section>
        </div>
      </div>
    </AdminShell>
  );
}
