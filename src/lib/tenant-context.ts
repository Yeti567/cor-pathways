import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TenantScopedTable } from "@/types/database";

export type TenantContext = {
  userId: string;
  tenantId: string;
  powerLevel: Database["public"]["Enums"]["power_level"];
  reachType: Database["public"]["Enums"]["reach_type"];
};

type UserRow = Database["public"]["Tables"]["users"]["Row"];

type TenantScopedClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): unknown;
    };
  };
};

export async function resolveTenantContext(
  supabase: SupabaseClient<Database>,
): Promise<TenantContext> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw authError;
  }

  if (!user) {
    throw new Error("A signed in user is required.");
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, tenant_id, power_level, reach_type")
    .eq("id", user.id)
    .single<UserRow>();

  if (error) {
    throw error;
  }

  if (!data?.tenant_id) {
    throw new Error("The signed in user does not have a tenant.");
  }

  return {
    userId: data.id,
    tenantId: data.tenant_id,
    powerLevel: data.power_level,
    reachType: data.reach_type,
  };
}

export function tenantScopedQuery<TTable extends TenantScopedTable>(
  supabase: TenantScopedClient,
  table: TTable,
  tenantId: string,
) {
  return supabase.from(table).select("*").eq("tenant_id", tenantId);
}

export function withTenantId<TRow extends Record<string, unknown>>(
  tenantId: string,
  row: TRow,
): TRow & { tenant_id: string } {
  return {
    ...row,
    tenant_id: tenantId,
  };
}

export function assertTenantId(tenantId: string | null | undefined): asserts tenantId is string {
  if (!tenantId) {
    throw new Error("A tenant id is required for tenant scoped data.");
  }
}
