import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Truck } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { createContractedEquipment } from "@/app/admin/contracted-equipment/actions";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  rollUpContractedFleet,
  summarizeContractedUnit,
  type ContractedEquipmentDocumentRow,
  type ContractedEquipmentRow,
} from "@/lib/contracted-equipment";
import { requireAppUser } from "@/lib/current-user";
import { ensureEquipmentCertificationTypes } from "@/lib/equipment-certification-types";
import { VEHICLE_FILE_STATE_LABELS, vehicleFileStateClass } from "@/lib/equipment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CarrierRow = Pick<Database["public"]["Tables"]["subcontractor"]["Row"], "id" | "legal_name" | "operating_name">;
type RequirementRow = Pick<
  Database["public"]["Tables"]["contracted_equipment_certification_requirement"]["Row"],
  "contracted_equipment_id" | "certification_type_id"
>;

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

export default async function ContractedEquipmentPage({ searchParams }: PageProps) {
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

  const [{ data: carriers }, { data: units }, { data: documents }, { data: requirements }, certificationTypes] =
    await Promise.all([
      supabase
        .from("subcontractor")
        .select("id, legal_name, operating_name")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("legal_name")
        .returns<CarrierRow[]>(),
      supabase
        .from("contracted_equipment")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("unit_number")
        .returns<ContractedEquipmentRow[]>(),
      supabase
        .from("contracted_equipment_document")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .returns<ContractedEquipmentDocumentRow[]>(),
      supabase
        .from("contracted_equipment_certification_requirement")
        .select("contracted_equipment_id, certification_type_id")
        .eq("tenant_id", tenantId)
        .returns<RequirementRow[]>(),
      ensureEquipmentCertificationTypes(supabase, tenantId),
    ]);

  const carrierRows = carriers ?? [];
  const unitRows = units ?? [];
  const carrierById = new Map(carrierRows.map((carrier) => [carrier.id, carrier]));

  const documentsByUnit = new Map<string, ContractedEquipmentDocumentRow[]>();

  for (const document of documents ?? []) {
    const existing = documentsByUnit.get(document.contracted_equipment_id);

    if (existing) {
      existing.push(document);
    } else {
      documentsByUnit.set(document.contracted_equipment_id, [document]);
    }
  }

  // Null and empty array mean different things: null is "nobody has chosen for this unit
  // yet, fall back to the defaults", an empty array is "held to nothing". Only units that
  // actually have rows get an array.
  const requiredTypeIdsByUnit = new Map<string, string[]>();

  for (const requirement of requirements ?? []) {
    const existing = requiredTypeIdsByUnit.get(requirement.contracted_equipment_id);

    if (existing) {
      existing.push(requirement.certification_type_id);
    } else {
      requiredTypeIdsByUnit.set(requirement.contracted_equipment_id, [requirement.certification_type_id]);
    }
  }

  const typeInputs = certificationTypes.map((type) => ({
    id: type.id,
    name: type.name,
    appliesByDefault: type.applies_by_default,
  }));

  const summarised = unitRows.map((unit) => ({
    unit,
    carrier: carrierById.get(unit.subcontractor_id) ?? null,
    summary: summarizeContractedUnit({
      category: unit.category,
      certificationTypes: typeInputs,
      requiredTypeIds: requiredTypeIdsByUnit.get(unit.id) ?? null,
      documents: documentsByUnit.get(unit.id) ?? [],
    }),
  }));

  const visible = carrierFilter
    ? summarised.filter((entry) => entry.unit.subcontractor_id === carrierFilter)
    : summarised;

  const rollup = rollUpContractedFleet(visible.map((entry) => entry.summary));

  // Worst first: the screen exists to show what needs chasing, not the alphabet.
  const stateOrder = { expired: 0, missing: 1, due_soon: 2, awaiting_proof: 3, on_file: 4 } as const;
  const ordered = [...visible].sort(
    (left, right) =>
      stateOrder[left.summary.overallState] - stateOrder[right.summary.overallState] ||
      left.unit.unit_number.localeCompare(right.unit.unit_number, undefined, { numeric: true }),
  );

  return (
    <AdminShell
      eyebrow="Contracted equipment"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Contracted equipment"
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
            <Truck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Units your hired carriers run for you</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--ink-muted)]">
              Registrations, insurance, CVIP and the inspection certificates each contracted tractor carries, held to
              the same standard as your own fleet. These units belong to the carrier, not to you, so they are kept
              apart from Equipment and never counted in your own fleet numbers.
            </p>
            <Link
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
              href="/admin/subcontractors"
            >
              The carriers themselves, and their insurance and WCB
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Units</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{rollup.units}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">With a deficiency</p>
          <p className="mt-2 text-2xl font-bold text-[var(--danger)]">{rollup.deficient}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Awaiting a document</p>
          <p className="mt-2 text-2xl font-bold text-[var(--warning)]">{rollup.awaitingProof}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Clean</p>
          <p className="mt-2 text-2xl font-bold text-[var(--success)]">{rollup.clean}</p>
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
          Units
        </h2>
        {ordered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--ink-muted)]">
            No contracted units yet. Add one below, or import them from the carrier&apos;s expiry sheet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {ordered.map((entry) => (
              <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" key={entry.unit.id}>
                <div className="min-w-0">
                  <Link
                    className="text-sm font-semibold text-[var(--primary)] hover:underline"
                    href={`/admin/contracted-equipment/${entry.unit.id}`}
                  >
                    Unit {entry.unit.unit_number}
                  </Link>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {entry.carrier?.legal_name ?? "Unknown carrier"}
                    {entry.unit.license_plate ? ` · ${entry.unit.license_plate}` : ""}
                    {entry.unit.make ? ` · ${entry.unit.make}` : ""}
                  </p>
                  {entry.summary.gaps.length > 0 ? (
                    <p className="mt-0.5 text-xs text-[var(--danger)]">
                      {entry.summary.gaps.length} to resolve:{" "}
                      {entry.summary.gaps
                        .slice(0, 3)
                        .map((gap) => gap.label)
                        .join(", ")}
                      {entry.summary.gaps.length > 3 ? "..." : ""}
                    </p>
                  ) : entry.summary.awaitingProof.length > 0 ? (
                    <p className="mt-0.5 text-xs text-[var(--warning)]">
                      {entry.summary.awaitingProof.length} record
                      {entry.summary.awaitingProof.length === 1 ? "" : "s"} with a date but no document
                    </p>
                  ) : null}
                </div>
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${vehicleFileStateClass(entry.summary.overallState)}`}
                >
                  {VEHICLE_FILE_STATE_LABELS[entry.summary.overallState]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Add a contracted unit</h2>
        {carrierRows.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ink-muted)]">
            Add a carrier first under{" "}
            <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/subcontractors">
              Subcontractors
            </Link>
            . Every contracted unit belongs to one.
          </p>
        ) : (
          <form action={createContractedEquipment} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              <span className="text-sm font-medium text-[var(--ink)]">Unit number</span>
              <input className={inputClass} name="unitNumber" required />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Owner</span>
              <input className={inputClass} name="ownerName" placeholder="The person, if different" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Year</span>
              <input className={inputClass} inputMode="numeric" name="year" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Make</span>
              <input className={inputClass} name="make" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Model and colour</span>
              <input className={inputClass} name="modelOrColour" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">VIN</span>
              <input className={inputClass} name="vinOrSerial" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Plate</span>
              <input className={inputClass} name="licensePlate" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Registered in</span>
              <input className={inputClass} name="registrationProvince" placeholder="AB" />
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <button className={submitClass} type="submit">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add unit
              </button>
            </div>
          </form>
        )}
      </section>
    </AdminShell>
  );
}
