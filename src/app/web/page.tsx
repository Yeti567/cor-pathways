import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  CalendarDays,
  Clock3,
  ClipboardCheck,
  ClipboardList,
  ExternalLink,
  FileSignature,
  FileText,
  Home,
  LogOut,
  MapPin,
  Paperclip,
  Truck,
  UserRound,
  UsersRound,
  Wifi,
} from "lucide-react";
import {
  clockInWorkerTimeCard,
  clockOutWorkerTimeCard,
  markNotificationRead,
  signOffFlaggedFollowUp,
  signOut,
  updateAssignedFollowUpStatus,
  uploadWorkerCertificationTicket,
} from "@/app/actions";
import { AssignedFormsPanel } from "@/app/web/_components/AssignedFormsPanel";
import { EquipmentPanel } from "@/app/web/_components/EquipmentPanel";
import { DailyInspectionPanel } from "@/app/web/_components/DailyInspectionPanel";
import { FieldTicketsPanel } from "@/app/web/_components/FieldTicketsPanel";
import { InventoryFieldPanel } from "@/app/web/_components/InventoryFieldPanel";
import { MyWorkOrdersPanel } from "@/app/web/_components/MyWorkOrdersPanel";
import { OfflineStatus } from "@/app/web/_components/OfflineStatus";
import { ResourceLibraryPanel } from "@/app/web/_components/ResourceLibraryPanel";
import { WorkerCertificationTicketForm } from "@/app/web/_components/WorkerCertificationTicketForm";
import { WorkerHosPanel } from "@/app/web/_components/WorkerHosPanel";
import {
  coerceHosRegime,
  computeAvailability,
  computeHosViolations,
  DUTY_STATUS_LABELS,
  HOS_REGIME_LABELS,
  HOS_RULESETS,
  type DutyStatusEvent,
} from "@/lib/hos-rules";
import {
  canAccessEquipmentByReach,
  canAccessLocationByReach,
  canUseWebApp,
  formatPowerLevel,
  formatSyncDays,
} from "@/lib/access-control";
import { sendCertificationExpiryNotifications } from "@/lib/certification-reminders";
import { requireAppUser } from "@/lib/current-user";
import { compareResourceOrder, getKnowledgeSearchTerms, normalizeKnowledgeSearchQuery } from "@/lib/document-control";
import { sendEquipmentAttentionNotifications } from "@/lib/equipment-reminders";
import { followUpStatusClass, formatFollowUpStatus } from "@/lib/follow-ups";
import { getManagedListIdFromSettings, resolveManagedListSettings } from "@/lib/managed-lists";
import { toOfflineFormItem, toOfflineFormSection, toOfflineFormSummary } from "@/lib/offline/form-model";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildVisitorRoster,
  visitorRosterLocationLabel,
  type VisitorRosterEntry,
  type VisitorRosterGroup,
  type VisitorRosterLocation,
  type VisitorRosterWorkerEntry,
} from "@/lib/visitor-roster";
import { certificationStatus, certificationStatusClass } from "@/lib/workers";
import { countWorkerSignaturesBySubmissionId, mergeWorkerDocumentSubmissions } from "@/lib/worker-records";
import { classifyScheduledTaskStatus, classifyWorkflowRunStepStatus } from "@/lib/workflow-station";
import { formatWorkOrderSchedule } from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type WebAppPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ResourceRow = Database["public"]["Tables"]["resources"]["Row"];
type ResourceSectionRow = Database["public"]["Tables"]["resource_sections"]["Row"];
type FormSectionRow = Database["public"]["Tables"]["form_sections"]["Row"];
type FormItemRow = Database["public"]["Tables"]["form_items"]["Row"];
type ChoiceListRow = Pick<Database["public"]["Tables"]["lists"]["Row"], "id" | "include_other" | "name">;
type ChoiceListItemRow = Pick<Database["public"]["Tables"]["list_items"]["Row"], "active" | "id" | "label" | "list_id" | "parent_id" | "sort_order">;
type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
type WorkerPickerRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "full_name" | "id" | "power_level">;
type WorkerProfileSummaryRow = Pick<Database["public"]["Tables"]["worker_profiles"]["Row"], "id" | "phone" | "title" | "user_id">;
type SubmissionLocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name" | "visibility_rule">;
type UserLocationRow = Pick<Database["public"]["Tables"]["user_locations"]["Row"], "location_id">;
type SiteRosterVisitorRow = Pick<
  Database["public"]["Tables"]["visitors"]["Row"],
  "full_name" | "id" | "location_id" | "organization" | "signed_in_at" | "signed_out_at" | "visit_reason"
>;
type WorkerTimeCardRow = Pick<
  Database["public"]["Tables"]["worker_time_cards"]["Row"],
  "clocked_in_at" | "clocked_out_at" | "id" | "location_id" | "note"
>;
type SiteRosterWorkerTimeCardRow = Pick<
  Database["public"]["Tables"]["worker_time_cards"]["Row"],
  "clocked_in_at" | "clocked_out_at" | "id" | "location_id" | "note" | "worker_user_id"
>;
type FollowUpRow = Pick<
  Database["public"]["Tables"]["follow_ups"]["Row"],
  "assigned_to" | "created_at" | "description" | "due_at" | "id" | "parent_submission_id" | "status" | "title"
>;
type ScheduleRow = Pick<Database["public"]["Tables"]["schedules"]["Row"], "form_id" | "id" | "location_id" | "name">;
type ScheduledTaskRow = Database["public"]["Tables"]["scheduled_tasks"]["Row"];
type WorkflowRunStepRow = Pick<
  Database["public"]["Tables"]["workflow_run_steps"]["Row"],
  "assigned_to" | "completed_at" | "due_at" | "id" | "status" | "workflow_run_id" | "workflow_step_id"
>;
type WorkflowStepRow = Pick<
  Database["public"]["Tables"]["workflow_steps"]["Row"],
  "form_id" | "id" | "sort_order" | "workflow_id"
>;
type WorkflowRunRow = Pick<
  Database["public"]["Tables"]["workflow_runs"]["Row"],
  "completed_at" | "id" | "location_id" | "status" | "workflow_id"
>;
type WorkflowRow = Pick<Database["public"]["Tables"]["workflows"]["Row"], "id" | "name">;
type CertificationRow = Database["public"]["Tables"]["certifications"]["Row"];
type SignatureSummaryRow = Pick<
  Database["public"]["Tables"]["signatures"]["Row"],
  "id" | "signature_path" | "signed_at" | "signer_name" | "submission_id"
>;
type WorkerDocumentSubmissionRow = Pick<
  Database["public"]["Tables"]["submissions"]["Row"],
  "created_at" | "form_id" | "id" | "location_id" | "status" | "submitted_at" | "submitted_by" | "sync_state"
>;
type WorkerDocumentFormRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name">;
type WorkerDocumentLocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name">;
type WorkerDocumentRegisterRow = Pick<Database["public"]["Tables"]["document_control_register"]["Row"], "dcn" | "source_id">;
type EquipmentRow = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  | "assigned_to"
  | "category"
  | "current_meter"
  | "id"
  | "location_id"
  | "make"
  | "model"
  | "name"
  | "status"
  | "tenant_id"
  | "tracking_mode"
  | "unit_number"
  | "updated_at"
  | "vin_or_serial"
  | "year"
>;
type EquipmentServiceRow = Pick<
  Database["public"]["Tables"]["equipment_scheduled_service"]["Row"],
  | "due_date"
  | "due_meter"
  | "equipment_id"
  | "id"
  | "interval_mode"
  | "is_active"
  | "last_completed_at"
  | "last_completed_meter"
  | "recurrence_unit"
  | "recurrence_value"
  | "service_type"
  | "tenant_id"
  | "title"
  | "updated_at"
>;
type EquipmentDocumentRow = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  | "attachment_ids"
  | "doc_type"
  | "equipment_id"
  | "expiry_date"
  | "id"
  | "is_active"
  | "reminder_lead_days"
  | "tenant_id"
  | "title"
  | "updated_at"
>;
type EquipmentMaintenanceRow = Pick<
  Database["public"]["Tables"]["equipment_maintenance_log"]["Row"],
  | "attachment_ids"
  | "description"
  | "equipment_id"
  | "id"
  | "meter_at_service"
  | "performed_at"
  | "tenant_id"
  | "title"
  | "type"
  | "updated_at"
  | "vendor"
>;
type EquipmentMeterRow = Pick<
  Database["public"]["Tables"]["equipment_meter_log"]["Row"],
  "equipment_id" | "id" | "recorded_at" | "source" | "tenant_id" | "updated_at" | "value"
>;
type EquipmentSubmissionLinkRow = Pick<
  Database["public"]["Tables"]["equipment_submission_link"]["Row"],
  "equipment_id" | "form_type" | "id" | "linked_at" | "link_source" | "submission_id" | "tenant_id" | "updated_at"
>;
type EquipmentLinkedSubmissionRow = Pick<
  Database["public"]["Tables"]["submissions"]["Row"],
  "created_at" | "form_id" | "id" | "location_id" | "submitted_at" | "submitted_by"
>;
type EquipmentLinkedFormRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name">;

const mobileNav = [
  { href: "#home", label: "Home", icon: Home },
  { href: "#site-roster", label: "Roster", icon: UsersRound },
  { href: "#forms", label: "Forms", icon: ClipboardList },
  { href: "#resources", label: "Resources", icon: FileText },
  { href: "#equipment", label: "Equipment", icon: Truck },
  { href: "#records", label: "Records", icon: BadgeCheck },
  { href: "#workers", label: "Workers", icon: UsersRound },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Isolated impure read (request time) for the HOS event window, so the page
// component body stays pure. 15 days covers cycle 2's availability window.
function hosEventWindowStartIso() {
  return new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
}

function searchPattern(term: string) {
  return `%${term}%`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function isDueToday(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const dueDate = new Date(value);
  const today = new Date();

  return (
    dueDate.getFullYear() === today.getFullYear() &&
    dueDate.getMonth() === today.getMonth() &&
    dueDate.getDate() === today.getDate()
  );
}

function workerAssignmentStatusLabel(status: string, dueAt: string | null | undefined) {
  if (status === "overdue") {
    return "Overdue";
  }

  if (isDueToday(dueAt)) {
    return "Due today";
  }

  if (status === "completed") {
    return "Completed";
  }

  if (status === "pending" || status === "due" || status === "open") {
    return "Due";
  }

  return status;
}

function workerAssignmentStatusClass(status: string, dueAt: string | null | undefined) {
  if (status === "overdue") {
    return "bg-red-50 text-[var(--danger)]";
  }

  if (status === "completed") {
    return "bg-emerald-50 text-[var(--success)]";
  }

  if (isDueToday(dueAt)) {
    return "bg-amber-50 text-[var(--warning)]";
  }

  return "bg-amber-50 text-[var(--warning)]";
}

function isStoragePath(path: string | null | undefined): path is string {
  return Boolean(path && !path.startsWith("data:"));
}

function workerInitials(name: string) {
  const initials = name
    .split(" ")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return initials || "W";
}

function siteRosterActiveCount(group: VisitorRosterGroup) {
  return group.visitors.length + group.workers.length;
}

function siteRosterVisitorRow(visitor: VisitorRosterEntry) {
  return (
    <article className="grid gap-2 rounded-md border border-[var(--border)] bg-white p-3 sm:grid-cols-[88px_1fr] sm:items-start" key={`visitor-${visitor.id}`}>
      <span className="w-fit rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-[var(--primary)]">Visitor</span>
      <div className="min-w-0">
        <p className="truncate font-semibold text-[var(--ink)]">{visitor.full_name}</p>
        <p className="truncate text-sm text-[var(--ink-muted)]">{visitor.organization || "No organization recorded"}</p>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">{visitor.visit_reason}</p>
        <p className="mt-1 text-xs font-semibold text-[var(--ink)]">{visitor.durationLabel}</p>
      </div>
    </article>
  );
}

function siteRosterWorkerRow(worker: VisitorRosterWorkerEntry) {
  return (
    <article className="grid gap-2 rounded-md border border-[var(--border)] bg-white p-3 sm:grid-cols-[88px_1fr] sm:items-start" key={`worker-${worker.id}`}>
      <span className="w-fit rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-[var(--success)]">Worker</span>
      <div className="min-w-0">
        <p className="truncate font-semibold text-[var(--ink)]">{worker.worker_full_name}</p>
        <p className="truncate text-sm text-[var(--ink-muted)]">{worker.worker_email || "No email recorded"}</p>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">{worker.note || "Time card"}</p>
        <p className="mt-1 text-xs font-semibold text-[var(--ink)]">{worker.durationLabel}</p>
      </div>
    </article>
  );
}

function siteRosterRows(group: VisitorRosterGroup) {
  if (siteRosterActiveCount(group) === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-sm text-[var(--ink-muted)]">
        No active people at this location.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {group.workers.map(siteRosterWorkerRow)}
      {group.visitors.map(siteRosterVisitorRow)}
    </div>
  );
}

export default async function WebAppPage({ searchParams }: WebAppPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const referenceSearch = normalizeKnowledgeSearchQuery(firstParam(params.referenceSearch) ?? "");
  const referenceSearchTerms = getKnowledgeSearchTerms(referenceSearch);
  const context = await requireAppUser();
  const supabase = await createSupabaseServerClient();
  const storageSupabase = createSupabaseAdminClient() ?? supabase;

  if (!canUseWebApp(context.appUser)) {
    redirect("/choose");
  }

  await sendCertificationExpiryNotifications(context.appUser.tenant_id);
  await sendEquipmentAttentionNotifications(context.appUser.tenant_id);

  const { data: formRows } = await supabase
    .from("forms")
    .select("id, tenant_id, name, code, description, status, updated_at")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("app_menu_visible", true)
    .eq("is_private", false)
    .neq("status", "archived")
    .order("name", { ascending: true })
    .limit(25);

  let resourcesQuery = supabase
    .from("resources")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("name", { ascending: true })
    .limit(referenceSearch ? 50 : 100);

  for (const term of referenceSearchTerms) {
    const pattern = searchPattern(term);
    resourcesQuery = resourcesQuery.or(
      `name.ilike.${pattern},dcn.ilike.${pattern},storage_path.ilike.${pattern},mime_type.ilike.${pattern},search_text.ilike.${pattern}`,
    );
  }

  const [
    { data: resourceRows },
    { data: resourceSectionRows },
    { data: notificationRows },
    { data: workerRows },
    { data: locationRows },
    { data: userLocationRows },
    { data: openWorkerTimeCard },
    { data: followUpRows },
    { data: scheduledTaskRows },
    { data: workflowRunStepRows },
    { data: equipmentRows },
    { data: equipmentServiceRows },
    { data: equipmentDocumentRows },
  ] = await Promise.all([
    resourcesQuery.returns<ResourceRow[]>(),
    supabase
      .from("resource_sections")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .returns<ResourceSectionRow[]>(),
    supabase
      .from("notifications")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("user_id", context.appUser.id)
      .order("created_at", { ascending: false })
      .limit(6)
      .returns<NotificationRow[]>(),
    supabase
      .from("users")
      .select("id, full_name, email, power_level")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("full_name", { ascending: true })
      .returns<WorkerPickerRow[]>(),
    supabase
      .from("locations")
      .select("id, name, code, visibility_rule")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name", { ascending: true })
      .returns<SubmissionLocationRow[]>(),
    supabase
      .from("user_locations")
      .select("location_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("user_id", context.appUser.id)
      .returns<UserLocationRow[]>(),
    supabase
      .from("worker_time_cards")
      .select("id, location_id, note, clocked_in_at, clocked_out_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("worker_user_id", context.appUser.id)
      .is("clocked_out_at", null)
      .maybeSingle<WorkerTimeCardRow>(),
    supabase
      .from("follow_ups")
      .select("id, title, description, status, assigned_to, parent_submission_id, due_at, created_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("assigned_to", context.appUser.id)
      .order("created_at", { ascending: false })
      .limit(8)
      .returns<FollowUpRow[]>(),
    supabase
      .from("scheduled_tasks")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("assigned_to", context.appUser.id)
      .order("due_at", { ascending: true })
      .limit(8)
      .returns<ScheduledTaskRow[]>(),
    supabase
      .from("workflow_run_steps")
      .select("id, workflow_run_id, workflow_step_id, assigned_to, status, due_at, completed_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("assigned_to", context.appUser.id)
      .is("completed_at", null)
      .order("due_at", { ascending: true })
      .limit(12)
      .returns<WorkflowRunStepRow[]>(),
    supabase
      .from("equipment")
      .select(
        "id, tenant_id, unit_number, name, category, make, model, year, vin_or_serial, tracking_mode, current_meter, status, assigned_to, location_id, updated_at",
      )
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .in("status", ["active", "down"])
      .order("unit_number", { ascending: true })
      .returns<EquipmentRow[]>(),
    supabase
      .from("equipment_scheduled_service")
      .select(
        "id, tenant_id, equipment_id, service_type, title, interval_mode, due_date, due_meter, recurrence_value, recurrence_unit, last_completed_at, last_completed_meter, is_active, updated_at",
      )
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .returns<EquipmentServiceRow[]>(),
    supabase
      .from("equipment_document")
      .select("id, tenant_id, equipment_id, doc_type, title, expiry_date, reminder_lead_days, attachment_ids, is_active, updated_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .returns<EquipmentDocumentRow[]>(),
  ]);
  const assignedLocationIds = new Set((userLocationRows ?? []).map((location) => location.location_id));
  const locationOptions = (locationRows ?? [])
    .filter((location) =>
      canAccessLocationByReach({
        assignedLocationIds,
        includeAllWorkersLocations: true,
        locationId: location.id,
        reachType: context.appUser.reach_type,
        visibilityRule: location.visibility_rule,
      }),
    )
    .map((location) => ({
      code: location.code,
      id: location.id,
      name: location.name,
    }));
  const openTimeCardLocation = openWorkerTimeCard?.location_id
    ? locationOptions.find((location) => location.id === openWorkerTimeCard.location_id) ??
      (locationRows ?? []).find((location) => location.id === openWorkerTimeCard.location_id) ??
      null
    : null;
  const siteRosterLocationIds = locationOptions.map((location) => location.id);
  const siteRosterLocationIdSet = new Set(siteRosterLocationIds);
  const siteRosterLocations = (locationRows ?? [])
    .filter((location) => siteRosterLocationIdSet.has(location.id))
    .map(
      (location): VisitorRosterLocation => ({
        code: location.code,
        id: location.id,
        name: location.name,
      }),
    );
  const [{ data: siteRosterVisitors }, { data: siteRosterTimeCards }] =
    siteRosterLocationIds.length > 0
      ? await Promise.all([
          supabase
            .from("visitors")
            .select("id, location_id, full_name, organization, visit_reason, signed_in_at, signed_out_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .is("signed_out_at", null)
            .in("location_id", siteRosterLocationIds)
            .order("signed_in_at", { ascending: true })
            .returns<SiteRosterVisitorRow[]>(),
          supabase
            .from("worker_time_cards")
            .select("id, location_id, worker_user_id, note, clocked_in_at, clocked_out_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .is("clocked_out_at", null)
            .in("location_id", siteRosterLocationIds)
            .order("clocked_in_at", { ascending: true })
            .returns<SiteRosterWorkerTimeCardRow[]>(),
        ])
      : [{ data: [] as SiteRosterVisitorRow[] }, { data: [] as SiteRosterWorkerTimeCardRow[] }];
  const siteRosterWorkerById = new Map((workerRows ?? []).map((worker) => [worker.id, worker]));
  const siteRoster = buildVisitorRoster({
    locations: siteRosterLocations,
    visitors: siteRosterVisitors ?? [],
    workers: (siteRosterTimeCards ?? []).map((timeCard) => {
      const worker = siteRosterWorkerById.get(timeCard.worker_user_id);

      return {
        id: timeCard.id,
        location_id: timeCard.location_id,
        note: timeCard.note,
        signed_in_at: timeCard.clocked_in_at,
        signed_out_at: timeCard.clocked_out_at,
        worker_email: worker?.email ?? null,
        worker_full_name: worker?.full_name ?? "Unknown worker",
        worker_user_id: timeCard.worker_user_id,
      };
    }),
  });
  const siteRosterGroups = [...siteRoster.groups].sort((left, right) => {
    const leftIsCurrent = openWorkerTimeCard?.location_id === left.locationId;
    const rightIsCurrent = openWorkerTimeCard?.location_id === right.locationId;

    if (leftIsCurrent !== rightIsCurrent) {
      return leftIsCurrent ? -1 : 1;
    }

    return visitorRosterLocationLabel(left).localeCompare(visitorRosterLocationLabel(right));
  });
  const currentSiteRosterGroup = openWorkerTimeCard?.location_id
    ? siteRoster.groups.find((group) => group.locationId === openWorkerTimeCard.location_id) ?? null
    : null;
  const currentSiteActiveCount = currentSiteRosterGroup ? siteRosterActiveCount(currentSiteRosterGroup) : 0;
  const reachableEquipmentRows = (equipmentRows ?? []).filter((equipment) =>
    canAccessEquipmentByReach({
      assignedLocationIds,
      assignedTo: equipment.assigned_to,
      locationId: equipment.location_id,
      reachType: context.appUser.reach_type,
      userId: context.appUser.id,
    }),
  );
  const equipmentIds = reachableEquipmentRows.map((equipment) => equipment.id);
  const reachableEquipmentIdSet = new Set(equipmentIds);
  const reachableEquipmentServiceRows = (equipmentServiceRows ?? []).filter((service) => reachableEquipmentIdSet.has(service.equipment_id));
  const reachableEquipmentDocumentRows = (equipmentDocumentRows ?? []).filter((document) => reachableEquipmentIdSet.has(document.equipment_id));
  const [{ data: equipmentMaintenanceRows }, { data: equipmentMeterRows }, { data: equipmentSubmissionLinkRows }] =
    equipmentIds.length > 0
      ? await Promise.all([
          supabase
            .from("equipment_maintenance_log")
            .select("id, tenant_id, equipment_id, type, title, description, performed_at, meter_at_service, vendor, attachment_ids, updated_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .is("deleted_at", null)
            .in("equipment_id", equipmentIds)
            .order("performed_at", { ascending: false })
            .limit(200)
            .returns<EquipmentMaintenanceRow[]>(),
          supabase
            .from("equipment_meter_log")
            .select("id, tenant_id, equipment_id, value, recorded_at, source, updated_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("equipment_id", equipmentIds)
            .order("recorded_at", { ascending: false })
            .limit(200)
            .returns<EquipmentMeterRow[]>(),
          supabase
            .from("equipment_submission_link")
            .select("id, tenant_id, equipment_id, submission_id, form_type, linked_at, link_source, updated_at")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("equipment_id", equipmentIds)
            .order("linked_at", { ascending: false })
            .limit(200)
            .returns<EquipmentSubmissionLinkRow[]>(),
        ])
      : [
          { data: [] as EquipmentMaintenanceRow[] },
          { data: [] as EquipmentMeterRow[] },
          { data: [] as EquipmentSubmissionLinkRow[] },
        ];
  const equipmentLinkedSubmissionIds = Array.from(new Set((equipmentSubmissionLinkRows ?? []).map((link) => link.submission_id)));
  const { data: equipmentLinkedSubmissionRows } =
    equipmentLinkedSubmissionIds.length > 0
      ? await supabase
          .from("submissions")
          .select("id, form_id, location_id, submitted_by, submitted_at, created_at")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", equipmentLinkedSubmissionIds)
          .returns<EquipmentLinkedSubmissionRow[]>()
      : { data: [] as EquipmentLinkedSubmissionRow[] };
  const equipmentLinkedFormIds = Array.from(new Set((equipmentLinkedSubmissionRows ?? []).map((submission) => submission.form_id)));
  const { data: equipmentLinkedFormRows } =
    equipmentLinkedFormIds.length > 0
      ? await supabase
          .from("forms")
          .select("id, name, code")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", equipmentLinkedFormIds)
          .returns<EquipmentLinkedFormRow[]>()
      : { data: [] as EquipmentLinkedFormRow[] };
  const scheduleIds = Array.from(new Set((scheduledTaskRows ?? []).map((task) => task.schedule_id)));
  const workflowStepIds = Array.from(new Set((workflowRunStepRows ?? []).map((step) => step.workflow_step_id)));
  const workflowRunIds = Array.from(new Set((workflowRunStepRows ?? []).map((step) => step.workflow_run_id)));
  const [{ data: scheduleRows }, { data: workflowStepRows }, { data: workflowRunRows }] = await Promise.all([
    scheduleIds.length > 0
      ? supabase
          .from("schedules")
          .select("id, name, form_id, location_id")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", scheduleIds)
          .returns<ScheduleRow[]>()
      : Promise.resolve({ data: [] as ScheduleRow[] }),
    workflowStepIds.length > 0
      ? supabase
          .from("workflow_steps")
          .select("id, workflow_id, form_id, sort_order")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", workflowStepIds)
          .returns<WorkflowStepRow[]>()
      : Promise.resolve({ data: [] as WorkflowStepRow[] }),
    workflowRunIds.length > 0
      ? supabase
          .from("workflow_runs")
          .select("id, workflow_id, location_id, status, completed_at")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", workflowRunIds)
          .returns<WorkflowRunRow[]>()
      : Promise.resolve({ data: [] as WorkflowRunRow[] }),
  ]);
  const workflowIds = Array.from(
    new Set([...(workflowStepRows ?? []).map((step) => step.workflow_id), ...(workflowRunRows ?? []).map((run) => run.workflow_id)]),
  );
  const { data: workflowRows } =
    workflowIds.length > 0
      ? await supabase
          .from("workflows")
          .select("id, name")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", workflowIds)
          .returns<WorkflowRow[]>()
      : { data: [] as WorkflowRow[] };
  const baseFormRows = formRows ?? [];
  const baseFormIds = new Set(baseFormRows.map((form) => form.id));
  const scheduledFormIds = Array.from(
    new Set((scheduleRows ?? []).map((schedule) => schedule.form_id).filter((formId): formId is string => Boolean(formId))),
  );
  const workflowFormIds = Array.from(
    new Set((workflowStepRows ?? []).map((step) => step.form_id).filter((formId): formId is string => Boolean(formId))),
  );
  const assignedFormIds = Array.from(new Set([...scheduledFormIds, ...workflowFormIds]));
  const missingAssignedFormIds = assignedFormIds.filter((formId) => !baseFormIds.has(formId));
  const { data: assignedFormRows } =
    missingAssignedFormIds.length > 0
      ? await supabase
          .from("forms")
          .select("id, tenant_id, name, code, description, status, updated_at")
          .eq("tenant_id", context.appUser.tenant_id)
          .neq("status", "archived")
          .in("id", missingAssignedFormIds)
      : { data: [] as typeof baseFormRows };
  const allFormRows = [...baseFormRows, ...(assignedFormRows ?? [])].sort((left, right) => left.name.localeCompare(right.name));
  const formIds = allFormRows.map((form) => form.id);
  const [{ data: sectionRows }, { data: itemRows }] =
    formIds.length > 0
      ? await Promise.all([
          supabase
            .from("form_sections")
            .select("*")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("form_id", formIds)
            .order("sort_order", { ascending: true })
            .returns<FormSectionRow[]>(),
          supabase
            .from("form_items")
            .select("*")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("form_id", formIds)
            .order("sort_order", { ascending: true })
            .returns<FormItemRow[]>(),
        ])
      : [{ data: [] as FormSectionRow[] }, { data: [] as FormItemRow[] }];
  const referencedListIds = Array.from(
    new Set((itemRows ?? []).map((item) => getManagedListIdFromSettings(item.settings)).filter((listId): listId is string => Boolean(listId))),
  );
  const [{ data: choiceLists }, { data: choiceListItems }] =
    referencedListIds.length > 0
      ? await Promise.all([
          supabase
            .from("lists")
            .select("id, include_other, name")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("id", referencedListIds)
            .returns<ChoiceListRow[]>(),
          supabase
            .from("list_items")
            .select("active, id, label, list_id, parent_id, sort_order")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("list_id", referencedListIds)
            .order("sort_order", { ascending: true })
            .order("label", { ascending: true })
            .returns<ChoiceListItemRow[]>(),
        ])
      : [{ data: [] as ChoiceListRow[] }, { data: [] as ChoiceListItemRow[] }];
  const resources = await Promise.all(
    (resourceRows ?? []).map(async (resource) => {
      const { data } = await storageSupabase.storage.from("tenant-documents").createSignedUrl(resource.storage_path, 10 * 60);

      return {
        ...resource,
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );
  const resourceSections = resourceSectionRows ?? [];
  const orderedResources = [...resources].sort(compareResourceOrder);
  const resourceSummaries = orderedResources.map((resource) => ({
    bodyText: resource.body_text ?? null,
    dcn: resource.dcn,
    id: resource.id,
    mimeType: resource.mime_type,
    name: resource.name,
    sectionId: resource.section_id,
    signedUrl: resource.signedUrl,
    sortOrder: resource.sort_order,
    storagePath: resource.storage_path,
    tenantId: resource.tenant_id,
    updatedAt: resource.updated_at ?? "",
  }));
  const resourceSectionSummaries = resourceSections.map((section) => ({
    id: section.id,
    name: section.name,
    sortOrder: section.sort_order,
    tenantId: section.tenant_id,
  }));
  const choiceListById = new Map((choiceLists ?? []).map((list) => [list.id, list]));
  const choiceItemsByListId = new Map<string, ChoiceListItemRow[]>();

  for (const item of choiceListItems ?? []) {
    const listItems = choiceItemsByListId.get(item.list_id) ?? [];
    listItems.push(item);
    choiceItemsByListId.set(item.list_id, listItems);
  }

  const itemsBySection = new Map<string, ReturnType<typeof toOfflineFormItem>[]>();
  for (const item of itemRows ?? []) {
    const listId = getManagedListIdFromSettings(item.settings);
    const choiceList = listId ? choiceListById.get(listId) : null;
    const itemWithResolvedOptions =
      listId && choiceList
        ? {
            ...item,
            settings: resolveManagedListSettings(item.settings, choiceList, choiceItemsByListId.get(listId) ?? []),
          }
        : item;
    const sectionItems = itemsBySection.get(item.section_id) ?? [];
    sectionItems.push(toOfflineFormItem(itemWithResolvedOptions));
    itemsBySection.set(item.section_id, sectionItems);
  }

  const sectionsByForm = new Map<string, ReturnType<typeof toOfflineFormSection>[]>();
  for (const section of sectionRows ?? []) {
    const formSections = sectionsByForm.get(section.form_id) ?? [];
    formSections.push(toOfflineFormSection(section, itemsBySection.get(section.id) ?? []));
    sectionsByForm.set(section.form_id, formSections);
  }

  const initialForms = allFormRows.map((form) => toOfflineFormSummary(form, sectionsByForm.get(form.id) ?? []));
  const workerIds = (workerRows ?? []).map((worker) => worker.id);
  const { data: workerProfiles } =
    workerIds.length > 0
      ? await supabase
          .from("worker_profiles")
          .select("id, user_id, title, phone")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("user_id", workerIds)
          .returns<WorkerProfileSummaryRow[]>()
      : { data: [] as WorkerProfileSummaryRow[] };
  const workerProfileByUserId = new Map((workerProfiles ?? []).map((profile) => [profile.user_id, profile]));
  const workerOptions = (workerRows ?? []).map((worker) => ({
    fullName: worker.full_name,
    id: worker.id,
    title: workerProfileByUserId.get(worker.id)?.title ?? null,
  }));
  const workerDirectory = (workerRows ?? []).map((worker) => ({
    email: worker.email,
    fullName: worker.full_name,
    id: worker.id,
    phone: workerProfileByUserId.get(worker.id)?.phone ?? null,
    powerLevel: worker.power_level,
    title: workerProfileByUserId.get(worker.id)?.title ?? null,
  }));
  const equipmentAttachmentPaths = Array.from(
    new Set([
      ...reachableEquipmentDocumentRows.flatMap((document) => document.attachment_ids ?? []),
      ...(equipmentMaintenanceRows ?? []).flatMap((entry) => entry.attachment_ids ?? []),
    ]),
  );
  const equipmentAttachmentSignedUrls = new Map<string, string | null>();

  await Promise.all(
    equipmentAttachmentPaths.map(async (path) => {
      const { data } = await storageSupabase.storage.from("tenant-documents").createSignedUrl(path, 10 * 60);
      equipmentAttachmentSignedUrls.set(path, data?.signedUrl ?? null);
    }),
  );
  const equipmentSummaries = reachableEquipmentRows.map((equipment) => ({
    assignedTo: equipment.assigned_to,
    category: equipment.category,
    currentMeter: equipment.current_meter,
    id: equipment.id,
    locationId: equipment.location_id,
    make: equipment.make,
    model: equipment.model,
    name: equipment.name,
    status: equipment.status,
    tenantId: equipment.tenant_id,
    trackingMode: equipment.tracking_mode,
    unitNumber: equipment.unit_number,
    updatedAt: equipment.updated_at ?? "",
    vinOrSerial: equipment.vin_or_serial,
    year: equipment.year,
  }));
  const equipmentServiceSummaries = reachableEquipmentServiceRows.map((service) => ({
    dueDate: service.due_date,
    dueMeter: service.due_meter,
    equipmentId: service.equipment_id,
    id: service.id,
    intervalMode: service.interval_mode,
    isActive: service.is_active,
    lastCompletedAt: service.last_completed_at,
    lastCompletedMeter: service.last_completed_meter,
    recurrenceUnit: service.recurrence_unit,
    recurrenceValue: service.recurrence_value,
    serviceType: service.service_type,
    tenantId: service.tenant_id,
    title: service.title,
    updatedAt: service.updated_at ?? "",
  }));
  const equipmentDocumentSummaries = reachableEquipmentDocumentRows.map((document) => ({
    attachmentIds: document.attachment_ids ?? [],
    attachmentUrls: Object.fromEntries((document.attachment_ids ?? []).map((path) => [path, equipmentAttachmentSignedUrls.get(path) ?? null])),
    docType: document.doc_type,
    equipmentId: document.equipment_id,
    expiryDate: document.expiry_date,
    id: document.id,
    isActive: document.is_active,
    reminderLeadDays: document.reminder_lead_days,
    tenantId: document.tenant_id,
    title: document.title,
    updatedAt: document.updated_at ?? "",
  }));
  const equipmentMaintenanceSummaries = (equipmentMaintenanceRows ?? []).map((entry) => ({
    attachmentIds: entry.attachment_ids ?? [],
    attachmentUrls: Object.fromEntries((entry.attachment_ids ?? []).map((path) => [path, equipmentAttachmentSignedUrls.get(path) ?? null])),
    description: entry.description,
    equipmentId: entry.equipment_id,
    id: entry.id,
    meterAtService: entry.meter_at_service,
    performedAt: entry.performed_at,
    tenantId: entry.tenant_id,
    title: entry.title,
    type: entry.type,
    updatedAt: entry.updated_at ?? "",
    vendor: entry.vendor,
  }));
  const equipmentMeterSummaries = (equipmentMeterRows ?? []).map((entry) => ({
    equipmentId: entry.equipment_id,
    id: entry.id,
    recordedAt: entry.recorded_at,
    source: entry.source,
    tenantId: entry.tenant_id,
    updatedAt: entry.updated_at ?? "",
    value: entry.value,
  }));
  const equipmentLinkedSubmissionById = new Map((equipmentLinkedSubmissionRows ?? []).map((submission) => [submission.id, submission]));
  const equipmentLinkedFormById = new Map((equipmentLinkedFormRows ?? []).map((form) => [form.id, form]));
  const equipmentSubmitterById = new Map((workerRows ?? []).map((worker) => [worker.id, worker]));
  const equipmentLocationById = new Map((locationRows ?? []).map((location) => [location.id, location]));
  const equipmentLinkedSubmissionSummaries = (equipmentSubmissionLinkRows ?? []).flatMap((link) => {
    const submission = equipmentLinkedSubmissionById.get(link.submission_id);
    const form = submission ? equipmentLinkedFormById.get(submission.form_id) : null;
    const submitter = submission?.submitted_by ? equipmentSubmitterById.get(submission.submitted_by) : null;
    const location = submission?.location_id ? equipmentLocationById.get(submission.location_id) : null;

    if (
      submission &&
      !canAccessLocationByReach({
        assignedLocationIds,
        includeUnassignedLocation: true,
        locationId: submission.location_id,
        reachType: context.appUser.reach_type,
      })
    ) {
      return [];
    }

    return [
      {
        equipmentId: link.equipment_id,
        formCode: form?.code ?? null,
        formId: submission?.form_id ?? null,
        formName: form?.name ?? link.form_type ?? "Completed form",
        formType: link.form_type,
        id: link.id,
        linkedAt: link.linked_at,
        linkSource: link.link_source,
        locationName: location ? `${location.name}${location.code ? ` (${location.code})` : ""}` : null,
        submittedAt: submission?.submitted_at ?? submission?.created_at ?? null,
        submissionId: link.submission_id,
        submitterName: submitter?.full_name ?? null,
        tenantId: link.tenant_id,
        updatedAt: link.updated_at ?? link.linked_at,
      },
    ];
  });
  const equipmentLocationSummaries = locationOptions.map((location) => ({
    code: location.code,
    id: location.id,
    name: location.name,
    tenantId: context.appUser.tenant_id,
  }));
  const equipmentAssigneeSummaries = (workerRows ?? []).map((worker) => ({
    fullName: worker.full_name,
    id: worker.id,
    tenantId: context.appUser.tenant_id,
  }));
  const currentWorkerProfile = workerProfileByUserId.get(context.appUser.id);
  const [{ data: workerCertifications }, { data: workerSignatures }, { data: submittedDocumentRows }] =
    await Promise.all([
      currentWorkerProfile?.id
        ? supabase
            .from("certifications")
            .select("*")
            .eq("tenant_id", context.appUser.tenant_id)
            .eq("worker_profile_id", currentWorkerProfile.id)
            .order("expires_on", { ascending: true })
            .returns<CertificationRow[]>()
        : Promise.resolve({ data: [] as CertificationRow[] }),
      supabase
        .from("signatures")
        .select("id, submission_id, signer_name, signature_path, signed_at")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("signer_user_id", context.appUser.id)
        .order("signed_at", { ascending: false })
        .limit(20)
        .returns<SignatureSummaryRow[]>(),
      supabase
        .from("submissions")
        .select("id, form_id, location_id, status, sync_state, submitted_at, created_at, submitted_by")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("submitted_by", context.appUser.id)
        .order("created_at", { ascending: false })
        .limit(20)
        .returns<WorkerDocumentSubmissionRow[]>(),
    ]);
  const signOffSourceSubmissionIds = (submittedDocumentRows ?? []).map((submission) => submission.id);
  const { data: signOffFollowUpRows } =
    signOffSourceSubmissionIds.length > 0
      ? await supabase
          .from("follow_ups")
          .select("id, title, description, status, assigned_to, parent_submission_id, due_at, created_at")
          .eq("tenant_id", context.appUser.tenant_id)
          .eq("status", "completed")
          .in("parent_submission_id", signOffSourceSubmissionIds)
          .order("created_at", { ascending: false })
          .returns<FollowUpRow[]>()
      : { data: [] as FollowUpRow[] };
  const signatureSubmissionIds = Array.from(new Set((workerSignatures ?? []).map((signature) => signature.submission_id)));
  const { data: signedDocumentRows } =
    signatureSubmissionIds.length > 0
      ? await supabase
          .from("submissions")
          .select("id, form_id, location_id, status, sync_state, submitted_at, created_at, submitted_by")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", signatureSubmissionIds)
          .returns<WorkerDocumentSubmissionRow[]>()
      : { data: [] as WorkerDocumentSubmissionRow[] };
  const workerDocumentSubmissions = mergeWorkerDocumentSubmissions([signedDocumentRows ?? [], submittedDocumentRows ?? []])
    .filter((submission) =>
      canAccessLocationByReach({
        assignedLocationIds,
        includeUnassignedLocation: true,
        locationId: submission.location_id,
        reachType: context.appUser.reach_type,
      }),
    )
    .slice(0, 20);
  const workerDocumentFormIds = Array.from(new Set(workerDocumentSubmissions.map((submission) => submission.form_id)));
  const workerDocumentLocationIds = Array.from(
    new Set(workerDocumentSubmissions.map((submission) => submission.location_id).filter((id): id is string => Boolean(id))),
  );
  const [{ data: workerDocumentForms }, { data: workerDocumentLocations }, { data: workerDocumentRegisters }] =
    workerDocumentSubmissions.length > 0
      ? await Promise.all([
          workerDocumentFormIds.length > 0
            ? supabase
                .from("forms")
                .select("id, name, code")
                .eq("tenant_id", context.appUser.tenant_id)
                .in("id", workerDocumentFormIds)
                .returns<WorkerDocumentFormRow[]>()
            : Promise.resolve({ data: [] as WorkerDocumentFormRow[] }),
          workerDocumentLocationIds.length > 0
            ? supabase
                .from("locations")
                .select("id, name, code")
                .eq("tenant_id", context.appUser.tenant_id)
                .in("id", workerDocumentLocationIds)
                .returns<WorkerDocumentLocationRow[]>()
            : Promise.resolve({ data: [] as WorkerDocumentLocationRow[] }),
          workerDocumentFormIds.length > 0
            ? supabase
                .from("document_control_register")
                .select("source_id, dcn")
                .eq("tenant_id", context.appUser.tenant_id)
                .eq("source_table", "forms")
                .in("source_id", workerDocumentFormIds)
                .returns<WorkerDocumentRegisterRow[]>()
            : Promise.resolve({ data: [] as WorkerDocumentRegisterRow[] }),
        ])
      : [
          { data: [] as WorkerDocumentFormRow[] },
          { data: [] as WorkerDocumentLocationRow[] },
          { data: [] as WorkerDocumentRegisterRow[] },
        ];
  const recordAttachmentPaths = Array.from(
    new Set([
      ...(workerCertifications ?? []).map((certification) => certification.attachment_path).filter(isStoragePath),
      ...(workerSignatures ?? []).map((signature) => signature.signature_path).filter(isStoragePath),
    ]),
  );
  const recordSignedUrls = new Map<string, string | null>();

  await Promise.all(
    recordAttachmentPaths.map(async (path) => {
      const { data } = await storageSupabase.storage.from("tenant-documents").createSignedUrl(path, 10 * 60);
      recordSignedUrls.set(path, data?.signedUrl ?? null);
    }),
  );
  const workerDocumentFormById = new Map((workerDocumentForms ?? []).map((form) => [form.id, form]));
  const workerDocumentLocationById = new Map((workerDocumentLocations ?? []).map((location) => [location.id, location]));
  const workerDocumentDcnByFormId = new Map((workerDocumentRegisters ?? []).map((document) => [document.source_id, document.dcn]));
  const workerSignatureCountsBySubmissionId = countWorkerSignaturesBySubmissionId(workerSignatures ?? []);
  const workerSignaturesBySubmissionId = new Map<string, SignatureSummaryRow[]>();

  for (const signature of workerSignatures ?? []) {
    const submissionSignatures = workerSignaturesBySubmissionId.get(signature.submission_id) ?? [];
    submissionSignatures.push(signature);
    workerSignaturesBySubmissionId.set(signature.submission_id, submissionSignatures);
  }
  const equipmentLinkableSubmissionSummaries = workerDocumentSubmissions.map((submission) => {
    const form = workerDocumentFormById.get(submission.form_id);
    const location = submission.location_id ? workerDocumentLocationById.get(submission.location_id) : null;
    const submitter = submission.submitted_by ? equipmentSubmitterById.get(submission.submitted_by) : null;
    const submittedAt = submission.submitted_at ?? submission.created_at ?? null;

    return {
      formCode: form?.code ?? null,
      formId: submission.form_id,
      formName: form?.name ?? form?.code ?? "Completed form",
      formType: form?.code ?? null,
      id: submission.id,
      locationName: location ? `${location.name}${location.code ? ` (${location.code})` : ""}` : null,
      submittedAt,
      submitterName: submitter?.full_name ?? context.appUser.full_name,
      tenantId: context.appUser.tenant_id,
      updatedAt: submittedAt ?? new Date().toISOString(),
    };
  });
  const notifications = notificationRows ?? [];
  const unreadNotifications = notifications.filter((notification) => !notification.read_at).length;
  const signOffFollowUpIds = new Set((signOffFollowUpRows ?? []).map((followUp) => followUp.id));
  const mergedFollowUpRows = [...(followUpRows ?? [])];

  for (const followUp of signOffFollowUpRows ?? []) {
    if (!mergedFollowUpRows.some((candidate) => candidate.id === followUp.id)) {
      mergedFollowUpRows.push(followUp);
    }
  }

  // Where to route a vehicle-defect corrective action raised from a failed
  // inspection: the designated maintenance owner if set, otherwise a tenant admin
  // so it never lands on the driver who reported it.
  const { data: maintenanceSettingsRow } = await supabase
    .from("company_settings")
    .select("maintenance_contact_user_id")
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ maintenance_contact_user_id: string | null }>();
  let maintenanceContactUserId = maintenanceSettingsRow?.maintenance_contact_user_id ?? null;

  if (!maintenanceContactUserId) {
    const { data: fallbackAdmin } = await supabase
      .from("users")
      .select("id")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .eq("power_level", "super_admin")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string }>();
    maintenanceContactUserId = fallbackAdmin?.id ?? null;
  }

  const followUps = mergedFollowUpRows.filter(
    (followUp) => signOffFollowUpIds.has(followUp.id) || (followUp.status !== "completed" && followUp.status !== "signed_off"),
  );
  const scheduleById = new Map((scheduleRows ?? []).map((schedule) => [schedule.id, schedule]));
  const scheduledTasks = (scheduledTaskRows ?? [])
    .map((task) => ({
      ...task,
      displayStatus: classifyScheduledTaskStatus({ dueAt: task.due_at, status: task.status }),
    }))
    .filter((task) => task.displayStatus !== "completed");
  const scheduledFormAssignments = scheduledTasks
    .flatMap((task) => {
      const schedule = scheduleById.get(task.schedule_id);

      if (!schedule?.form_id) {
        return [];
      }

      return [
        {
          displayStatus: task.displayStatus,
          dueAt: task.due_at,
          formId: schedule.form_id,
          locationId: schedule.location_id,
          scheduleName: schedule.name,
          taskId: task.id,
        },
      ];
    })
    .filter((assignment) =>
      canAccessLocationByReach({
        assignedLocationIds,
        includeUnassignedLocation: true,
        locationId: assignment.locationId,
        reachType: context.appUser.reach_type,
      }),
    );
  const visibleScheduledTaskIds = new Set(scheduledFormAssignments.map((assignment) => assignment.taskId));
  const visibleScheduledTasks = scheduledTasks.filter((task) => visibleScheduledTaskIds.has(task.id));
  const workflowStepById = new Map((workflowStepRows ?? []).map((step) => [step.id, step]));
  const workflowRunById = new Map((workflowRunRows ?? []).map((run) => [run.id, run]));
  const workflowById = new Map((workflowRows ?? []).map((workflow) => [workflow.id, workflow]));
  const workflowFormAssignments = (workflowRunStepRows ?? [])
    .map((runStep) => {
      const step = workflowStepById.get(runStep.workflow_step_id);
      const run = workflowRunById.get(runStep.workflow_run_id);

      if (!step?.form_id || !run || run.completed_at || run.status === "completed") {
        return null;
      }

      const workflow = workflowById.get(run.workflow_id) ?? workflowById.get(step.workflow_id);
      const displayStatus = classifyWorkflowRunStepStatus({ step: runStep });

      if (displayStatus === "completed") {
        return null;
      }

      return {
        displayStatus,
        dueAt: runStep.due_at,
        formId: step.form_id,
        locationId: run.location_id,
        runStepId: runStep.id,
        workflowName: workflow?.name ?? "Workflow",
      };
    })
    .filter((assignment): assignment is NonNullable<typeof assignment> => Boolean(assignment))
    .filter((assignment) =>
      canAccessLocationByReach({
        assignedLocationIds,
        includeUnassignedLocation: true,
        locationId: assignment.locationId,
        reachType: context.appUser.reach_type,
      }),
    );
  const outstandingCount = followUps.length + visibleScheduledTasks.length + workflowFormAssignments.length;
  const hasEquipmentSurface = equipmentSummaries.length > 0;
  const changeOrdersOn =
    Boolean(context.tenant?.change_orders_enabled);
  const dailyInspectionOn =
    Boolean(context.tenant?.daily_inspection_enabled);
  const tradesOn = Boolean(context.tenant?.trades_enabled);
  const equipmentLabelById = new Map(
    equipmentSummaries.map((equipment) => [
      equipment.id,
      equipment.name ? `${equipment.unitNumber} - ${equipment.name}` : equipment.unitNumber,
    ]),
  );
  const inspectionVehicles = dailyInspectionOn
    ? equipmentSummaries
        .filter(
          (equipment) =>
            equipment.status === "active" &&
            (equipment.category === "vehicle" ||
              equipment.category === "trailer" ||
              equipment.category === "mobile_equipment"),
        )
        .map((equipment) => ({
          id: equipment.id,
          category: equipment.category,
          label: equipmentLabelById.get(equipment.id) ?? equipment.unitNumber,
        }))
    : [];
  const baseNav = hasEquipmentSurface ? mobileNav : mobileNav.filter((item) => item.label !== "Equipment");
  const navWithChangeOrders = changeOrdersOn
    ? [...baseNav, { href: "#field-tickets", label: "Variations", icon: FileSignature }]
    : baseNav;
  const mobileNavItems = dailyInspectionOn
    ? [...navWithChangeOrders, { href: "#trip-inspections", label: "Inspections", icon: ClipboardCheck }]
    : navWithChangeOrders;

  // Hours of Service self-logging: only for a worker whose account is linked to a
  // transport_driver, when the Transport module is on.
  let workerHos: Parameters<typeof WorkerHosPanel>[0] | null = null;

  if (context.tenant?.transport_enabled) {
    const { data: myDriver } = await supabase
      .from("transport_driver")
      .select("id, hos_cycle, hos_regime")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("user_id", context.appUser.id)
      .is("deleted_at", null)
      .maybeSingle<{ id: string; hos_cycle: "cycle_1" | "cycle_2"; hos_regime: "federal" | "provincial_ab" }>();

    if (myDriver) {
      const { data: myDutyEvents } = await supabase
        .from("transport_duty_status_event")
        .select("status, started_at")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("driver_id", myDriver.id)
        .gte("started_at", hosEventWindowStartIso())
        .order("started_at", { ascending: true })
        .returns<{ status: DutyStatusEvent["status"]; started_at: string }[]>();

      const events: DutyStatusEvent[] = (myDutyEvents ?? []).map((event) => ({
        status: event.status,
        startedAt: event.started_at,
      }));
      const regime = coerceHosRegime(myDriver.hos_regime);
      const ruleset = HOS_RULESETS[regime];
      const availability = computeAvailability({ events, cycle: myDriver.hos_cycle, regime });
      const violations = computeHosViolations({ events, cycle: myDriver.hos_cycle, regime });
      const clocks = [
        { label: "Drive left", value: availability.driveRemainingHours, of: ruleset.drivingHours },
        { label: "On-duty left", value: availability.onDutyRemainingHours, of: ruleset.onDutyHours },
        ...(availability.windowRemainingHours !== null
          ? [{ label: "Window left", value: availability.windowRemainingHours, of: ruleset.elapsedWindowHours ?? 0 }]
          : []),
        ...(availability.cycleRemainingHours !== null
          ? [{ label: "Cycle left", value: availability.cycleRemainingHours, of: myDriver.hos_cycle === "cycle_2" ? 120 : 70 }]
          : []),
      ];

      workerHos = {
        currentStatus: availability.currentStatus,
        currentStatusLabel: DUTY_STATUS_LABELS[availability.currentStatus],
        regimeLabel: HOS_REGIME_LABELS[regime],
        clocks,
        violations: violations.length,
      };
    }
  }

  // Field variations (change requests) capture: active projects to pick from and
  // the worker's own recent submissions. Only when the module is on for the tenant.
  let fieldTicketProjects: { id: string; name: string }[] = [];
  let fieldTicketItems: {
    id: string;
    title: string;
    status: "open" | "promoted" | "dismissed";
    created_at: string;
    project_name: string | null;
  }[] = [];

  if (changeOrdersOn) {
    const [{ data: coProjectRows }, { data: fieldTicketRows }] = await Promise.all([
      supabase
        .from("co_project")
        .select("id, name")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .returns<{ id: string; name: string }[]>(),
      supabase
        .from("field_ticket")
        .select("id, title, status, created_at, project_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("submitted_by", context.appUser.id)
        .order("created_at", { ascending: false })
        .limit(10)
        .returns<
          { id: string; title: string; status: "open" | "promoted" | "dismissed"; created_at: string; project_id: string | null }[]
        >(),
    ]);

    fieldTicketProjects = coProjectRows ?? [];
    const projectNameById = new Map(fieldTicketProjects.map((project) => [project.id, project.name]));
    fieldTicketItems = (fieldTicketRows ?? []).map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      created_at: ticket.created_at,
      project_name: ticket.project_id ? projectNameById.get(ticket.project_id) ?? null : null,
    }));
  }

  // The signed-in worker's own assigned trade work orders, for the My Work panel.
  let myWorkOrders: Parameters<typeof MyWorkOrdersPanel>[0]["workOrders"] = [];
  let clockedOnWorkOrderId: string | null = null;

  if (tradesOn) {
    const { data: openTimeEntry } = await supabase
      .from("trade_work_order_time")
      .select("work_order_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("user_id", context.appUser.id)
      .is("ended_at", null)
      .maybeSingle<{ work_order_id: string }>();
    clockedOnWorkOrderId = openTimeEntry?.work_order_id ?? null;

    const { data: workOrderRows } = await supabase
      .from("trade_work_order")
      .select("id, title, status, work_type, scheduled_start, scheduled_end, customer_id, service_address_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("assigned_user_id", context.appUser.id)
      .in("status", ["open", "scheduled", "in_progress"])
      .order("scheduled_start", { ascending: true, nullsFirst: false })
      .returns<
        {
          id: string;
          title: string;
          status: "open" | "scheduled" | "in_progress" | "completed" | "cancelled";
          work_type: "service_call" | "project";
          scheduled_start: string | null;
          scheduled_end: string | null;
          customer_id: string;
          service_address_id: string | null;
        }[]
      >();
    const rows = workOrderRows ?? [];

    if (rows.length > 0) {
      const customerIds = [...new Set(rows.map((row) => row.customer_id))];
      const addressIds = [...new Set(rows.map((row) => row.service_address_id).filter((id): id is string => Boolean(id)))];
      const workOrderIds = rows.map((row) => row.id);
      const [{ data: customerRows }, { data: addressRows }, { data: taskRows }, { data: equipmentRows }] = await Promise.all([
        supabase
          .from("trade_customer")
          .select("id, name")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", customerIds)
          .returns<{ id: string; name: string }[]>(),
        addressIds.length > 0
          ? supabase
              .from("trade_service_address")
              .select("id, line1, line2, city, region, postal_code")
              .eq("tenant_id", context.appUser.tenant_id)
              .in("id", addressIds)
              .returns<{ id: string; line1: string; line2: string | null; city: string | null; region: string | null; postal_code: string | null }[]>()
          : Promise.resolve({ data: [] as { id: string; line1: string; line2: string | null; city: string | null; region: string | null; postal_code: string | null }[] }),
        supabase
          .from("trade_work_order_task")
          .select("id, work_order_id, label, position, done")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("work_order_id", workOrderIds)
          .order("position", { ascending: true })
          .returns<{ id: string; work_order_id: string; label: string; position: number; done: boolean }[]>(),
        supabase
          .from("trade_customer_equipment")
          .select("id, customer_id, equipment_type, make, model, condition, needs_follow_up")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("customer_id", customerIds)
          .order("created_at", { ascending: false })
          .returns<
            {
              id: string;
              customer_id: string;
              equipment_type: string | null;
              make: string | null;
              model: string | null;
              condition: "good" | "monitor" | "needs_replacement" | null;
              needs_follow_up: boolean;
            }[]
          >(),
      ]);
      const customerNameById = new Map((customerRows ?? []).map((customer) => [customer.id, customer.name]));
      const addressById = new Map(
        (addressRows ?? []).map((address) => [
          address.id,
          [address.line1, address.line2, address.city, address.region, address.postal_code].filter(Boolean).join(", "),
        ]),
      );
      const tasksByWorkOrder = new Map<string, { id: string; label: string; done: boolean }[]>();
      for (const task of taskRows ?? []) {
        const list = tasksByWorkOrder.get(task.work_order_id) ?? [];
        list.push({ id: task.id, label: task.label, done: task.done });
        tasksByWorkOrder.set(task.work_order_id, list);
      }
      const equipmentByCustomer = new Map<
        string,
        { id: string; title: string; condition: "good" | "monitor" | "needs_replacement" | null; needs_follow_up: boolean }[]
      >();
      for (const unit of equipmentRows ?? []) {
        const list = equipmentByCustomer.get(unit.customer_id) ?? [];
        const title =
          unit.equipment_type || [unit.make, unit.model].filter(Boolean).join(" ") || "Equipment";
        list.push({ id: unit.id, title, condition: unit.condition, needs_follow_up: unit.needs_follow_up });
        equipmentByCustomer.set(unit.customer_id, list);
      }

      myWorkOrders = rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        work_type: row.work_type,
        customer_name: customerNameById.get(row.customer_id) ?? "Customer",
        address: row.service_address_id ? addressById.get(row.service_address_id) ?? null : null,
        schedule: formatWorkOrderSchedule(row.scheduled_start, row.scheduled_end),
        tasks: tasksByWorkOrder.get(row.id) ?? [],
        equipment: equipmentByCustomer.get(row.customer_id) ?? [],
      }));
    }
  }

  // The signed-in driver's own recent trip inspections, for the worker panel.
  let inspectionRecent: Parameters<typeof DailyInspectionPanel>[0]["recent"] = [];

  if (dailyInspectionOn) {
    const { data: inspectionRows } = await supabase
      .from("dti_inspection")
      .select("id, equipment_id, province, overall_result, out_of_service, out_of_service_cleared_at, completed_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("driver_user_id", context.appUser.id)
      .order("completed_at", { ascending: false })
      .limit(10)
      .returns<
        {
          id: string;
          equipment_id: string;
          province: "BC" | "AB" | "ON";
          overall_result: "clean" | "minor" | "major";
          out_of_service: boolean;
          out_of_service_cleared_at: string | null;
          completed_at: string;
        }[]
      >();

    inspectionRecent = (inspectionRows ?? []).map((row) => ({
      id: row.id,
      vehicleLabel: equipmentLabelById.get(row.equipment_id) ?? "Vehicle",
      province: row.province,
      overall_result: row.overall_result,
      outOfService: row.out_of_service && !row.out_of_service_cleared_at,
      completed_at: row.completed_at,
    }));
  }

  // Inventory field capture: the worker records stock moving between real places, offline.
  const inventoryOn = Boolean(context.tenant?.inventory_enabled);
  let inventoryPlaces: { id: string; label: string }[] = [];
  let inventoryItems: { id: string; name: string; unit: string }[] = [];

  if (inventoryOn) {
    const [{ data: placeRows }, { data: itemRows }, { data: invLocations }, { data: invUsers }] = await Promise.all([
      supabase
        .from("inventory_location")
        .select("id, kind, name, location_id, equipment_id, user_id, active")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("active", true)
        .not("kind", "in", "(transit,loss)")
        .returns<
          {
            id: string;
            kind: string;
            name: string | null;
            location_id: string | null;
            equipment_id: string | null;
            user_id: string | null;
            active: boolean;
          }[]
        >(),
      supabase
        .from("inventory_item")
        .select("id, name, unit_of_measure")
        .eq("tenant_id", context.appUser.tenant_id)
        .is("deleted_at", null)
        .eq("active", true)
        .order("name", { ascending: true })
        .returns<{ id: string; name: string; unit_of_measure: string }[]>(),
      supabase
        .from("locations")
        .select("id, name")
        .eq("tenant_id", context.appUser.tenant_id)
        .returns<{ id: string; name: string }[]>(),
      supabase
        .from("users")
        .select("id, full_name, email")
        .eq("tenant_id", context.appUser.tenant_id)
        .returns<{ id: string; full_name: string | null; email: string }[]>(),
    ]);

    const invLocationName = new Map((invLocations ?? []).map((row) => [row.id, row.name]));
    const invEquipmentName = equipmentLabelById;
    const invUserName = new Map((invUsers ?? []).map((row) => [row.id, row.full_name || row.email]));

    inventoryPlaces = (placeRows ?? [])
      .map((place) => {
        const backing =
          (place.location_id ? invLocationName.get(place.location_id) : null) ??
          (place.equipment_id ? invEquipmentName.get(place.equipment_id) : null) ??
          (place.user_id ? invUserName.get(place.user_id) : null) ??
          place.name ??
          "Place";
        return { id: place.id, label: backing };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    inventoryItems = (itemRows ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      unit: item.unit_of_measure,
    }));
  }

  const showInventoryPanel = inventoryOn && inventoryPlaces.length >= 2 && inventoryItems.length >= 1;

  return (
    <main className="min-h-screen scroll-smooth bg-[var(--background)] pb-24 md:pb-0" id="home">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--primary)]">{context.tenant?.name ?? "Core Pathways"}</p>
            <h1 className="truncate text-xl font-bold text-[var(--ink)]">Web App</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/choose"
            >
              Switch
            </Link>
            <form action={signOut}>
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)]"
                title="Sign out"
                type="submit"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {notice ? (
            <p className="rounded-md border border-[var(--success)] bg-emerald-50 px-4 py-3 text-sm font-semibold text-[var(--success)]">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md border border-[var(--danger)] bg-red-50 px-4 py-3 text-sm font-semibold text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <OfflineStatus
            fullName={context.appUser.full_name}
            offlineSyncDays={context.appUser.offline_sync_days}
            tenantId={context.appUser.tenant_id}
            tenantName={context.tenant?.name ?? "Core Pathways"}
            userId={context.appUser.id}
          />

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Time Card</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  {openWorkerTimeCard ? "You are currently counted on the emergency roster." : "Clock in when you arrive on site."}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <Clock3 className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            {openWorkerTimeCard ? (
              <div className="mt-4 grid gap-4 rounded-md border border-[var(--border)] bg-white p-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="grid gap-2 text-sm">
                  <p className="font-semibold text-[var(--ink)]">{openTimeCardLocation?.name ?? "Unknown location"}</p>
                  <p className="text-[var(--ink-muted)]">Clocked in {formatDateTime(openWorkerTimeCard.clocked_in_at)}</p>
                  {openWorkerTimeCard.note ? (
                    <p className="text-[var(--ink-muted)]">{openWorkerTimeCard.note}</p>
                  ) : null}
                </div>
                <form action={clockOutWorkerTimeCard}>
                  <button
                    className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 sm:w-auto"
                    type="submit"
                  >
                    Clock Out
                  </button>
                </form>
              </div>
            ) : (
              <form action={clockInWorkerTimeCard} className="mt-4 grid gap-3 rounded-md border border-[var(--border)] bg-white p-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Location</span>
                  <select
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    disabled={locationOptions.length === 0}
                    name="locationId"
                    required
                  >
                    {locationOptions.length === 0 ? <option value="">No active locations available</option> : null}
                    {locationOptions.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.code ? `${location.name} (${location.code})` : location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Note</span>
                  <input
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    disabled={locationOptions.length === 0}
                    name="note"
                    placeholder="Optional"
                  />
                </label>
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={locationOptions.length === 0}
                  type="submit"
                >
                  Clock In
                </button>
              </form>
            )}
          </section>

          <section className="scroll-mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" id="site-roster">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Emergency Site Roster</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  {openWorkerTimeCard
                    ? `${currentSiteActiveCount} active at your current site.`
                    : "Clock in to add yourself to the roster."}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <UsersRound className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-[var(--border)] bg-white p-3">
                <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Active people</p>
                <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{siteRoster.totalPeople}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] bg-white p-3">
                <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Visitors</p>
                <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{siteRoster.totalVisitors}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] bg-white p-3">
                <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Workers</p>
                <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{siteRoster.totalWorkers}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4">
              {siteRosterGroups.length > 0 ? (
                siteRosterGroups.map((group) => {
                  const activeCount = siteRosterActiveCount(group);
                  const isCurrentSite = openWorkerTimeCard?.location_id === group.locationId;

                  return (
                    <article className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4" key={group.locationId}>
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-[var(--ink)]">{visitorRosterLocationLabel(group)}</h3>
                          <p className="text-sm text-[var(--ink-muted)]">{activeCount} active on site</p>
                        </div>
                        {isCurrentSite ? (
                          <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-[var(--success)]">
                            Current site
                          </span>
                        ) : null}
                      </div>
                      {siteRosterRows(group)}
                    </article>
                  );
                })
              ) : (
                <div className="rounded-md border border-dashed border-[var(--border)] bg-white p-6 text-center text-sm text-[var(--ink-muted)]">
                  No active locations are available for your roster.
                </div>
              )}
            </div>
          </section>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <UserRound className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">{context.appUser.full_name}</h2>
                <p className="text-sm text-[var(--ink-muted)]">{formatPowerLevel(context.appUser.power_level)}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-[var(--border)] p-3">
                <Wifi className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-[var(--ink)]">Offline sync</p>
                <p className="text-sm text-[var(--ink-muted)]">{formatSyncDays(context.appUser.offline_sync_days)}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] p-3">
                <MapPin className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-[var(--ink)]">Reach</p>
                <p className="text-sm text-[var(--ink-muted)]">
                  {context.appUser.reach_type === "all_locations" ? "All locations" : "Assigned locations"}
                </p>
              </div>
              <div className="rounded-md border border-[var(--border)] p-3">
                <Bell className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-[var(--ink)]">Outstanding</p>
                <p className="text-sm text-[var(--ink-muted)]">{outstandingCount > 0 ? `${outstandingCount} open` : "All caught up"}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Outstanding Work</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  {outstandingCount > 0 ? `${outstandingCount} assigned items` : "No assigned work"}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <ClipboardList className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            {outstandingCount > 0 ? (
              <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                {followUps.map((followUp) => {
                  const canSignOff = signOffFollowUpIds.has(followUp.id);

                  return (
                    <article className="grid gap-3 p-3 sm:grid-cols-[1fr_auto]" key={followUp.id}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-[var(--ink)]">{followUp.title}</p>
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${followUpStatusClass(followUp.status)}`}>
                            {formatFollowUpStatus(followUp.status)}
                          </span>
                          {canSignOff ? (
                            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-[var(--success)]">
                              Ready for sign-off
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                          {followUp.description ?? "Corrective action assigned from a flagged form item."}
                        </p>
                        {followUp.due_at ? (
                          <p className="mt-1 text-xs text-[var(--ink-muted)]">Due {formatDateTime(followUp.due_at)}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2 sm:flex-col">
                        {canSignOff ? (
                          <form action={signOffFlaggedFollowUp}>
                            <input name="followUpId" type="hidden" value={followUp.id} />
                            <button
                              className="inline-flex h-9 w-full items-center justify-center rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              type="submit"
                            >
                              Sign Off
                            </button>
                          </form>
                        ) : (
                          <>
                            {followUp.status !== "in_progress" ? (
                              <form action={updateAssignedFollowUpStatus}>
                                <input name="followUpId" type="hidden" value={followUp.id} />
                                <input name="status" type="hidden" value="in_progress" />
                                <button
                                  className="inline-flex h-9 w-full items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                                  type="submit"
                                >
                                  Start
                                </button>
                              </form>
                            ) : null}
                            <form action={updateAssignedFollowUpStatus}>
                              <input name="followUpId" type="hidden" value={followUp.id} />
                              <input name="status" type="hidden" value="completed" />
                              <button
                                className="inline-flex h-9 w-full items-center justify-center rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                                type="submit"
                              >
                                Mark Complete
                              </button>
                            </form>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
                {visibleScheduledTasks.map((task) => {
                  const schedule = scheduleById.get(task.schedule_id);

                  return (
                    <article className="grid gap-3 p-3 sm:grid-cols-[1fr_auto]" key={task.id}>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-[var(--ink)]">{schedule?.name ?? "Scheduled task"}</p>
                          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-[var(--warning)]">
                            Scheduled
                          </span>
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${workerAssignmentStatusClass(task.displayStatus, task.due_at)}`}>
                            {workerAssignmentStatusLabel(task.displayStatus, task.due_at)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">Scheduled form assignment.</p>
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">Due {formatDateTime(task.due_at)}</p>
                      </div>
                      {schedule?.form_id ? (
                        <Link
                          className="inline-flex h-9 w-full items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 sm:w-auto"
                          href={`/web?assignmentSource=scheduled&assignmentId=${task.id}#forms`}
                        >
                          Go to Scheduled Task
                        </Link>
                      ) : null}
                    </article>
                  );
                })}
                {workflowFormAssignments.map((assignment) => (
                  <article className="grid gap-3 p-3 sm:grid-cols-[1fr_auto]" key={assignment.runStepId}>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[var(--ink)]">{assignment.workflowName}</p>
                        <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-[var(--primary)]">
                          Workflow
                        </span>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${workerAssignmentStatusClass(
                            assignment.displayStatus,
                            assignment.dueAt,
                          )}`}
                        >
                          {workerAssignmentStatusLabel(assignment.displayStatus, assignment.dueAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">Workflow form assignment.</p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        {assignment.dueAt ? `Due ${formatDateTime(assignment.dueAt)}` : "No due date set"}
                      </p>
                    </div>
                    <Link
                      className="inline-flex h-9 w-full items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 sm:w-auto"
                      href={`/web?assignmentSource=workflow&assignmentId=${assignment.runStepId}#forms`}
                    >
                      Go to Workflow Step
                    </Link>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
                Workflow assignments, scheduled forms, and corrective actions will appear here.
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Notifications</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  {unreadNotifications > 0 ? `${unreadNotifications} unread` : notifications.length > 0 ? `${notifications.length} recent` : "No recent notices"}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <Bell className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            {notifications.length > 0 ? (
              <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                {notifications.map((notification) => (
                  <article className="grid gap-3 p-3 sm:grid-cols-[1fr_auto]" key={notification.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[var(--ink)]">{notification.title}</p>
                        {!notification.read_at ? (
                          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-[var(--warning)]">
                            New
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{notification.body}</p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">{formatDateTime(notification.created_at)}</p>
                    </div>
                    {!notification.read_at ? (
                      <form action={markNotificationRead}>
                        <input name="notificationId" type="hidden" value={notification.id} />
                        <button
                          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          type="submit"
                        >
                          Mark Read
                        </button>
                      </form>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
                Auto-share, workflow, and certification notices will appear here.
              </div>
            )}
          </div>

          <div className="scroll-mt-5" id="forms">
            <AssignedFormsPanel
              equipment={equipmentSummaries}
              initialForms={initialForms}
              locations={locationOptions}
              maintenanceContactUserId={maintenanceContactUserId}
              offlineSyncDays={context.appUser.offline_sync_days}
              scheduledAssignments={scheduledFormAssignments}
              tenantId={context.appUser.tenant_id}
              userId={context.appUser.id}
              workflowAssignments={workflowFormAssignments}
              workers={workerOptions}
            />
          </div>

          <ResourceLibraryPanel
            initialResources={resourceSummaries}
            initialSections={resourceSectionSummaries}
            offlineSyncDays={context.appUser.offline_sync_days}
            referenceSearch={referenceSearch}
            tenantId={context.appUser.tenant_id}
          />

          {workerHos ? <WorkerHosPanel {...workerHos} /> : null}

          {tradesOn ? (
            <MyWorkOrdersPanel clockedOnWorkOrderId={clockedOnWorkOrderId} workOrders={myWorkOrders} />
          ) : null}

          {changeOrdersOn ? (
            <FieldTicketsPanel projects={fieldTicketProjects} tickets={fieldTicketItems} />
          ) : null}

          {dailyInspectionOn ? (
            <DailyInspectionPanel recent={inspectionRecent} vehicles={inspectionVehicles} />
          ) : null}

          {showInventoryPanel ? (
            <InventoryFieldPanel
              items={inventoryItems}
              places={inventoryPlaces}
              tenantId={context.appUser.tenant_id}
              userId={context.appUser.id}
            />
          ) : null}

          {hasEquipmentSurface ? (
            <EquipmentPanel
              initialAssignees={equipmentAssigneeSummaries}
              initialDocuments={equipmentDocumentSummaries}
              initialEquipment={equipmentSummaries}
              initialLocations={equipmentLocationSummaries}
              initialMaintenance={equipmentMaintenanceSummaries}
              initialMeterReadings={equipmentMeterSummaries}
              initialLinkedSubmissions={equipmentLinkedSubmissionSummaries}
              initialLinkableSubmissions={equipmentLinkableSubmissionSummaries}
              initialServices={equipmentServiceSummaries}
              offlineSyncDays={context.appUser.offline_sync_days}
              tenantId={context.appUser.tenant_id}
              userId={context.appUser.id}
            />
          ) : null}

          <section className="scroll-mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" id="records">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Records</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  {(workerCertifications ?? []).length} tickets, {workerDocumentSubmissions.length} signed or submitted documents
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <BadgeCheck className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-[var(--border)] bg-white p-4">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  <h3 className="font-semibold text-[var(--ink)]">Certification Tickets</h3>
                </div>

                <WorkerCertificationTicketForm action={uploadWorkerCertificationTicket} />

                {(workerCertifications ?? []).length > 0 ? (
                  <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                    {(workerCertifications ?? []).map((certification) => {
                      const status = certificationStatus(certification.expires_on);
                      const attachmentUrl = certification.attachment_path
                        ? recordSignedUrls.get(certification.attachment_path) ?? null
                        : null;

                      return (
                        <article className="p-3" key={certification.id}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-[var(--ink)]">{certification.name}</p>
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                {formatDate(certification.issued_on)} to {formatDate(certification.expires_on)}
                              </p>
                            </div>
                            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${certificationStatusClass(status.tone)}`}>
                              {status.label}
                            </span>
                          </div>
                          {attachmentUrl ? (
                            <a
                              className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                              href={attachmentUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                              Open Ticket
                            </a>
                          ) : (
                            <p className="mt-3 text-xs text-[var(--ink-muted)]">No ticket attachment uploaded.</p>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
                    No certification tickets have been added to your profile yet.
                  </div>
                )}
              </div>

              <div className="rounded-md border border-[var(--border)] bg-white p-4">
                <div className="flex items-center gap-2">
                  <FileSignature className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  <h3 className="font-semibold text-[var(--ink)]">Signed Documents</h3>
                </div>

                {workerDocumentSubmissions.length > 0 ? (
                  <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                    {workerDocumentSubmissions.map((submission) => {
                      const form = workerDocumentFormById.get(submission.form_id);
                      const location = submission.location_id ? workerDocumentLocationById.get(submission.location_id) : null;
                      const dcn = workerDocumentDcnByFormId.get(submission.form_id);
                      const signatureCount = workerSignatureCountsBySubmissionId.get(submission.id) ?? 0;
                      const submissionSignatures = workerSignaturesBySubmissionId.get(submission.id) ?? [];
                      const signatureUrl = submissionSignatures[0]?.signature_path
                        ? recordSignedUrls.get(submissionSignatures[0].signature_path) ?? null
                        : null;
                      const recordType = submission.submitted_by === context.appUser.id ? "Submitted by you" : "Signed by you";

                      return (
                        <article className="p-3" key={submission.id}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-[var(--ink)]">{form?.name ?? "Completed form"}</p>
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">{dcn ?? form?.code ?? submission.form_id}</p>
                            </div>
                            <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                              {recordType}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs text-[var(--ink-muted)] sm:grid-cols-2">
                            <span className="inline-flex items-center gap-1">
                              <CalendarDays className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                              {formatDate(submission.submitted_at ?? submission.created_at)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                              {location?.name ?? "No location"}
                            </span>
                            <span>{signatureCount > 0 ? `${signatureCount} signature${signatureCount === 1 ? "" : "s"}` : "No signature on file"}</span>
                            <span>{submission.status} / {submission.sync_state}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                              href={`/admin/monitor/${submission.id}/print`}
                            >
                              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                              Print Output
                            </Link>
                            {signatureUrl ? (
                              <a
                                className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                href={signatureUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                Open Signature
                              </a>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
                    Signed and submitted forms will appear here after sync.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="scroll-mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" id="workers">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Workers</h2>
                <p className="text-sm text-[var(--ink-muted)]">{workerDirectory.length} active workers</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <UsersRound className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            {workerDirectory.length > 0 ? (
              <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
                {workerDirectory.map((worker) => (
                  <article className="flex items-start gap-3 p-3" key={worker.id}>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-sm font-bold text-[var(--primary)]">
                      {workerInitials(worker.fullName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold text-[var(--ink)]">{worker.fullName}</p>
                        <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                          {formatPowerLevel(worker.powerLevel)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-[var(--ink-muted)]">{worker.title ?? "No title set"}</p>
                      <div className="mt-2 grid gap-1 text-xs text-[var(--ink-muted)] sm:grid-cols-2">
                        <a className="truncate font-medium text-[var(--primary)]" href={`mailto:${worker.email}`}>
                          {worker.email}
                        </a>
                        {worker.phone ? (
                          <a className="truncate font-medium text-[var(--primary)]" href={`tel:${worker.phone}`}>
                            {worker.phone}
                          </a>
                        ) : (
                          <span>No phone set</span>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
                No active workers are available.
              </div>
            )}
          </section>
        </div>

        <aside className="hidden h-fit overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm md:block">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Mobile Menu</h2>
          </div>
          <div
            className="grid divide-x divide-[var(--border)]"
            style={{ gridTemplateColumns: `repeat(${mobileNavItems.length}, minmax(0, 1fr))` }}
          >
            {mobileNavItems.map((item) => {
              const Icon = item.icon;

              return (
                <a
                  className="flex min-h-20 flex-col items-center justify-center gap-2 bg-white px-2 text-xs font-semibold text-[var(--ink-muted)] first:text-[var(--primary)]"
                  href={item.href}
                  key={item.label}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {item.label}
                </a>
              );
            })}
          </div>
        </aside>
      </section>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border)] bg-[var(--surface)] shadow-[0_-10px_30px_rgba(15,23,42,0.08)] md:hidden">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${mobileNavItems.length}, minmax(0, 1fr))` }}>
          {mobileNavItems.map((item) => {
            const Icon = item.icon;

            return (
              <a
                className="flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold text-[var(--ink-muted)] first:text-[var(--primary)]"
                href={item.href}
                key={item.label}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {item.label}
              </a>
            );
          })}
        </div>
      </nav>
    </main>
  );
}
