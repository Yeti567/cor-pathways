import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, FileWarning, IdCard, Truck, UserRound } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  buildUnitCertificationStatuses,
  buildVehicleFileStatuses,
  certificationTypeNameMap,
  statusesAwaitingProof,
  unitExpectsCertifications,
} from "@/lib/equipment";
import { ensureEquipmentCertificationTypes } from "@/lib/equipment-certification-types";
import {
  AWAITING_PROOF_DESCRIPTION,
  hasAttachedProof,
  sortProofGaps,
  type ProofGap,
  type ProofSubject,
} from "@/lib/proof-status";
import { companyProofGaps, driverProofGaps, type TransportDocumentRecord } from "@/lib/transport-registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { daysUntilCertificationExpiry } from "@/lib/workers";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

// The chase list for the onboarding two-pass.
//
// A client's dates arrive first, in a spreadsheet, and their scans arrive second,
// a shoebox at a time. Between the two, every record in the app reads as tracked
// and not one of them could be produced at an audit. This page is the worklist
// that closes that gap: everything holding a date with no document behind it, in
// one place, so it can be driven to zero instead of hunted page by page.
//
// It is deliberately NOT a deficiency report. Nothing here is expired or missing;
// those are already red on their own pages. Everything here is amber, which is why
// the page opens by saying so rather than leading with an alarm.

const FLEET_CATEGORIES = ["vehicle", "trailer"] as const;

type CertificationRow = Pick<
  Database["public"]["Tables"]["certifications"]["Row"],
  "id" | "name" | "expires_on" | "attachment_path" | "worker_profile_id"
>;
type WorkerProfileRow = Pick<Database["public"]["Tables"]["worker_profiles"]["Row"], "id" | "user_id">;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "full_name" | "email">;
type EquipmentRow = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "id" | "unit_number" | "name" | "category" | "is_commercial"
>;
type EquipmentDocumentRow = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  | "equipment_id"
  | "doc_type"
  | "certification_type_id"
  | "expiry_date"
  | "is_active"
  | "reminder_lead_days"
  | "title"
  | "attachment_ids"
>;
type TransportDocumentRow = Pick<
  Database["public"]["Tables"]["transport_document"]["Row"],
  "registry_key" | "slot_key" | "scope" | "subject_id" | "status" | "expiry_date" | "attachment_ids"
>;
type TransportDriverRow = Pick<Database["public"]["Tables"]["transport_driver"]["Row"], "id" | "full_name">;

const SECTIONS: { subject: ProofSubject; heading: string; icon: typeof UserRound; blurb: string }[] = [
  {
    subject: "worker",
    heading: "Employee tickets",
    icon: IdCard,
    blurb: "Tickets and certifications with an expiry on file and no photo of the card.",
  },
  {
    subject: "unit",
    heading: "Unit files",
    icon: Truck,
    blurb: "Registration, insurance, CVIP and unit certifications entered as a date with no certificate attached.",
  },
  {
    subject: "driver",
    heading: "Driver qualification files",
    icon: UserRound,
    blurb: "DQ file slots that pass the deficiency check and have nothing to hand an auditor.",
  },
];

function displayName(user: UserRow | undefined) {
  return user?.full_name?.trim() || user?.email || "Worker";
}

function unitLabel(unit: EquipmentRow) {
  return unit.name ? `${unit.unit_number} - ${unit.name}` : unit.unit_number;
}

function expiryDetail(expiryDate: string | null) {
  if (!expiryDate) {
    return "No expiry recorded";
  }

  const days = daysUntilCertificationExpiry(expiryDate);

  if (days === null) {
    return expiryDate.slice(0, 10);
  }

  return `Expires ${expiryDate.slice(0, 10)} (${days} days)`;
}

export default async function NeedsDocumentPage() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const transportEnabled = Boolean(context.tenant?.transport_enabled);

  const [
    { data: certifications },
    { data: profiles },
    { data: users },
    { data: equipmentRows },
    { data: equipmentDocuments },
    certificationTypes,
  ] = await Promise.all([
    supabase
      .from("certifications")
      .select("id, name, expires_on, attachment_path, worker_profile_id")
      .eq("tenant_id", tenantId)
      .returns<CertificationRow[]>(),
    supabase.from("worker_profiles").select("id, user_id").eq("tenant_id", tenantId).returns<WorkerProfileRow[]>(),
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .returns<UserRow[]>(),
    supabase
      .from("equipment")
      .select("id, unit_number, name, category, is_commercial")
      .eq("tenant_id", tenantId)
      .in("category", [...FLEET_CATEGORIES])
      .is("deleted_at", null)
      .neq("status", "retired")
      .neq("status", "sold")
      .order("unit_number", { ascending: true })
      .returns<EquipmentRow[]>(),
    supabase
      .from("equipment_document")
      .select(
        "equipment_id, doc_type, certification_type_id, expiry_date, is_active, reminder_lead_days, title, attachment_ids",
      )
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<EquipmentDocumentRow[]>(),
    ensureEquipmentCertificationTypes(supabase, tenantId),
  ]);

  // Driver files are a Transport-module concept, so they are only queried when the
  // module is on. A tenant without Transport should see the two sections that
  // apply to it rather than an empty third one implying something is missing.
  const [{ data: driverDocuments }, { data: drivers }, { data: companyDocuments }] = transportEnabled
    ? await Promise.all([
        supabase
          .from("transport_document")
          .select("registry_key, slot_key, scope, subject_id, status, expiry_date, attachment_ids")
          .eq("tenant_id", tenantId)
          .eq("scope", "driver")
          .is("deleted_at", null)
          .returns<TransportDocumentRow[]>(),
        supabase
          .from("transport_driver")
          .select("id, full_name")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .returns<TransportDriverRow[]>(),
        supabase
          .from("transport_document")
          .select("registry_key, slot_key, scope, subject_id, status, expiry_date, attachment_ids")
          .eq("tenant_id", tenantId)
          .eq("scope", "company")
          .is("deleted_at", null)
          .returns<TransportDocumentRow[]>(),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const gaps: ProofGap[] = [];

  // --- Employee tickets ------------------------------------------------------
  //
  // An expired ticket is left out: it is already a deficiency on its own page, and
  // what it needs is a renewal, not a scan of a card that has run out.
  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const userIdByProfileId = new Map((profiles ?? []).map((profile) => [profile.id, profile.user_id]));

  for (const certification of certifications ?? []) {
    if (hasAttachedProof(certification.attachment_path)) {
      continue;
    }

    const days = daysUntilCertificationExpiry(certification.expires_on);

    if (days !== null && days < 0) {
      continue;
    }

    const userId = userIdByProfileId.get(certification.worker_profile_id);
    const user = userId ? userById.get(userId) : undefined;

    // A ticket whose worker is deactivated is nobody's job to chase.
    if (!user) {
      continue;
    }

    gaps.push({
      subject: "worker",
      subjectName: displayName(user),
      label: certification.name,
      expiryDate: certification.expires_on,
      href: `/admin/workers/${user.id}?tab=certifications`,
    });
  }

  // --- Unit files ------------------------------------------------------------
  const documentsByEquipment = new Map<string, EquipmentDocumentRow[]>();
  for (const document of equipmentDocuments ?? []) {
    documentsByEquipment.set(document.equipment_id, [
      ...(documentsByEquipment.get(document.equipment_id) ?? []),
      document,
    ]);
  }

  const certificationTypeInputs = certificationTypes.map((type) => ({ id: type.id, name: type.name }));
  const certificationTypeNames = certificationTypeNameMap(certificationTypeInputs);

  for (const unit of equipmentRows ?? []) {
    const documents = documentsByEquipment.get(unit.id) ?? [];
    const registryStatuses = unit.is_commercial
      ? buildVehicleFileStatuses({
          category: unit.category,
          documents: documents.map((document) => ({
            docType: document.doc_type,
            expiryDate: document.expiry_date,
            isActive: document.is_active,
            reminderLeadDays: document.reminder_lead_days,
            hasProof: hasAttachedProof(document.attachment_ids),
          })),
        })
      : [];
    const certificationStatuses = buildUnitCertificationStatuses({
      certificationTypes: unitExpectsCertifications(unit.category) ? certificationTypeInputs : [],
      certificationTypeNames,
      documents: documents.map((document) => ({
        certificationTypeId: document.certification_type_id,
        docType: document.doc_type,
        expiryDate: document.expiry_date,
        isActive: document.is_active,
        reminderLeadDays: document.reminder_lead_days,
        title: document.title,
        hasProof: hasAttachedProof(document.attachment_ids),
      })),
    });

    for (const status of [...statusesAwaitingProof(registryStatuses), ...statusesAwaitingProof(certificationStatuses)]) {
      gaps.push({
        subject: "unit",
        subjectName: unitLabel(unit),
        label: status.label,
        expiryDate: status.expiryDate,
        // Straight to the tab that holds the upload form, because the point of a
        // chase list is that every row is one click from being cleared.
        href: `/admin/equipment/${unit.id}?tab=documents`,
      });
    }
  }

  // --- Driver qualification files --------------------------------------------
  const driverRecords = new Map<string, TransportDocumentRecord[]>();
  for (const document of driverDocuments ?? []) {
    if (!document.subject_id) {
      continue;
    }

    driverRecords.set(document.subject_id, [
      ...(driverRecords.get(document.subject_id) ?? []),
      {
        registryKey: document.registry_key,
        slotKey: document.slot_key,
        scope: document.scope,
        subjectId: document.subject_id,
        status: document.status,
        expiryDate: document.expiry_date,
        hasProof: hasAttachedProof(document.attachment_ids),
      },
    ]);
  }

  for (const driver of drivers ?? []) {
    for (const gap of driverProofGaps(driverRecords.get(driver.id) ?? [])) {
      gaps.push({
        subject: "driver",
        subjectName: driver.full_name,
        label: gap.label,
        expiryDate: gap.expiryDate,
        href: `/admin/transport/drivers/${driver.id}`,
      });
    }
  }

  // Company-scope registries (the COR safety program elements) hang off no person
  // or unit, so they ride in the driver section under the company's own name
  // rather than earning a fourth section for what is usually a handful of rows.
  const companyRecords: TransportDocumentRecord[] = (companyDocuments ?? []).map((document) => ({
    registryKey: document.registry_key,
    slotKey: document.slot_key,
    scope: document.scope,
    subjectId: document.subject_id,
    status: document.status,
    expiryDate: document.expiry_date,
    hasProof: hasAttachedProof(document.attachment_ids),
  }));

  for (const gap of companyProofGaps(companyRecords)) {
    gaps.push({
      subject: "driver",
      subjectName: context.tenant?.name ?? "Company",
      label: gap.label,
      expiryDate: gap.expiryDate,
      href: "/admin/cor",
    });
  }

  const sorted = sortProofGaps(gaps);
  const bySubject = new Map<ProofSubject, ProofGap[]>();
  for (const gap of sorted) {
    bySubject.set(gap.subject, [...(bySubject.get(gap.subject) ?? []), gap]);
  }

  const visibleSections = SECTIONS.filter((section) => section.subject !== "driver" || transportEnabled);

  return (
    <AdminShell
      eyebrow="Compliance"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Records waiting on a document"
    >
      <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        <p className="text-sm text-[var(--ink)]">
          <span className="font-semibold">The document is the proof.</span> {AWAITING_PROOF_DESCRIPTION} Nothing on this
          page is expired or missing, so nothing here is a deficiency yet. Work it to zero and every green badge in the
          app is one you can stand behind at an audit.
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {visibleSections.map((section) => {
          const count = bySubject.get(section.subject)?.length ?? 0;

          return (
            <div
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
              key={section.subject}
            >
              <p className="text-sm text-[var(--ink-muted)]">{section.heading}</p>
              <p className={`mt-2 text-2xl font-bold ${count > 0 ? "text-[var(--warning)]" : "text-[var(--ink)]"}`}>
                {count}
              </p>
            </div>
          );
        })}
      </div>

      {sorted.length === 0 ? (
        <section className="mt-5 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center shadow-sm">
          <BadgeCheck className="mx-auto h-8 w-8 text-[var(--success)]" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">Every record has its document</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Nothing is sitting on a date alone. Every current record in the app has the actual document behind it.
          </p>
        </section>
      ) : (
        visibleSections.map((section) => {
          const rows = bySubject.get(section.subject) ?? [];

          if (rows.length === 0) {
            return null;
          }

          const Icon = section.icon;

          return (
            <section
              className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm"
              key={section.subject}
            >
              <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
                <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  <Icon className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  {section.heading}
                  <span className="font-normal text-[var(--ink-muted)]">({rows.length})</span>
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">{section.blurb}</p>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {rows.map((gap, index) => (
                  <Link
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition hover:bg-[var(--surface-muted)]"
                    href={gap.href}
                    key={`${gap.subject}-${gap.subjectName}-${gap.label}-${index}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ink)]">{gap.subjectName}</p>
                      <p className="mt-0.5 truncate text-sm text-[var(--ink-muted)]">{gap.label}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[var(--ink-muted)]">{expiryDetail(gap.expiryDate)}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--warning)] bg-amber-50 px-2.5 py-1 text-xs font-semibold text-[var(--warning)]">
                        <FileWarning className="h-4 w-4" aria-hidden="true" />
                        Upload
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </AdminShell>
  );
}
