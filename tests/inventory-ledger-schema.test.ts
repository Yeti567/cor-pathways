import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The ledger's guarantees are privileges and constraints, not application code, because
// application code can be bypassed by anything holding a connection. These assertions pin
// the guarantees that make "the balance always equals the ledger" true rather than
// merely usually true.
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260723030000_inventory_ledger.sql"),
  "utf8",
)
  .toLowerCase()
  .replace(/"/g, "");

describe("the ledger is append-only", () => {
  it("grants insert and select, and takes update and delete away", () => {
    expect(migration).toContain("grant select, insert on table public.inventory_movement to authenticated");
    expect(migration).toContain("revoke update, delete on table public.inventory_movement from authenticated");
  });

  // A policy cannot restore a privilege that was never granted, so the absence of an
  // update or delete policy is not what protects the ledger. The revoke is.
  it("declares no update or delete policy on the ledger", () => {
    expect(migration).not.toContain("on public.inventory_movement for update");
    expect(migration).not.toContain("on public.inventory_movement for delete");
  });

  it("has no update or delete trigger, because neither is supported", () => {
    expect(migration).toContain("after insert on public.inventory_movement");
    expect(migration).not.toContain("after update on public.inventory_movement");
    expect(migration).not.toContain("after delete on public.inventory_movement");
  });
});

describe("balances cannot be written by hand", () => {
  // inventory_balance is keyed by (tenant, item, place) rather than an id, so it is not
  // in the TenantScopedTable union that tests/schema-rls.test.ts iterates. Assert its
  // row level security here instead of letting it fall between the two suites.
  it("still enables row level security, with a tenant read policy", () => {
    expect(migration).toContain("alter table public.inventory_balance enable row level security");
    expect(migration).toContain("inventory_balance_tenant_select");
    expect(migration).toContain("authz.is_tenant_member(tenant_id)");
  });

  it("grants select only", () => {
    expect(migration).toContain("grant select on table public.inventory_balance to authenticated");
    expect(migration).toContain("revoke insert, update, delete on table public.inventory_balance from authenticated");
  });

  it("moves them through a definer-rights trigger with a pinned search_path", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path to 'public', 'pg_temp'");
  });

  // The definer trigger function must not be reachable as an RPC. Revoking EXECUTE closes
  // the /rest/v1/rpc door without stopping the trigger, which fires as the table owner.
  it("takes the trigger function off the public API", () => {
    const harden = readFileSync(
      join(process.cwd(), "supabase/migrations/20260724000000_inventory_ledger_harden.sql"),
      "utf8",
    )
      .toLowerCase()
      .replace(/"/g, "");

    expect(harden).toContain("revoke execute on function public.apply_inventory_movement()");
    expect(harden).toContain("anon");
    expect(harden).toContain("authenticated");
  });
});

describe("movement constraints", () => {
  it("keeps quantity positive, so direction lives only in the endpoints", () => {
    expect(migration).toContain("check (qty > 0)");
  });

  it("requires a movement to go somewhere, and not in a circle", () => {
    const constraint = migration.slice(migration.indexOf("inventory_movement_endpoints_check"));

    expect(constraint).toContain("from_location_id is not null or to_location_id is not null");
    expect(constraint).toContain("from_location_id is distinct from to_location_id");
  });

  it("makes an offline replay idempotent", () => {
    expect(migration).toContain("inventory_movement_tenant_client_uuid_key");
    expect(migration).toContain("(tenant_id, client_uuid) where client_uuid is not null");
  });

  // Deleting an item or a place that has history would leave the ledger unable to say
  // what moved, so every reference restricts rather than cascades.
  it("restricts deletion of anything the ledger points at", () => {
    const referenced = migration.match(/foreign key \((item_id|from_location_id|to_location_id|location_id)\)[^;]*/g) ?? [];

    expect(referenced.length).toBeGreaterThanOrEqual(5);
    for (const reference of referenced) {
      expect(reference).toContain("on delete restrict");
    }
  });
});

describe("only virtual places may go negative", () => {
  it("guards the balance with a constraint rather than trusting the trigger alone", () => {
    expect(migration).toContain("check (allows_negative or qty >= 0)");
  });

  it("derives allows_negative from the two virtual kinds", () => {
    expect(migration).toContain("kind in ('transit', 'loss')");
  });

  // Postgres evaluates CHECK constraints on the proposed row BEFORE ON CONFLICT resolves
  // it, so inserting a negative delta trips the constraint even when the settled balance
  // would be fine. The row is seeded at zero and moved by a separate update instead.
  it("seeds the balance row at zero rather than inserting a delta", () => {
    expect(migration).toContain("do nothing");
    expect(migration).not.toContain("values (new.tenant_id, new.item_id, new.from_location_id, -new.qty");
  });

  // Without the lock, two concurrent movements could each read the same balance and both
  // take the last of the stock.
  it("locks the balance row before deciding whether there is enough", () => {
    expect(migration).toContain("for update");
  });
});
