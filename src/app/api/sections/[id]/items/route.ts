import { NextResponse } from "next/server";
import {
  bodyBoolean,
  bodyJsonObject,
  bodyNumber,
  bodyOptionalString,
  bodyString,
  getTenantSection,
  jsonError,
  readJsonObject,
  requireFormBuilderAccess,
  revalidateFormBuilder,
} from "@/app/api/form-builder/_lib";
import { isFormBuilderItemType } from "@/lib/form-templates";
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

  const section = await getTenantSection(access.supabase, id, access.tenantId);

  if (!section) {
    return jsonError("Section not found.", 404);
  }

  const fieldType = bodyString(body, "type") || bodyString(body, "fieldType");
  const prompt = bodyString(body, "prompt") || bodyString(body, "label");

  if (!isFormBuilderItemType(fieldType)) {
    return jsonError("Choose a valid form item type.", 400);
  }

  if (!prompt) {
    return jsonError("Question text is required.", 400);
  }

  const { data: item, error } = await access.supabase
    .from("form_items")
    .insert({
      field_type: fieldType,
      flaggable: "flaggable" in body ? bodyBoolean(body, "flaggable") : true,
      form_id: section.form_id,
      helper_text: bodyOptionalString(body, "helpText"),
      label: prompt,
      required: bodyBoolean(body, "required"),
      section_id: section.id,
      settings: bodyJsonObject(body, "config"),
      sort_order: bodyNumber(body, "sortOrder") ?? 0,
      tenant_id: access.tenantId,
    })
    .select("*")
    .single<Database["public"]["Tables"]["form_items"]["Row"]>();

  if (error || !item) {
    return jsonError(error?.message ?? "Item was not created.", 500);
  }

  revalidateFormBuilder(section.form_id);

  return NextResponse.json({ item }, { status: 201 });
}
