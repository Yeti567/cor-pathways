import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FilePlus2, Save } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { ContractedUploadField } from "@/app/admin/_components/ContractedUploadField";
import { ContractedTicketProofForm } from "@/app/admin/contracted-drivers/[driverId]/ContractedTicketProofForm";
import {
  createContractedDriverCertification,
  deleteContractedDriverCertification,
  updateContractedDriver,
} from "@/app/admin/contracted-drivers/actions";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  contractedDriverCertificationStatuses,
  contractedDriverIdentityRecords,
  contractedDriverMissingTickets,
  CONTRACTED_DRIVER_CATEGORY_DESCRIPTIONS,
  CONTRACTED_DRIVER_CATEGORY_LABELS,
  groupContractedDriverCertifications,
  type ContractedDriverCertificationInput,
  type ContractedDriverRow,
} from "@/lib/contracted-drivers";
import { requireAppUser } from "@/lib/current-user";
import { certificationStatusClass } from "@/lib/workers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CertificationCategory, Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CarrierRow = Pick<Database["public"]["Tables"]["subcontractor"]["Row"], "id" | "legal_name">;
type UnitRow = Pick<Database["public"]["Tables"]["contracted_equipment"]["Row"], "id" | "unit_number">;
type CertificationTypeRow = Pick<
  Database["public"]["Tables"]["certification_types"]["Row"],
  "id" | "name" | "category" | "is_mandatory"
>;
type CertificationRow = Database["public"]["Tables"]["contracted_driver_certification"]["Row"];

type PageProps = {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const submitClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90";
const cardClass = "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm";

const CATEGORY_ORDER: CertificationCategory[] = ["ticket", "orientation", "site_access"];

export default async function ContractedDriverPage({ params, searchParams }: PageProps) {
  const { driverId } = await params;
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
  const tenantId = context.appUser.tenant_id;

  const { data: driver } = await supabase
    .from("contracted_driver")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", driverId)
    .is("deleted_at", null)
    .maybeSingle<ContractedDriverRow>();

  if (!driver) {
    notFound();
  }

  const [{ data: carrier }, { data: units }, { data: types }, { data: certifications }] = await Promise.all([
    supabase
      .from("subcontractor")
      .select("id, legal_name")
      .eq("tenant_id", tenantId)
      .eq("id", driver.subcontractor_id)
      .maybeSingle<CarrierRow>(),
    supabase
      .from("contracted_equipment")
      .select("id, unit_number")
      .eq("tenant_id", tenantId)
      .eq("subcontractor_id", driver.subcontractor_id)
      .is("deleted_at", null)
      .order("unit_number")
      .returns<UnitRow[]>(),
    supabase
      .from("certification_types")
      .select("id, name, category, is_mandatory")
      .eq("tenant_id", tenantId)
      .order("name")
      .returns<CertificationTypeRow[]>(),
    supabase
      .from("contracted_driver_certification")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("contracted_driver_id", driver.id)
      .returns<CertificationRow[]>(),
  ]);

  const typeRows = types ?? [];
  const typeById = new Map(typeRows.map((type) => [type.id, type]));

  const held: ContractedDriverCertificationInput[] = (certifications ?? []).map((certification) => {
    const type = certification.certification_type_id ? typeById.get(certification.certification_type_id) : null;

    return {
      ...certification,
      typeCategory: (type?.category ?? "ticket") as CertificationCategory,
      typeName: type?.name ?? null,
    };
  });

  const mandatoryTickets = typeRows
    .filter((type) => type.category === "ticket" && type.is_mandatory)
    .map((type) => ({ id: type.id, name: type.name }));

  const statuses = contractedDriverCertificationStatuses({
    certifications: held,
    mandatoryTicketTypeIds: mandatoryTickets.map((ticket) => ticket.id),
  });
  const grouped = groupContractedDriverCertifications(statuses);
  const identity = contractedDriverIdentityRecords(driver);
  const missingMandatory = contractedDriverMissingTickets({ certifications: held, mandatoryTickets });
  const certificationById = new Map(held.map((certification) => [certification.id, certification]));

  return (
    <AdminShell
      eyebrow={carrier?.legal_name ?? "Contracted drivers"}
      tenantName={context.tenant?.name ?? "Company profile"}
      title={driver.full_name}
    >
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/contracted-drivers"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All contracted drivers
      </Link>

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

      {missingMandatory.length > 0 ? (
        <p className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          Nothing on file for {missingMandatory.map((ticket) => ticket.name).join(", ")}. Every driver is expected to
          hold {missingMandatory.length === 1 ? "this one" : "these"}.
        </p>
      ) : null}

      {/* --- Licence and abstract -------------------------------------------- */}
      <section className={`mt-5 ${cardClass}`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Licence and abstract</h2>
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {identity.map((record) => (
            <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={record.key}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--ink)]">{record.label}</p>
                <p className="text-xs text-[var(--ink-muted)]">{record.description}</p>
                {record.date ? (
                  <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                    {record.tracksExpiry ? "Expires" : "Dated"} {record.date}
                  </p>
                ) : null}
              </div>
              <span
                className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide ${certificationStatusClass(record.status.tone)}`}
              >
                {record.status.label}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          Edit these under Driver details below.
        </p>
      </section>

      {/* --- Tickets, orientations, badges ------------------------------------ */}
      {CATEGORY_ORDER.map((category) => (
        <section className={`mt-5 ${cardClass}`} key={category}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            {CONTRACTED_DRIVER_CATEGORY_LABELS[category]}
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {CONTRACTED_DRIVER_CATEGORY_DESCRIPTIONS[category]}
          </p>

          {grouped[category].filter((status) => status.superseded).length > 0 ? (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {grouped[category].filter((status) => status.superseded).length} earlier record
              {grouped[category].filter((status) => status.superseded).length === 1 ? " is" : "s are"} kept
              below as history. Only the most recent of each counts.
            </p>
          ) : null}

          {grouped[category].length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">Nothing filed yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {grouped[category].map((status) => {
                const source = certificationById.get(status.id);

                return (
                  // History is dimmed rather than hidden: the file has to explain itself,
                  // but a replaced certificate must not read like a live problem.
                  <li className={`py-3${status.superseded ? " opacity-60" : ""}`} key={status.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--ink)]">
                          {status.label}
                          {status.expected && !status.superseded ? " · required" : ""}
                          {status.superseded ? " · earlier record" : ""}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {status.expiresOn ? `Expires ${status.expiresOn}` : "No expiry"}
                          {status.issuedOn ? ` · issued ${status.issuedOn}` : ""}
                          {status.issuingCompany ? ` · ${status.issuingCompany}` : ""}
                        </p>
                        {status.detail ? (
                          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{status.detail}</p>
                        ) : null}
                      </div>
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide ${certificationStatusClass(status.status.tone)}`}
                      >
                        {status.status.label}
                      </span>
                    </div>

                    <ContractedTicketProofForm
                      certificationId={status.id}
                      driverId={driver.id}
                      expiresOn={source?.expires_on ?? null}
                      hasProof={status.hasProof}
                      inputClass={inputClass}
                      issuedOn={source?.issued_on ?? null}
                      label={status.label}
                      subcontractorId={driver.subcontractor_id}
                      submitClass={submitClass}
                      tenantId={tenantId}
                    />
                    <form action={deleteContractedDriverCertification} className="ml-2 inline-block">
                      <input name="certificationId" type="hidden" value={status.id} />
                      <input name="driverId" type="hidden" value={driver.id} />
                      <button
                        className="text-xs font-semibold text-[var(--ink-muted)] underline transition hover:text-[var(--danger)]"
                        type="submit"
                      >
                        Remove
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {/* --- File a record ---------------------------------------------------- */}
      <section className={`mt-5 ${cardClass}`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          File a ticket, orientation or badge
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Pick from the same list your own crew&apos;s tickets use. Which section it lands in comes from the type
          itself, so a new client orientation is added once under{" "}
          <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/certification-types">
            Certification Types
          </Link>{" "}
          and is then available for every driver.
        </p>
        <form action={createContractedDriverCertification} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input name="driverId" type="hidden" value={driver.id} />
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Type</span>
            <select className={inputClass} defaultValue="" name="certificationTypeId">
              <option value="">Not on the list</option>
              {CATEGORY_ORDER.map((category) => (
                <optgroup key={category} label={CONTRACTED_DRIVER_CATEGORY_LABELS[category]}>
                  {typeRows
                    .filter((type) => type.category === category)
                    .map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Name</span>
            <input className={inputClass} name="name" placeholder="Only needed if not on the list" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Issued</span>
            <input className={inputClass} name="issuedOn" type="date" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Expires</span>
            <input className={inputClass} name="expiresOn" type="date" />
            <span className="block text-xs text-[var(--ink-muted)]">Leave empty if it does not expire.</span>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Issued by</span>
            <input className={inputClass} name="issuingCompany" placeholder="Training provider" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Badge number or PIN</span>
            <input className={inputClass} name="detail" />
          </label>
          <div className="grid gap-3 sm:col-span-2">
            <ContractedUploadField
              hint="PDF or a photo of the card, up to 10 MB."
              inputClass={inputClass}
              label="Scan"
              location={{
                tenantId,
                subcontractorId: driver.subcontractor_id,
                subjectId: driver.id,
                scope: "contracted-drivers",
              }}
              single
              submitClass={submitClass}
              submitIcon={<FilePlus2 className="h-4 w-4" aria-hidden="true" />}
              submitLabel="File record"
            />
          </div>
        </form>
      </section>

      {/* --- Driver details --------------------------------------------------- */}
      <section className={`mt-5 ${cardClass}`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Driver details</h2>
        <form action={updateContractedDriver} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input name="driverId" type="hidden" value={driver.id} />
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Name</span>
            <input className={inputClass} defaultValue={driver.full_name} name="fullName" required />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Unit</span>
            <select
              className={inputClass}
              defaultValue={driver.contracted_equipment_id ?? ""}
              name="contractedEquipmentId"
            >
              <option value="">No unit assigned</option>
              {(units ?? []).map((unit) => (
                <option key={unit.id} value={unit.id}>
                  Unit {unit.unit_number}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Status</span>
            <select className={inputClass} defaultValue={driver.status} name="status">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="terminated">Terminated</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Licence province</span>
            <input className={inputClass} defaultValue={driver.license_province ?? ""} name="licenseProvince" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Licence expiry</span>
            <input
              className={inputClass}
              defaultValue={driver.license_expiry ?? ""}
              name="licenseExpiry"
              type="date"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Driver type</span>
            <select className={inputClass} defaultValue={driver.driver_type} name="driverType">
              <option value="contracted">Contracted</option>
              <option value="casual">Casual</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Abstract pulled</span>
            <input
              className={inputClass}
              defaultValue={driver.abstract_issued ?? ""}
              name="abstractIssued"
              type="date"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Abstract expiry</span>
            <input
              className={inputClass}
              defaultValue={driver.abstract_expiry ?? ""}
              name="abstractExpiry"
              type="date"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Common Safety Orientation</span>
            <input className={inputClass} defaultValue={driver.cso_completed ?? ""} name="csoCompleted" type="date" />
            <span className="block text-xs text-[var(--ink-muted)]">Completed. The CSO does not expire.</span>
          </label>
          <label className="space-y-2 sm:col-span-2 lg:col-span-3">
            <span className="text-sm font-medium text-[var(--ink)]">Notes</span>
            <input className={inputClass} defaultValue={driver.notes ?? ""} name="notes" />
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <button className={submitClass} type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              Save details
            </button>
          </div>
        </form>
        {/*
          No emergency contact and no medical fields, deliberately. These are the
          carrier's employees: the app holds what proves the contract is safe to run, and
          dispatch keeps the rest privately. See the table comment in the migration.
        */}
      </section>
    </AdminShell>
  );
}
