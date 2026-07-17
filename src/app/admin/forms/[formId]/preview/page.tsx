import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ClipboardList, Edit3 } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { FormTemplatePreview, type PreviewWorkerOption } from "@/app/admin/forms/[formId]/preview/FormTemplatePreview";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { formatFormStatus } from "@/lib/form-templates";
import { getManagedListIdFromSettings, resolveManagedListSettings } from "@/lib/managed-lists";
import { buildOfflineFormSummary } from "@/lib/offline/form-model";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type FormPreviewPageProps = {
  params: Promise<{ formId: string }>;
};

type FormTemplateRow = Database["public"]["Tables"]["forms"]["Row"];
type FormSectionRow = Pick<
  Database["public"]["Tables"]["form_sections"]["Row"],
  "collapsible" | "form_id" | "id" | "repeatable" | "sort_order" | "title"
>;
type FormItemRow = Pick<
  Database["public"]["Tables"]["form_items"]["Row"],
  "field_type" | "flaggable" | "form_id" | "helper_text" | "id" | "label" | "required" | "section_id" | "settings" | "sort_order"
>;
type ChoiceListRow = Pick<Database["public"]["Tables"]["lists"]["Row"], "id" | "include_other" | "name">;
type ChoiceListItemRow = Pick<Database["public"]["Tables"]["list_items"]["Row"], "active" | "id" | "label" | "list_id" | "parent_id" | "sort_order">;
type WorkerPreviewRow = Pick<Database["public"]["Tables"]["users"]["Row"], "full_name" | "id">;
type WorkerProfilePreviewRow = Pick<Database["public"]["Tables"]["worker_profiles"]["Row"], "title" | "user_id">;

export default async function FormPreviewPage({ params }: FormPreviewPageProps) {
  const { formId } = await params;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const { data: form } = await supabase
    .from("forms")
    .select("*")
    .eq("id", formId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<FormTemplateRow>();

  if (!form) {
    notFound();
  }

  const [{ data: sections }, { data: items }, { data: workers }] = await Promise.all([
    supabase
      .from("form_sections")
      .select("collapsible, form_id, id, repeatable, sort_order, title")
      .eq("form_id", form.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true })
      .returns<FormSectionRow[]>(),
    supabase
      .from("form_items")
      .select("field_type, flaggable, form_id, helper_text, id, label, required, section_id, settings, sort_order")
      .eq("form_id", form.id)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true })
      .returns<FormItemRow[]>(),
    supabase
      .from("users")
      .select("id, full_name")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("full_name", { ascending: true })
      .returns<WorkerPreviewRow[]>(),
  ]);
  const workerIds = (workers ?? []).map((worker) => worker.id);
  const { data: workerProfiles } =
    workerIds.length > 0
      ? await supabase
          .from("worker_profiles")
          .select("user_id, title")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("user_id", workerIds)
          .returns<WorkerProfilePreviewRow[]>()
      : { data: [] as WorkerProfilePreviewRow[] };
  const workerProfileByUserId = new Map((workerProfiles ?? []).map((profile) => [profile.user_id, profile]));
  const workerOptions: PreviewWorkerOption[] = (workers ?? []).map((worker) => ({
    fullName: worker.full_name,
    id: worker.id,
    title: workerProfileByUserId.get(worker.id)?.title ?? null,
  }));

  const referencedListIds = Array.from(
    new Set((items ?? []).map((item) => getManagedListIdFromSettings(item.settings)).filter((listId): listId is string => Boolean(listId))),
  );
  const [{ data: choiceLists }, { data: choiceListItems }] =
    referencedListIds.length > 0
      ? await Promise.all([
          supabase
            .from("lists")
            .select("id, include_other, name")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("id", referencedListIds)
            .returns<ChoiceListRow[]>(),
          supabase
            .from("list_items")
            .select("active, id, label, list_id, parent_id, sort_order")
            .eq("tenant_id", context.appUser.tenant_id)
            .in("list_id", referencedListIds)
            .order("sort_order", { ascending: true })
            .order("label", { ascending: true })
            .returns<ChoiceListItemRow[]>(),
        ])
      : [{ data: [] as ChoiceListRow[] }, { data: [] as ChoiceListItemRow[] }];

  const choiceListById = new Map((choiceLists ?? []).map((list) => [list.id, list]));
  const choiceItemsByListId = new Map<string, ChoiceListItemRow[]>();

  for (const item of choiceListItems ?? []) {
    const listItems = choiceItemsByListId.get(item.list_id) ?? [];
    listItems.push(item);
    choiceItemsByListId.set(item.list_id, listItems);
  }

  const resolvedItems = (items ?? []).map((item) => {
    const listId = getManagedListIdFromSettings(item.settings);
    const choiceList = listId ? choiceListById.get(listId) : null;

    return listId && choiceList
      ? {
          ...item,
          settings: resolveManagedListSettings(item.settings, choiceList, choiceItemsByListId.get(listId) ?? []),
        }
      : item;
  });
  const previewForm = buildOfflineFormSummary(form, sections ?? [], resolvedItems);

  return (
    <AdminShell eyebrow="Form preview" tenantName={context.tenant?.name ?? "Company profile"} title={form.name}>
      <div className="mb-5 flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <Link
            className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:text-[var(--primary-dark)]"
            href={`/admin/forms/${form.id}`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Form Builder
          </Link>
          <p className="mt-2 truncate text-sm text-[var(--ink-muted)]">
            {form.code} - {formatFormStatus(form.status)}
          </p>
          {form.description ? <p className="mt-1 text-sm text-[var(--ink-muted)]">{form.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink-muted)]">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            {previewForm.sections.length} sections
          </span>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            href={`/admin/forms/${form.id}`}
          >
            <Edit3 className="h-4 w-4" aria-hidden="true" />
            Edit
          </Link>
        </div>
      </div>

      <FormTemplatePreview form={previewForm} workers={workerOptions} />
    </AdminShell>
  );
}
