import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, BarChart3, CheckCircle2, ClipboardList, Eye, ListChecks, LockKeyhole, PencilLine, Plus, Save } from "lucide-react";
import { createFormTemplate, updateFormTemplateSettings } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { coerceCertifyingPartner, elementDisplay, frameworkElements } from "@/lib/cor-frameworks";
import { formatFormStatus, formStatusOptions } from "@/lib/form-templates";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { DeleteFormButton } from "./DeleteFormButton";
import { FormImportPanel } from "./FormImportPanel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FormsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type FormTemplateRow = Database["public"]["Tables"]["forms"]["Row"];
type FormDocumentControlRow = Pick<
  Database["public"]["Tables"]["document_control_register"]["Row"],
  "approval_status" | "dcn" | "source_id" | "version"
>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatUpdatedAt(value: string | undefined) {
  if (!value) {
    return "Not synced";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusClass(status: string) {
  switch (status) {
    case "published":
      return "border-[var(--success)] bg-emerald-50 text-[var(--success)]";
    case "archived":
      return "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink-muted)]";
    default:
      return "border-[var(--warning)] bg-amber-50 text-[var(--warning)]";
  }
}

function formatApprovalStatus(value: string | undefined) {
  switch (value) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Needs revision";
    default:
      return "Pending approval";
  }
}

function approvalStatusClass(value: string | undefined) {
  switch (value) {
    case "approved":
      return "border-[var(--success)] bg-emerald-50 text-[var(--success)]";
    case "rejected":
      return "border-[var(--danger)] bg-red-50 text-[var(--danger)]";
    default:
      return "border-[var(--warning)] bg-amber-50 text-[var(--warning)]";
  }
}

export default async function FormsPage({ searchParams }: FormsPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: forms }, { data: managedLists }] = await Promise.all([
    supabase
      .from("forms")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("updated_at", { ascending: false })
      .returns<FormTemplateRow[]>(),
    supabase
      .from("lists")
      .select("id, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
  ]);

  const formRows = forms ?? [];
  const formIds = formRows.map((form) => form.id);
  const { data: formDocumentRows } =
    formIds.length > 0
      ? await supabase
          .from("document_control_register")
          .select("approval_status, dcn, source_id, version")
          .eq("tenant_id", context.appUser.tenant_id)
          .eq("source_table", "forms")
          .eq("active", true)
          .in("source_id", formIds)
          .order("updated_at", { ascending: false })
          .returns<FormDocumentControlRow[]>()
      : { data: [] as FormDocumentControlRow[] };
  const documentControlByFormId = new Map<string, FormDocumentControlRow>();

  for (const document of formDocumentRows ?? []) {
    if (!documentControlByFormId.has(document.source_id)) {
      documentControlByFormId.set(document.source_id, document);
    }
  }

  const documentControlEnabled = Boolean(context.tenant?.document_control_enabled);
  const corElements = frameworkElements(coerceCertifyingPartner(context.tenant?.cor_certifying_partner));
  const publishedCount = formRows.filter((form) => form.status === "published").length;
  const appMenuCount = formRows.filter(
    (form) => form.app_menu_visible && !form.is_private && form.status !== "archived",
  ).length;
  return (
    <AdminShell eyebrow="Form operations" tenantName={context.tenant?.name ?? "Company profile"} title="Form Templates">
      {notice ? (
        <p className="mb-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Templates</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{formRows.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Published</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{publishedCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Visible in worker app</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{appMenuCount}</p>
        </div>
      </div>

      <form action={createFormTemplate} className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">New Form Template</h2>
              <p className="text-sm text-[var(--ink-muted)]">Published visible templates appear in the worker app and offline cache.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create
            </button>
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              href="/admin/lists"
            >
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              Managed Lists
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_180px_170px]">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Name</span>
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              name="name"
              placeholder="Daily field report"
              required
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Code</span>
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              maxLength={32}
              name="code"
              placeholder="DAILY-FIELD"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Status</span>
            <select
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue="published"
              name="status"
            >
              {formStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 block space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Description</span>
          <textarea
            className="min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          name="description"
          placeholder="Short purpose or usage note"
        />
      </label>

        <fieldset className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["appMenuVisible", "App menu visible", true],
            ["isPrivate", "Private", false],
            ["allowDuplicates", "Allow duplicates", true],
            ["useItemDataInAnalytics", "Use in analytics", false],
          ].map(([name, label, checked]) => (
            <label
              className="flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--ink)]"
              key={String(name)}
            >
              <input className="h-4 w-4 accent-[var(--primary)]" defaultChecked={Boolean(checked)} name={String(name)} type="checkbox" />
              {label}
            </label>
          ))}
        </fieldset>
      </form>

      <FormImportPanel availableLists={managedLists ?? []} />

      <div className="mt-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid grid-cols-[1.25fr_150px_1.2fr_100px_220px] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold uppercase text-[var(--ink-muted)] max-xl:hidden">
          <span>Template</span>
          <span>Status</span>
          <span>Settings</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>

        {formRows.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {formRows.map((form) => {
              const controlledDocument = documentControlByFormId.get(form.id);

              return (
                <form
                  action={updateFormTemplateSettings}
                  className="grid gap-4 px-4 py-4 xl:grid-cols-[1.25fr_150px_1.2fr_100px_220px] xl:items-center"
                  key={form.id}
                >
                  <input name="formId" type="hidden" value={form.id} />
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                      <ClipboardList className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ink)]">{form.name}</p>
                      <p className="truncate text-sm text-[var(--ink-muted)]">{form.code}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {controlledDocument ? (
                          <>
                            <span className="rounded-md border border-[var(--border)] bg-white px-2 py-1 text-xs font-semibold text-[var(--ink)]">
                              DCN {controlledDocument.dcn} v{controlledDocument.version}
                            </span>
                            <span
                              className={`rounded-md border px-2 py-1 text-xs font-semibold ${approvalStatusClass(controlledDocument.approval_status)}`}
                            >
                              {formatApprovalStatus(controlledDocument.approval_status)}
                            </span>
                          </>
                        ) : documentControlEnabled ? (
                          <span className="rounded-md border border-[var(--warning)] bg-amber-50 px-2 py-1 text-xs font-semibold text-[var(--warning)]">
                            DCN pending
                          </span>
                        ) : (
                          <span className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                            Document control off
                          </span>
                        )}
                      </div>
                      {form.description ? <p className="mt-1 line-clamp-2 text-sm text-[var(--ink-muted)]">{form.description}</p> : null}
                      <Link
                        className="mt-2 inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        href={`/admin/forms/${form.id}`}
                      >
                        <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
                        Builder
                      </Link>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <span className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(form.status)}`}>
                      {formatFormStatus(form.status)}
                    </span>
                    <select
                      className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      defaultValue={form.status}
                      name="status"
                    >
                      {formStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <fieldset className="grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                      <input className="h-4 w-4 accent-[var(--primary)]" defaultChecked={form.app_menu_visible} name="appMenuVisible" type="checkbox" />
                      <Eye className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      App menu
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                      <input className="h-4 w-4 accent-[var(--primary)]" defaultChecked={form.is_private} name="isPrivate" type="checkbox" />
                      <LockKeyhole className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      Private
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                      <input className="h-4 w-4 accent-[var(--primary)]" defaultChecked={form.allow_duplicates} name="allowDuplicates" type="checkbox" />
                      <CheckCircle2 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      Duplicates
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                      <input
                        className="h-4 w-4 accent-[var(--primary)]"
                        defaultChecked={form.use_item_data_in_analytics}
                        name="useItemDataInAnalytics"
                        type="checkbox"
                      />
                      <BarChart3 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      Analytics
                    </label>
                  </fieldset>

                  <div className="grid gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                      <input className="h-4 w-4 accent-[var(--primary)]" defaultChecked={form.cor_tracked} name="corTracked" type="checkbox" />
                      <BadgeCheck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      Track for COR
                    </label>
                    <label className="text-xs font-semibold text-[var(--ink-muted)]">
                      Audit element
                      <select
                        className="mt-1 h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        defaultValue={form.cor_element_key ?? ""}
                        name="corElementKey"
                      >
                        <option value="">No element</option>
                        {corElements.map((element) => (
                          <option key={element.canonical} value={element.canonical}>
                            {`Element ${elementDisplay(element)}: ${element.name}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <p className="text-sm text-[var(--ink-muted)]">{formatUpdatedAt(form.updated_at)}</p>

                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      type="submit"
                    >
                      <Save className="h-4 w-4" aria-hidden="true" />
                      Save
                    </button>
                    <DeleteFormButton formName={form.name} />
                  </div>
                </form>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No form templates yet</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Create a published template to make it available in the worker app.</p>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
