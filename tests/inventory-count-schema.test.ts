import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The count's guarantees are the table's constraints and the reconciliation function, not
// application code. These pin the parts that make a count trustworthy: it never writes a
// balance, its three numbers cannot disagree, and the movement and the count row it posts
// share one transaction.
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260724020000_inventory_counts.sql"),
  "utf8",
)
  .toLowerCase()
  .replace(/"/g, "");

describe("the inventory_count table records, it does not mutate balances", () => {
  it("enables row level security with a tenant read and insert policy", () => {
    expect(migration).toContain("alter table public.inventory_count enable row level security");
    expect(migration).toContain("inventory_count_tenant_select");
    expect(migration).toContain("inventory_count_tenant_insert");
    expect(migration).toContain("authz.is_tenant_member(tenant_id)");
  });

  // A count is a historical statement, corrected by counting again. No end user rewrites it.
  it("grants insert and select, and takes update and delete away", () => {
    expect(migration).toContain("grant select, insert on table public.inventory_count to authenticated");
    expect(migration).toContain("revoke update, delete on table public.inventory_count from authenticated");
  });

  it("declares no update or delete policy on counts", () => {
    expect(migration).not.toContain("on public.inventory_count for update");
    expect(migration).not.toContain("on public.inventory_count for delete");
  });

  // The stored delta must equal counted minus expected, and a movement exists exactly when
  // the delta is non-zero. These two are what keep a count row internally honest.
  it("pins the delta to the other two figures", () => {
    expect(migration).toContain("check (delta = counted_qty - expected_qty)");
  });

  it("ties the presence of a movement to a non-zero delta", () => {
    expect(migration).toContain("(delta = 0) = (movement_id is null)");
  });

  it("forbids a negative count", () => {
    expect(migration).toContain("check (counted_qty >= 0)");
  });

  // Deleting the item, place, or movement a count refers to must fail rather than quietly
  // rewriting what was counted.
  it("restricts deletion of anything a count points at", () => {
    const referenced = migration.match(/foreign key \((item_id|location_id|movement_id)\)[^;]*/g) ?? [];

    expect(referenced.length).toBeGreaterThanOrEqual(3);
    for (const reference of referenced) {
      expect(reference).toContain("on delete restrict");
    }
  });
});

describe("record_inventory_count reconciles atomically", () => {
  it("runs as the caller, so every write is checked by the caller's own row security", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path to 'public', 'pg_temp'");
  });

  // One function, one transaction: the adjustment movement and the count row land together
  // or not at all, so the ledger never holds an unexplained adjustment or a dangling count.
  it("writes the movement and the count row in the same function", () => {
    expect(migration).toContain("insert into public.inventory_movement");
    expect(migration).toContain("insert into public.inventory_count");
    expect(migration).toContain("movement_type,");
  });

  // Direction lives in the endpoints: a shortage goes out to loss, a windfall comes back,
  // and the quantity is always the absolute delta.
  it("posts the absolute delta, with the endpoints deciding direction", () => {
    expect(migration).toContain("abs(v_delta)");
    expect(migration).toContain("case when v_delta < 0 then p_location_id else v_loss_id end");
    expect(migration).toContain("case when v_delta < 0 then v_loss_id else p_location_id end");
  });

  // A matching count changes nothing, so it must not post a movement.
  it("only posts a movement when the count differs from the books", () => {
    expect(migration).toContain("if v_delta <> 0 then");
  });

  it("resolves the loss place itself rather than trusting the caller to name it", () => {
    expect(migration).toContain("where tenant_id = p_tenant_id");
    expect(migration).toContain("and kind = 'loss'");
  });

  // anon has no business reconciling stock; signed-in users do.
  it("is callable by authenticated users, not anon", () => {
    expect(migration).toContain("revoke execute on function public.record_inventory_count");
    expect(migration).toContain("to authenticated");
  });
});
