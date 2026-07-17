import { readFileSync } from "node:fs";
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
const rawSchema = readFileSync(
  join(process.cwd(), "supabase/migrations/20260716000000_initial_schema.sql"),
  "utf8",
);

// pg_dump writes UPPERCASE keywords and "quoted"."identifiers".
const schema = rawSchema.toLowerCase().replace(/"/g, "");
const schemaLines = schema.split("\n");

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
];

describe("tenant-scoped schema", () => {
  it.each(tenantScopedTables)("enables row level security on %s", (table) => {
    expect(schema).toContain(`alter table public.${table} enable row level security`);
  });

  it.each(tenantScopedTables)("guards %s with a tenant-membership policy", (table) => {
    const policies = schemaLines.filter(
      (line) => line.startsWith("create policy") && line.includes(` on public.${table} `),
    );

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
