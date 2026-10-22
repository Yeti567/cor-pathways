import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TenantScopedTable } from "@/types/database";

// The schema is one generated baseline rather than 93 hand-written migrations, so
// this suite checks security INVARIANTS that hold however the DDL is phrased,
// instead of grepping for the exact text of a migration. pg_dump restructures SQL
// (an inline "references" becomes a separate alter table ... add constraint), which
// makes text-matching hand-authored DDL meaningless.
//
// Live proof of tenant isolation is supabase/tests/tenant-isolation.sql, which
// exercises the policies against a real database. This file is the fast
// no-database guard that every tenant-scoped table is actually covered.
//
// Reads EVERY migration, not just the baseline. Reading only the baseline would mean any
// table added afterwards silently escaped these invariants, which is precisely how the
// missing-grants bug survived: the check looked at the file where the rule was written
// rather than at the schema the rule is supposed to govern.
const migrationsDir = join(process.cwd(), "supabase/migrations");
const rawSchema = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
  .join("\n");

// pg_dump writes UPPERCASE keywords and "quoted"."identifiers".
const schema = rawSchema.toLowerCase().replace(/"/g, "");

// Statements, not lines. pg_dump emits each policy on a single line, but a hand-written
// migration wraps them across several, and an invariant that only holds for one of those
// formattings is not an invariant. Splitting on the statement terminator and flattening
// whitespace lets both shapes be read the same way.
//
// Line comments go first. A comment above a policy lands in the same chunk as the
// policy once the text is split on ";", so the chunk starts with the comment and not
// with "create policy", and a check reading it would decide the table had no policy.
// inventory_balance has exactly that shape and was invisible to this file until 2026-10-22.
const schemaStatements = schema
  .replace(/--[^\n]*/g, "")
  .split(";")
  .map((statement) => statement.replace(/\s+/g, " ").trim())
  .filter(Boolean);

function policiesFor(table: string) {
  return schemaStatements.filter(
    (statement) => statement.startsWith("create policy") && statement.includes(` on public.${table} `),
  );
}

const tenantScopedTables: TenantScopedTable[] = [
  "users",
  "permission_profiles",
  "locations",
  "user_locations",
  "visitors",
  "worker_time_cards",
  "worker_profiles",
  "certification_types",
  "certifications",
  "lists",
  "list_items",
  "forms",
  "form_sections",
  "form_items",
  "submissions",
  "submission_values",
  "signatures",
  "submission_photos",
  "resources",
  "resource_sections",
  "document_control_register",
  "workflows",
  "workflow_steps",
  "workflow_conditions",
  "workflow_runs",
  "workflow_run_steps",
  "follow_ups",
  "schedules",
  "scheduled_tasks",
  "auto_share_recipients",
  "notifications",
  "company_settings",
  "print_settings",
  "equipment",
  "equipment_meter_log",
  "equipment_maintenance_log",
  "equipment_scheduled_service",
  "equipment_submission_link",
  "equipment_document",
  "inventory_category",
  "inventory_item",
  "inventory_location",
  "inventory_movement",
  "inventory_transfer",
  "inventory_count",
];

// The hand-kept list above stopped growing at the inventory tables, so trades, transport,
// change orders and subcontractors were never checked by name. Rather than keep chasing a
// list, every table that carries a tenant_id column is found from the schema itself and
// held to the same rule. A table that is guarded by something stricter than plain
// membership has to say so here, with the reason, or the suite fails.
const tablesWithTenantId = (() => {
  const found = new Set<string>();

  for (const statement of schemaStatements) {
    const created = statement.match(/^create table (?:if not exists )?public\.([a-z0-9_]+) \((.*)\)/);

    if (created && /\btenant_id uuid\b/.test(created[2])) {
      found.add(created[1]);
    }

    const added = statement.match(/^alter table (?:only )?public\.([a-z0-9_]+) add column (?:if not exists )?tenant_id uuid/);

    if (added) {
      found.add(added[1]);
    }
  }

  return [...found].sort();
})();

const stricterThanMembership: Record<string, string> = {
  eld_connection_secret: "ELD credentials: no policy at all, so only the service role can read them",
  tenant_audit_log: "Readable by the tenant's admins only, and append-only",
  transport_medical_record: "Medical vault: the vault-access check, which is narrower than membership",
  app_error: "Members may write their own tenant's errors; only admins and consultants read them",
  app_error_signature: "Error grouping: admins and consultants of the tenant only",
};

describe("every table with a tenant_id", () => {
  it("finds the tenant tables in the schema", () => {
    expect(tablesWithTenantId.length).toBeGreaterThan(80);
  });

  it.each(tablesWithTenantId)("enables row level security on %s", (table) => {
    expect(schema).toContain(`alter table public.${table} enable row level security`);
  });

  it.each(tablesWithTenantId)("scopes %s to the tenant", (table) => {
    const policies = policiesFor(table);

    if (table in stricterThanMembership) {
      // Either no policy (service role only) or every policy names the tenant.
      expect(policies.every((policy) => policy.includes("tenant_id"))).toBe(true);
      return;
    }

    expect(policies.length).toBeGreaterThan(0);
    expect(policies.some((policy) => policy.includes("is_tenant_member"))).toBe(true);
  });

  it("lists no exception for a table that no longer exists", () => {
    for (const table of Object.keys(stricterThanMembership)) {
      expect(tablesWithTenantId).toContain(table);
    }
  });
});

describe("tenant-scoped schema", () => {
  it.each(tenantScopedTables)("enables row level security on %s", (table) => {
    expect(schema).toContain(`alter table public.${table} enable row level security`);
  });

  it.each(tenantScopedTables)("guards %s with a tenant-membership policy", (table) => {
    const policies = policiesFor(table);

    expect(policies.length).toBeGreaterThan(0);
    expect(policies.some((policy) => policy.includes("is_tenant_member"))).toBe(true);
  });

  it("creates the tenant guard functions the policies depend on", () => {
    expect(schema).toContain("function public.current_user_tenant_id()");
    expect(schema).toContain("function public.is_tenant_member(target_tenant_id uuid)");
  });

  it("routes document storage through the private authz helpers", () => {
    expect(schema).toContain("authz.can_access_storage_tenant_path");
    expect(schema).toContain("authz.can_access_medical_vault_path");
  });

  it("grants table access to authenticated, because row level security cannot", () => {
    // Regression guard. The old foundation migration used a one-time
    // "grant ... on all tables in schema public", so every table added afterwards
    // silently had no privileges and returned "permission denied for table x"
    // through PostgREST no matter how permissive its policies were.
    expect(schema).toContain(
      "grant select, insert, update, delete on all tables in schema public to authenticated",
    );
    expect(schema).toContain("alter default privileges in schema public");
  });

  it("keeps the audit log append-only for end users", () => {
    expect(schema).toContain(
      "revoke insert, update, delete on table public.tenant_audit_log from authenticated",
    );
  });

  it("ships no subscription paywall", () => {
    // The product is open source and self-hosted: nothing may gate writes on billing.
    expect(schema).not.toContain("enforce_subscription_active");
    expect(schema).not.toContain("tenant_can_write");
    expect(schema).not.toContain("platform_owners");
    expect(schema).not.toContain("stripe_customer_id");
  });

  it("creates a tenant, an admin, and starter content on signup", () => {
    expect(schema).toContain("function authz.handle_new_core_pathways_user()");
    expect(schema).toContain("create trigger on_auth_user_created_core_pathways");
    expect(schema).toContain("seed_starter_forms_for_tenant");
    // Born active: no trial clock anywhere in the signup path.
    expect(schema).not.toContain("30 days");
  });
});
