import { describe, expect, it } from "vitest";
import { assertTenantId, tenantScopedQuery, withTenantId } from "@/lib/tenant-context";

describe("tenant helpers", () => {
  it("adds tenant_id to tenant scoped inserts", () => {
    expect(withTenantId("tenant-a", { name: "Riverside Project" })).toEqual({
      tenant_id: "tenant-a",
      name: "Riverside Project",
    });
  });

  it("fails fast when a tenant id is missing", () => {
    expect(() => assertTenantId(null)).toThrow("A tenant id is required");
  });

  it("applies the tenant filter to reads", () => {
    const calls: string[] = [];
    const supabase = {
      from(table: string) {
        calls.push(`from:${table}`);

        return {
          select(columns: string) {
            calls.push(`select:${columns}`);

            return {
              eq(column: string, value: string) {
                calls.push(`eq:${column}:${value}`);
                return { column, value };
              },
            };
          },
        };
      },
    };

    tenantScopedQuery(supabase as never, "locations", "tenant-a");

    expect(calls).toEqual(["from:locations", "select:*", "eq:tenant_id:tenant-a"]);
  });
});
