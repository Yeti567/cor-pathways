import { redirect } from "next/navigation";
import { AlertTriangle, CircleHelp, MapPin } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  SITE_QUALIFICATION_LABELS,
  buildSiteQualificationRows,
  siteQualificationClass,
  summariseSiteQualification,
  type SiteQualificationInput,
} from "@/lib/site-qualification";
import { selectAllRows } from "@/lib/supabase/select-all";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SiteQualificationPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const siteFilter = firstParam(params.site) ?? "";
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const [{ data: types }, drivers, { data: carriers }, { data: users }, { data: profiles }] =
    await Promise.all([
      supabase
        .from("certification_types")
        .select("id, name, category")
        .eq("tenant_id", tenantId)
        .eq("category", "site_access")
        .order("name"),
      selectAllRows((from, to) =>
        supabase
          .from("contracted_driver")
          .select("id, full_name, subcontractor_id, status")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .order("id")
          .range(from, to),
      ),
      supabase.from("subcontractor").select("id, legal_name").eq("tenant_id", tenantId).is("deleted_at", null),
      supabase.from("users").select("id, full_name, active").eq("tenant_id", tenantId),
      supabase.from("worker_profiles").select("id, user_id").eq("tenant_id", tenantId),
    ]);

  const siteTypeIds = new Set((types ?? []).map((t) => t.id));
  const siteNameById = new Map((types ?? []).map((t) => [t.id, t.name]));

  // Read in full: PostgREST stops at 1,000 rows, and contracted certifications alone are
  // past that on the largest tenant. A badge on row 1,001 would read as never held.
  const [contractedCerts, workerCerts] = await Promise.all([
    selectAllRows((from, to) =>
      supabase
        .from("contracted_driver_certification")
        .select("contracted_driver_id, certification_type_id, expires_on, detail")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to),
    ),
    selectAllRows((from, to) =>
      supabase
        .from("certifications")
        .select("worker_profile_id, certification_type_id, expires_on, detail")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to),
    ),
  ]);

  const carrierName = new Map((carriers ?? []).map((c) => [c.id, c.legal_name]));
  const userName = new Map((users ?? []).map((u) => [u.id, u.full_name]));

  const credsByDriver = new Map<string, SiteQualificationInput["credentials"][number][]>();
  for (const cert of contractedCerts) {
    if (!cert.certification_type_id || !siteTypeIds.has(cert.certification_type_id)) continue;
    const list = credsByDriver.get(cert.contracted_driver_id) ?? [];
    list.push({
      siteName: siteNameById.get(cert.certification_type_id)!,
      badgeNumber: cert.detail,
      expiresOn: cert.expires_on,
    });
    credsByDriver.set(cert.contracted_driver_id, list);
  }

  const credsByProfile = new Map<string, SiteQualificationInput["credentials"][number][]>();
  for (const cert of workerCerts) {
    if (!cert.certification_type_id || !siteTypeIds.has(cert.certification_type_id)) continue;
    const list = credsByProfile.get(cert.worker_profile_id) ?? [];
    list.push({
      siteName: siteNameById.get(cert.certification_type_id)!,
      badgeNumber: cert.detail,
      expiresOn: cert.expires_on,
    });
    credsByProfile.set(cert.worker_profile_id, list);
  }

  // Employees are shown against the tenant's own name, not a carrier.
  const employerName = context.tenant?.name ?? "Own staff";

  const inputs: SiteQualificationInput[] = [
    ...drivers
      .filter((d) => d.status !== "inactive")
      .map((d) => ({
        driverId: d.id,
        driverName: d.full_name,
        carrierName: carrierName.get(d.subcontractor_id ?? "") ?? "Unassigned carrier",
        source: "contracted" as const,
        credentials: credsByDriver.get(d.id) ?? [],
      })),
    ...(profiles ?? []).map((p) => ({
      driverId: p.id,
      driverName: userName.get(p.user_id) ?? "Unknown",
      carrierName: employerName,
      source: "employee" as const,
      credentials: credsByProfile.get(p.id) ?? [],
    })),
  ]
    // Only people who hold at least one badge belong on a "who can load where"
    // page. Listing 119 drivers who have never had a terminal badge would bury
    // the handful this page exists to warn about.
    .filter((input) => input.credentials.length > 0);

  const allSites = (types ?? []).map((t) => t.name);
  const siteNames = siteFilter && allSites.includes(siteFilter) ? [siteFilter] : allSites;
  const rows = buildSiteQualificationRows(inputs, siteNames);
  const summary = summariseSiteQualification(rows, siteNames);

  return (
    <AdminShell
      eyebrow="Site qualification"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Who can load where"
    >
      <div className="grid gap-5">
        <header className="grid gap-2">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--ink)]">
            <MapPin className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            Who can load where
          </h1>
          <p className="max-w-3xl text-sm text-[var(--ink-muted)]">
            Terminal badges and site orientations, by driver. Check this before assigning a run. Only a
            badge that is on file, dated, and in date reads as qualified. A badge with no expiry recorded
            anywhere reads as unconfirmed, not as a pass.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Drivers with a badge problem
            </p>
            <p className="mt-1 text-2xl font-semibold text-[var(--ink)]">{summary.driversWithAProblem}</p>
          </div>
          <div className="rounded-lg border border-[var(--danger)] bg-red-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--danger)]">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Expired badges
            </p>
            <p className="mt-1 text-2xl font-semibold text-[var(--danger)]">{summary.totalExpired}</p>
          </div>
          <div className="rounded-lg border border-[var(--warning)] bg-amber-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--warning)]">
              <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
              Expiry never recorded
            </p>
            <p className="mt-1 text-2xl font-semibold text-[var(--warning)]">{summary.totalUnconfirmed}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-semibold ${
              siteFilter ? "border-[var(--border)] bg-white text-[var(--ink-muted)]" : "border-[var(--primary)] bg-white text-[var(--ink)]"
            }`}
            href="/admin/site-qualification"
          >
            All sites
          </a>
          {allSites.map((site) => (
            <a
              className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-semibold ${
                siteFilter === site
                  ? "border-[var(--primary)] bg-white text-[var(--ink)]"
                  : "border-[var(--border)] bg-white text-[var(--ink-muted)]"
              }`}
              href={`/admin/site-qualification?site=${encodeURIComponent(site)}`}
              key={site}
            >
              {site}
            </a>
          ))}
        </div>

        {/* Wide grid: scrolls inside its own container so the page never scrolls sideways. */}
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left">
                <th className="sticky left-0 z-10 bg-[var(--surface-muted)] px-4 py-3 font-semibold text-[var(--ink)]">
                  Driver
                </th>
                {siteNames.map((site) => (
                  <th className="px-3 py-3 font-semibold text-[var(--ink)]" key={site}>
                    {site}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-[var(--ink-muted)]" colSpan={siteNames.length + 1}>
                    No drivers hold a terminal badge yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr className="border-b border-[var(--border)] last:border-0" key={row.driverId}>
                    <td className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3">
                      <p className="font-semibold text-[var(--ink)]">{row.driverName}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {row.carrierName}
                        {row.source === "employee" ? " (employee)" : ""}
                      </p>
                    </td>
                    {siteNames.map((site) => {
                      const q = row.bySite[site];
                      return (
                        <td className="px-3 py-3 align-top" key={site}>
                          {q.state === "none" ? (
                            <span className="text-xs text-[var(--ink-muted)]">&mdash;</span>
                          ) : (
                            <div className="grid gap-1">
                              <span
                                className={`inline-flex w-fit items-center rounded-md border px-2 py-1 text-xs font-semibold ${siteQualificationClass(q.state)}`}
                              >
                                {SITE_QUALIFICATION_LABELS[q.state]}
                              </span>
                              {q.expiresOn ? (
                                <span className="text-xs text-[var(--ink-muted)]">
                                  {q.expiresOn}
                                  {q.daysUntilExpiry !== null && q.daysUntilExpiry >= 0
                                    ? ` (${q.daysUntilExpiry}d)`
                                    : ""}
                                </span>
                              ) : null}
                              {q.badgeNumber ? (
                                <span className="text-xs text-[var(--ink-muted)]">{q.badgeNumber}</span>
                              ) : null}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
