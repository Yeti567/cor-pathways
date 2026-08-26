import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FilePlus2, Save } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { ContractedUploadField } from "@/app/admin/_components/ContractedUploadField";
import { ContractedDocumentProofForm } from "@/app/admin/contracted-equipment/[unitId]/ContractedDocumentProofForm";
import {
  createContractedEquipmentDocument,
  deleteContractedEquipmentDocument,
  setContractedEquipmentRequirements,
  updateContractedEquipment,
} from "@/app/admin/contracted-equipment/actions";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  summarizeContractedUnit,
  type ContractedEquipmentDocumentRow,
  type ContractedEquipmentRow,
} from "@/lib/contracted-equipment";
import { requireAppUser } from "@/lib/current-user";
import { ensureEquipmentCertificationTypes } from "@/lib/equipment-certification-types";
import { VEHICLE_FILE_STATE_LABELS, vehicleFileStateClass } from "@/lib/equipment";
import { AWAITING_PROOF_DESCRIPTION } from "@/lib/proof-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CarrierRow = Pick<Database["public"]["Tables"]["subcontractor"]["Row"], "id" | "legal_name">;

type PageProps = {
  params: Promise<{ unitId: string }>;
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

export default async function ContractedUnitPage({ params, searchParams }: PageProps) {
  const { unitId } = await params;
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

  const { data: unit } = await supabase
    .from("contracted_equipment")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", unitId)
    .is("deleted_at", null)
    .maybeSingle<ContractedEquipmentRow>();

  if (!unit) {
    notFound();
  }

  const [{ data: carrier }, { data: documents }, { data: requirements }, certificationTypes] = await Promise.all([
    supabase
      .from("subcontractor")
      .select("id, legal_name")
      .eq("tenant_id", tenantId)
      .eq("id", unit.subcontractor_id)
      .maybeSingle<CarrierRow>(),
    supabase
      .from("contracted_equipment_document")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("contracted_equipment_id", unit.id)
      .is("deleted_at", null)
      .order("expiry_date", { ascending: true, nullsFirst: false })
      .returns<ContractedEquipmentDocumentRow[]>(),
    supabase
      .from("contracted_equipment_certification_requirement")
      .select("certification_type_id")
      .eq("tenant_id", tenantId)
      .eq("contracted_equipment_id", unit.id)
      .returns<{ certification_type_id: string }[]>(),
    ensureEquipmentCertificationTypes(supabase, tenantId),
  ]);

  const documentRows = documents ?? [];

  // Null means nobody has chosen for this unit, which falls back to the defaults. An
  // empty array means somebody deliberately cleared it, and must stay empty.
  const requiredTypeIds = requirements ? requirements.map((row) => row.certification_type_id) : null;
  const tickedIds = new Set(requiredTypeIds ?? []);

  const typeInputs = certificationTypes.map((type) => ({
    id: type.id,
    name: type.name,
    appliesByDefault: type.applies_by_default,
  }));

  const summary = summarizeContractedUnit({
    category: unit.category,
    certificationTypes: typeInputs,
    requiredTypeIds,
    documents: documentRows,
  });

  const typeNameById = new Map(certificationTypes.map((type) => [type.id, type.name]));

  return (
    <AdminShell
      eyebrow={carrier?.legal_name ?? "Contracted equipment"}
      tenantName={context.tenant?.name ?? "Company profile"}
      title={`Unit ${unit.unit_number}`}
    >
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/contracted-equipment"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All contracted equipment
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

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${vehicleFileStateClass(summary.overallState)}`}
        >
          {VEHICLE_FILE_STATE_LABELS[summary.overallState]}
        </span>
        <span className="text-sm text-[var(--ink-muted)]">
          {summary.gaps.length} to resolve · {summary.awaitingProof.length} awaiting a document
        </span>
      </div>

      {/* --- Compliance files ------------------------------------------------ */}
      <section className={`mt-5 ${cardClass}`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Files</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          The documents every road unit carries. Use the upload button on the row that is asking, not Add document
          below: a second copy filed alongside leaves this row still waiting.
        </p>
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {summary.fileStatuses.map((status) => {
            const backing = documentRows.filter(
              (document) => document.doc_type === status.docType && document.is_active,
            );

            return (
              <li className="py-3" key={status.docType}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      {status.label}
                      {status.required ? "" : " (optional)"}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">{status.description}</p>
                    {status.expiryDate ? (
                      <p className="mt-0.5 text-xs text-[var(--ink-muted)]">Expires {status.expiryDate}</p>
                    ) : null}
                    {status.state === "awaiting_proof" ? (
                      <p className="mt-0.5 text-xs text-[var(--warning)]">{AWAITING_PROOF_DESCRIPTION}</p>
                    ) : null}
                  </div>
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${vehicleFileStateClass(status.state)}`}
                  >
                    {VEHICLE_FILE_STATE_LABELS[status.state]}
                  </span>
                </div>

                {backing.map((document) => (
                  <ContractedDocumentProofForm
                    documentId={document.id}
                    expiryDate={document.expiry_date}
                    hasProof={document.attachment_ids.length > 0}
                    inputClass={inputClass}
                    issuedDate={document.issued_date}
                    key={document.id}
                    subcontractorId={unit.subcontractor_id}
                    submitClass={submitClass}
                    tenantId={tenantId}
                    title={document.title}
                    unitId={unit.id}
                  />
                ))}
              </li>
            );
          })}
        </ul>
      </section>

      {/* --- Certifications -------------------------------------------------- */}
      <section className={`mt-5 ${cardClass}`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Inspections</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          What this unit is held to. A tractor carrying a belly hose and a product hose is ticked for those and
          nothing else, so it is never reported short of a tank inspection it will never need.
        </p>
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {summary.certificationStatuses.length === 0 ? (
            <li className="py-3 text-sm text-[var(--ink-muted)]">
              Nothing ticked yet. Choose this unit&apos;s inspections below.
            </li>
          ) : null}
          {summary.certificationStatuses.map((status) => {
            const backing = documentRows.filter(
              (document) =>
                document.is_active &&
                document.doc_type === "certification" &&
                (status.certificationTypeId
                  ? document.certification_type_id === status.certificationTypeId
                  : document.title === status.label),
            );

            return (
              <li className="py-3" key={status.certificationTypeId ?? status.label}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      {status.label}
                      {status.expected ? "" : " (not expected)"}
                    </p>
                    {status.expiryDate ? (
                      <p className="text-xs text-[var(--ink-muted)]">Expires {status.expiryDate}</p>
                    ) : null}
                    {status.state === "awaiting_proof" ? (
                      <p className="mt-0.5 text-xs text-[var(--warning)]">{AWAITING_PROOF_DESCRIPTION}</p>
                    ) : null}
                  </div>
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${vehicleFileStateClass(status.state)}`}
                  >
                    {VEHICLE_FILE_STATE_LABELS[status.state]}
                  </span>
                </div>

                {backing.map((document) => (
                  <div key={document.id}>
                    {/*
                      Several certificates of one type on one unit is normal here: a
                      primary and a spare product hose, a 20 lb and a 10 lb extinguisher.
                      The title is what tells them apart, so it is shown on every row.
                    */}
                    {backing.length > 1 ? (
                      <p className="mt-2 text-xs font-medium text-[var(--ink)]">{document.title}</p>
                    ) : null}
                    <ContractedDocumentProofForm
                      documentId={document.id}
                      expiryDate={document.expiry_date}
                      hasProof={document.attachment_ids.length > 0}
                      inputClass={inputClass}
                      issuedDate={document.issued_date}
                      subcontractorId={unit.subcontractor_id}
                      submitClass={submitClass}
                      tenantId={tenantId}
                      title={document.title}
                      unitId={unit.id}
                    />
                    <form action={deleteContractedEquipmentDocument} className="mt-1 inline-block">
                      <input name="documentId" type="hidden" value={document.id} />
                      <input name="unitId" type="hidden" value={unit.id} />
                      <button
                        className="text-xs font-semibold text-[var(--ink-muted)] underline transition hover:text-[var(--danger)]"
                        type="submit"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </section>

      {/* --- The tick list --------------------------------------------------- */}
      <section className={`mt-5 ${cardClass}`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Choose which inspections this unit needs
        </h2>
        <form action={setContractedEquipmentRequirements} className="mt-3">
          <input name="unitId" type="hidden" value={unit.id} />
          <div className="grid gap-2 sm:grid-cols-2">
            {certificationTypes.map((type) => (
              <label className="flex items-start gap-2 text-sm text-[var(--ink)]" key={type.id}>
                <input
                  className="mt-1"
                  defaultChecked={requiredTypeIds ? tickedIds.has(type.id) : type.applies_by_default}
                  name="certificationTypeIds"
                  type="checkbox"
                  value={type.id}
                />
                <span>
                  {type.name}
                  {type.notes ? (
                    <span className="block text-xs text-[var(--ink-muted)]">{type.notes}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            Unticking everything is a real answer and means this unit is held to nothing. Where you are not sure
            whether an inspection applies, tick it, so it reads as a gap rather than passing silently.
          </p>
          <button className={`${submitClass} mt-3`} type="submit">
            <Save className="h-4 w-4" aria-hidden="true" />
            Save inspection list
          </button>
        </form>
      </section>

      {/* --- Add a document -------------------------------------------------- */}
      <section className={`mt-5 ${cardClass}`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Add a document</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          For a document this unit has no row for yet. To answer a row that is already asking, use its own upload
          button above.
        </p>
        <form action={createContractedEquipmentDocument} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input name="unitId" type="hidden" value={unit.id} />
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Title</span>
            <input
              className={inputClass}
              name="title"
              placeholder="Product hose (spare), Fire extinguisher 20 lb"
              required
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Document type</span>
            <select className={inputClass} defaultValue="certification" name="docType">
              <option value="registration">Registration</option>
              <option value="insurance">Insurance (pink card)</option>
              <option value="cvip">CVIP</option>
              <option value="permit">Permit</option>
              <option value="certification">Certification / inspection</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Inspection type</span>
            <select className={inputClass} defaultValue="" name="certificationTypeId">
              <option value="">Not a listed inspection</option>
              {certificationTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {typeNameById.get(type.id)}
                </option>
              ))}
            </select>
            <span className="block text-xs text-[var(--ink-muted)]">
              Only used when the type above is Certification. This is what makes the inspection row go green.
            </span>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Issued</span>
            <input className={inputClass} name="issuedDate" type="date" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Expires</span>
            <input className={inputClass} name="expiryDate" type="date" />
            <span className="block text-xs text-[var(--ink-muted)]">Leave empty if it does not expire.</span>
          </label>
          <div className="grid gap-3 sm:col-span-2">
            <ContractedUploadField
              hint="PDF or a photo, up to 10 MB."
              inputClass={inputClass}
              label="Scan"
              location={{
                tenantId,
                subcontractorId: unit.subcontractor_id,
                subjectId: unit.id,
                scope: "contracted-equipment",
              }}
              submitClass={submitClass}
              submitIcon={<FilePlus2 className="h-4 w-4" aria-hidden="true" />}
              submitLabel="Add document"
            />
          </div>
        </form>
      </section>

      {/* --- Unit details ---------------------------------------------------- */}
      <section className={`mt-5 ${cardClass}`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Unit details</h2>
        <form action={updateContractedEquipment} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input name="unitId" type="hidden" value={unit.id} />
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Unit number</span>
            <input className={inputClass} defaultValue={unit.unit_number} name="unitNumber" required />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Owner</span>
            <input className={inputClass} defaultValue={unit.owner_name ?? ""} name="ownerName" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Status</span>
            <select className={inputClass} defaultValue={unit.status} name="status">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="terminated">Terminated</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Year</span>
            <input className={inputClass} defaultValue={unit.year ?? ""} inputMode="numeric" name="year" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Make</span>
            <input className={inputClass} defaultValue={unit.make ?? ""} name="make" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Model and colour</span>
            <input className={inputClass} defaultValue={unit.model_or_colour ?? ""} name="modelOrColour" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">VIN</span>
            <input className={inputClass} defaultValue={unit.vin_or_serial ?? ""} name="vinOrSerial" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Plate</span>
            <input className={inputClass} defaultValue={unit.license_plate ?? ""} name="licensePlate" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Registered in</span>
            <input
              className={inputClass}
              defaultValue={unit.registration_province ?? ""}
              name="registrationProvince"
            />
          </label>
          <label className="space-y-2 sm:col-span-2 lg:col-span-3">
            <span className="text-sm font-medium text-[var(--ink)]">Notes</span>
            <input className={inputClass} defaultValue={unit.notes ?? ""} name="notes" />
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <button className={submitClass} type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              Save details
            </button>
          </div>
        </form>
      </section>
    </AdminShell>
  );
}
