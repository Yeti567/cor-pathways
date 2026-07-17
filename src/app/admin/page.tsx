import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, AlertTriangle, BadgeCheck, BarChart3, ClipboardList, FileSliders, FileText, GitBranch, ListChecks, MapPin, Settings2, Share2, ShieldCheck, Smartphone, Truck, UserRound, UsersRound, Wrench } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel, formatAccessLevel, formatPowerLevel, formatReachType } from "@/lib/access-control";
import { requireCurrentUser } from "@/lib/current-user";
import {
  buildEquipmentAttentionItems,
  buildEquipmentDashboardCounts,
  equipmentDueStatusClass,
  formatEquipmentCategory,
  formatEquipmentMeter,
  formatEquipmentStatus,
} from "@/lib/equipment";
import { sendEquipmentAttentionNotifications } from "@/lib/equipment-reminders";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type EquipmentRow = Database["public"]["Tables"]["equipment"]["Row"];
type ScheduledServiceRow = Pick<
  Database["public"]["Tables"]["equipment_scheduled_service"]["Row"],
  | "due_date"
  | "due_meter"
  | "window_start_meter"
  | "warn_meter"
  | "equipment_id"
  | "interval_mode"
  | "is_active"
  | "title"
>;
type EquipmentDocumentRow = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  "equipment_id" | "expiry_date" | "is_active" | "reminder_lead_days" | "title"
>;

const cards = [
  {
    title: "Monitor",
    detail: "Review the live submitted-form feed with filters, signatures, photos, and print output.",
    href: "/admin/monitor",
    icon: Activity,
  },
  {
    title: "Reports",
    detail: "Review year-to-date trends, time-card gaps, and corrective-action volume.",
    href: "/admin/reports",
    icon: FileText,
  },
  {
    title: "Analytics",
    detail: "Inspect answer trends from form templates marked for analytics.",
    href: "/admin/analytics",
    icon: BarChart3,
  },
  {
    title: "Incidents",
    detail: "Separate incidents, near misses, illnesses, and unsafe work refusals into operational registers.",
    href: "/admin/incidents",
    icon: AlertTriangle,
  },
  {
    title: "Corrective Actions",
    detail: "Assign, due-date, update, and sign off follow-up actions from flagged form fields.",
    href: "/admin/follow-ups",
    icon: Wrench,
  },
  {
    title: "Equipment",
    detail: "Track units, service schedules, documents, maintenance history, and linked inspections.",
    href: "/admin/equipment",
    icon: Truck,
  },
  {
    title: "Workflow Station",
    detail: "Build form sequences, branch from submitted answers, and assign scheduled work.",
    href: "/admin/workflows",
    icon: GitBranch,
  },
  {
    title: "Form Templates",
    detail: "Create the forms that appear in the worker app and are cached for offline drafts.",
    href: "/admin/forms",
    icon: ClipboardList,
  },
  {
    title: "Managed Lists",
    detail: "Build reusable dropdown and multiple-choice answer lists for form templates.",
    href: "/admin/lists",
    icon: ListChecks,
  },
  {
    title: "Documents",
    detail: "Register controlled documents and prepare OCR form imports for builder review.",
    href: "/admin/documents",
    icon: FileText,
  },
  {
    title: "Auto-Share",
    detail: "Send completed form notifications to company, client, and location-specific recipients.",
    href: "/admin/auto-share",
    icon: Share2,
  },
  {
    title: "Setup",
    detail: "Open the setup hub for company identity, print settings, forms, people, access, and distribution.",
    href: "/admin/setup",
    icon: Settings2,
  },
  {
    title: "Locations",
    detail: "Create active locations, set visibility, and support worker assignments.",
    href: "/admin/locations",
    icon: MapPin,
  },
  {
    title: "Workers",
    detail: "Invite workers, update profiles, assign locations, and track credentials.",
    href: "/admin/workers",
    icon: UsersRound,
  },
  {
    title: "Visitors",
    detail: "Sign visitors in and out without making them permissioned app users.",
    href: "/admin/visitors",
    icon: UserRound,
  },
  {
    title: "Certification Types",
    detail: "Manage reusable credential types for worker certification records.",
    href: "/admin/certification-types",
    icon: BadgeCheck,
  },
  {
    title: "User Access",
    detail: "Set app access, admin access, reach, permission profile, and offline sync duration.",
    href: "/admin/access",
    icon: UsersRound,
  },
  {
    title: "Permission Profiles",
    detail: "Manage tenant profile presets such as App Admin, App Supervisor, and Worker Team.",
    href: "/admin/permission-profiles",
    icon: FileSliders,
  },
  {
    title: "Consultant Access",
    detail: "Control Core Pathways consultant access and review override audit records.",
    href: "/admin/consultant-access",
    icon: ShieldCheck,
  },
  {
    title: "Web App",
    detail: "Open the worker-facing app surface for assigned forms and resources.",
    href: "/web",
    icon: Smartphone,
  },
];

export default async function AdminPage() {
  const context = await requireCurrentUser();
  const supabase = await createSupabaseServerClient();

  if (context.status === "profile_pending") {
    redirect("/choose");
  }

  if (context.status === "consultant") {
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id, name, slug, consultant_access_revoked")
      .order("name");

    return (
      <AdminShell eyebrow="Consultant console" tenantName="Core Pathways" title="Tenant Access">
        <div className="mb-4">
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
            href="/admin/billing"
          >
            <FileSliders className="h-4 w-4" aria-hidden="true" />
            Tenant billing
          </Link>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Accessible tenants</h2>
          <div className="mt-4 divide-y divide-[var(--border)]">
            {(tenants ?? []).map((tenant) => (
              <div className="flex items-center justify-between gap-4 py-3" key={tenant.id}>
                <div>
                  <p className="font-semibold text-[var(--ink)]">{tenant.name}</p>
                  <p className="text-sm text-[var(--ink-muted)]">{tenant.slug}</p>
                </div>
                <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                  {tenant.consultant_access_revoked ? "Override required" : "Available"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </AdminShell>
    );
  }

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  // Platform owner (the program operator) gets a cross-tenant billing console
  // reachable from a banner on their own admin dashboard.
  const ownerClient = supabase as unknown as {
    rpc: (fn: string) => Promise<{ data: boolean | null }>;
  };
  const { data: isPlatformOwner } = await ownerClient.rpc("is_platform_owner");

  await sendEquipmentAttentionNotifications(context.appUser.tenant_id);

  const [
    { count: userCount },
    { count: permissionProfileCount },
    { count: auditCount },
    { count: formCount },
    { count: documentCount },
    { count: submissionCount },
    { data: equipment },
    { data: scheduledServices },
    { data: equipmentDocuments },
  ] = await Promise.all([
    supabase.from("users").select("*", { count: "exact", head: true }).eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("permission_profiles")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("consultant_audit_log")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id),
    supabase.from("forms").select("*", { count: "exact", head: true }).eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("document_control_register")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id),
    supabase.from("submissions").select("*", { count: "exact", head: true }).eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("equipment")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .returns<EquipmentRow[]>(),
    supabase
      .from("equipment_scheduled_service")
      .select("equipment_id, title, interval_mode, due_date, due_meter, window_start_meter, warn_meter, is_active")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .returns<ScheduledServiceRow[]>(),
    supabase
      .from("equipment_document")
      .select("equipment_id, title, expiry_date, reminder_lead_days, is_active")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .returns<EquipmentDocumentRow[]>(),
  ]);

  const equipmentDashboardDocuments = (equipmentDocuments ?? []).map((document) => ({
    equipment_id: document.equipment_id,
    expiryDate: document.expiry_date,
    isActive: document.is_active,
    reminderLeadDays: document.reminder_lead_days,
    title: document.title,
  }));
  const equipmentDashboardServices = (scheduledServices ?? []).map((service) => ({
    dueDate: service.due_date,
    dueMeter: service.due_meter,
    windowStartMeter: service.window_start_meter,
    warnMeter: service.warn_meter,
    equipment_id: service.equipment_id,
    intervalMode: service.interval_mode,
    isActive: service.is_active,
    title: service.title,
  }));
  const equipmentDashboardCounts = buildEquipmentDashboardCounts({
    documents: equipmentDashboardDocuments,
    equipment: equipment ?? [],
    scheduledServices: equipmentDashboardServices,
  });
  const equipmentAttentionItems = buildEquipmentAttentionItems({
    documents: equipmentDashboardDocuments,
    equipment: equipment ?? [],
    limit: 5,
    scheduledServices: equipmentDashboardServices,
  });

  return (
    <AdminShell
      eyebrow="Admin panel"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Access Model"
    >
      {isPlatformOwner ? (
        <Link
          className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--primary)]/40 bg-emerald-50 p-4 transition hover:bg-emerald-100"
          href="/admin/billing"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-[var(--primary)]">
              <FileSliders className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-[var(--ink)]">Tenant billing</span>
              <span className="block text-xs text-[var(--ink-muted)]">
                Set plans and record QuickBooks payments across every tenant.
              </span>
            </span>
          </span>
          <span className="text-sm font-semibold text-[var(--primary)]">Open</span>
        </Link>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Signed in as</p>
          <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{context.appUser.full_name}</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {formatPowerLevel(context.appUser.power_level)} with {formatAccessLevel(context.appUser.app_access)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Reach</p>
          <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{formatReachType(context.appUser.reach_type)}</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Location assignment controls the rows users can touch.</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Tenant records</p>
          <p className="mt-2 text-lg font-semibold text-[var(--ink)]">
            {userCount ?? 0} users, {permissionProfileCount ?? 0} profiles
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {formCount ?? 0} forms, {submissionCount ?? 0} submissions, {documentCount ?? 0} documents
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {equipment?.length ?? 0} equipment units,{" "}
            {equipmentDashboardCounts.downUnits + equipmentDashboardCounts.overdueService + equipmentDashboardCounts.expiringDocuments} alerts
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{auditCount ?? 0} audit entries</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Link
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:border-[var(--primary)]"
          href="/admin/equipment?status=down"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--ink-muted)]">Down units</p>
            <AlertTriangle className="h-5 w-5 text-[var(--danger)]" aria-hidden="true" />
          </div>
          <p className="mt-3 text-3xl font-bold text-[var(--ink)]">{equipmentDashboardCounts.downUnits}</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Out of service and unavailable for location assignment.</p>
        </Link>
        <Link
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:border-[var(--primary)]"
          href="/admin/equipment?sort=service"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--ink-muted)]">Overdue service</p>
            <Wrench className="h-5 w-5 text-[var(--danger)]" aria-hidden="true" />
          </div>
          <p className="mt-3 text-3xl font-bold text-[var(--ink)]">{equipmentDashboardCounts.overdueService}</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Scheduled services past date or meter threshold.</p>
        </Link>
        <Link
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:border-[var(--primary)]"
          href="/admin/equipment?sort=service"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--ink-muted)]">Expiring documents</p>
            <FileText className="h-5 w-5 text-[var(--warning)]" aria-hidden="true" />
          </div>
          <p className="mt-3 text-3xl font-bold text-[var(--ink)]">{equipmentDashboardCounts.expiringDocuments}</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Registration, insurance, permits, or certifications due for renewal.</p>
        </Link>
      </div>

      <section className="mt-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Equipment Attention</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Upcoming service, expired documents, and units that need review.</p>
          </div>
          <Link
            className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            href="/admin/equipment?sort=service"
          >
            Open Equipment
          </Link>
        </div>
        {equipmentAttentionItems.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {equipmentAttentionItems.map((item) => (
              <Link
                className="grid gap-3 px-5 py-4 transition hover:bg-[var(--surface-muted)] lg:grid-cols-[1fr_140px_140px_120px] lg:items-center"
                href={item.href}
                key={`${item.source}-${item.equipment.id}-${item.title}`}
              >
                <div>
                  <p className="font-semibold text-[var(--ink)]">
                    {item.equipment.unit_number}
                    {item.equipment.name ? `, ${item.equipment.name}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    {item.title} - {item.source === "service" ? "service" : "document"}
                  </p>
                </div>
                <p className="text-sm text-[var(--ink-muted)]">
                  {formatEquipmentCategory(item.equipment.category)} - {formatEquipmentStatus(item.equipment.status)}
                </p>
                <p className="text-sm text-[var(--ink-muted)]">
                  {formatEquipmentMeter({
                    trackingMode: item.equipment.tracking_mode,
                    value: item.equipment.current_meter,
                  })}
                </p>
                <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${equipmentDueStatusClass(item.status)}`}>
                  {item.detail}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-sm text-[var(--ink-muted)]">
            No equipment service or document alerts right now.
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;

          return (
            <Link
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm transition hover:border-[var(--primary)]"
              href={card.href}
              key={card.href}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-[var(--ink)]">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{card.detail}</p>
            </Link>
          );
        })}
      </div>
    </AdminShell>
  );
}
