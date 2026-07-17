import Link from "next/link";
import { redirect } from "next/navigation";
import { FileDown, MapPin, ShieldAlert, UsersRound } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { PrintFooter } from "@/app/admin/_components/PrintFooter";
import { PrintHeader } from "@/app/admin/_components/PrintHeader";
import { PrintReportButton } from "@/app/admin/monitor/PrintReportButton";
import { loadVisitorRosterData } from "@/app/admin/visitors/_lib/roster-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  buildVisitorRoster,
  visitorRosterLocationLabel,
  type VisitorRosterEntry,
  type VisitorRosterGroup,
  type VisitorRosterWorkerEntry,
} from "@/lib/visitor-roster";

export const dynamic = "force-dynamic";

type VisitorRosterPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function locationFilterHref(locationId: string | null) {
  return locationId ? `/admin/visitors/roster/export?locationId=${encodeURIComponent(locationId)}` : "/admin/visitors/roster/export";
}

function oldestPerson(groups: VisitorRosterGroup[]) {
  return groups
    .flatMap((group) => [
      ...group.visitors.map((person) => ({ group, person })),
      ...group.workers.map((person) => ({ group, person })),
    ])
    .sort((left, right) => left.person.signed_in_at.localeCompare(right.person.signed_in_at))[0] ?? null;
}

function visitorTableRow(visitor: VisitorRosterEntry) {
  return (
    <tr key={`visitor-${visitor.id}`}>
      <td className="px-3 py-3 font-semibold text-[var(--ink)] print:text-black">Visitor</td>
      <td className="px-3 py-3 font-semibold text-[var(--ink)] print:text-black">{visitor.full_name}</td>
      <td className="px-3 py-3 text-[var(--ink-muted)] print:text-gray-700">
        {visitor.organization || "Not recorded"}
      </td>
      <td className="px-3 py-3 text-[var(--ink)] print:text-black">{visitor.visit_reason}</td>
      <td className="px-3 py-3 text-[var(--ink-muted)] print:text-gray-700">{visitor.signedInLabel}</td>
      <td className="px-3 py-3 font-semibold text-[var(--ink)] print:text-black">{visitor.durationLabel}</td>
    </tr>
  );
}

function workerTableRow(worker: VisitorRosterWorkerEntry) {
  return (
    <tr key={`worker-${worker.id}`}>
      <td className="px-3 py-3 font-semibold text-[var(--ink)] print:text-black">Worker</td>
      <td className="px-3 py-3 font-semibold text-[var(--ink)] print:text-black">{worker.worker_full_name}</td>
      <td className="px-3 py-3 text-[var(--ink-muted)] print:text-gray-700">
        {worker.worker_email || "Not recorded"}
      </td>
      <td className="px-3 py-3 text-[var(--ink)] print:text-black">{worker.note || "Time card"}</td>
      <td className="px-3 py-3 text-[var(--ink-muted)] print:text-gray-700">{worker.signedInLabel}</td>
      <td className="px-3 py-3 font-semibold text-[var(--ink)] print:text-black">{worker.durationLabel}</td>
    </tr>
  );
}

function rosterRows(group: VisitorRosterGroup) {
  if (group.visitors.length === 0 && group.workers.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)] print:border-gray-300 print:text-gray-600">
        No active people signed in at this location.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border)] print:overflow-visible print:border-gray-300">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm print:min-w-0">
        <thead className="bg-[var(--surface-muted)] text-xs uppercase text-[var(--ink-muted)] print:bg-white print:text-gray-600">
          <tr>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 font-semibold">Organization / Email</th>
            <th className="px-3 py-2 font-semibold">Reason / Note</th>
            <th className="px-3 py-2 font-semibold">Signed in</th>
            <th className="px-3 py-2 font-semibold">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)] print:divide-gray-300">
          {group.visitors.map(visitorTableRow)}
          {group.workers.map(workerTableRow)}
        </tbody>
      </table>
    </div>
  );
}

export default async function VisitorRosterPage({ searchParams }: VisitorRosterPageProps) {
  const params = await searchParams;
  const selectedLocationId = firstParam(params.locationId)?.trim() || null;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const tenantName = context.tenant?.name ?? "Company profile";
  const rosterData = await loadVisitorRosterData(context.appUser.tenant_id);
  const roster = buildVisitorRoster({
    locationId: selectedLocationId,
    locations: rosterData.locations,
    now: rosterData.now,
    visitors: rosterData.visitors,
    workers: rosterData.workers,
  });
  const longestActiveVisit = oldestPerson(roster.groups);
  const generatedAt = rosterData.now.toISOString();
  const preparedBy = context.appUser.full_name ?? context.appUser.email;
  const selectedLocationName = roster.selectedLocation
    ? roster.selectedLocation.code
      ? `${roster.selectedLocation.name} (${roster.selectedLocation.code})`
      : roster.selectedLocation.name
    : "All locations";
  const metrics = [
    { label: "Active people", value: String(roster.totalPeople), icon: UsersRound },
    { label: "Active workers", value: String(roster.totalWorkers), icon: UsersRound },
    { label: "Locations occupied", value: String(roster.occupiedLocationCount), icon: MapPin },
    { label: "Longest active visit", value: longestActiveVisit?.person.durationLabel ?? "None", icon: ShieldAlert },
  ];

  return (
    <AdminShell eyebrow="Emergency roster" tenantName={tenantName} title="Site Roster">
      <PrintHeader
        className="mb-5"
        companySettings={rosterData.companySettings}
        logoUrl={rosterData.logoUrl}
        printSettings={rosterData.printSettings}
        tenantName={tenantName}
      />

      <div className="flex flex-col gap-4 border-b border-[var(--border)] pb-5 print:border-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--primary)]">{selectedLocationName}</p>
            <h2 className="mt-1 text-xl font-bold text-[var(--ink)] print:text-black">Emergency site roster</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)] print:text-gray-700">
              Active visitor sign-ins and worker time cards grouped by location for mustering.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/admin/visitors"
            >
              Visitors
            </Link>
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href={locationFilterHref(selectedLocationId)}
            >
              <FileDown className="h-4 w-4" aria-hidden="true" />
              Export CSV
            </Link>
            <PrintReportButton label="Print Roster" />
          </div>
        </div>

        <form action="/admin/visitors/roster" className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm sm:grid-cols-[1fr_auto] print:hidden">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Location</span>
            <select
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={selectedLocationId ?? ""}
              name="locationId"
            >
              <option value="">All locations</option>
              {rosterData.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code ? `${location.name} (${location.code})` : location.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="inline-flex h-10 items-center justify-center self-end rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
            type="submit"
          >
            Apply
          </button>
        </form>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-4 print:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;

          return (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm print:border-gray-300 print:bg-white print:shadow-none" key={metric.label}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[var(--ink-muted)] print:text-gray-600">{metric.label}</p>
                <Icon className="h-5 w-5 text-[var(--primary)] print:text-black" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-bold text-[var(--ink)] print:text-black">{metric.value}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4">
        {roster.groups.length > 0 ? (
          roster.groups.map((group) => (
            <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm print:break-inside-avoid print:border-gray-300 print:bg-white print:shadow-none" key={group.locationId}>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink)] print:text-black">
                    {visitorRosterLocationLabel(group)}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--ink-muted)] print:text-gray-700">Emergency muster location</p>
                </div>
                <span className="inline-flex w-fit rounded-md bg-[var(--surface-muted)] px-3 py-1 text-sm font-semibold text-[var(--ink)] print:border print:border-gray-300 print:bg-white print:text-black">
                  {group.visitors.length + group.workers.length} active
                </span>
              </div>
              {rosterRows(group)}
            </article>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--ink-muted)] print:border-gray-300 print:bg-white print:text-gray-600">
            No locations match this roster filter.
          </div>
        )}
      </div>

      <PrintFooter
        companySettings={rosterData.companySettings}
        entries={[
          { label: "Roster", value: "Emergency site roster" },
          { label: "Location filter", value: selectedLocationName },
          { label: "Active people", value: String(roster.totalPeople) },
          { label: "Active visitors", value: String(roster.totalVisitors) },
          { label: "Active workers", value: String(roster.totalWorkers) },
          { label: "Locations occupied", value: String(roster.occupiedLocationCount) },
        ]}
        generatedAt={generatedAt}
        preparedByValue={preparedBy}
        printSettings={rosterData.printSettings}
      />
    </AdminShell>
  );
}
