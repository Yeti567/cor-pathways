import Link from "next/link";
import { redirect } from "next/navigation";
import { IdCard, Plus } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { createContractedDriver } from "@/app/admin/contracted-drivers/actions";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  contractedDriverCertificationStatuses,
  contractedDriverIdentityRecords,
  contractedDriverMissingTickets,
  contractedDriverOverallTone,
  type ContractedDriverCertificationInput,
  type ContractedDriverRow,
} from "@/lib/contracted-drivers";
import { requireAppUser } from "@/lib/current-user";
import { certificationStatusClass } from "@/lib/workers";
import { selectAllRows } from "@/lib/supabase/select-all";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CertificationCategory, Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CarrierRow = Pick<Database["public"]["Tables"]["subcontractor"]["Row"], "id" | "legal_name">;
type UnitRow = Pick<
  Database["public"]["Tables"]["contracted_equipment"]["Row"],
  "id" | "subcontractor_id" | "unit_number"
>;
type CertificationTypeRow = Pick<
  Database["public"]["Tables"]["certification_types"]["Row"],
  "id" | "name" | "category" | "is_mandatory"
>;
type CertificationRow = Database["public"]["Tables"]["contracted_driver_certification"]["Row"];

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const submitClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90";

const TONE_LABELS = {
  danger: "Deficiency",
  warning: "Expiring soon",
  unproven: "No document",
  success: "Current",
  neutral: "Nothing on file",
} as const;

export default async function ContractedDriversPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const carrierFilter = firstParam(params.carrier) ?? "";
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.subcontractors_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  // Drivers, units and certifications are read in full: PostgREST stops at 1,000 rows and
  // this tenant already holds more certifications than that.
  const [{ data: carriers }, drivers, units, { data: types }, certifications] =
    await Promise.all([
      supabase
        .from("subcontractor")
        .select("id, legal_name")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("legal_name")
        .returns<CarrierRow[]>(),
      selectAllRows<ContractedDriverRow>((from, to) =>
        supabase
          .from("contracted_driver")
          .select("*")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .order("full_name")
          .order("id")
          .range(from, to)
          .returns<ContractedDriverRow[]>(),
      ),
      selectAllRows<UnitRow>((from, to) =>
        supabase
          .from("contracted_equipment")
          .select("id, subcontractor_id, unit_number")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .order("unit_number")
          .order("id")
          .range(from, to)
          .returns<UnitRow[]>(),
      ),
      supabase
        .from("certification_types")
        .select("id, name, category, is_mandatory")
        .eq("tenant_id", tenantId)
        .returns<CertificationTypeRow[]>(),
      selectAllRows<CertificationRow>((from, to) =>
        supabase
          .from("contracted_driver_certification")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("id")
          .range(from, to)
          .returns<CertificationRow[]>(),
      ),
    ]);

  const carrierRows = carriers ?? [];
  const driverRows = drivers ?? [];
  const typeRows = types ?? [];
  const carrierById = new Map(carrierRows.map((carrier) => [carrier.id, carrier]));
  const unitById = new Map((units ?? []).map((unit) => [unit.id, unit]));

  const typeById = new Map(typeRows.map((type) => [type.id, type]));

  // Mandatory TICKETS only. An orientation is never expected of everyone: a driver who
  // does not run to that client's site is not short of anything, and treating it as a
  // gap would bury the driver who genuinely has no H2S.
  const mandatoryTickets = typeRows
    .filter((type) => type.category === "ticket" && type.is_mandatory)
    .map((type) => ({ id: type.id, name: type.name }));
  const mandatoryTicketIds = mandatoryTickets.map((ticket) => ticket.id);

  const certificationsByDriver = new Map<string, ContractedDriverCertificationInput[]>();

  for (const certification of certifications ?? []) {
    const type = certification.certification_type_id ? typeById.get(certification.certification_type_id) : null;
    const enriched: ContractedDriverCertificationInput = {
      ...certification,
      typeCategory: (type?.category ?? "ticket") as CertificationCategory,
      typeName: type?.name ?? null,
    };
    const existing = certificationsByDriver.get(certification.contracted_driver_id);

    if (existing) {
      existing.push(enriched);
    } else {
      certificationsByDriver.set(certification.contracted_driver_id, [enriched]);
    }
  }

  const summarised = driverRows.map((driver) => {
    const held = certificationsByDriver.get(driver.id) ?? [];
    const statuses = contractedDriverCertificationStatuses({
      certifications: held,
      mandatoryTicketTypeIds: mandatoryTicketIds,
    });
    const identity = contractedDriverIdentityRecords(driver);
    const missingMandatory = contractedDriverMissingTickets({ certifications: held, mandatoryTickets });

    return {
      driver,
      carrier: carrierById.get(driver.subcontractor_id) ?? null,
      unit: driver.contracted_equipment_id ? unitById.get(driver.contracted_equipment_id) ?? null : null,
      ticketCount: statuses.filter((status) => status.category === "ticket").length,
      missingMandatory,
      tone: contractedDriverOverallTone({ identity, certifications: statuses, missingMandatory }),
    };
  });

  const visible = carrierFilter
    ? summarised.filter((entry) => entry.driver.subcontractor_id === carrierFilter)
    : summarised;

  const toneOrder = { danger: 0, warning: 1, unproven: 2, neutral: 3, success: 4 } as const;
  const ordered = [...visible].sort(
    (left, right) =>
      toneOrder[left.tone] - toneOrder[right.tone] || left.driver.full_name.localeCompare(right.driver.full_name),
  );

  const deficient = visible.filter((entry) => entry.tone === "danger").length;
  const expiring = visible.filter((entry) => entry.tone === "warning").length;

  return (
    <AdminShell
      eyebrow="Contracted drivers"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Contracted drivers"
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
            <IdCard className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Drivers who work for your hired carriers</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--ink-muted)]">
              Their tickets, client site orientations and site access badges, tracked the way your own crew&apos;s
              are. These drivers work for the carrier, not for you: they hold no login, receive nothing from this
              app, and never appear on your own roster.
            </p>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Drivers</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{visible.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">With a deficiency</p>
          <p className="mt-2 text-2xl font-bold text-[var(--danger)]">{deficient}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Expiring soon</p>
          <p className="mt-2 text-2xl font-bold text-[var(--warning)]">{expiring}</p>
        </div>
      </div>

      {carrierRows.length > 1 ? (
        <form className="mt-5 flex flex-wrap items-end gap-3" method="get">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Carrier</span>
            <select className={inputClass} defaultValue={carrierFilter} name="carrier">
              <option value="">All carriers</option>
              {carrierRows.map((carrier) => (
                <option key={carrier.id} value={carrier.id}>
                  {carrier.legal_name}
                </option>
              ))}
            </select>
          </label>
          <button className={submitClass} type="submit">
            Filter
          </button>
        </form>
      ) : null}

      <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Drivers
        </h2>
        {ordered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--ink-muted)]">No contracted drivers yet. Add one below.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {ordered.map((entry) => (
              <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" key={entry.driver.id}>
                <div className="min-w-0">
                  <Link
                    className="text-sm font-semibold text-[var(--primary)] hover:underline"
                    href={`/admin/contracted-drivers/${entry.driver.id}`}
                  >
                    {entry.driver.full_name}
                  </Link>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {entry.carrier?.legal_name ?? "Unknown carrier"}
                    {entry.unit ? ` · Unit ${entry.unit.unit_number}` : ""}
                    {entry.driver.driver_type === "casual" ? " · Casual" : ""}
                  </p>
                  {entry.missingMandatory.length > 0 ? (
                    <p className="mt-0.5 text-xs text-[var(--danger)]">
                      Nothing on file for {entry.missingMandatory.map((ticket) => ticket.name).join(", ")}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                      {entry.ticketCount} ticket{entry.ticketCount === 1 ? "" : "s"} on file
                    </p>
                  )}
                </div>
                <span
                  className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide ${certificationStatusClass(entry.tone)}`}
                >
                  {TONE_LABELS[entry.tone]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Add a driver</h2>
        {carrierRows.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ink-muted)]">
            Add a carrier first under{" "}
            <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/subcontractors">
              Subcontractors
            </Link>
            . Every contracted driver works for one.
          </p>
        ) : (
          <form action={createContractedDriver} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Carrier</span>
              <select className={inputClass} name="subcontractorId" required>
                {carrierRows.map((carrier) => (
                  <option key={carrier.id} value={carrier.id}>
                    {carrier.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Name</span>
              <input className={inputClass} name="fullName" required />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Unit</span>
              <select className={inputClass} defaultValue="" name="contractedEquipmentId">
                <option value="">No unit assigned</option>
                {(units ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    Unit {unit.unit_number}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-[var(--ink-muted)]">
                Must belong to the same carrier, or it is left unassigned.
              </span>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Licence province</span>
              <input className={inputClass} name="licenseProvince" placeholder="AB" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Licence expiry</span>
              <input className={inputClass} name="licenseExpiry" type="date" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Driver type</span>
              <select className={inputClass} defaultValue="contracted" name="driverType">
                <option value="contracted">Contracted</option>
                <option value="casual">Casual</option>
              </select>
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <button className={submitClass} type="submit">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add driver
              </button>
            </div>
          </form>
        )}
      </section>
    </AdminShell>
  );
}
