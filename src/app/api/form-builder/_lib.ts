import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { canUseAdminPanel } from "@/lib/access-control";
import { getCurrentUserContext } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireFormBuilderAccess() {
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

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function bodyString(body: Record<string, unknown>, key: string) {
  const value = body[key];

  return typeof value === "string" ? value.trim() : "";
}

export function bodyOptionalString(body: Record<string, unknown>, key: string) {
  const value = body[key];

  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function bodyBoolean(body: Record<string, unknown>, key: string) {
  return body[key] === true;
}

export function bodyNumber(body: Record<string, unknown>, key: string) {
  const value = body[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isJsonObject(value: Json): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function bodyJsonObject(body: Record<string, unknown>, key: string): Json {
  const value = body[key];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Json;
}

export function sortOrderForIndex(index: number) {
  return (index + 1) * 100;
}

export function orderUpdatesFromBody(body: Record<string, unknown>) {
  const items = body.items;

  if (!Array.isArray(items)) {
    return null;
  }

  const updates: Array<{ id: string; order: number }> = [];

  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const order = typeof record.order === "number" && Number.isFinite(record.order) ? record.order : null;

    if (!id || order === null) {
      return null;
    }

    updates.push({ id, order });
  }

  return updates;
}

export async function getTenantForm(supabase: SupabaseServerClient, formId: string, tenantId: string) {
  const { data, error } = await supabase
    .from("forms")
    .select("*")
    .eq("id", formId)
    .eq("tenant_id", tenantId)
    .maybeSingle<Database["public"]["Tables"]["forms"]["Row"]>();

  if (error) {
    throw error;
  }

  return data;
}

export async function getTenantSection(supabase: SupabaseServerClient, sectionId: string, tenantId: string) {
  const { data, error } = await supabase
    .from("form_sections")
    .select("*")
    .eq("id", sectionId)
    .eq("tenant_id", tenantId)
    .maybeSingle<Database["public"]["Tables"]["form_sections"]["Row"]>();

  if (error) {
    throw error;
  }

  return data;
}

export async function getTenantItem(supabase: SupabaseServerClient, itemId: string, tenantId: string) {
  const { data, error } = await supabase
    .from("form_items")
    .select("*")
    .eq("id", itemId)
    .eq("tenant_id", tenantId)
    .maybeSingle<Database["public"]["Tables"]["form_items"]["Row"]>();

  if (error) {
    throw error;
  }

  return data;
}

export function revalidateFormBuilder(formId: string) {
  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath(`/admin/forms/${formId}/preview`);
  revalidatePath("/admin/forms");
  revalidatePath("/web");
}
