import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintHeader } from "@/app/admin/_components/PrintHeader";
import { PrintReportButton } from "@/app/admin/monitor/PrintReportButton";
import { loadResolvedSubcontractorSlots } from "@/app/admin/subcontractors/_lib/settings";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import {
  getSubcontractorDocumentStatus,
  summariseSubcontractorCompliance,
  SUBCONTRACTOR_SLOT_GROUPS,
  SUBCONTRACTOR_STATE_LABELS,
} from "@/lib/subcontractor-requirements";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CompanySettingsRow = Database["public"]["Tables"]["company_settings"]["Row"];
type PrintSettingsRow = Database["public"]["Tables"]["print_settings"]["Row"];
type SubcontractorRow = Database["public"]["Tables"]["subcontractor"]["Row"];
type DocumentRow = Database["public"]["Tables"]["subcontractor_document"]["Row"];

type PackPageProps = {
  params: Promise<{ subcontractorId: string }>;
};

function money(value: number | null) {
  if (value === null) {
    return "Not recorded";
  }

  return new Intl.NumberFormat("en-CA", { currency: "CAD", maximumFractionDigits: 0, style: "currency" }).format(value);
}

function field(label: string, value: string) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 print:border-gray-300 print:bg-white">
      <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">{label}</p>
      <p className="mt-1 font-semibold text-[var(--ink)] print:text-black">{value}</p>
    </div>
  );
}

/**
 * One carrier's whole file on a page, for an insurer, a customer, or an auditor.
 *
 * Printed rather than generated as a PDF, matching every other pack in this app. The
 * browser's own print-to-PDF is what the other modules rely on, and adding a rendering
 * dependency to produce the same artefact would be a second way of doing one job.
 *
 * It deliberately shows superseded copies as well as current ones. What makes this
 * document worth anything after an incident is not what the company holds today, it is
 * being able to show what it held, when it checked, and who checked it.
 */
export default async function SubcontractorPackPage({ params }: PackPageProps) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.subcontractors_enabled) {
    redirect("/admin/setup");
  }

  const { subcontractorId } = await params;
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const [{ data: subcontractor }, { data: documents }, { slots }, { data: companySettings }, { data: printSettings }] =
    await Promise.all([
      supabase
        .from("subcontractor")
        .select("*")
        .eq("id", subcontractorId)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .maybeSingle<SubcontractorRow>(),
      supabase
        .from("subcontractor_document")
        .select("*")
        .eq("subcontractor_id", subcontractorId)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .returns<DocumentRow[]>(),
      loadResolvedSubcontractorSlots(supabase, tenantId),
      supabase.from("company_settings").select("*").eq("tenant_id", tenantId).maybeSingle<CompanySettingsRow>(),
      supabase.from("print_settings").select("*").eq("tenant_id", tenantId).maybeSingle<PrintSettingsRow>(),
    ]);

  if (!subcontractor) {
    notFound();
  }

  const documentRows = documents ?? [];
  const summary = summariseSubcontractorCompliance(
    documentRows.map((document) => ({
      coverageAmount: document.coverage_amount === null ? null : Number(document.coverage_amount),
      dueDate: document.due_date,
      reviewStatus: document.review_status,
      slotKey: document.slot_key,
    })),
    slots,
  );

  const liveBySlot = new Map<string, DocumentRow>();
  const historyBySlot = new Map<string, DocumentRow[]>();

  for (const document of documentRows) {
    if (document.review_status !== "approved") {
      continue;
    }

    if (document.superseded_by_id === null && !liveBySlot.has(document.slot_key)) {
      liveBySlot.set(document.slot_key, document);
    } else {
      const existing = historyBySlot.get(document.slot_key);

      if (existing) {
        existing.push(document);
      } else {
        historyBySlot.set(document.slot_key, [document]);
      }
    }
  }

  const tenantName = context.tenant?.name ?? "Company profile";
  const logoUrl = companySettings?.logo_path
    ? ((await supabase.storage.from("tenant-documents").createSignedUrl(companySettings.logo_path, 10 * 60)).data
        ?.signedUrl ?? null)
    : null;
  const preparedOn = new Intl.DateTimeFormat("en", { day: "2-digit", month: "long", year: "numeric" }).format(
    new Date(),
  );
  const deficiencies = [...summary.missing, ...summary.overdue, ...summary.underLimit];

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
            href={`/admin/subcontractors/${subcontractor.id}`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to {subcontractor.legal_name}
          </Link>
          <PrintReportButton label="Print or save as PDF" />
        </div>

        <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <PrintHeader
            className="mb-5"
            companySettings={companySettings ?? null}
            logoUrl={logoUrl}
            mode="always"
            printSettings={printSettings ?? null}
            tenantName={tenantName}
          />

          <header className="border-b border-[var(--border)] pb-5 print:border-gray-300">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--primary)] print:text-gray-600">
              Hired carrier due diligence file
            </p>
            <h1 className="mt-1 text-2xl font-bold text-[var(--ink)] print:text-black">{subcontractor.legal_name}</h1>
            <p className="mt-1 text-sm text-[var(--ink-muted)] print:text-gray-600">
              Prepared {preparedOn} · {SUBCONTRACTOR_STATE_LABELS[summary.state]} · {summary.satisfiedCount} of{" "}
              {summary.requiredCount} required documents current
            </p>
          </header>

          <section className="mt-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)] print:text-gray-600">
              The carrier
            </h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {field("Operating name", subcontractor.operating_name || "Not recorded")}
              {field("NSC number", subcontractor.nsc_number || "Not recorded")}
              {field("Safety rating", subcontractor.safety_rating || "Not recorded")}
              {field("Monitoring status", subcontractor.monitoring_status || "Not recorded")}
              {field(
                "Contact",
                [subcontractor.contact_name, subcontractor.contact_email, subcontractor.contact_phone]
                  .filter(Boolean)
                  .join(" · ") || "Not recorded",
              )}
              {field(
                "Insurance broker",
                [subcontractor.broker_name, subcontractor.broker_email, subcontractor.broker_phone]
                  .filter(Boolean)
                  .join(" · ") || "Not recorded",
              )}
            </div>
          </section>

          {deficiencies.length > 0 ? (
            <section className="mt-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)] print:text-gray-600">
                Outstanding ({deficiencies.length})
              </h2>
              <ul className="mt-2 space-y-1">
                {deficiencies.map((entry) => (
                  <li
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:border-gray-400 print:bg-white print:text-black"
                    key={`${entry.slot.key}-${entry.reason}`}
                  >
                    <span className="font-semibold">{entry.slot.label}</span>
                    {entry.reason === "missing" ? " is not on file." : null}
                    {entry.reason === "rejected" ? " was returned to the carrier and not replaced." : null}
                    {entry.reason === "overdue" ? ` lapsed on ${entry.dueDate}.` : null}
                    {entry.reason === "under_limit"
                      ? ` carries ${money(entry.coverageAmount)} against the ${money(entry.slot.minimumCoverageAmount)} required.`
                      : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {SUBCONTRACTOR_SLOT_GROUPS.map((group) => {
            const groupSlots = slots.filter((slot) => slot.group === group.key);

            if (groupSlots.length === 0) {
              return null;
            }

            return (
              <section className="mt-5" key={group.key}>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)] print:text-gray-600">
                  {group.label}
                </h2>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)] print:border-gray-400 print:text-gray-600">
                        <th className="py-2 pr-3 font-semibold">Document</th>
                        <th className="py-2 pr-3 font-semibold">Status</th>
                        <th className="py-2 pr-3 font-semibold">Reference</th>
                        <th className="py-2 pr-3 font-semibold">Limit</th>
                        <th className="py-2 pr-3 font-semibold">Issued</th>
                        <th className="py-2 font-semibold">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupSlots.map((slot) => {
                        const live = liveBySlot.get(slot.key) ?? null;
                        const status = live
                          ? getSubcontractorDocumentStatus({
                              dueDate: live.due_date,
                              reminderLeadDays: slot.reminderLeadDays,
                            })
                          : null;

                        return (
                          <tr
                            className="border-b border-[var(--border)] align-top print:border-gray-300"
                            key={slot.key}
                          >
                            <td className="py-2 pr-3 font-semibold text-[var(--ink)] print:text-black">
                              {slot.label}
                              {slot.required ? null : (
                                <span className="ml-1 text-xs font-normal text-[var(--ink-muted)]">(optional)</span>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-[var(--ink)] print:text-black">
                              {live ? (status?.state === "current" ? "On file" : (status?.label ?? "On file")) : "Not on file"}
                            </td>
                            <td className="py-2 pr-3 text-[var(--ink-muted)] print:text-black">
                              {[live?.document_number, live?.insurer].filter(Boolean).join(" · ") || "—"}
                            </td>
                            <td className="py-2 pr-3 text-[var(--ink-muted)] print:text-black">
                              {live?.coverage_amount != null ? money(Number(live.coverage_amount)) : "—"}
                            </td>
                            <td className="py-2 pr-3 text-[var(--ink-muted)] print:text-black">
                              {live?.issued_date ?? "—"}
                            </td>
                            <td className="py-2 text-[var(--ink-muted)] print:text-black">{live?.due_date ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}

          <section className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)] print:text-gray-600">
              What was held, and when it was checked
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)] print:text-gray-600">
              Every accepted document, including ones since replaced. This is the part that answers what was on file on
              a given date, which is the question that gets asked after an incident rather than before one.
            </p>
            <ul className="mt-2 space-y-1">
              {documentRows
                .filter((document) => document.review_status === "approved")
                .map((document) => {
                  const slot = slots.find((entry) => entry.key === document.slot_key);

                  return (
                    <li
                      className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--ink)] print:border-gray-300 print:text-black"
                      key={document.id}
                    >
                      <span className="font-semibold">{slot?.label ?? document.slot_key}</span>
                      {document.issued_date ? ` · issued ${document.issued_date}` : ""}
                      {document.due_date ? ` · due ${document.due_date}` : ""}
                      {document.reviewed_at ? ` · accepted ${document.reviewed_at.slice(0, 10)}` : ""}
                      {document.superseded_by_id ? " · since replaced" : " · current"}
                    </li>
                  );
                })}
              {documentRows.filter((document) => document.review_status === "approved").length === 0 ? (
                <li className="text-sm text-[var(--ink-muted)] print:text-black">Nothing has been accepted yet.</li>
              ) : null}
            </ul>
          </section>

          {/*
            The honest footer. Alberta Transportation imposes no document-collection duty
            on a carrier that hires another carrier, and this pack will be read by people
            who would notice the overclaim. Saying plainly what it is costs nothing and
            makes the rest of the page more credible, not less.
          */}
          <footer className="mt-6 border-t border-[var(--border)] pt-4 text-xs text-[var(--ink-muted)] print:border-gray-300 print:text-gray-600">
            <p>
              Prepared by {tenantName} on {preparedOn} as its own record of due diligence on a hired carrier. It
              reflects what was on file at that moment and is not a certification of the carrier by any regulator.
              Alberta Transportation&apos;s requirements run to the holder of a Safety Fitness Certificate, and an
              independent carrier holds its own.
            </p>
          </footer>
        </article>
      </div>
    </main>
  );
}
