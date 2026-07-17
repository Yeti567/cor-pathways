import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { FormTypeDetailsBuilder, type BuilderSection } from "./FormTypeDetailsBuilder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FormBuilderPageProps = {
  params: Promise<{ formId: string }>;
};

type FormTemplateRow = Pick<
  Database["public"]["Tables"]["forms"]["Row"],
  "allow_duplicates" | "code" | "id" | "name" | "status"
>;
type FormSectionRow = Database["public"]["Tables"]["form_sections"]["Row"];
type FormItemRow = Database["public"]["Tables"]["form_items"]["Row"];
type FormDocumentControlRow = Pick<
  Database["public"]["Tables"]["document_control_register"]["Row"],
  "approval_status" | "dcn" | "version"
>;
type AvailableListRow = Pick<Database["public"]["Tables"]["lists"]["Row"], "id" | "include_other" | "name">;

function itemsForSection(items: FormItemRow[], sectionId: string) {
  return items
    .filter((item) => item.section_id === sectionId)
    .sort((left, right) => left.sort_order - right.sort_order || left.label.localeCompare(right.label));
}

export default async function FormBuilderPage({ params }: FormBuilderPageProps) {
  const { formId } = await params;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const { data: form } = await supabase
    .from("forms")
    .select("allow_duplicates, code, id, name, status")
    .eq("id", formId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<FormTemplateRow>();

  if (!form) {
    notFound();
  }

  const [{ data: sections }, { data: items }, { data: formDocumentControl }, { data: availableListRows }] = await Promise.all([
    supabase
      .from("form_sections")
      .select("*")
      .eq("form_id", form.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true })
      .returns<FormSectionRow[]>(),
    supabase
      .from("form_items")
      .select("*")
      .eq("form_id", form.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true })
      .returns<FormItemRow[]>(),
    supabase
      .from("document_control_register")
      .select("approval_status, dcn, version")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("source_table", "forms")
      .eq("source_id", form.id)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<FormDocumentControlRow>(),
    supabase
      .from("lists")
      .select("id, name, include_other")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name", { ascending: true })
      .returns<AvailableListRow[]>(),
  ]);

  const itemRows = items ?? [];
  const sectionRows: BuilderSection[] = (sections ?? []).map((section) => ({
    ...section,
    items: itemsForSection(itemRows, section.id),
  }));

  return (
    <AdminShell eyebrow="Form builder" tenantName={context.tenant?.name ?? "Company profile"} title="Form Type Details">
      <FormTypeDetailsBuilder
        availableLists={availableListRows ?? []}
        documentControlEnabled={Boolean(context.tenant?.document_control_enabled)}
        formDocumentControl={formDocumentControl ?? null}
        initialForm={form}
        initialSections={sectionRows}
      />
    </AdminShell>
  );
}
