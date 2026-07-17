import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, BadgeCheck, CheckCircle2, FileCheck2, FileClock, FileText, GripVertical, Layers3, Save, Search, ScanLine, ToggleLeft, ToggleRight, Upload, XCircle } from "lucide-react";
import {
  approveControlledDocument,
  assignResourceSection,
  createResourceSection,
  createFormFromDetectedText,
  markResourceReviewed,
  moveResource,
  moveResourceSection,
  requestControlledDocumentRevision,
  updateDocumentControlSetting,
  updateDocumentControlNumberingSettings,
  updateResourceCorSettings,
  updateResourceSection,
  uploadControlledDocument,
} from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { coerceCertifyingPartner, elementDisplay, elementDisplayForCanonical, frameworkElements, isCanonicalElement } from "@/lib/cor-frameworks";
import { corAvailable } from "@/lib/region";
import { getResourceReviewStatus } from "@/lib/document-reminders";
import {
  compareResourceOrder,
  buildDocumentControlNumberSettings,
  coerceDocumentApprovalStatusFilter,
  createDocumentControlNumber,
  documentApprovalStatusFilterOptions,
  documentTypeOptions,
  formatDocumentType,
  getKnowledgeSearchTerms,
  nextResourceSortOrder,
  normalizeKnowledgeSearchQuery,
} from "@/lib/document-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type DocumentsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ControlledDocumentRow = Database["public"]["Tables"]["document_control_register"]["Row"];
type CompanySettingsRow = Database["public"]["Tables"]["company_settings"]["Row"];
type ResourceRow = Database["public"]["Tables"]["resources"]["Row"];
type ResourceSectionRow = Database["public"]["Tables"]["resource_sections"]["Row"];
type ApprovalUserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "full_name" | "id">;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | undefined) {
  if (!value) {
    return "Not synced";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatReviewerName(user: ApprovalUserRow | undefined) {
  return user?.full_name ?? "Unknown reviewer";
}

function searchPattern(term: string) {
  return `%${term}%`;
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

function documentRegisterFilterHref(status: string, query: string) {
  const params = new URLSearchParams();

  if (status !== "all") {
    params.set("approvalStatus", status);
  }

  if (query) {
    params.set("q", query);
  }

  const search = params.toString();
  return search ? `/admin/documents?${search}` : "/admin/documents";
}

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const query = normalizeKnowledgeSearchQuery(firstParam(params.q) ?? "");
  const approvalStatusFilter = coerceDocumentApprovalStatusFilter(firstParam(params.approvalStatus));
  const searchTerms = getKnowledgeSearchTerms(query);
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  let documentQuery = supabase
    .from("document_control_register")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("updated_at", { ascending: false })
    .limit(20);
  let resourceQuery = supabase
    .from("resources")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .order("name", { ascending: true })
    .limit(query ? 50 : 100);

  for (const term of searchTerms) {
    const pattern = searchPattern(term);
    documentQuery = documentQuery.or(
      `dcn.ilike.${pattern},document_type.ilike.${pattern},source_table.ilike.${pattern},revision_notes.ilike.${pattern},version.ilike.${pattern}`,
    );
    resourceQuery = resourceQuery.or(
      `name.ilike.${pattern},dcn.ilike.${pattern},storage_path.ilike.${pattern},mime_type.ilike.${pattern},search_text.ilike.${pattern}`,
    );
  }

  if (approvalStatusFilter === "revision") {
    documentQuery = documentQuery.not("revision_of_id", "is", null);
  } else if (approvalStatusFilter !== "all") {
    documentQuery = documentQuery.eq("approval_status", approvalStatusFilter);
  }

  const [
    { data: documents },
    { data: resourceRows },
    { count: resourceCount },
    { count: activeDocumentCount },
    { count: formImportCount },
    { count: pendingApprovalCount },
    { data: revisionRows },
    { data: resourceSections },
    { data: companySettings },
    { data: registerHistoryRows },
    { data: approvalUsers },
  ] = await Promise.all([
    documentQuery.returns<ControlledDocumentRow[]>(),
    resourceQuery.returns<ResourceRow[]>(),
    supabase.from("resources").select("*", { count: "exact", head: true }).eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("document_control_register")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true),
    supabase
      .from("document_control_register")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id)
      .in("document_type", ["form", "form_import"]),
    supabase
      .from("document_control_register")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("approval_status", "pending"),
    supabase
      .from("document_control_register")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("active", true)
      .order("dcn", { ascending: true })
      .returns<ControlledDocumentRow[]>(),
    supabase
      .from("resource_sections")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .returns<ResourceSectionRow[]>(),
    supabase
      .from("company_settings")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<CompanySettingsRow>(),
    supabase
      .from("document_control_register")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("dcn", { ascending: true })
      .order("version", { ascending: false })
      .limit(200)
      .returns<ControlledDocumentRow[]>(),
    supabase
      .from("users")
      .select("id, full_name")
      .eq("tenant_id", context.appUser.tenant_id)
      .returns<ApprovalUserRow[]>(),
  ]);

  const resources = await Promise.all(
    (resourceRows ?? []).map(async (resource) => {
      const { data } = await supabase.storage.from("tenant-documents").createSignedUrl(resource.storage_path, 10 * 60);

      return {
        ...resource,
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );

  const documentControlEnabled = Boolean(context.tenant?.document_control_enabled);
  // COR document tagging is Canada-only; US tenants never see it.
  const showCor = corAvailable(context.tenant?.country);
  const certifyingPartner = coerceCertifyingPartner(context.tenant?.cor_certifying_partner);
  const corElements = frameworkElements(certifyingPartner);
  const numberingSettings = buildDocumentControlNumberSettings({
    companyId: companySettings?.company_id,
    dcnCompanyPrefix: companySettings?.dcn_company_prefix,
    dcnIncludeRevision: companySettings?.dcn_include_revision,
    dcnIncludeSourceCode: companySettings?.dcn_include_source_code,
    dcnIncludeYear: companySettings?.dcn_include_year,
    dcnSequencePadding: companySettings?.dcn_sequence_padding,
    tenantSlug: context.tenant?.slug,
  });
  const dcnPreview = createDocumentControlNumber({
    companyPrefix: numberingSettings.companyPrefix,
    documentType: "form",
    includeRevision: numberingSettings.includeRevision,
    includeSourceCode: numberingSettings.includeSourceCode,
    includeYear: numberingSettings.includeYear,
    revision: "1",
    sequence: 12,
    sequencePadding: numberingSettings.sequencePadding,
    sourceCode: "JHA",
  });
  const registerIsFiltered = Boolean(query || approvalStatusFilter !== "all");
  const revisionOptions = revisionRows ?? [];
  const sectionRows = resourceSections ?? [];
  const orderedResources = [...resources].sort(compareResourceOrder);
  const approvalUserById = new Map((approvalUsers ?? []).map((user) => [user.id, user]));
  const historyByDcn = new Map<string, ControlledDocumentRow[]>();

  for (const registerDocument of registerHistoryRows ?? []) {
    const history = historyByDcn.get(registerDocument.dcn) ?? [];
    history.push(registerDocument);
    historyByDcn.set(registerDocument.dcn, history);
  }

  const resourceCountBySection = new Map<string, number>();

  for (const resource of orderedResources) {
    if (resource.section_id) {
      resourceCountBySection.set(resource.section_id, (resourceCountBySection.get(resource.section_id) ?? 0) + 1);
    }
  }

  const unsectionedResourceKey = "__unsectioned__";
  const resourcesBySectionKey = new Map<string, typeof orderedResources>();
  const resourcePositionById = new Map<string, { isFirst: boolean; isLast: boolean }>();

  for (const resource of orderedResources) {
    const sectionKey = resource.section_id ?? unsectionedResourceKey;
    const sectionResources = resourcesBySectionKey.get(sectionKey) ?? [];
    sectionResources.push(resource);
    resourcesBySectionKey.set(sectionKey, sectionResources);
  }

  for (const sectionResources of resourcesBySectionKey.values()) {
    const sortedResources = [...sectionResources].sort(compareResourceOrder);

    sortedResources.forEach((resource, index) => {
      resourcePositionById.set(resource.id, {
        isFirst: index === 0,
        isLast: index === sortedResources.length - 1,
      });
    });
  }

  const nextResourceSectionSortOrder = sectionRows.length * 100;
  const nextUploadSortOrder = nextResourceSortOrder(orderedResources.filter((resource) => !resource.section_id));
  const settingButtonBase =
    "inline-flex h-10 min-w-24 items-center justify-center gap-2 px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-default";
  const settingButtonActive = "bg-[var(--primary)] text-white";
  const settingButtonInactive = "bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]";

  return (
    <AdminShell
      eyebrow="Document control"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Documents"
    >
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Document control</p>
          <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-[var(--ink)]">
            {documentControlEnabled ? (
              <ToggleRight className="h-5 w-5 text-[var(--success)]" aria-hidden="true" />
            ) : (
              <ToggleLeft className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
            )}
            {documentControlEnabled ? "Enabled" : "Disabled"}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Resources</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{resourceCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Active register</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{activeDocumentCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Pending approval</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{pendingApprovalCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--ink-muted)]">Forms</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{formImportCount ?? 0}</p>
        </div>
      </div>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Document Control Setting</h2>
            <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-[var(--ink-muted)]">
              {documentControlEnabled ? (
                <ToggleRight className="h-4 w-4 text-[var(--success)]" aria-hidden="true" />
              ) : (
                <ToggleLeft className="h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
              )}
              {documentControlEnabled ? "On" : "Off"}
            </p>
          </div>
          <div className="inline-grid w-full grid-cols-2 overflow-hidden rounded-md border border-[var(--border)] sm:w-auto">
            <form action={updateDocumentControlSetting}>
              <input name="enabled" type="hidden" value="true" />
              <button
                aria-pressed={documentControlEnabled}
                className={`${settingButtonBase} w-full rounded-none ${documentControlEnabled ? settingButtonActive : settingButtonInactive}`}
                disabled={documentControlEnabled}
                type="submit"
              >
                <ToggleRight className="h-4 w-4" aria-hidden="true" />
                On
              </button>
            </form>
            <form action={updateDocumentControlSetting}>
              <input name="enabled" type="hidden" value="false" />
              <button
                aria-pressed={!documentControlEnabled}
                className={`${settingButtonBase} w-full rounded-none border-l border-[var(--border)] ${
                  documentControlEnabled ? settingButtonInactive : "bg-[var(--surface-muted)] text-[var(--ink)]"
                }`}
                disabled={!documentControlEnabled}
                type="submit"
              >
                <ToggleLeft className="h-4 w-4" aria-hidden="true" />
                Off
              </button>
            </form>
          </div>
        </div>

        <form action={updateDocumentControlNumberingSettings} className="mt-5 border-t border-[var(--border)] pt-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_150px]">
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Company prefix</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={numberingSettings.companyPrefix}
                name="companyPrefix"
                placeholder="ACME"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Digits</span>
              <input
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={numberingSettings.sequencePadding}
                max={8}
                min={3}
                name="sequencePadding"
                type="number"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]">
              <input
                className="h-4 w-4 accent-[var(--primary)]"
                defaultChecked={numberingSettings.includeSourceCode}
                name="includeSourceCode"
                type="checkbox"
                value="true"
              />
              Include form or resource code
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]">
              <input
                className="h-4 w-4 accent-[var(--primary)]"
                defaultChecked={numberingSettings.includeRevision}
                name="includeRevision"
                type="checkbox"
                value="true"
              />
              Include revision in DCN
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] sm:col-span-2">
              <input
                className="h-4 w-4 accent-[var(--primary)]"
                defaultChecked={numberingSettings.includeYear}
                name="includeYear"
                type="checkbox"
                value="true"
              />
              Include current year (e.g., ACME-2026-FRM-JHA-0012)
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-[var(--ink)]">{dcnPreview}</p>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              Save Numbering
            </button>
          </div>
        </form>
      </section>

      <form action="/admin/documents" className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Search knowledge base</span>
          <span className="flex flex-col gap-3 sm:flex-row">
            <input
              className="h-10 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              defaultValue={query}
              name="q"
              placeholder="working alone procedure"
              type="search"
            />
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Search
            </button>
          </span>
        </label>
        {query ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Showing matches for {query} across filenames, document names, DCNs, types, and notes.
          </p>
        ) : null}
      </form>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <section className="space-y-5">
          <form
            action={uploadControlledDocument}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <Upload className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Upload Controlled Document</h2>
                <p className="text-sm text-[var(--ink-muted)]">PDFs and image forms become registered source documents.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_170px_130px_150px]">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Document name</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="name"
                  placeholder="Daily field report source"
                  required
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Type</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue="form_import"
                  name="documentType"
                >
                  {documentTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Version</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue="1.0"
                  name="version"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Source code</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="sourceCode"
                  placeholder="JHA"
                />
              </label>
            </div>

            <label className="mt-4 block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Revision of</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="revisionOfId"
              >
                <option value="">New controlled document</option>
                {revisionOptions.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.dcn} v{document.version} - {formatDocumentType(document.document_type)}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-4 block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Resource section</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="sectionId"
              >
                <option value="">Unsectioned resource</option>
                {sectionRows.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </label>

            {showCor ? (
              <div className="mt-4 grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:grid-cols-[auto_1fr] sm:items-center">
                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  <input className="h-4 w-4 accent-[var(--primary)]" name="corTracked" type="checkbox" />
                  <BadgeCheck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  Track for COR
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-[var(--ink-muted)]">Audit element</span>
                  <select
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
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
            ) : null}

            <div className="mt-4 grid gap-3 rounded-md border border-[var(--border)] p-3 sm:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-[var(--ink-muted)]">Expiry cycle</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="reviewIntervalMonths"
                >
                  <option value="">No expiry schedule</option>
                  <option value="12">Annual (12 months)</option>
                  <option value="24">Every 2 years</option>
                  <option value="36">Every 3 years (SDS)</option>
                  <option value="60">Every 5 years</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-[var(--ink-muted)]">Expiry date</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="reviewDate"
                  type="date"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-[var(--ink-muted)]">Remind days before</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={30}
                  max={365}
                  min={0}
                  name="reminderLeadDays"
                  type="number"
                />
              </label>
              <p className="text-xs text-[var(--ink-muted)] sm:col-span-3">
                Pick a cycle to set the expiry date automatically, or set an exact date. Leave both blank for no expiry
                tracking.
              </p>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_130px]">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">File</span>
                <input
                  accept=".pdf,image/png,image/jpeg,image/webp,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="block h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="file"
                  required
                  type="file"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">DCN</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="dcn"
                  placeholder="Auto if blank"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Order</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={nextUploadSortOrder}
                  name="sortOrder"
                  type="number"
                />
              </label>
            </div>

            <label className="mt-4 block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Revision notes</span>
              <textarea
                className="min-h-20 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="revisionNotes"
              />
            </label>

            <button
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Upload
            </button>
          </form>

          <form action={createFormFromDetectedText} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <ScanLine className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">OCR Form Import</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  Paste detected field text here, or use the Forms import panel to scan a file locally.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[1fr_190px]">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Form name</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="name"
                  placeholder="Imported daily report"
                  required
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Form code</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  maxLength={32}
                  name="code"
                  placeholder="Auto if blank"
                />
              </label>
            </div>

            <label className="mt-4 block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Detected field text</span>
              <textarea
                className="min-h-40 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                name="detectedText"
                placeholder={"Inspection date\nWorker name\nPass / Fail\nNotes"}
                required
              />
            </label>

            <button
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <ScanLine className="h-4 w-4" aria-hidden="true" />
              Create Draft Form
            </button>
          </form>
        </section>

        <aside className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]">Resource Library Sections</h2>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">{sectionRows.length} sections for the mobile menu.</p>
              </div>
              <Layers3 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            </div>

            <form action={createResourceSection} className="border-b border-[var(--border)] p-4">
              <input name="sortOrder" type="hidden" value={nextResourceSectionSortOrder} />
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">New section</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="name"
                  placeholder="Policies"
                  required
                />
              </label>
              <button
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                type="submit"
              >
                <Layers3 className="h-4 w-4" aria-hidden="true" />
                Add Section
              </button>
            </form>

            {sectionRows.length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {sectionRows.map((section, sectionIndex) => (
                  <div className="grid gap-3 px-4 py-3" key={section.id}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <GripVertical className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />
                        <p className="truncate text-sm font-semibold text-[var(--ink)]">{section.name}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <form action={moveResourceSection}>
                          <input name="sectionId" type="hidden" value={section.id} />
                          <input name="direction" type="hidden" value="up" />
                          <button
                            aria-label={`Move ${section.name} up`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={sectionIndex === 0}
                            title={`Move ${section.name} up`}
                            type="submit"
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </form>
                        <form action={moveResourceSection}>
                          <input name="sectionId" type="hidden" value={section.id} />
                          <input name="direction" type="hidden" value="down" />
                          <button
                            aria-label={`Move ${section.name} down`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={sectionIndex === sectionRows.length - 1}
                            title={`Move ${section.name} down`}
                            type="submit"
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </form>
                      </div>
                    </div>
                    <form action={updateResourceSection} className="grid gap-3">
                      <input name="sectionId" type="hidden" value={section.id} />
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Name</span>
                        <input
                          className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          defaultValue={section.name}
                          name="name"
                        />
                      </label>
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Sort</span>
                          <input
                            className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                            defaultValue={section.sort_order}
                            name="sortOrder"
                            type="number"
                          />
                        </label>
                        <button
                          className="self-end inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          type="submit"
                        >
                          <Save className="h-4 w-4" aria-hidden="true" />
                          Save
                        </button>
                      </div>
                    </form>
                    <p className="text-xs text-[var(--ink-muted)]">{resourceCountBySection.get(section.id) ?? 0} resources assigned.</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                Add sections to group resources in the worker app.
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
              <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]">
                {registerIsFiltered ? "Register matches" : "Register"}
              </h2>
              <FileCheck2 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            </div>
            <div className="flex flex-wrap gap-2 border-b border-[var(--border)] px-4 py-3">
              {documentApprovalStatusFilterOptions.map((option) => {
                const active = approvalStatusFilter === option.value;

                return (
                  <a
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "bg-[var(--primary)] text-white"
                        : "bg-white text-[var(--ink-muted)] ring-1 ring-[var(--border)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                    }`}
                    href={documentRegisterFilterHref(option.value, query)}
                    key={option.value}
                  >
                    {option.label}
                  </a>
                );
              })}
            </div>
            {(documents ?? []).length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {(documents ?? []).map((document) => {
                  const revisionHistory = historyByDcn.get(document.dcn) ?? [document];
                  const reviewedBy = document.approved_by ? approvalUserById.get(document.approved_by) : undefined;

                  return (
                    <div className="px-4 py-3" key={document.id}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--ink)]">{document.dcn}</p>
                          <p className="mt-1 text-sm text-[var(--ink-muted)]">
                            {formatDocumentType(document.document_type)} v{document.version}
                          </p>
                        </div>
                        <span className={`w-fit rounded-md border px-2 py-1 text-xs font-semibold ${approvalStatusClass(document.approval_status)}`}>
                          {formatApprovalStatus(document.approval_status)}
                        </span>
                      </div>
                      {document.revision_notes ? (
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">{document.revision_notes}</p>
                      ) : null}
                      {document.revision_of_id ? (
                        <p className="mt-1 text-xs font-semibold text-[var(--ink-muted)]">Revision record</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold text-[var(--ink-muted)]">{formatDate(document.updated_at)}</p>
                        {document.approved_by && document.approved_at ? (
                          <p className="text-xs font-semibold text-[var(--ink-muted)]">
                            Reviewed by {formatReviewerName(reviewedBy)} on {formatDate(document.approved_at)}
                          </p>
                        ) : null}
                        {document.approval_status !== "approved" ? (
                          <form action={approveControlledDocument}>
                            <input name="documentId" type="hidden" value={document.id} />
                            <button
                              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              type="submit"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" aria-hidden="true" />
                              Approve
                            </button>
                          </form>
                        ) : null}
                        {document.approval_status !== "rejected" ? (
                          <form action={requestControlledDocumentRevision}>
                            <input name="documentId" type="hidden" value={document.id} />
                            <button
                              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-red-50 hover:text-[var(--danger)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              type="submit"
                            >
                              <XCircle className="h-3.5 w-3.5 text-[var(--danger)]" aria-hidden="true" />
                              Needs Revision
                            </button>
                          </form>
                        ) : null}
                      </div>
                      {revisionHistory.length > 1 ? (
                        <details className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase text-[var(--ink-muted)]">
                            Revision history
                          </summary>
                          <div className="divide-y divide-[var(--border)] border-t border-[var(--border)] bg-white">
                            {revisionHistory.map((revision) => {
                              const revisionReviewer = revision.approved_by ? approvalUserById.get(revision.approved_by) : undefined;

                              return (
                                <div className="px-3 py-2" key={revision.id}>
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-semibold text-[var(--ink)]">v{revision.version}</p>
                                    <span className={`w-fit rounded-md border px-2 py-1 text-xs font-semibold ${approvalStatusClass(revision.approval_status)}`}>
                                      {formatApprovalStatus(revision.approval_status)}
                                    </span>
                                  </div>
                                  {revision.revision_notes ? (
                                    <p className="mt-1 text-xs text-[var(--ink-muted)]">{revision.revision_notes}</p>
                                  ) : null}
                                  <p className="mt-1 text-xs font-semibold text-[var(--ink-muted)]">
                                    {formatDate(revision.updated_at)}
                                    {revision.approved_by && revision.approved_at
                                      ? `, reviewed by ${formatReviewerName(revisionReviewer)} on ${formatDate(revision.approved_at)}`
                                      : ""}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                {registerIsFiltered ? "No register matches." : "No controlled documents yet."}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
              <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]">
                {query ? "Resource matches" : "Library resources"}
              </h2>
              <FileClock className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            </div>
            {orderedResources.length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {orderedResources.map((resource) => {
                  const position = resourcePositionById.get(resource.id);
                  const reviewState = getResourceReviewStatus({
                    reminderLeadDays: resource.reminder_lead_days,
                    reviewDate: resource.review_date,
                  });

                  return (
                    <div className="grid gap-3 px-4 py-3" key={resource.id}>
                      <div className="flex gap-3">
                        <FileText className="mt-1 h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-[var(--ink)]">{resource.name}</p>
                          <p className="truncate text-sm text-[var(--ink-muted)]">{resource.dcn ?? resource.storage_path}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-[var(--ink-muted)]">Order {resource.sort_order}</span>
                            {showCor && resource.cor_tracked && isCanonicalElement(resource.cor_element_key) ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                                COR E{elementDisplayForCanonical(certifyingPartner, resource.cor_element_key) ?? "?"}
                              </span>
                            ) : null}
                            {reviewState === "overdue" ? (
                              <span className="rounded-md border border-[var(--danger)] bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--danger)]">
                                Expired
                              </span>
                            ) : reviewState === "due_soon" ? (
                              <span className="rounded-md border border-[var(--warning)] bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--warning)]">
                                Expiry due
                              </span>
                            ) : resource.review_date ? (
                              <span className="rounded-md border border-[var(--border)] bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                                Current
                              </span>
                            ) : null}
                          </div>
                          {resource.signedUrl ? (
                            <a
                              className="mt-2 inline-flex h-8 items-center rounded-md border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              href={resource.signedUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open
                            </a>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <form action={moveResource}>
                            <input name="resourceId" type="hidden" value={resource.id} />
                            <input name="direction" type="hidden" value="up" />
                            <button
                              aria-label={`Move ${resource.name} up`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={position?.isFirst ?? true}
                              title={`Move ${resource.name} up`}
                              type="submit"
                            >
                              <ArrowUp className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </form>
                          <form action={moveResource}>
                            <input name="resourceId" type="hidden" value={resource.id} />
                            <input name="direction" type="hidden" value="down" />
                            <button
                              aria-label={`Move ${resource.name} down`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={position?.isLast ?? true}
                              title={`Move ${resource.name} down`}
                              type="submit"
                            >
                              <ArrowDown className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </form>
                        </div>
                      </div>
                      <form action={assignResourceSection} className="grid gap-2">
                        <input name="resourceId" type="hidden" value={resource.id} />
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Name</span>
                          <input
                            className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-2 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                            defaultValue={resource.name}
                            name="name"
                          />
                        </label>
                        <div className="grid grid-cols-[1fr_88px] gap-2">
                          <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Section</span>
                            <select
                              className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-2 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              defaultValue={resource.section_id ?? ""}
                              name="sectionId"
                            >
                              <option value="">Unsectioned</option>
                              {sectionRows.map((section) => (
                                <option key={section.id} value={section.id}>
                                  {section.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Order</span>
                            <input
                              className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-2 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              defaultValue={resource.sort_order}
                              name="sortOrder"
                              type="number"
                            />
                          </label>
                        </div>
                        <button
                          className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          type="submit"
                        >
                          Save Resource
                        </button>
                      </form>

                      <details className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[var(--primary)]">
                          {showCor ? "COR and expiry settings" : "Expiry settings"}
                        </summary>
                        <form action={updateResourceCorSettings} className="grid gap-2 border-t border-[var(--border)] p-3">
                          <input name="resourceId" type="hidden" value={resource.id} />
                          {showCor ? (
                            <>
                              <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                                <input className="h-4 w-4 accent-[var(--primary)]" defaultChecked={resource.cor_tracked} name="corTracked" type="checkbox" />
                                Track for COR
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Audit element</span>
                                <select
                                  className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-2 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                                  defaultValue={resource.cor_element_key ?? ""}
                                  name="corElementKey"
                                >
                                  <option value="">No element</option>
                                  {corElements.map((element) => (
                                    <option key={element.canonical} value={element.canonical}>
                                      {`Element ${element.number}: ${element.name}`}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </>
                          ) : null}
                          <div className="grid grid-cols-2 gap-2">
                            <label className="space-y-1">
                              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Expiry cycle</span>
                              <select
                                className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-2 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                                defaultValue={resource.review_interval_months ?? ""}
                                name="reviewIntervalMonths"
                              >
                                <option value="">No schedule</option>
                                <option value="12">Annual</option>
                                <option value="24">2 years</option>
                                <option value="36">3 years (SDS)</option>
                                <option value="60">5 years</option>
                              </select>
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Expiry date</span>
                              <input
                                className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-2 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                                defaultValue={resource.review_date ?? ""}
                                name="reviewDate"
                                type="date"
                              />
                            </label>
                          </div>
                          <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Remind days before</span>
                            <input
                              className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-2 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              defaultValue={resource.reminder_lead_days}
                              max={365}
                              min={0}
                              name="reminderLeadDays"
                              type="number"
                            />
                          </label>
                          <button
                            className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                            type="submit"
                          >
                            Save COR and review
                          </button>
                        </form>
                        {resource.review_date ? (
                          <form action={markResourceReviewed} className="border-t border-[var(--border)] p-3">
                            <input name="resourceId" type="hidden" value={resource.id} />
                            <button
                              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              type="submit"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" aria-hidden="true" />
                              Mark reviewed today
                            </button>
                          </form>
                        ) : null}
                      </details>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                {query ? "No resource matches." : "No uploads yet."}
              </div>
            )}
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}
