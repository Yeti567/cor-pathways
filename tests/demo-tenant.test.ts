import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isDemoTenant } from "@/lib/demo";

// Builds a stub client whose tenants lookup resolves to the given row. isDemoTenant
// calls .from("tenants").select("demo_mode").eq("id", id).maybeSingle().
function clientReturning(row: { demo_mode: boolean } | null): SupabaseClient<Database> {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient<Database>;
}

describe("isDemoTenant", () => {
  it("is true when the tenant row has demo_mode set", async () => {
    await expect(isDemoTenant(clientReturning({ demo_mode: true }), "t-1")).resolves.toBe(true);
  });

  it("is false when the tenant is not a demo", async () => {
    await expect(isDemoTenant(clientReturning({ demo_mode: false }), "t-1")).resolves.toBe(false);
  });

  it("is false when no tenant row is found", async () => {
    await expect(isDemoTenant(clientReturning(null), "t-1")).resolves.toBe(false);
  });
});
