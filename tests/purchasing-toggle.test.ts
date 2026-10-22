import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Purchasing is a tenant module toggle like inventory. A toggle is only correct when the
// column exists, the nav hides the entry, every route guards itself, and Setup can flip
// it. These are static source assertions on purpose, matching tests/inventory-toggle.test.ts:
// they run with no database and catch the wiring drifting apart.
const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf8");

// Built from char codes so this file never contains the characters it looks for.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const toggleMigration = read("supabase/migrations/20261022000000_purchasing_module_toggle.sql");
const ordersMigration = read("supabase/migrations/20261022030000_purchase_orders.sql");
const approvalsMigration = read("supabase/migrations/20261022040000_purchase_approvals.sql");
const receivingMigration = read("supabase/migrations/20261022050000_purchase_receiving.sql");
const adminShell = read("src/app/admin/_components/AdminShell.tsx");
const setupPage = read("src/app/admin/setup/page.tsx");
const adminActions = read("src/app/admin/actions.ts");
const purchasingActions = read("src/app/admin/purchasing/actions.ts");
const exportRoute = read("src/app/admin/purchasing/export/download/route.ts");
const databaseTypes = read("src/types/database.ts");

const normalize = (sql: string) => sql.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");

function filesUnder(relativeDir: string): string[] {
  const absolute = join(process.cwd(), relativeDir);
  return readdirSync(absolute).flatMap((name) => {
    const path = join(relativeDir, name);
    return statSync(join(process.cwd(), path)).isDirectory() ? filesUnder(path) : [path];
  });
}

const purchasingFiles = filesUnder("src/app/admin/purchasing");
const purchasingPages = purchasingFiles.filter((file) => /page\.tsx$/.test(file));

describe("purchasing module migration", () => {
  it("adds purchasing_enabled to tenants, defaulting to off", () => {
    expect(normalize(toggleMigration)).toContain(
      "alter table public.tenants add column if not exists purchasing_enabled boolean default false not null",
    );
  });

  it("refuses over-receipt in the database as well as in the app", () => {
    expect(normalize(ordersMigration)).toContain("qty_received <= qty_ordered");
  });

  it("holds the order total to its parts", () => {
    expect(normalize(ordersMigration)).toContain("total = subtotal - discount + shipping + tax");
  });

  it("keeps the trail and receipts append-only for end users", () => {
    const approvals = normalize(approvalsMigration);
    const receiving = normalize(receivingMigration);

    expect(approvals).toContain("revoke update, delete on table public.purchase_order_event from authenticated");
    expect(receiving).toContain("revoke update, delete on table public.purchase_receipt from authenticated");
    expect(receiving).toContain("revoke update, delete on table public.purchase_receipt_line from authenticated");
  });

  // Stock only ever changes through the ledger. Receiving posts a movement and lets the
  // ledger's trigger move the balance; it never writes a balance itself.
  it("receives stock through the inventory ledger, never by writing a balance", () => {
    const receiving = normalize(receivingMigration);

    expect(receiving).toContain("insert into public.inventory_movement");
    expect(receiving).toContain("'receive'");
    expect(receiving).not.toContain("inventory_balance");
  });

  it("runs both purchasing functions as the caller, so row level security still applies", () => {
    expect(normalize(approvalsMigration)).toContain("language plpgsql security invoker");
    expect(normalize(receivingMigration)).toContain("language plpgsql security invoker");
    expect(normalize(approvalsMigration)).not.toContain("security definer");
    expect(normalize(receivingMigration)).not.toContain("security definer");
  });

  it("leaves the work order link nullable and unwired until work orders exist", () => {
    const orders = normalize(ordersMigration);
    expect(orders).toContain("work_order_id uuid,");
    expect(orders).not.toContain("work_order_id_fkey");
  });
});

describe("purchasing module types", () => {
  it("exposes purchasing_enabled on the tenants row", () => {
    expect(databaseTypes).toContain("purchasing_enabled: boolean;");
  });

  it("declares every purchasing table", () => {
    for (const table of [
      "supplier",
      "supplier_item",
      "purchase_order",
      "purchase_order_line",
      "purchase_approval_rule",
      "purchase_settings",
      "purchase_order_event",
      "purchase_receipt",
      "purchase_receipt_line",
    ]) {
      expect(databaseTypes).toContain(`      ${table}: {`);
    }
  });

  it("gives inventory items a unit cost and a reorder quantity", () => {
    expect(databaseTypes).toContain("unit_cost: number | null;");
    expect(databaseTypes).toContain("reorder_qty: number | null;");
  });
});

describe("purchasing module wiring", () => {
  it("hides the nav entry unless the tenant has the module on", () => {
    expect(adminShell).toContain('const PURCHASING_NAV_HREF = "/admin/purchasing"');
    expect(adminShell).toContain('{ href: PURCHASING_NAV_HREF, label: "Purchasing"');
    expect(adminShell).toContain("const purchasingEnabled = Boolean(context.tenant?.purchasing_enabled)");
    expect(adminShell).toContain(".filter((item) => item.href !== PURCHASING_NAV_HREF || purchasingEnabled)");
  });

  it("has the pages the plan names", () => {
    for (const page of [
      "src/app/admin/purchasing/page.tsx",
      "src/app/admin/purchasing/new/page.tsx",
      "src/app/admin/purchasing/[orderId]/page.tsx",
      "src/app/admin/purchasing/suppliers/page.tsx",
      "src/app/admin/purchasing/rules/page.tsx",
      "src/app/admin/purchasing/export/page.tsx",
    ]) {
      expect(purchasingPages.map((file) => file.replace(/\\/g, "/"))).toContain(page);
    }
  });

  it.each(purchasingPages)("guards %s itself, admin access first, then the toggle", (file) => {
    const source = read(file);
    const adminGuard = source.indexOf("canUseAdminPanel");
    const toggleGuard = source.indexOf("if (!context.tenant?.purchasing_enabled)");

    expect(adminGuard).toBeGreaterThan(-1);
    expect(toggleGuard).toBeGreaterThan(adminGuard);
    expect(source).toContain('redirect("/admin/setup")');
  });

  it("gates every server action on the module, not just the pages", () => {
    const exported = purchasingActions.match(/export async function \w+/g) ?? [];
    const gated = purchasingActions.match(/await requirePurchasing(?:User|Admin)\(/g) ?? [];

    expect(exported.length).toBeGreaterThan(10);
    expect(gated.length).toBeGreaterThanOrEqual(exported.length);
    expect(purchasingActions).toContain("if (!context.tenant?.purchasing_enabled)");
  });

  it("gates the export download on the module and refuses a cross-site post", () => {
    expect(exportRoute).toContain("if (!context.tenant?.purchasing_enabled)");
    expect(exportRoute).toContain("canUseAdminPanel");
    expect(exportRoute).toContain("export async function POST");
    expect(exportRoute).not.toContain("export async function GET");
    expect(exportRoute).toContain('request.headers.get("origin")');
  });

  it("offers both an on and an off control in Setup", () => {
    expect(setupPage).toContain("const purchasingEnabled = Boolean(context.tenant?.purchasing_enabled)");
    expect(setupPage.match(/<form action=\{updatePurchasingSetting\}>/g) ?? []).toHaveLength(2);
  });
});

describe("updatePurchasingSetting", () => {
  const action = adminActions.slice(
    adminActions.indexOf("export async function updatePurchasingSetting"),
    adminActions.indexOf("export async function updateInventorySetting"),
  );

  it("writes the toggle through the helper that verifies the update landed", () => {
    expect(action).toContain(
      "await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { purchasing_enabled: enabled })",
    );
  });

  it("is restricted to a form manager and audited", () => {
    expect(action).toContain("await requireFormManager()");
    expect(action).toContain('action: "purchasing.setting.update"');
  });

  it("revalidates the admin layout so the nav reflects the change immediately", () => {
    expect(action).toContain('revalidatePath("/admin", "layout")');
  });
});

describe("public repository hygiene", () => {
  const sources = [
    ...purchasingFiles,
    "src/lib/purchasing.ts",
    "tests/purchasing.test.ts",
    "supabase/migrations/20261022000000_purchasing_module_toggle.sql",
    "supabase/migrations/20261022010000_purchasing_suppliers.sql",
    "supabase/migrations/20261022020000_inventory_item_costing.sql",
    "supabase/migrations/20261022030000_purchase_orders.sql",
    "supabase/migrations/20261022040000_purchase_approvals.sql",
    "supabase/migrations/20261022050000_purchase_receiving.sql",
  ];

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
