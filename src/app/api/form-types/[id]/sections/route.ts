import { NextResponse } from "next/server";
import {
  bodyBoolean,
  bodyNumber,
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

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const access = await requireFormBuilderAccess();

  if ("error" in access) {
    return access.error;
  }

  const body = await readJsonObject(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const form = await getTenantForm(access.supabase, id, access.tenantId);

  if (!form) {
    return jsonError("Form not found.", 404);
  }

  const title = bodyString(body, "title") || "New Section";
  const sortOrder = bodyNumber(body, "sortOrder") ?? 0;

  const { data: section, error } = await access.supabase
    .from("form_sections")
    .insert({
      collapsible: bodyBoolean(body, "collapsible"),
      form_id: form.id,
      repeatable: bodyBoolean(body, "repeatable"),
      sort_order: sortOrder,
      tenant_id: access.tenantId,
      title,
    })
    .select("*")
    .single<Database["public"]["Tables"]["form_sections"]["Row"]>();

  if (error || !section) {
    return jsonError(error?.message ?? "Section was not created.", 500);
  }

  revalidateFormBuilder(form.id);

  return NextResponse.json({ section }, { status: 201 });
}
