import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, CalendarClock, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { createSubcontractor } from "@/app/admin/subcontractors/actions";
import { loadResolvedSubcontractorSlots } from "@/app/admin/subcontractors/_lib/settings";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  getSubcontractorDocumentStatus,
  summariseSubcontractorCompliance,
  SUBCONTRACTOR_STATE_LABELS,
  subcontractorStateTone,
  type SubcontractorComplianceSummary,
} from "@/lib/subcontractor-requirements";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type SubcontractorRow = Database["public"]["Tables"]["subcontractor"]["Row"];
type DocumentRow = Pick<
  Database["public"]["Tables"]["subcontractor_document"]["Row"],
  "coverage_amount" | "due_date" | "review_status" | "slot_key" | "subcontractor_id" | "superseded_by_id"
>;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const labelClass = "space-y-2";
const labelTextClass = "text-sm font-medium text-[var(--ink)]";

const toneClass: Record<ReturnType<typeof subcontractorStateTone>, string> = {
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  muted: "bg-[var(--surface-muted)] text-[var(--ink-muted)] border-[var(--border)]",
  red: "bg-red-50 text-red-700 border-red-200",
};

function StateBadge({ summary }: { summary: SubcontractorComplianceSummary }) {
  const tone = subcontractorStateTone(summary.state);

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${toneClass[tone]}`}
    >
      {SUBCONTRACTOR_STATE_LABELS[summary.state]}
    </span>
  );
}

/** The shortest sentence that says what to do next. */
function describeSummary(summary: SubcontractorComplianceSummary) {
  const parts: string[] = [];

  if (summary.missing.length > 0) {
    parts.push(`${summary.missing.length} not on file`);
  }

  if (summary.overdue.length > 0) {
    parts.push(`${summary.overdue.length} past due`);
  }

  if (summary.underLimit.length > 0) {
    parts.push(`${summary.underLimit.length} under your limit`);
  }

  if (summary.expiring.length > 0) {
    parts.push(`${summary.expiring.length} expiring`);
  }

  if (parts.length === 0) {
    return `All ${summary.requiredCount} documents current`;
  }

  return parts.join(" · ");
}

export default async function SubcontractorsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.subcontractors_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: subcontractors }, { data: documents }, { slots }] = await Promise.all([
    supabase
      .from("subcontractor")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .order("legal_name", { ascending: true })
      .returns<SubcontractorRow[]>(),
    supabase
      .from("subcontractor_document")
      .select("subcontractor_id, slot_key, due_date, coverage_amount, review_status, superseded_by_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .returns<DocumentRow[]>(),
    loadResolvedSubcontractorSlots(supabase, context.appUser.tenant_id),
  ]);

  const subcontractorRows = subcontractors ?? [];
  const documentRows = documents ?? [];
  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));

  const documentsBySubcontractor = new Map<string, DocumentRow[]>();

  for (const document of documentRows) {
    const existing = documentsBySubcontractor.get(document.subcontractor_id);

    if (existing) {
      existing.push(document);
    } else {
      documentsBySubcontractor.set(document.subcontractor_id, [document]);
    }
  }

  const summaries = subcontractorRows.map((subcontractor) => ({
    subcontractor,
    summary: summariseSubcontractorCompliance(
      (documentsBySubcontractor.get(subcontractor.id) ?? []).map((document) => ({
        coverageAmount: document.coverage_amount === null ? null : Number(document.coverage_amount),
        dueDate: document.due_date,
        reviewStatus: document.review_status,
        slotKey: document.slot_key,
      })),
      slots,
    ),
  }));

  // Everything still live that carries a due date, across every carrier, nearest first.
  // The per-carrier list answers "who is a problem"; this answers "what do I chase this
  // week", which is the question that actually gets asked on a Monday morning.
  const nameById = new Map(subcontractorRows.map((row) => [row.id, row.legal_name]));
  const comingDue = documentRows
    .filter(
      (document) =>
        document.due_date !== null &&
        document.superseded_by_id === null &&
        document.review_status === "approved" &&
        slotByKey.has(document.slot_key) &&
        nameById.has(document.subcontractor_id),
    )
    .map((document) => ({
      carrier: nameById.get(document.subcontractor_id) as string,
      dueDate: document.due_date as string,
      slotLabel: slotByKey.get(document.slot_key)?.label ?? document.slot_key,
      status: getSubcontractorDocumentStatus({
        dueDate: document.due_date,
        reminderLeadDays: slotByKey.get(document.slot_key)?.reminderLeadDays ?? null,
      }),
      subcontractorId: document.subcontractor_id,
    }))
    .filter((entry) => entry.status.state !== "current")
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
    .slice(0, 12);

  // Worst first. The point of the screen is what needs chasing, not the alphabet.
  const stateOrder = { non_compliant: 0, expiring: 1, not_started: 2, compliant: 3 } as const;
  const ordered = [...summaries].sort(
    (left, right) =>
      stateOrder[left.summary.state] - stateOrder[right.summary.state] ||
      left.subcontractor.legal_name.localeCompare(right.subcontractor.legal_name),
  );

  const needsAttention = summaries.filter(
    (entry) => entry.summary.state === "non_compliant" || entry.summary.state === "not_started",
  ).length;
  const expiringCount = summaries.filter((entry) => entry.summary.state === "expiring").length;

  return (
    <AdminShell
      eyebrow="Subcontractors"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Hired carriers"
    >
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

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Hired carriers</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--ink-muted)]">
              The carriers you hire to cover work you cannot reach yourself, and the insurance, carrier profile, and
              WCB paperwork you hold on each of them. This is your own due diligence file. It is what your insurer,
              your customers, and your lawyer will ask to see, and it is not something Alberta Transportation requires
              of you.
            </p>
            <Link
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
              href="/admin/subcontractors/requirements"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Set your coverage limits and warning windows
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Carriers</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{subcontractorRows.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Need attention</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{needsAttention}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Expiring soon</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{expiringCount}</p>
        </div>
      </div>

      {comingDue.length > 0 ? (
        <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <h2 className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            <CalendarClock className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Coming due
          </h2>
          <ul className="divide-y divide-[var(--border)]">
            {comingDue.map((entry) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                key={`${entry.subcontractorId}-${entry.slotLabel}-${entry.dueDate}`}
              >
                <div className="min-w-0">
                  <Link
                    className="text-sm font-semibold text-[var(--primary)] hover:underline"
                    href={`/admin/subcontractors/${entry.subcontractorId}`}
                  >
                    {entry.carrier}
                  </Link>
                  <span className="ml-2 text-sm text-[var(--ink-muted)]">{entry.slotLabel}</span>
                </div>
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
                    entry.status.tone === "red" ? toneClass.red : toneClass.amber
                  }`}
                >
                  {entry.status.label} · {entry.dueDate}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          {ordered.length > 0 ? (
            <div className="divide-y divide-[var(--border)]">
              {ordered.map(({ subcontractor, summary }) => (
                <div className="px-4 py-4" key={subcontractor.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        className="text-base font-semibold text-[var(--primary)] hover:underline"
                        href={`/admin/subcontractors/${subcontractor.id}`}
                      >
                        {subcontractor.legal_name}
                      </Link>
                      {subcontractor.active ? null : (
                        <span className="ml-2 inline-flex items-center rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                          Archived
                        </span>
                      )}
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">
                        {describeSummary(summary)}
                        {subcontractor.contact_name ? ` · ${subcontractor.contact_name}` : ""}
                        {subcontractor.nsc_number ? ` · NSC ${subcontractor.nsc_number}` : ""}
                      </p>
                    </div>
                    <StateBadge summary={summary} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-6 text-sm text-[var(--ink-muted)]">
              No hired carriers yet. Add the first one on the right. You do not need everything at once: add the
              company, then file whichever certificates you already have in your inbox.
            </p>
          )}
        </section>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
            <Building2 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Add a carrier
          </h3>
          <form action={createSubcontractor} className="mt-4 space-y-3">
            <label className={labelClass}>
              <span className={labelTextClass}>Legal name</span>
              <input className={inputClass} name="legalName" placeholder="Redwater Hauling Ltd." required />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Operating name (optional)</span>
              <input className={inputClass} name="operatingName" placeholder="Redwater Trucking" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                <span className={labelTextClass}>Contact</span>
                <input className={inputClass} name="contactName" />
              </label>
              <label className={labelClass}>
                <span className={labelTextClass}>Phone</span>
                <input className={inputClass} name="contactPhone" type="tel" />
              </label>
            </div>
            <label className={labelClass}>
              <span className={labelTextClass}>Email</span>
              <input className={inputClass} name="contactEmail" type="email" />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>NSC number (optional)</span>
              <input className={inputClass} name="nscNumber" />
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              Add carrier
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
