import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Inventory is the eighth tenant module toggle. A module toggle is only correct when
// all four wiring points agree: the column exists, the nav hides the entry, the route
// guards itself, and Setup can flip it. Miss one and the module either leaks into a
// tenant that never asked for it, or becomes unreachable after being switched on.
//
// These are static source assertions on purpose, matching tests/schema-rls.test.ts:
// they run with no database and catch the wiring drifting apart.
const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf8");

const migration = read("supabase/migrations/20260723000000_inventory_module_toggle.sql");
const adminShell = read("src/app/admin/_components/AdminShell.tsx");
const inventoryPage = read("src/app/admin/inventory/page.tsx");
const setupPage = read("src/app/admin/setup/page.tsx");
const adminActions = read("src/app/admin/actions.ts");
const databaseTypes = read("src/types/database.ts");

// The kinds a location may take. Duplicated here on purpose: the test is the thing
// that notices when the SQL constraint and the TypeScript union stop agreeing.
const LOCATION_KINDS = [
  "yard",
  "customer_site",
  "transit",
  "loss",
  "vendor",
  "worker",
  "vehicle",
  "job",
] as const;

describe("inventory module migration", () => {
  it("adds inventory_enabled to tenants, defaulting to off", () => {
    const normalized = migration.toLowerCase().replace(/"/g, "");

    expect(normalized).toContain("alter table public.tenants");
    expect(normalized).toContain("add column if not exists inventory_enabled boolean default false not null");
  });

  it("adds location_kind to locations, defaulting to yard so existing rows stay valid", () => {
    const normalized = migration.toLowerCase().replace(/"/g, "");

    expect(normalized).toContain("alter table public.locations");
    expect(normalized).toContain("add column if not exists location_kind text default 'yard' not null");
  });

  it("constrains location_kind to exactly the kinds the app knows about", () => {
    const normalized = migration.toLowerCase().replace(/"/g, "");
    const constraint = normalized.slice(normalized.indexOf("locations_location_kind_check"));

    for (const kind of LOCATION_KINDS) {
      expect(constraint).toContain(`'${kind}'::text`);
    }
  });
});

describe("inventory module types", () => {
  it("exposes inventory_enabled on the tenants row", () => {
    expect(databaseTypes).toContain("inventory_enabled: boolean;");
  });

  it("keeps the LocationKind union in step with the database constraint", () => {
    const union = databaseTypes.slice(
      databaseTypes.indexOf("export type LocationKind ="),
      databaseTypes.indexOf('| "job";') + '| "job";'.length,
    );

    for (const kind of LOCATION_KINDS) {
      expect(union).toContain(`"${kind}"`);
    }
  });
});

describe("inventory module wiring", () => {
  it("hides the nav entry unless the tenant has the module on", () => {
    expect(adminShell).toContain('const INVENTORY_NAV_HREF = "/admin/inventory"');
    expect(adminShell).toContain("{ href: INVENTORY_NAV_HREF, label: \"Inventory\"");
    expect(adminShell).toContain("const inventoryEnabled = Boolean(context.tenant?.inventory_enabled)");
    expect(adminShell).toContain(
      ".filter((item) => item.href !== INVENTORY_NAV_HREF || inventoryEnabled)",
    );
  });

  it("guards the route itself, so a direct hit cannot bypass the hidden nav", () => {
    expect(inventoryPage).toContain("if (!context.tenant?.inventory_enabled)");
    expect(inventoryPage).toContain('redirect("/admin/setup")');
  });

  it("requires admin panel access before the toggle is even considered", () => {
    const guardOrder = inventoryPage.indexOf("canUseAdminPanel");
    const toggleOrder = inventoryPage.indexOf("inventory_enabled");

    expect(guardOrder).toBeGreaterThan(-1);
    expect(guardOrder).toBeLessThan(toggleOrder);
  });

  it("offers both an on and an off control in Setup", () => {
    expect(setupPage).toContain("updateInventorySetting");
    expect(setupPage).toContain("const inventoryEnabled = Boolean(context.tenant?.inventory_enabled)");

    const forms = setupPage.match(/<form action=\{updateInventorySetting\}>/g) ?? [];
    expect(forms).toHaveLength(2);
  });
});

describe("updateInventorySetting", () => {
  const action = adminActions.slice(
    adminActions.indexOf("export async function updateInventorySetting"),
    adminActions.indexOf("export async function createGcProject"),
  );

  it("writes the toggle against the caller's own tenant", () => {
    expect(action).toContain("{ inventory_enabled: enabled }");
    expect(action).toContain("context.appUser.tenant_id");
  });

  // Row-level security restricts tenant updates to a super admin, but the action admits
  // any form manager. Writing through the shared helper is what stops the update matching
  // no row, returning no error, and the caller being told the module was switched when
  // nothing happened. tests/tenant-settings-writes.test.ts covers the helper itself.
  it("writes through the helper that verifies the update landed", () => {
    expect(action).toContain("await applyTenantSettingsPatch(supabase, context.appUser.tenant_id,");
  });

  it("is restricted to a form manager", () => {
    expect(action).toContain("await requireFormManager()");
  });

  it("records an audit event, so a module appearing or vanishing is traceable", () => {
    expect(action).toContain('action: "inventory.setting.update"');
    expect(action).toContain("inventory_enabled: enabled,");
  });

  it("revalidates the admin layout so the nav reflects the change immediately", () => {
    expect(action).toContain('revalidatePath("/admin", "layout")');
  });
});
