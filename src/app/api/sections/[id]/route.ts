import { NextResponse } from "next/server";
import {
  bodyBoolean,
  bodyNumber,
  bodyString,
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

  const existing = await getTenantSection(access.supabase, id, access.tenantId);

  if (!existing) {
    return jsonError("Section not found.", 404);
  }

  const update: Database["public"]["Tables"]["form_sections"]["Update"] = {};

  if ("title" in body) {
    const title = bodyString(body, "title");

    if (!title) {
      return jsonError("Section title is required.", 400);
    }

    update.title = title;
  }

  if ("collapsible" in body) {
    update.collapsible = bodyBoolean(body, "collapsible");
  }

  if ("repeatable" in body) {
    update.repeatable = bodyBoolean(body, "repeatable");
  }

  if ("sortOrder" in body || "order" in body) {
    update.sort_order = bodyNumber(body, "sortOrder") ?? bodyNumber(body, "order") ?? existing.sort_order;
  }

  if (Object.keys(update).length === 0) {
    return jsonError("No section settings were provided.", 400);
  }

  const { data: section, error } = await access.supabase
    .from("form_sections")
    .update(update)
    .eq("id", existing.id)
    .eq("tenant_id", access.tenantId)
    .select("*")
    .maybeSingle<Database["public"]["Tables"]["form_sections"]["Row"]>();

  if (error) {
    return jsonError(error.message, 500);
  }

  if (!section) {
    return jsonError("Section not found.", 404);
  }

  revalidateFormBuilder(section.form_id);

  return NextResponse.json({ section });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const access = await requireFormBuilderAccess();

  if ("error" in access) {
    return access.error;
  }

  const existing = await getTenantSection(access.supabase, id, access.tenantId);

  if (!existing) {
    return jsonError("Section not found.", 404);
  }

  const { error } = await access.supabase
    .from("form_sections")
    .delete()
    .eq("id", existing.id)
    .eq("tenant_id", access.tenantId);

  if (error) {
    return jsonError(error.message, 500);
  }

  revalidateFormBuilder(existing.form_id);

  return NextResponse.json({ deleted: true });
}
