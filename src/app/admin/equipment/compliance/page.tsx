import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, CalendarClock, FileWarning, Truck, Wrench } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  buildUnitCertificationStatuses,
  buildVehicleFileStatuses,
  certificationTypeNameMap,
  unitExpectsCertifications,
} from "@/lib/equipment";
import { ensureEquipmentCertificationTypes } from "@/lib/equipment-certification-types";
import { buildFleetComplianceSummary, type FleetUnitInput, type UnitCompliance } from "@/lib/fleet-compliance";
import { hasAttachedProof } from "@/lib/proof-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

const FLEET_CATEGORIES = ["vehicle", "trailer"] as const;

type EquipmentRow = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "id" | "unit_number" | "name" | "category" | "status" | "is_commercial"
>;
type DocumentRow = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  "equipment_id" | "doc_type" | "certification_type_id" | "expiry_date" | "is_active" | "reminder_lead_days" | "title" | "attachment_ids"
>;

// One dial per question a manager actually asks, in the order they ask them.
const TONE = {
  good: { ring: "border-[var(--success)]", text: "text-[var(--success)]", wash: "bg-emerald-50" },
  warn: { ring: "border-[var(--warning)]", text: "text-[var(--warning)]", wash: "bg-amber-50" },
  bad: { ring: "border-[var(--danger)]", text: "text-[var(--danger)]", wash: "bg-red-50" },
  plain: { ring: "border-[var(--border)]", text: "text-[var(--ink)]", wash: "bg-[var(--surface-muted)]" },
} as const;

type Tone = keyof typeof TONE;

function Tile({
  detail,
  href,
  icon: Icon,
  label,
  tone,
  value,
}: {
  detail: string;
  href?: string;
  icon: typeof Truck;
  label: string;
  tone: Tone;
  value: number | string;
}) {
  const palette = TONE[value === 0 || tone === "plain" ? "plain" : tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[var(--ink-muted)]">{label}</p>
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${palette.wash} ${palette.text}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className={`mt-3 text-3xl font-bold tabular-nums ${palette.text}`}>{value}</p>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">{detail}</p>
    </>
  );

  const className = `rounded-lg border-l-4 ${palette.ring} border-y border-r border-y-[var(--border)] border-r-[var(--border)] bg-[var(--surface)] p-4 shadow-sm`;

  return href ? (
    <Link className={`${className} block transition hover:bg-[var(--surface-muted)]`} href={href}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** The proportion bar. Reads at a glance in a way three numbers never quite do. */
function ComplianceBar({ compliant, attention, deficient }: { compliant: number; attention: number; deficient: number }) {
  const total = compliant + attention + deficient;

  if (total === 0) {
    return null;
  }

  const percent = (count: number) => `${(count / total) * 100}%`;

  return (
    <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
      {deficient > 0 ? <div className="bg-[var(--danger)]" style={{ width: percent(deficient) }} /> : null}
      {attention > 0 ? <div className="bg-[var(--warning)]" style={{ width: percent(attention) }} /> : null}
      {compliant > 0 ? <div className="bg-[var(--success)]" style={{ width: percent(compliant) }} /> : null}
    </div>
  );
}

function unitDetail(row: UnitCompliance): string {
  if (row.deficiencies > 0) {
    return `${row.deficiencies} missing or expired`;
  }

  if (row.awaitingProof > 0) {
    return `${row.awaitingProof} waiting on a document`;
  }

  if (row.daysUntilNext === null) {
    return "Nothing expiring";
  }

  return `Next renewal in ${row.daysUntilNext} day${row.daysUntilNext === 1 ? "" : "s"}`;
}

export default async function FleetCompliancePage() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const [{ data: equipmentRows }, { data: documentRows }, certificationTypes] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, unit_number, name, category, status, is_commercial")
      .eq("tenant_id", tenantId)
      .in("category", [...FLEET_CATEGORIES])
      .is("deleted_at", null)
      .neq("status", "retired")
      .neq("status", "sold")
      .returns<EquipmentRow[]>(),
    supabase
      .from("equipment_document")
      .select(
        "equipment_id, doc_type, certification_type_id, expiry_date, is_active, reminder_lead_days, title, attachment_ids",
      )
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<DocumentRow[]>(),
    ensureEquipmentCertificationTypes(supabase, tenantId),
  ]);

  const documentsByEquipment = new Map<string, DocumentRow[]>();
  for (const document of documentRows ?? []) {
    documentsByEquipment.set(document.equipment_id, [
      ...(documentsByEquipment.get(document.equipment_id) ?? []),
      document,
    ]);
  }

  const certificationTypeInputs = certificationTypes.map((type) => ({ id: type.id, name: type.name }));
  const certificationTypeNames = certificationTypeNameMap(certificationTypeInputs);

  const inputs: FleetUnitInput[] = (equipmentRows ?? []).map((unit) => {
    const documents = documentsByEquipment.get(unit.id) ?? [];

    return {
      id: unit.id,
      unitNumber: unit.name ? `${unit.unit_number} - ${unit.name}` : unit.unit_number,
      status: unit.status,
      // Registry files are an NSC obligation, so only commercial units carry
      // them. A shop trailer would otherwise read permanently deficient.
      registryFiles: unit.is_commercial
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
        : [],
      certifications: buildUnitCertificationStatuses({
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
      }),
    };
  });

  const summary = buildFleetComplianceSummary(inputs);
  const needsAttention = summary.units_.filter((row) => row.state !== "compliant");

  return (
    <AdminShell eyebrow="Equipment" tenantName={context.tenant?.name ?? "Company profile"} title="Fleet compliance">
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/equipment"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Equipment
      </Link>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--ink)]">
            {summary.compliance.compliant} of {summary.units.total} units are good to go
          </h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {summary.units.outOfService > 0
              ? `${summary.units.outOfService} out of service`
              : "None out of service"}
          </p>
        </div>
        <ComplianceBar {...summary.compliance} />
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--ink-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--success)]" aria-hidden="true" />
            {summary.compliance.compliant} complete
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--warning)]" aria-hidden="true" />
            {summary.compliance.attention} need attention
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--danger)]" aria-hidden="true" />
            {summary.compliance.deficient} deficient
          </span>
        </div>
      </section>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          detail="Already lapsed. These units should not roll."
          href="/admin/transport/vehicle-files"
          icon={AlertTriangle}
          label="Expired"
          tone="bad"
          value={summary.expired}
        />
        <Tile
          detail="Book these now."
          icon={CalendarClock}
          label="Due in 7 days"
          tone="bad"
          value={summary.expiring.within7}
        />
        <Tile
          detail="Includes the 7 day count."
          icon={CalendarClock}
          label="Due in 30 days"
          tone="warn"
          value={summary.expiring.within30}
        />
        <Tile
          detail="Includes the 30 day count."
          icon={CalendarClock}
          label="Due in 60 days"
          tone="warn"
          value={summary.expiring.within60}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Tile
          detail="Vehicles and trailers on the books."
          href="/admin/equipment"
          icon={Truck}
          label="Units in the fleet"
          tone="plain"
          value={summary.units.total}
        />
        <Tile
          detail="Down and not available to dispatch."
          href="/admin/equipment?status=down"
          icon={Wrench}
          label="Out of service"
          tone="warn"
          value={summary.units.outOfService}
        />
        <Tile
          detail="A date is on file but the certificate is not."
          href="/admin/needs-document"
          icon={FileWarning}
          label="Waiting on a document"
          tone="warn"
          value={summary.awaitingProof}
        />
      </div>

      <section className="mt-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            Units needing attention
            <span className="ml-2 font-normal text-[var(--ink-muted)]">({needsAttention.length})</span>
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Worst first, then soonest to expire, so the top of this list is the next thing to do.
          </p>
        </div>

        {needsAttention.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {needsAttention.map((row) => (
              <Link
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition hover:bg-[var(--surface-muted)]"
                href={`/admin/equipment/${row.id}?tab=documents`}
                key={row.id}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${row.state === "deficient" ? "bg-[var(--danger)]" : "bg-[var(--warning)]"}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--ink)]">{row.unitNumber}</p>
                    <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{unitDetail(row)}</p>
                  </div>
                </div>
                {row.outOfService ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--warning)] bg-amber-50 px-2.5 py-1 text-xs font-semibold text-[var(--warning)]">
                    <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                    Out of service
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <BadgeCheck className="mx-auto h-8 w-8 text-[var(--success)]" aria-hidden="true" />
            <h3 className="mt-3 text-lg font-semibold text-[var(--ink)]">Every unit is current</h3>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Nothing is expired, nothing is missing, and every date has its document behind it.
            </p>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
