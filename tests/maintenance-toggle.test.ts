import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Maintenance is a tenant module toggle like inventory and purchasing. A toggle is only
// correct when the column exists, the nav hides the entry, every route and action guards
// itself, the worker app hides its panel, and Setup can flip it. Static source assertions
// on purpose, matching tests/purchasing-toggle.test.ts: no database, and they catch the
// wiring drifting apart.
const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf8");

// Built from char codes so this file never contains the characters it looks for.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const normalize = (sql: string) => sql.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");

function filesUnder(relativeDir: string): string[] {
  const absolute = join(process.cwd(), relativeDir);
  return readdirSync(absolute).flatMap((name) => {
    const path = join(relativeDir, name);
    return statSync(join(process.cwd(), path)).isDirectory() ? filesUnder(path) : [path];
  });
}

const toggleMigration = read("supabase/migrations/20261022080000_maintenance_module_toggle.sql");
const adminShell = read("src/app/admin/_components/AdminShell.tsx");
const setupPage = read("src/app/admin/setup/page.tsx");
const adminActions = read("src/app/admin/actions.ts");
const maintenanceActions = read("src/app/admin/maintenance/actions.ts");
const workerActions = read("src/app/web/maintenance-actions.ts");
const webPage = read("src/app/web/page.tsx");
const equipmentPage = read("src/app/admin/equipment/[equipmentId]/page.tsx");
const followUpsPage = read("src/app/admin/follow-ups/page.tsx");
const cronRoute = read("src/app/api/cron/certification-reminders/route.ts");
const databaseTypes = read("src/types/database.ts");

const maintenanceFiles = filesUnder("src/app/admin/maintenance");
const maintenancePages = maintenanceFiles.filter((file) => /page\.tsx$/.test(file));

describe("maintenance module migration and types", () => {
  it("adds maintenance_enabled to tenants, defaulting to off", () => {
    expect(normalize(toggleMigration)).toContain(
      "alter table public.tenants add column if not exists maintenance_enabled boolean default false not null",
    );
  });

  it("exposes the toggle and every maintenance table in the hand-kept types", () => {
    expect(databaseTypes).toContain("maintenance_enabled: boolean;");
    for (const table of [
      "maintenance_work_order",
      "maintenance_work_order_task",
      "maintenance_work_order_labour",
      "maintenance_work_order_part",
      "maintenance_work_order_cost",
      "maintenance_work_order_note",
      "maintenance_work_order_event",
    ]) {
      expect(databaseTypes).toContain(`      ${table}: {`);
    }
    expect(databaseTypes).toContain("maintenance_work_order_id: string | null;");
    expect(databaseTypes).toContain("work_order_part_id: string | null;");
  });
});

describe("maintenance module wiring", () => {
  it("hides the nav entry unless the tenant has the module on", () => {
    expect(adminShell).toContain('const MAINTENANCE_NAV_HREF = "/admin/maintenance"');
    expect(adminShell).toContain('{ href: MAINTENANCE_NAV_HREF, label: "Maintenance"');
    expect(adminShell).toContain("const maintenanceEnabled = Boolean(context.tenant?.maintenance_enabled)");
    expect(adminShell).toContain(".filter((item) => item.href !== MAINTENANCE_NAV_HREF || maintenanceEnabled)");
  });

  it("has the pages the plan names", () => {
    const pages = maintenancePages.map((file) => file.replace(/\\/g, "/"));
    for (const page of [
      "src/app/admin/maintenance/page.tsx",
      "src/app/admin/maintenance/new/page.tsx",
      "src/app/admin/maintenance/[workOrderId]/page.tsx",
    ]) {
      expect(pages).toContain(page);
    }
  });

  it.each(maintenancePages)("guards %s itself, admin access first, then the toggle", (file) => {
    const source = read(file);
    const adminGuard = source.indexOf("canUseAdminPanel");
    const toggleGuard = source.indexOf("if (!context.tenant?.maintenance_enabled)");

    expect(adminGuard).toBeGreaterThan(-1);
    expect(toggleGuard).toBeGreaterThan(adminGuard);
    expect(source).toContain('redirect("/admin/setup")');
  });

  it("gates every admin server action on the module, not just the pages", () => {
    const exported = maintenanceActions.match(/export async function \w+/g) ?? [];
    const gated = maintenanceActions.match(/await requireMaintenanceUser\(\)/g) ?? [];

    expect(exported.length).toBeGreaterThan(15);
    expect(gated.length).toBeGreaterThanOrEqual(exported.length);
    expect(maintenanceActions).toContain("if (!context.tenant?.maintenance_enabled)");
    expect(maintenanceActions).toContain("canUseAdminPanel(context.appUser)");
  });

  it("gates the worker app's actions on the module and on the work order being theirs", () => {
    const exported = workerActions.match(/export async function \w+/g) ?? [];
    const gated = workerActions.match(/await requireAssignedWorkOrder\(/g) ?? [];

    expect(exported.length).toBeGreaterThanOrEqual(2);
    expect(gated.length).toBeGreaterThanOrEqual(exported.length);
    expect(workerActions).toContain("if (!context.tenant?.maintenance_enabled)");
    expect(workerActions).toContain('.eq("assignee_id", context.appUser.id)');
  });

  it("shows the worker panel and the inspection deficiencies only when the module is on", () => {
    expect(webPage).toContain("const maintenanceOn = Boolean(context.tenant?.maintenance_enabled)");
    expect(webPage).toContain("{maintenanceOn ? (\n            <MaintenanceWorkPanel");
    expect(webPage).toContain("if (maintenanceOn) {");
    expect(webPage).toContain("maintenanceEnabled={maintenanceOn}");
  });

  it("hides the equipment Work orders tab with the module", () => {
    expect(equipmentPage).toContain("const maintenanceEnabled = Boolean(context.tenant?.maintenance_enabled)");
    expect(equipmentPage).toContain('const visibleTabs = equipmentTabs.filter((tab) => tab !== "work_orders" || maintenanceEnabled)');
    expect(equipmentPage).toContain('activeTab === "work_orders" && maintenanceEnabled');
  });

  it("offers Create work order on a corrective action only when the module is on", () => {
    expect(followUpsPage).toContain(
      "const maintenanceEnabled = Boolean(context.tenant?.maintenance_enabled) && canUseAdminPanel(context.appUser)",
    );
    expect(followUpsPage).toContain("{maintenanceEnabled ? (");
    expect(followUpsPage).toContain("action={createWorkOrderFromFollowUp}");
  });

  it("raises preventive work from the daily cron only for tenants with the module on", () => {
    expect(cronRoute).toContain("if (!tenant.maintenance_enabled) {");
    expect(cronRoute).toContain("await raiseDuePreventiveWorkOrders(supabase, tenant.id, now)");
  });

  it("offers both an on and an off control in Setup", () => {
    expect(setupPage).toContain("const maintenanceEnabled = Boolean(context.tenant?.maintenance_enabled)");
    expect(setupPage.match(/<form action=\{updateMaintenanceSetting\}>/g) ?? []).toHaveLength(2);
  });
});

describe("updateMaintenanceSetting", () => {
  const action = adminActions.slice(
    adminActions.indexOf("export async function updateMaintenanceSetting"),
    adminActions.indexOf("export async function updateInventorySetting"),
  );

  it("writes the toggle through the helper that verifies the update landed, as a form manager, audited", () => {
    expect(action).toContain(
      "await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { maintenance_enabled: enabled })",
    );
    expect(action).toContain("await requireFormManager()");
    expect(action).toContain('action: "maintenance.setting.update"');
    expect(action).toContain('revalidatePath("/admin", "layout")');
  });
});

describe("public repository hygiene", () => {
  const sources = [
    ...maintenanceFiles,
    "src/lib/maintenance.ts",
    "src/lib/maintenance-preventive.ts",
    "src/lib/offline/maintenance.ts",
    "src/app/web/maintenance-actions.ts",
    "src/app/web/_components/MaintenanceWorkPanel.tsx",
    "tests/maintenance.test.ts",
    "tests/maintenance-offline.test.ts",
    "tests/maintenance-enforcement-schema.test.ts",
    "tests/inspection-deficiency-loop.test.ts",
    "supabase/tests/maintenance-work-orders.sql",
    ...readdirSync(join(process.cwd(), "supabase/migrations"))
      .filter((file) => file >= "20261022080000" && file.endsWith(".sql"))
      .map((file) => `supabase/migrations/${file}`),
  ];

  it("checks the new migrations", () => {
    expect(sources.filter((file) => file.startsWith("supabase/migrations/")).length).toBeGreaterThanOrEqual(8);
  });

  it.each(sources)("uses no em or en dashes in %s", (file) => {
    expect(read(file)).not.toMatch(DASHES);
  });

  it.each(sources)("carries no paywall or trial gate in %s", (file) => {
    const source = read(file).toLowerCase();
    expect(source).not.toContain("subscription_status");
    expect(source).not.toContain("trial_ends_at");
    expect(source).not.toContain("tenant_can_write");
  });
});
