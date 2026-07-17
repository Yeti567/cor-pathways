import Image from "next/image";
import { redirect } from "next/navigation";
import { Building2, CheckCircle2, FileText, Plug, Printer, Upload } from "lucide-react";
import { updateCompanySettings, updatePrintSettings } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  formatLogoPlacement,
  formatPrintHeaderOption,
  integrationOptions,
  isIntegrationEnabled,
  logoPlacementOptions,
  normalizePreparedByLabel,
  normalizePrintFooterNote,
  parseAddressLines,
  printHeaderOptions,
  timezoneOptions,
  type CompanySettingsRow,
  type PrintSettingsRow,
} from "@/lib/company-settings";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function previewAddress(companySettings: CompanySettingsRow | null) {
  const addressLines = parseAddressLines(companySettings?.address);
  return [companySettings?.company_name, ...addressLines, companySettings?.phone]
    .filter((value): value is string => Boolean(value?.trim()))
    .slice(0, 5);
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: companySettings }, { data: printSettings }] = await Promise.all([
    supabase
      .from("company_settings")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<CompanySettingsRow>(),
    supabase
      .from("print_settings")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<PrintSettingsRow>(),
  ]);
  const logoUrl = companySettings?.logo_path
    ? (await supabase.storage.from("tenant-documents").createSignedUrl(companySettings.logo_path, 10 * 60)).data
        ?.signedUrl ?? null
    : null;
  const activeHeaderOption = printSettings?.header_option ?? "company_info_only";
  const activeLogoPlacement = printSettings?.logo_placement ?? "left";
  const activeFooterNote = normalizePrintFooterNote(printSettings?.footer_note);
  const activePreparedByLabel = normalizePreparedByLabel(printSettings?.prepared_by_label);
  const activeShowPrintedAt = printSettings?.show_printed_at ?? true;
  const previewLines = previewAddress(companySettings);

  return (
    <AdminShell
      eyebrow="Setup"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Company Settings"
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

      <div className="grid gap-6 xl:grid-cols-[220px_1fr]">
        <aside className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm">
          <a className="flex items-center gap-3 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-sm font-semibold text-[var(--primary)]" href="#company-info">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            Company Info
          </a>
          <a className="mt-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]" href="#print-settings">
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print Settings
          </a>
          <a className="mt-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]" href="#integrations">
            <Plug className="h-4 w-4" aria-hidden="true" />
            Integrations
          </a>
        </aside>

        <div className="space-y-6">
          <form
            action={updateCompanySettings}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
            id="company-info"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <Building2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Basic Info</h2>
                <p className="text-sm text-[var(--ink-muted)]">This information appears in the admin console and printed form headers.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Company Name</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={companySettings?.company_name ?? context.tenant?.name ?? ""}
                  name="companyName"
                  required
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Company ID</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={companySettings?.company_id ?? ""}
                  name="companyId"
                  placeholder="ACME"
                />
              </label>
              <label className="space-y-2 lg:col-span-2">
                <span className="text-sm font-medium text-[var(--ink)]">Address</span>
                <textarea
                  className="min-h-28 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={companySettings?.address ?? ""}
                  name="address"
                  placeholder={"100 Riverside Road\nVancouver, BC\nCanada"}
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Phone</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={companySettings?.phone ?? ""}
                  name="phone"
                  type="tel"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Timezone</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={companySettings?.timezone ?? "America/Vancouver"}
                  name="timezone"
                >
                  {timezoneOptions.map((timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <section className="mt-5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--ink)]">Logo</h3>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">PNG, JPEG, or WebP. Stored in tenant document storage.</p>
                </div>
                {logoUrl ? (
                  <div className="flex h-16 w-40 items-center justify-center rounded-md border border-[var(--border)] bg-white p-2">
                    <Image
                      alt="Company logo"
                      className="max-h-12 w-auto object-contain"
                      height={48}
                      src={logoUrl}
                      unoptimized
                      width={140}
                    />
                  </div>
                ) : (
                  <div className="flex h-16 w-40 items-center justify-center rounded-md border border-dashed border-[var(--border)] bg-white text-xs font-semibold text-[var(--ink-muted)]">
                    No logo
                  </div>
                )}
              </div>
              <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]">
                <Upload className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                <span>Upload Logo</span>
                <input accept="image/png,image/jpeg,image/webp" className="sr-only" name="logo" type="file" />
              </label>
            </section>

            <section className="mt-5 rounded-md border border-[var(--border)] bg-white p-4" id="integrations">
              <div className="flex items-center gap-2">
                <Plug className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[var(--ink)]">Integrations</h3>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {integrationOptions.map((integration) => (
                  <label className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--ink)]" key={integration.value}>
                    <input
                      className="h-4 w-4 accent-[var(--primary)]"
                      defaultChecked={isIntegrationEnabled(companySettings?.integrations ?? {}, integration.value)}
                      name="integrations"
                      type="checkbox"
                      value={integration.value}
                    />
                    {integration.label}
                  </label>
                ))}
              </div>
            </section>

            <button
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Save Company Settings
            </button>
          </form>

          <form action={updatePrintSettings} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" id="print-settings">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <Printer className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Printed Reports</h2>
                <p className="text-sm text-[var(--ink-muted)]">Choose how company information appears on completed forms and monitor reports.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {printHeaderOptions.map((option) => {
                const selected = activeHeaderOption === option.value;
                const showInfo = option.value !== "logo_only";
                const showLogo = option.value !== "company_info_only";
                const logoPreview = (
                  <span className="flex h-8 w-16 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[10px] font-bold text-[var(--primary)]">
                    Logo
                  </span>
                );

                return (
                  <label
                    className={`block rounded-lg border bg-white p-3 shadow-sm transition ${
                      selected ? "border-[var(--primary)] ring-2 ring-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--primary)]"
                    }`}
                    key={option.value}
                  >
                    <input className="sr-only" defaultChecked={selected} name="headerOption" type="radio" value={option.value} />
                    <span className="block text-center text-sm font-semibold text-[var(--ink)]">{option.label}</span>
                    <span className="mt-4 block rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
                      <span
                        className={`flex min-h-20 items-start gap-3 bg-white p-3 ${
                          showInfo ? "justify-between" : activeLogoPlacement === "right" ? "justify-end" : "justify-start"
                        }`}
                      >
                        {showLogo && activeLogoPlacement === "left" ? logoPreview : null}
                        {showInfo ? (
                          <span className="flex-1 text-center text-[9px] leading-4 text-[var(--ink-muted)]">
                            {(previewLines.length > 0 ? previewLines : ["Company Name", "Address", "Phone"]).map((line) => (
                              <span className="block truncate" key={line}>
                                {line}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        {showLogo && activeLogoPlacement === "right" ? logoPreview : null}
                      </span>
                    </span>
                    {selected ? (
                      <span className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md bg-[var(--primary)] px-2 py-1 text-xs font-semibold text-white">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Selected
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>

            <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <h3 className="text-sm font-semibold text-[var(--ink)]">Logo Placement</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {logoPlacementOptions.map((option) => (
                  <label
                    className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${
                      activeLogoPlacement === option.value
                        ? "border-[var(--primary)] bg-white text-[var(--primary)]"
                        : "border-[var(--border)] bg-white text-[var(--ink)]"
                    }`}
                    key={option.value}
                  >
                    <input className="h-4 w-4 accent-[var(--primary)]" defaultChecked={activeLogoPlacement === option.value} name="logoPlacement" type="radio" value={option.value} />
                    {option.label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                Current print header: {formatPrintHeaderOption(activeHeaderOption)}, logo {formatLogoPlacement(activeLogoPlacement).toLowerCase()}.
              </p>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_240px]">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Footer Note</span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={activeFooterNote}
                  maxLength={240}
                  name="footerNote"
                />
              </label>
              <div className="space-y-4 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--ink)]">Prepared By Label</span>
                  <input
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    defaultValue={activePreparedByLabel}
                    maxLength={48}
                    name="preparedByLabel"
                  />
                </label>
                <label className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-medium text-[var(--ink)]">
                  <input
                    className="h-4 w-4 accent-[var(--primary)]"
                    defaultChecked={activeShowPrintedAt}
                    name="showPrintedAt"
                    type="checkbox"
                    value="true"
                  />
                  Show printed timestamp
                </label>
              </div>
            </div>

            <button
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              type="submit"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Save Print Settings
            </button>
          </form>

          <p className="text-center text-sm text-[var(--ink-muted)]">Tenant ID: {context.appUser.tenant_id}</p>
        </div>
      </div>
    </AdminShell>
  );
}
