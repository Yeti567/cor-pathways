import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  FileSliders,
  FileText,
  Globe,
  ListChecks,
  MapPin,
  Share2,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Truck,
  UserRound,
  UsersRound,
  Wrench,
} from "lucide-react";
import {
  updateChangeOrdersSetting,
  updateCorSetting,
  updateCountrySetting,
  updateDailyInspectionSetting,
  updateGcSetting,
  updateMaintenanceContact,
  updateTradesSetting,
  updateTransportSetting,
} from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { regionConfig } from "@/lib/region";
import {
  buildProductionReadinessChecklist,
  productionReadinessCounts,
  type ProductionReadinessStatus,
} from "@/lib/production-readiness";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CompanySettingsRow = Pick<
  Database["public"]["Tables"]["company_settings"]["Row"],
  "company_name" | "logo_path" | "maintenance_contact_user_id" | "phone" | "timezone"
>;
type MaintenanceWorkerRow = Pick<Database["public"]["Tables"]["users"]["Row"], "full_name" | "id">;
type PrintSettingsRow = Pick<Database["public"]["Tables"]["print_settings"]["Row"], "header_option" | "logo_placement">;

function statusLabel(ready: boolean) {
  return ready ? "Ready" : "Needs setup";
}

function statusClass(ready: boolean) {
  return ready ? "bg-emerald-50 text-[var(--success)]" : "bg-amber-50 text-[var(--warning)]";
}

function productionStatusLabel(status: ProductionReadinessStatus) {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs_setup":
      return "Needs setup";
    default:
      return "Verify";
  }
}

function productionStatusClass(status: ProductionReadinessStatus) {
  switch (status) {
    case "ready":
      return "bg-emerald-50 text-[var(--success)]";
    case "needs_setup":
      return "bg-amber-50 text-[var(--warning)]";
    default:
      return "bg-[var(--surface-muted)] text-[var(--ink-muted)]";
  }
}

// The applied migration list lives in the supabase_migrations schema, which is
// not exposed through PostgREST, so it is read via a security-definer RPC.
// Returns null when the RPC is unavailable so the checklist falls back to a
// manual "verify" prompt instead of a misleading status.
async function fetchAppliedMigrationNames(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<string[] | null> {
  const rpcClient = supabase as unknown as {
    rpc: (fn: string) => Promise<{ data: string[] | null; error: unknown }>;
  };

  try {
    const { data, error } = await rpcClient.rpc("applied_migration_names");

    if (error || !Array.isArray(data)) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

export default async function SetupPage() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const [
    { data: companySettings },
    { data: printSettings },
    { count: locationCount },
    { count: workerCount },
    { count: formCount },
    { count: managedListCount },
    { count: documentCount },
    { count: autoShareCount },
    { count: certificationTypeCount },
    { count: permissionProfileCount },
    { count: visitorCount },
  ] = await Promise.all([
    supabase
      .from("company_settings")
      .select("company_name, logo_path, maintenance_contact_user_id, phone, timezone")
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<CompanySettingsRow>(),
    supabase
      .from("print_settings")
      .select("header_option, logo_placement")
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<PrintSettingsRow>(),
    supabase.from("locations").select("*", { count: "exact", head: true }).eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true),
    supabase.from("forms").select("*", { count: "exact", head: true }).eq("tenant_id", context.appUser.tenant_id),
    supabase.from("lists").select("*", { count: "exact", head: true }).eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("document_control_register")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("auto_share_recipients")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true),
    supabase
      .from("certification_types")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("permission_profiles")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id),
    supabase.from("visitors").select("*", { count: "exact", head: true }).eq("tenant_id", context.appUser.tenant_id),
  ]);
  const companyReady = Boolean(companySettings?.company_name?.trim() && companySettings.timezone);
  const printReady = Boolean(printSettings?.header_option && printSettings.logo_placement);
  const setupCards = [
    {
      count: companyReady ? "Ready" : "Missing",
      href: "/admin/settings#company-info",
      icon: Building2,
      ready: companyReady,
      title: "Company Info",
    },
    {
      count: printReady ? "Ready" : "Default",
      href: "/admin/settings#print-settings",
      icon: FileText,
      ready: printReady,
      title: "Print Settings",
    },
    {
      count: locationCount ?? 0,
      href: "/admin/locations",
      icon: MapPin,
      ready: (locationCount ?? 0) > 0,
      title: "Locations",
    },
    {
      count: workerCount ?? 0,
      href: "/admin/workers",
      icon: UsersRound,
      ready: (workerCount ?? 0) > 0,
      title: "Workers",
    },
    {
      count: formCount ?? 0,
      href: "/admin/forms",
      icon: ClipboardList,
      ready: (formCount ?? 0) > 0,
      title: "Forms",
    },
    {
      count: managedListCount ?? 0,
      href: "/admin/lists",
      icon: ListChecks,
      ready: (managedListCount ?? 0) > 0,
      title: "Managed Lists",
    },
    {
      count: certificationTypeCount ?? 0,
      href: "/admin/certification-types",
      icon: BadgeCheck,
      ready: (certificationTypeCount ?? 0) > 0,
      title: "Certification Types",
    },
    {
      count: permissionProfileCount ?? 0,
      href: "/admin/permission-profiles",
      icon: FileSliders,
      ready: (permissionProfileCount ?? 0) > 0,
      title: "Permission Profiles",
    },
    {
      count: documentCount ?? 0,
      href: "/admin/documents",
      icon: FileText,
      ready: (documentCount ?? 0) > 0,
      title: "Controlled Documents",
    },
    {
      count: autoShareCount ?? 0,
      href: "/admin/auto-share",
      icon: Share2,
      ready: (autoShareCount ?? 0) > 0,
      title: "Auto-Share",
    },
    {
      count: visitorCount ?? 0,
      href: "/admin/visitors",
      icon: UserRound,
      ready: true,
      title: "Visitor Log",
    },
    {
      count: "Access",
      href: "/admin/access",
      icon: ShieldCheck,
      ready: true,
      title: "User Access",
    },
  ];
  const readyCount = setupCards.filter((card) => card.ready).length;
  const appliedMigrationNames = await fetchAppliedMigrationNames(supabase);
  const productionChecklist = buildProductionReadinessChecklist({ appliedMigrationNames });
  const productionCounts = productionReadinessCounts(productionChecklist);
  const transportEnabled = Boolean(context.tenant?.transport_enabled);
  const corEnabled = Boolean(context.tenant?.cor_enabled);
  const changeOrdersEnabled = Boolean(context.tenant?.change_orders_enabled);
  const dailyInspectionEnabled = Boolean(context.tenant?.daily_inspection_enabled);
  const tradesEnabled = Boolean(context.tenant?.trades_enabled);
  const gcEnabled = Boolean(context.tenant?.gc_enabled);
  // Region (country) decides which safety framework a tenant sees. COR is a
  // Canadian concept; US tenants get the OSHA surface instead and never see COR.
  const region = regionConfig(context.tenant?.country);
  const showCor = region.corAvailable;
  // Transport and COR are Carrier-tier features; Change Orders and Daily Trip
  // Inspection are Pro-tier features. A live trial unlocks them all; once the trial
  // ends a tenant can only switch a module on if their plan includes it.
  const { data: maintenanceWorkerRows } = transportEnabled
    ? await supabase
        .from("users")
        .select("id, full_name")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("active", true)
        .order("full_name", { ascending: true })
        .returns<MaintenanceWorkerRow[]>()
    : { data: [] as MaintenanceWorkerRow[] };
  const maintenanceWorkers = maintenanceWorkerRows ?? [];
  const moduleToggleButtonBase =
    "inline-flex h-10 min-w-24 items-center justify-center gap-2 px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-default";

  return (
    <AdminShell
      eyebrow="Setup"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Setup"
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Company Setup</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Configure the company profile, forms, worker records, document controls, and app distribution.
              </p>
            </div>
            <span className="inline-flex h-8 w-fit items-center rounded-md bg-[var(--surface-muted)] px-3 text-sm font-semibold text-[var(--ink)]">
              {readyCount} / {setupCards.length} ready
            </span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {setupCards.map((card) => {
              const Icon = card.icon;

              return (
                <Link
                  className="rounded-lg border border-[var(--border)] bg-white p-4 transition hover:border-[var(--primary)] hover:bg-[var(--surface-muted)]"
                  href={card.href}
                  key={card.title}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(card.ready)}`}>
                      {statusLabel(card.ready)}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-[var(--ink)]">{card.title}</h3>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink-muted)]">{card.count}</p>
                </Link>
              );
            })}
          </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Region</h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  Sets your safety and compliance framework. Canada uses COR and WCB; the United States uses
                  OSHA and EMR. Switching to the United States hides the COR module.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 rounded-md border border-[var(--border)] bg-white p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <Globe className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[var(--ink)]">Country</h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Currently set to {region.label} ({region.safetyFrameworkShort}).
                  </p>
                </div>
              </div>
              <div className="inline-grid w-full grid-cols-2 overflow-hidden rounded-md border border-[var(--border)] sm:w-auto">
                <form action={updateCountrySetting}>
                  <input name="country" type="hidden" value="CA" />
                  <button
                    aria-pressed={region.country === "CA"}
                    className={`${moduleToggleButtonBase} w-full rounded-none ${
                      region.country === "CA"
                        ? "bg-[var(--primary)] text-white"
                        : "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                    }`}
                    disabled={region.country === "CA"}
                    type="submit"
                  >
                    Canada
                  </button>
                </form>
                <form action={updateCountrySetting}>
                  <input name="country" type="hidden" value="US" />
                  <button
                    aria-pressed={region.country === "US"}
                    className={`${moduleToggleButtonBase} w-full rounded-none border-l border-[var(--border)] ${
                      region.country === "US"
                        ? "bg-[var(--primary)] text-white"
                        : "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                    }`}
                    disabled={region.country === "US"}
                    type="submit"
                  >
                    United States
                  </button>
                </form>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Modules</h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  Turn on optional modules for your operation. Disabled modules are hidden from the menu.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 rounded-md border border-[var(--border)] bg-white p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <Truck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
                    Commercial Vehicles &amp; Transport
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-muted)]">
                      {transportEnabled ? (
                        <ToggleRight className="h-4 w-4 text-[var(--success)]" aria-hidden="true" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                      )}
                      {transportEnabled ? "On" : "Off"}
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    NSC and COR compliance: fleet maintenance windows, driver files, and document registries. Turn off
                    if you are not a transport company.
                  </p>
                  {transportEnabled ? (
                    <Link
                      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
                      href="/admin/transport"
                    >
                      Open Transport
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="inline-grid w-full grid-cols-2 overflow-hidden rounded-md border border-[var(--border)] sm:w-auto">
                  <form action={updateTransportSetting}>
                    <input name="enabled" type="hidden" value="true" />
                    <button
                      aria-pressed={transportEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none ${
                        transportEnabled
                          ? "bg-[var(--primary)] text-white"
                          : "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                      }`}
                      disabled={transportEnabled}
                      type="submit"
                    >
                      <ToggleRight className="h-4 w-4" aria-hidden="true" />
                      On
                    </button>
                  </form>
                  <form action={updateTransportSetting}>
                    <input name="enabled" type="hidden" value="false" />
                    <button
                      aria-pressed={!transportEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none border-l border-[var(--border)] ${
                        transportEnabled
                          ? "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                          : "bg-[var(--surface-muted)] text-[var(--ink)]"
                      }`}
                      disabled={!transportEnabled}
                      type="submit"
                    >
                      <ToggleLeft className="h-4 w-4" aria-hidden="true" />
                      Off
                    </button>
                  </form>
                </div>
            </div>

            {transportEnabled ? (
              <form
                action={updateMaintenanceContact}
                className="mt-4 grid gap-3 rounded-md border border-[var(--border)] bg-white p-4 lg:grid-cols-[1fr_auto] lg:items-end"
              >
                <div>
                  <label className="text-base font-semibold text-[var(--ink)]" htmlFor="maintenance_contact_user_id">
                    Maintenance contact
                  </label>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Who a vehicle-defect corrective action is assigned to when a driver fails an inspection item. Leave
                    unset and these route to an admin instead of the driver who reported them.
                  </p>
                  <select
                    className="mt-2 h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 lg:w-80"
                    defaultValue={companySettings?.maintenance_contact_user_id ?? ""}
                    id="maintenance_contact_user_id"
                    name="maintenance_contact_user_id"
                  >
                    <option value="">No designated contact (assign to an admin)</option>
                    {maintenanceWorkers.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        {worker.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                  type="submit"
                >
                  Save contact
                </button>
              </form>
            ) : null}

            {showCor ? (
            <div className="mt-4 grid gap-4 rounded-md border border-[var(--border)] bg-white p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <BadgeCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
                    COR Audit
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-muted)]">
                      {corEnabled ? (
                        <ToggleRight className="h-4 w-4 text-[var(--success)]" aria-hidden="true" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                      )}
                      {corEnabled ? "On" : "Off"}
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    The AMTA COR health and safety management system: the ten audit elements, evidence gathered from
                    across the app, and an auditor-ready package. Turn off if you use the app for purposes other than COR.
                  </p>
                  {corEnabled ? (
                    <Link
                      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
                      href="/admin/cor"
                    >
                      Open COR Audit
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="inline-grid w-full grid-cols-2 overflow-hidden rounded-md border border-[var(--border)] sm:w-auto">
                  <form action={updateCorSetting}>
                    <input name="enabled" type="hidden" value="true" />
                    <button
                      aria-pressed={corEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none ${
                        corEnabled
                          ? "bg-[var(--primary)] text-white"
                          : "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                      }`}
                      disabled={corEnabled}
                      type="submit"
                    >
                      <ToggleRight className="h-4 w-4" aria-hidden="true" />
                      On
                    </button>
                  </form>
                  <form action={updateCorSetting}>
                    <input name="enabled" type="hidden" value="false" />
                    <button
                      aria-pressed={!corEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none border-l border-[var(--border)] ${
                        corEnabled
                          ? "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                          : "bg-[var(--surface-muted)] text-[var(--ink)]"
                      }`}
                      disabled={!corEnabled}
                      type="submit"
                    >
                      <ToggleLeft className="h-4 w-4" aria-hidden="true" />
                      Off
                    </button>
                  </form>
                </div>
            </div>
            ) : (
            <div className="mt-4 grid gap-4 rounded-md border border-[var(--border)] bg-white p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
                    OSHA Safety &amp; Recordkeeping
                    <span className="inline-flex items-center rounded-md bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-muted)]">
                      United States
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Your workspace is set to the United States, so it uses OSHA safety and recordkeeping
                    ({region.safetyMetric}) instead of COR. Track your EMR, toolbox talks, hazard assessments,
                    incidents, and certifications from the OSHA Safety home.
                  </p>
                  <Link
                    className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
                    href="/admin/osha"
                  >
                    Open OSHA Safety
                  </Link>
                </div>
              </div>
            </div>
            )}

            <div className="mt-4 grid gap-4 rounded-md border border-[var(--border)] bg-white p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <FileSignature className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
                    Variations &amp; Change Orders
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-muted)]">
                      {changeOrdersEnabled ? (
                        <ToggleRight className="h-4 w-4 text-[var(--success)]" aria-hidden="true" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                      )}
                      {changeOrdersEnabled ? "On" : "Off"}
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Track field variations and contract change orders: priced line items, schedule impact, approvals,
                    and a running revised contract value. Turn off if you do not manage contract changes.
                  </p>
                  {changeOrdersEnabled ? (
                    <Link
                      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
                      href="/admin/change-orders"
                    >
                      Open Variations &amp; Change Orders
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="inline-grid w-full grid-cols-2 overflow-hidden rounded-md border border-[var(--border)] sm:w-auto">
                  <form action={updateChangeOrdersSetting}>
                    <input name="enabled" type="hidden" value="true" />
                    <button
                      aria-pressed={changeOrdersEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none ${
                        changeOrdersEnabled
                          ? "bg-[var(--primary)] text-white"
                          : "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                      }`}
                      disabled={changeOrdersEnabled}
                      type="submit"
                    >
                      <ToggleRight className="h-4 w-4" aria-hidden="true" />
                      On
                    </button>
                  </form>
                  <form action={updateChangeOrdersSetting}>
                    <input name="enabled" type="hidden" value="false" />
                    <button
                      aria-pressed={!changeOrdersEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none border-l border-[var(--border)] ${
                        changeOrdersEnabled
                          ? "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                          : "bg-[var(--surface-muted)] text-[var(--ink)]"
                      }`}
                      disabled={!changeOrdersEnabled}
                      type="submit"
                    >
                      <ToggleLeft className="h-4 w-4" aria-hidden="true" />
                      Off
                    </button>
                  </form>
                </div>
            </div>

            <div className="mt-4 grid gap-4 rounded-md border border-[var(--border)] bg-white p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
                    Daily Trip Inspections
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-muted)]">
                      {dailyInspectionEnabled ? (
                        <ToggleRight className="h-4 w-4 text-[var(--success)]" aria-hidden="true" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                      )}
                      {dailyInspectionEnabled ? "On" : "Off"}
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    NSC and CVOR daily vehicle inspections for British Columbia, Alberta, and Ontario: the right schedule
                    per province, pass or defect capture, out-of-service handling, and audit-ready records. Works on its
                    own, no Transport module required.
                  </p>
                  {dailyInspectionEnabled ? (
                    <Link
                      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
                      href="/admin/daily-inspection"
                    >
                      Open Trip Inspections
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="inline-grid w-full grid-cols-2 overflow-hidden rounded-md border border-[var(--border)] sm:w-auto">
                  <form action={updateDailyInspectionSetting}>
                    <input name="enabled" type="hidden" value="true" />
                    <button
                      aria-pressed={dailyInspectionEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none ${
                        dailyInspectionEnabled
                          ? "bg-[var(--primary)] text-white"
                          : "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                      }`}
                      disabled={dailyInspectionEnabled}
                      type="submit"
                    >
                      <ToggleRight className="h-4 w-4" aria-hidden="true" />
                      On
                    </button>
                  </form>
                  <form action={updateDailyInspectionSetting}>
                    <input name="enabled" type="hidden" value="false" />
                    <button
                      aria-pressed={!dailyInspectionEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none border-l border-[var(--border)] ${
                        dailyInspectionEnabled
                          ? "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                          : "bg-[var(--surface-muted)] text-[var(--ink)]"
                      }`}
                      disabled={!dailyInspectionEnabled}
                      type="submit"
                    >
                      <ToggleLeft className="h-4 w-4" aria-hidden="true" />
                      Off
                    </button>
                  </form>
                </div>
            </div>

            <div className="mt-4 grid gap-4 rounded-md border border-[var(--border)] bg-white p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <Wrench className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
                    Trades &amp; Field Service
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-muted)]">
                      {tradesEnabled ? (
                        <ToggleRight className="h-4 w-4 text-[var(--success)]" aria-hidden="true" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                      )}
                      {tradesEnabled ? "On" : "Off"}
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Run a trade or service business (HVAC, plumbing, electrical): customers and work orders, dispatch,
                    flat-rate price book, and service agreements. Turn off if you do not run service calls.
                  </p>
                  {tradesEnabled ? (
                    <Link
                      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
                      href="/admin/trades"
                    >
                      Open Trades
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="inline-grid w-full grid-cols-2 overflow-hidden rounded-md border border-[var(--border)] sm:w-auto">
                  <form action={updateTradesSetting}>
                    <input name="enabled" type="hidden" value="true" />
                    <button
                      aria-pressed={tradesEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none ${
                        tradesEnabled
                          ? "bg-[var(--primary)] text-white"
                          : "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                      }`}
                      disabled={tradesEnabled}
                      type="submit"
                    >
                      <ToggleRight className="h-4 w-4" aria-hidden="true" />
                      On
                    </button>
                  </form>
                  <form action={updateTradesSetting}>
                    <input name="enabled" type="hidden" value="false" />
                    <button
                      aria-pressed={!tradesEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none border-l border-[var(--border)] ${
                        tradesEnabled
                          ? "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                          : "bg-[var(--surface-muted)] text-[var(--ink)]"
                      }`}
                      disabled={!tradesEnabled}
                      type="submit"
                    >
                      <ToggleLeft className="h-4 w-4" aria-hidden="true" />
                      Off
                    </button>
                  </form>
                </div>
            </div>

            <div className="mt-4 grid gap-4 rounded-md border border-[var(--border)] bg-white p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <Building2 className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
                    Construction Projects
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-muted)]">
                      {gcEnabled ? (
                        <ToggleRight className="h-4 w-4 text-[var(--success)]" aria-hidden="true" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
                      )}
                      {gcEnabled ? "On" : "Off"}
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    For general contractors and builders: a project workspace with contract value, change orders, and
                    more to come (RFIs, submittals, draws). Turn off if you only run service work.
                  </p>
                  {gcEnabled ? (
                    <Link
                      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
                      href="/admin/projects"
                    >
                      Open Construction Projects
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="inline-grid w-full grid-cols-2 overflow-hidden rounded-md border border-[var(--border)] sm:w-auto">
                  <form action={updateGcSetting}>
                    <input name="enabled" type="hidden" value="true" />
                    <button
                      aria-pressed={gcEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none ${
                        gcEnabled
                          ? "bg-[var(--primary)] text-white"
                          : "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                      }`}
                      disabled={gcEnabled}
                      type="submit"
                    >
                      <ToggleRight className="h-4 w-4" aria-hidden="true" />
                      On
                    </button>
                  </form>
                  <form action={updateGcSetting}>
                    <input name="enabled" type="hidden" value="false" />
                    <button
                      aria-pressed={!gcEnabled}
                      className={`${moduleToggleButtonBase} w-full rounded-none border-l border-[var(--border)] ${
                        gcEnabled
                          ? "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                          : "bg-[var(--surface-muted)] text-[var(--ink)]"
                      }`}
                      disabled={!gcEnabled}
                      type="submit"
                    >
                      <ToggleLeft className="h-4 w-4" aria-hidden="true" />
                      Off
                    </button>
                  </form>
                </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Production Readiness</h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  Confirm deployment secrets, scheduled jobs, storage, migrations, and app assets before go-live.
                </p>
              </div>
              <span className="inline-flex h-8 w-fit items-center rounded-md bg-[var(--surface-muted)] px-3 text-sm font-semibold text-[var(--ink)]">
                {productionCounts.ready} / {productionCounts.total} ready
              </span>
            </div>

            {productionCounts.needsSetup > 0 ? (
              <p className="mt-4 inline-flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-[var(--warning)]">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {productionCounts.needsSetup} deployment item{productionCounts.needsSetup === 1 ? "" : "s"} need setup.
              </p>
            ) : null}

            <div className="mt-5 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {productionChecklist.map((item) => (
                <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto] md:items-start" key={item.id}>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--ink)]">{item.title}</h3>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">{item.detail}</p>
                    {item.missingEnv.length > 0 ? (
                      <p className="mt-2 break-words text-xs font-semibold text-[var(--warning)]">
                        Missing: {item.missingEnv.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <span className={`w-fit rounded-md px-2 py-1 text-xs font-semibold ${productionStatusClass(item.status)}`}>
                    {productionStatusLabel(item.status)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-[var(--ink)]">Core Readiness</h2>
            </div>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--ink-muted)]">Company profile</span>
                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(companyReady)}`}>
                  {statusLabel(companyReady)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--ink-muted)]">Locations</span>
                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass((locationCount ?? 0) > 0)}`}>
                  {locationCount ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--ink-muted)]">Forms</span>
                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass((formCount ?? 0) > 0)}`}>
                  {formCount ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--ink-muted)]">Workers</span>
                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass((workerCount ?? 0) > 0)}`}>
                  {workerCount ?? 0}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Print and Identity</h2>
            <div className="mt-4 grid gap-3 text-sm text-[var(--ink-muted)]">
              <p>Company: {companySettings?.company_name || context.tenant?.name || "Not set"}</p>
              <p>Timezone: {companySettings?.timezone || "Not set"}</p>
              <p>Logo: {companySettings?.logo_path ? "Uploaded" : "Not uploaded"}</p>
              <p>Header: {printSettings?.header_option?.replaceAll("_", " ") ?? "Default"}</p>
            </div>
            <Link
              className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/admin/settings"
            >
              Open Company Settings
            </Link>
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}
