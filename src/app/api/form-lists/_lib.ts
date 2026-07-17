import { NextResponse } from "next/server";
import { z } from "zod";
import { canUseAdminPanel } from "@/lib/access-control";
import { getCurrentUserContext } from "@/lib/current-user";
import { getManagedListUsage } from "@/lib/managed-list-service";
import { normalizeManagedListItemLabel, normalizeManagedListName } from "@/lib/managed-lists";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const listNameSchema = z
  .string()
  .transform((value) => normalizeManagedListName(value))
  .pipe(z.string().min(1).max(80));

export const itemLabelSchema = z
  .string()
  .transform((value) => normalizeManagedListItemLabel(value))
  .pipe(z.string().min(1).max(200));

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireManagedListAccess() {
  const context = await getCurrentUserContext();

  if (context.status === "signed_out") {
    return { error: jsonError("Unauthorized", 401) } as const;
  }

  if (context.status !== "app_user" || !canUseAdminPanel(context.appUser)) {
    return { error: jsonError("Admin access is required.", 403) } as const;
  }

  const supabase = await createSupabaseServerClient();

  return {
    appUser: context.appUser,
    supabase,
    tenantId: context.appUser.tenant_id,
  } as const;
}

export async function readJsonObject(request: Request) {
  try {
    const body: unknown = await request.json();

    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function findTenantList(supabase: SupabaseServerClient, tenantId: string, listId: string) {
  const { data, error } = await supabase
    .from("lists")
    .select("*")
    .eq("id", listId)
    .eq("tenant_id", tenantId)
    .maybeSingle<Database["public"]["Tables"]["lists"]["Row"]>();

  if (error) {
    throw error;
  }

  return data;
}

export async function findTenantListItem(supabase: SupabaseServerClient, tenantId: string, listId: string, itemId: string) {
  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("id", itemId)
    .eq("list_id", listId)
    .eq("tenant_id", tenantId)
    .maybeSingle<Database["public"]["Tables"]["list_items"]["Row"]>();

  if (error) {
    throw error;
  }

  return data;
}

export async function ensureUniqueListName(input: {
  currentListId?: string;
  name: string;
  supabase: SupabaseServerClient;
  tenantId: string;
}) {
  const { data, error } = await input.supabase
    .from("lists")
    .select("id, name")
    .eq("tenant_id", input.tenantId)
    .ilike("name", input.name)
    .returns<Array<Pick<Database["public"]["Tables"]["lists"]["Row"], "id" | "name">>>();

  if (error) {
    throw error;
  }

  return !(data ?? []).some((list) => list.id !== input.currentListId && list.name.toLowerCase() === input.name.toLowerCase());
}

export async function nextSiblingSortOrder(input: {
  listId: string;
  parentId: string | null;
  supabase: SupabaseServerClient;
  tenantId: string;
}) {
  let query = input.supabase
    .from("list_items")
    .select("sort_order")
    .eq("list_id", input.listId)
    .eq("tenant_id", input.tenantId)
    .order("sort_order", { ascending: false })
    .limit(1);

  query = input.parentId ? query.eq("parent_id", input.parentId) : query.is("parent_id", null);

  const { data, error } = await query.returns<Array<{ sort_order: number | null }>>();

  if (error) {
    throw error;
  }

  return ((data ?? [])[0]?.sort_order ?? 0) + 100;
}

export async function listUsageForDelete(supabase: SupabaseServerClient, tenantId: string, listId: string) {
  const usage = await getManagedListUsage(supabase, tenantId, [listId]);

  return usage.get(listId) ?? { usageCount: 0, usageFormNames: [] };
}
