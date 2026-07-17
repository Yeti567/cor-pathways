import { NextResponse } from "next/server";
import {
  bodyBoolean,
  bodyString,
  getTenantForm,
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

type FormSectionRow = Database["public"]["Tables"]["form_sections"]["Row"];
type FormItemRow = Database["public"]["Tables"]["form_items"]["Row"];

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const access = await requireFormBuilderAccess();

  if ("error" in access) {
    return access.error;
  }

  try {
    const form = await getTenantForm(access.supabase, id, access.tenantId);

    if (!form) {
      return jsonError("Form not found.", 404);
    }

    const [{ data: sections, error: sectionsError }, { data: items, error: itemsError }] = await Promise.all([
      access.supabase
        .from("form_sections")
        .select("*")
        .eq("form_id", form.id)
        .eq("tenant_id", access.tenantId)
        .order("sort_order", { ascending: true })
        .order("title", { ascending: true })
        .returns<FormSectionRow[]>(),
      access.supabase
        .from("form_items")
        .select("*")
        .eq("form_id", form.id)
        .eq("tenant_id", access.tenantId)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true })
        .returns<FormItemRow[]>(),
    ]);

    if (sectionsError) {
      return jsonError(sectionsError.message, 500);
    }

    if (itemsError) {
      return jsonError(itemsError.message, 500);
    }

    return NextResponse.json({ form, items: items ?? [], sections: sections ?? [] });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Form could not be loaded.", 500);
  }
}

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

  const update: Database["public"]["Tables"]["forms"]["Update"] = {};

  if ("name" in body) {
    const name = bodyString(body, "name");

    if (!name) {
      return jsonError("Form name is required.", 400);
    }

    update.name = name;
  }

  if ("allowDuplicates" in body) {
    update.allow_duplicates = bodyBoolean(body, "allowDuplicates");
  }

  if (Object.keys(update).length === 0) {
    return jsonError("No form settings were provided.", 400);
  }

  const { data: form, error } = await access.supabase
    .from("forms")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", access.tenantId)
    .select("*")
    .maybeSingle<Database["public"]["Tables"]["forms"]["Row"]>();

  if (error) {
    return jsonError(error.message, 500);
  }

  if (!form) {
    return jsonError("Form not found.", 404);
  }

  revalidateFormBuilder(form.id);

  return NextResponse.json({ form });
}
