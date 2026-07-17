import { NextResponse } from "next/server";
import {
  getTenantSection,
  jsonError,
  requireFormBuilderAccess,
  revalidateFormBuilder,
} from "@/app/api/form-builder/_lib";
import { duplicateFormBuilderName, nextFormBuilderSortOrder } from "@/lib/form-templates";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type FormSectionRow = Database["public"]["Tables"]["form_sections"]["Row"];
type FormItemRow = Database["public"]["Tables"]["form_items"]["Row"];

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const access = await requireFormBuilderAccess();

  if ("error" in access) {
    return access.error;
  }

  const section = await getTenantSection(access.supabase, id, access.tenantId);

  if (!section) {
    return jsonError("Section not found.", 404);
  }

  const [{ data: sectionSortRows, error: sortError }, { data: originalItems, error: itemError }] = await Promise.all([
    access.supabase
      .from("form_sections")
      .select("sort_order")
      .eq("form_id", section.form_id)
      .eq("tenant_id", access.tenantId)
      .returns<Array<{ sort_order: number | null }>>(),
    access.supabase
      .from("form_items")
      .select("*")
      .eq("section_id", section.id)
      .eq("form_id", section.form_id)
      .eq("tenant_id", access.tenantId)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true })
      .returns<FormItemRow[]>(),
  ]);

  if (sortError) {
    return jsonError(sortError.message, 500);
  }

  if (itemError) {
    return jsonError(itemError.message, 500);
  }

  const { data: copiedSection, error: insertSectionError } = await access.supabase
    .from("form_sections")
    .insert({
      collapsible: section.collapsible,
      form_id: section.form_id,
      repeatable: section.repeatable,
      sort_order: nextFormBuilderSortOrder(sectionSortRows ?? []),
      tenant_id: access.tenantId,
      title: duplicateFormBuilderName(section.title),
    })
    .select("*")
    .single<FormSectionRow>();

  if (insertSectionError || !copiedSection) {
    return jsonError(insertSectionError?.message ?? "Section could not be duplicated.", 500);
  }

  const itemCopies = (originalItems ?? []).map((item) => ({
    field_type: item.field_type,
    flaggable: item.flaggable,
    form_id: section.form_id,
    helper_text: item.helper_text,
    label: item.label,
    required: item.required,
    section_id: copiedSection.id,
    settings: item.settings,
    sort_order: item.sort_order,
    tenant_id: access.tenantId,
  }));

  let copiedItems: FormItemRow[] = [];

  if (itemCopies.length > 0) {
    const { data, error } = await access.supabase.from("form_items").insert(itemCopies).select("*").returns<FormItemRow[]>();

    if (error) {
      return jsonError(error.message, 500);
    }

    copiedItems = data ?? [];
  }

  revalidateFormBuilder(section.form_id);

  return NextResponse.json({ section: { ...copiedSection, items: copiedItems } }, { status: 201 });
}
