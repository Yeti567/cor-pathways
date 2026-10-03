import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, Info, Search, Sparkles, TriangleAlert } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  scanFleetDataQuality,
  searchFindings,
  sortFindings,
  summariseFindings,
  type DataQualityFinding,
  type DataQualityUnit,
} from "@/lib/fleet-data-quality";
import { findCandidatePairs, getFleetAiStatus, reviewCandidatesWithAi } from "@/lib/fleet-data-quality-ai";
import { selectAllRows } from "@/lib/supabase/select-all";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FLEET_CATEGORIES = ["vehicle", "trailer"] as const;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const SEVERITY_STYLE = {
  critical: { dot: "bg-[var(--danger)]", icon: AlertTriangle, label: "Certain problem", tone: "text-[var(--danger)]" },
  warning: { dot: "bg-[var(--warning)]", icon: TriangleAlert, label: "Worth checking", tone: "text-[var(--warning)]" },
  info: { dot: "bg-[var(--ink-muted)]", icon: Info, label: "For information", tone: "text-[var(--ink-muted)]" },
} as const;

/**
 * The badge that says how much the finding can be leaned on.
 *
 * This is the most important thing on the card. A duplicate plate can be put in
 * front of the client as fact; a model's hunch cannot, and the difference has to
 * survive somebody screenshotting one row of this page.
 */
function ConfidenceBadge({ confidence }: { confidence: DataQualityFinding["confidence"] }) {
  if (confidence === "certain") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-semibold text-[var(--ink)]">
        Certain
      </span>
    );
  }

  if (confidence === "suspect") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--warning)] bg-amber-50 px-2.5 py-1 text-xs font-semibold text-[var(--warning)]">
        Likely
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--primary)] bg-teal-50 px-2.5 py-1 text-xs font-semibold text-[var(--primary)]">
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      AI suggestion
    </span>
  );
}

function Stat({ label, tone, value }: { label: string; tone: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className={`text-2xl font-semibold ${tone}`}>{value}</p>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">{label}</p>
    </div>
  );
}

export default async function FleetDataQualityPage({ searchParams }: PageProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const params = await searchParams;
  const query = firstParam(params.q);
  const runAi = firstParam(params.ai) === "1";

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  // Read in full: PostgREST stops at 1,000 rows and says nothing, and a document past
  // that would never be checked.
  const [equipmentRows, documentRows] = await Promise.all([
    selectAllRows((from, to) =>
      supabase
        .from("equipment")
        .select("id, unit_number, name, category, status, is_commercial, license_plate, vin_or_serial, make, model, year, tank_spec")
        .eq("tenant_id", tenantId)
        .in("category", [...FLEET_CATEGORIES])
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    ),
    selectAllRows((from, to) =>
      supabase
        .from("equipment_document")
        .select("equipment_id, title, expiry_date, is_active")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    ),
  ]);

  const units = equipmentRows as DataQualityUnit[];
  const deterministic = scanFleetDataQuality({ documents: documentRows, units });

  // The AI pass is opt-in, because it costs money per run and the deterministic
  // report is the part that has to be instant. Candidates are still computed
  // either way, so the button can say how many pairs it would actually ask about.
  const candidates = findCandidatePairs(units, deterministic);
  const aiStatus = getFleetAiStatus();
  const aiFindings = runAi && aiStatus.ready ? await reviewCandidatesWithAi({ candidates }) : [];

  const all = sortFindings([...deterministic, ...aiFindings]);
  const findings = searchFindings(all, query);
  const summary = summariseFindings(all);
  const scannedAt = new Date().toISOString().slice(0, 10);

  return (
    <AdminShell eyebrow="Equipment" tenantName={context.tenant?.name ?? "Company profile"} title="Fleet data quality">
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/equipment"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Equipment
      </Link>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          {summary.total === 0
            ? `Nothing to answer for across ${units.length} units`
            : `${summary.total} ${summary.total === 1 ? "thing" : "things"} to answer for across ${summary.unitsAffected} of ${units.length} units`}
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Checks the identifiers a fleet is found by - plates, VINs and unit numbers - plus the dates behind them.
          Everything marked <strong>Certain</strong> is arithmetic and can be put in front of the client as fact.
          Scanned {scannedAt}.
        </p>
      </section>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Certain problems" tone="text-[var(--danger)]" value={summary.critical} />
        <Stat label="Worth checking" tone="text-[var(--warning)]" value={summary.warning} />
        <Stat label="For information" tone="text-[var(--ink)]" value={summary.info} />
        <Stat label="Units affected" tone="text-[var(--ink)]" value={summary.unitsAffected} />
      </div>

      <form className="mt-4 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Search the report</span>
          <span className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]"
              aria-hidden="true"
            />
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white pl-9 pr-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={query}
              name="q"
              placeholder="Plate, VIN, unit number, or what went wrong"
            />
          </span>
        </label>
        {runAi ? <input name="ai" type="hidden" value="1" /> : null}
        <button
          className="h-10 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white hover:opacity-90"
          type="submit"
        >
          Search
        </button>
      </form>

      {/* The second opinion. Deliberately a separate, explicit action. */}
      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
              <Sparkles className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              Second opinion on near-identical records
            </h3>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {candidates.length === 0
                ? "No two units are close enough to be worth asking about. The rules above already cover every exact match."
                : `${candidates.length} ${candidates.length === 1 ? "pair looks" : "pairs look"} alike enough that one trailer may have been entered twice. A rule cannot judge that; a model can have a look.`}
            </p>
            {!aiStatus.ready ? (
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Not configured on this deployment - needs {aiStatus.missing.join(" and ")}.
              </p>
            ) : null}
          </div>
          {candidates.length > 0 && aiStatus.ready && !runAi ? (
            <Link
              className="inline-flex h-10 shrink-0 items-center rounded-md border border-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary)] hover:bg-teal-50"
              href={`/admin/equipment/data-quality?ai=1${query ? `&q=${encodeURIComponent(query)}` : ""}`}
            >
              Run the check
            </Link>
          ) : null}
          {runAi ? (
            <span className="shrink-0 text-sm text-[var(--ink-muted)]">
              {aiFindings.length === 0 ? "Checked - nothing suggested." : `${aiFindings.length} suggested below.`}
            </span>
          ) : null}
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            Findings
            <span className="ml-2 font-normal text-[var(--ink-muted)]">
              ({findings.length}
              {query ? ` of ${all.length}` : ""})
            </span>
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Worst and least arguable first, so the top of this list is what you can say out loud.
          </p>
        </div>

        {findings.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {findings.map((finding) => {
              const style = SEVERITY_STYLE[finding.severity];

              return (
                <article className="px-4 py-4" key={finding.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                      <div className="min-w-0">
                        <h3 className="font-semibold text-[var(--ink)]">{finding.title}</h3>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">{finding.detail}</p>
                      </div>
                    </div>
                    <ConfidenceBadge confidence={finding.confidence} />
                  </div>

                  <dl className="mt-3 space-y-1 rounded-md bg-[var(--surface-muted)] p-3 text-sm">
                    {finding.evidence.map((item, index) => (
                      <div className="flex flex-wrap gap-x-2" key={`${finding.id}-${index}`}>
                        <dt className="font-semibold text-[var(--ink)]">{item.label}</dt>
                        <dd className="text-[var(--ink-muted)]">{item.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {finding.units.map((unit) => (
                      <Link
                        className="inline-flex items-center rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--surface-muted)]"
                        href={`/admin/equipment/${unit.id}`}
                        key={unit.id}
                      >
                        {unit.unitNumber}
                      </Link>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <BadgeCheck className="mx-auto h-8 w-8 text-[var(--success)]" aria-hidden="true" />
            <h3 className="mt-3 text-lg font-semibold text-[var(--ink)]">
              {query ? "Nothing matches that search" : "Every identifier checks out"}
            </h3>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {query
                ? "Try a plate, a VIN or a unit number. Spaces and hyphens do not matter."
                : "No duplicate plates, no duplicate VINs, no impossible dates."}
            </p>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
