import { NextResponse } from "next/server";
import {
  bodyBoolean,
  bodyJsonObject,
  bodyNumber,
  bodyOptionalString,
  bodyString,
  getTenantItem,
  getTenantSection,
  jsonError,
  readJsonObject,
  requireFormBuilderAccess,
  revalidateFormBuilder,
} from "@/app/api/form-builder/_lib";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const access = await requireFormBuilderAccess();

  if ("error" in access) {
    return access.error;
  }

  const body = await readJsonObject(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const existing = await getTenantItem(access.supabase, id, access.tenantId);

  if (!existing) {
    return jsonError("Item not found.", 404);
  }

  const update: Database["public"]["Tables"]["form_items"]["Update"] = {};

  if ("prompt" in body || "label" in body) {
    const prompt = bodyString(body, "prompt") || bodyString(body, "label");

    if (!prompt) {
      return jsonError("Question text is required.", 400);
    }

    update.label = prompt;
  }

  if ("required" in body) {
    update.required = bodyBoolean(body, "required");
  }

  if ("flaggable" in body) {
    update.flaggable = bodyBoolean(body, "flaggable");
  }

  if ("helpText" in body) {
    update.helper_text = bodyOptionalString(body, "helpText");
  }

  if ("config" in body) {
    update.settings = bodyJsonObject(body, "config");
  }

  if ("sortOrder" in body || "order" in body) {
    update.sort_order = bodyNumber(body, "sortOrder") ?? bodyNumber(body, "order") ?? existing.sort_order;
  }

  if ("sectionId" in body) {
    const sectionId = bodyString(body, "sectionId");
    const section = sectionId ? await getTenantSection(access.supabase, sectionId, access.tenantId) : null;

    if (!section || section.form_id !== existing.form_id) {
      return jsonError("Choose a valid section for this item.", 400);
    }

    update.section_id = section.id;
  }

  if (Object.keys(update).length === 0) {
    return jsonError("No item settings were provided.", 400);
  }

  const { data: item, error } = await access.supabase
    .from("form_items")
    .update(update)
    .eq("id", existing.id)
    .eq("tenant_id", access.tenantId)
    .select("*")
    .maybeSingle<Database["public"]["Tables"]["form_items"]["Row"]>();

  if (error) {
    return jsonError(error.message, 500);
  }

  if (!item) {
    return jsonError("Item not found.", 404);
  }

  revalidateFormBuilder(item.form_id);

  return NextResponse.json({ item });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const access = await requireFormBuilderAccess();

  if ("error" in access) {
    return access.error;
  }

  const existing = await getTenantItem(access.supabase, id, access.tenantId);

  if (!existing) {
    return jsonError("Item not found.", 404);
  }

  const { error } = await access.supabase.from("form_items").delete().eq("id", existing.id).eq("tenant_id", access.tenantId);

  if (error) {
    return jsonError(error.message, 500);
  }

  revalidateFormBuilder(existing.form_id);

  return NextResponse.json({ deleted: true });
}
