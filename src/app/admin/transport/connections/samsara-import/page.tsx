import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Info } from "lucide-react";
import { importSamsaraFleet } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { isSamsaraImportPlanEmpty } from "@/lib/eld/samsara-import";
import { planSamsaraImport } from "@/lib/eld/samsara-sync";

export const dynamic = "force-dynamic";

const CONNECTIONS_PATH = "/admin/transport/connections";

/**
 * Preview of what importing the Samsara fleet would create. Nothing is written
 * until the operator confirms, and the plan is recomputed server-side at that
 * point, so what runs is always what a fresh read says, not what this page said.
 */
export default async function SamsaraImportPage() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.transport_enabled) {
    redirect("/admin/setup");
  }

  const result = await planSamsaraImport(context.appUser.tenant_id);

  return (
    <AdminShell
      eyebrow="Transport"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Import fleet from Samsara"
    >
      <Link
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
        href={CONNECTIONS_PATH}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to connections
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-[var(--ink)]">Import fleet from Samsara</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
        Creates driver files and units from what Samsara already knows, using Samsara&rsquo;s own spelling of
        every name and unit number. That is the point: records created here match on the next sync by
        construction, instead of relying on someone typing them identically.
      </p>

      {!result.ok ? (
        <div className="mt-5 flex gap-3 rounded-lg border border-[var(--danger)] bg-red-50 p-4 text-sm text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Could not read the Samsara fleet.</p>
            <p className="mt-1">{result.error}</p>
          </div>
        </div>
      ) : (
        <>
          <section className="mt-5 grid gap-3 sm:grid-cols-2">
            <PlanCard
              title="Driver files to create"
              count={result.plan.driversToCreate.length}
              alreadyPresent={result.plan.driversAlreadyPresent}
              noun="driver"
            />
            <PlanCard
              title="Units to create"
              count={result.plan.vehiclesToCreate.length}
              alreadyPresent={result.plan.vehiclesAlreadyPresent}
              noun="unit"
            />
          </section>

          <div className="mt-4 flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm leading-6 text-[var(--ink)]">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />
            <div>
              <p>
                This creates <strong>driver files and units only</strong>. It does not create logins or set
                permission levels; those stay a deliberate decision through the worker invite flow.
              </p>
              <p className="mt-1">
                Units are created as <strong>commercial (NSC)</strong> with mileage tracking, because a vehicle
                carrying an ELD is a commercial motor vehicle. Uncheck any that are not on the unit&rsquo;s page.
              </p>
              <p className="mt-1">
                Expiry dates (CVIP, registration, insurance) and scanned documents are <strong>not</strong> in
                Samsara. Those still come from the client.
              </p>
            </div>
          </div>

          {result.plan.driversToCreate.length > 0 ? (
            <PreviewList
              title={`Driver files to create (${result.plan.driversToCreate.length})`}
              rows={result.plan.driversToCreate.map((driver) => ({ key: driver.externalId, primary: driver.fullName }))}
            />
          ) : null}

          {result.plan.vehiclesToCreate.length > 0 ? (
            <PreviewList
              title={`Units to create (${result.plan.vehiclesToCreate.length})`}
              rows={result.plan.vehiclesToCreate.map((vehicle) => ({
                key: vehicle.externalId,
                primary: vehicle.unitNumber,
                secondary: [
                  [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
                  vehicle.vin ? `VIN ${vehicle.vin}` : null,
                  vehicle.plate ? `Plate ${vehicle.plate}` : null,
                ]
                  .filter(Boolean)
                  .join("  ·  "),
              }))}
            />
          ) : null}

          {[...result.plan.driversSkipped, ...result.plan.vehiclesSkipped].length > 0 ? (
            <section className="mt-5 overflow-hidden rounded-lg border border-[var(--warning)] bg-[var(--surface)] shadow-sm">
              <div className="border-b border-[var(--border)] bg-amber-50 px-4 py-3">
                <h2 className="text-base font-semibold text-[var(--ink)]">
                  Skipped ({result.plan.driversSkipped.length + result.plan.vehiclesSkipped.length})
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  Nothing is created for these. Fix them in Samsara and import again.
                </p>
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {[...result.plan.driversSkipped, ...result.plan.vehiclesSkipped].map((item) => (
                  <li className="px-4 py-3" key={`${item.externalId}-${item.label}`}>
                    <p className="text-sm font-medium text-[var(--ink)]">{item.label}</p>
                    <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{item.reason}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {isSamsaraImportPlanEmpty(result.plan) ? (
            <div className="mt-5 flex items-center gap-3 rounded-lg border border-[var(--success)] bg-emerald-50 p-4 text-sm text-[var(--success)]">
              <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
              <p>Nothing to import. Everything Samsara knows about is already in the system.</p>
            </div>
          ) : (
            <form action={importSamsaraFleet} className="mt-6">
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)]"
                type="submit"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Import {result.plan.driversToCreate.length} driver
                {result.plan.driversToCreate.length === 1 ? "" : "s"} and {result.plan.vehiclesToCreate.length} unit
                {result.plan.vehiclesToCreate.length === 1 ? "" : "s"}
              </button>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                Safe to run again later: anything that already exists is left alone.
              </p>
            </form>
          )}
        </>
      )}
    </AdminShell>
  );
}

function PlanCard({
  title,
  count,
  alreadyPresent,
  noun,
}: {
  title: string;
  count: number;
  alreadyPresent: number;
  noun: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-sm font-medium text-[var(--ink-muted)]">{title}</p>
      <p className="mt-1 text-3xl font-semibold text-[var(--ink)]">{count}</p>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">
        {alreadyPresent} matching {noun}
        {alreadyPresent === 1 ? "" : "s"} already in the system
      </p>
    </div>
  );
}

function PreviewList({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; primary: string; secondary?: string }[];
}) {
  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((row) => (
          <li className="px-4 py-3" key={row.key}>
            <p className="text-sm font-medium text-[var(--ink)]">{row.primary}</p>
            {row.secondary ? <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{row.secondary}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
