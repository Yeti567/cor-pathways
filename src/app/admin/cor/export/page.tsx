import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { crosswalkForPartnerElement, hasCrosswalk, type CorCrosswalkMethod } from "@/lib/cor-crosswalk";
import { certifyingPartnerName, coerceCertifyingPartner, getCorFramework } from "@/lib/cor-frameworks";
import { CorPrintButton } from "../CorPrintButton";
import { loadCorAuditReadiness } from "../cor-readiness";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<CorCrosswalkMethod, string> = {
  documentation: "Documentation",
  interview: "Interview",
  observation: "Observation",
};

export default async function CorAuditExportPage() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.cor_enabled) {
    redirect("/admin/setup");
  }

  const certifyingPartner = coerceCertifyingPartner(context.tenant?.cor_certifying_partner);
  const framework = getCorFramework(certifyingPartner);
  const showQuestions = hasCrosswalk(certifyingPartner);
  const readiness = await loadCorAuditReadiness(context.appUser.tenant_id, certifyingPartner);
  const tenantName = context.tenant?.name ?? "Company";

  return (
    <AdminShell eyebrow="Compliance" tenantName={tenantName} title="Auditor Package">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
          href="/admin/cor"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          COR Audit
        </Link>
        <CorPrintButton />
      </div>

      <article className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="border-b border-[var(--border)] pb-4">
          <h1 className="text-2xl font-bold text-[var(--ink)]">COR Audit Package</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {tenantName} · {certifyingPartnerName(certifyingPartner)}
          </p>
          <p className="mt-3 max-w-3xl text-sm text-[var(--ink-muted)]">
            {showQuestions
              ? `This package maps each ${certifyingPartnerName(certifyingPartner)} COR audit question to the document that provides the evidence and where it lives. `
              : `This package organizes your evidence by the ${certifyingPartnerName(certifyingPartner)} audit elements. The auditor scores against ${certifyingPartnerName(certifyingPartner)}'s own instrument. `}
            {framework.scoring} Evidence is verified by documentation, interview, or observation.
          </p>
          <p className="mt-3 text-sm font-semibold text-[var(--ink)]">
            Readiness: {readiness.documentedCount} of {readiness.total} elements have evidence on file (
            {readiness.readinessPercent}%).
          </p>
        </header>

        {readiness.elements.map((element) => {
          const questions = showQuestions ? crosswalkForPartnerElement(certifyingPartner, element.number) : [];
          const tracked = {
            documents: element.covers.flatMap((key) => readiness.trackedByCanonical[key]?.documents ?? []),
            forms: element.covers.flatMap((key) => readiness.trackedByCanonical[key]?.forms ?? []),
          };
          const trackedItems = [
            ...tracked.documents.map((item) => ({ ...item, kind: "Document" as const })),
            ...tracked.forms.map((item) => ({ ...item, kind: "Form" as const })),
          ];

          return (
            <section className="mt-6 break-inside-avoid" key={element.canonical}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[var(--ink)]">{element.label}</h2>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    element.documented
                      ? "border border-[var(--success)] bg-emerald-50 text-[var(--success)]"
                      : "border border-[var(--warning)] bg-amber-50 text-[var(--warning)]"
                  }`}
                >
                  {element.documented ? <BadgeCheck className="h-4 w-4" aria-hidden="true" /> : null}
                  {element.documented ? "Documented" : "Gap"}
                </span>
              </div>

              {showQuestions ? (
                <table className="mt-2 w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs uppercase text-[var(--ink-muted)]">
                      <th className="py-1 pr-2 font-semibold">Q</th>
                      <th className="py-1 pr-2 font-semibold">Question</th>
                      <th className="py-1 pr-2 font-semibold">Method</th>
                      <th className="py-1 font-semibold">Evidence and location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((question) => (
                      <tr className="border-b border-[var(--border)] align-top" key={question.id}>
                        <td className="py-1.5 pr-2 font-semibold text-[var(--ink-muted)]">{question.id}</td>
                        <td className="py-1.5 pr-2 text-[var(--ink)]">{question.question}</td>
                        <td className="py-1.5 pr-2 text-[var(--ink-muted)]">{METHOD_LABEL[question.method]}</td>
                        <td className="py-1.5 text-[var(--ink-muted)]">
                          {question.evidence} <span className="text-[var(--ink-muted)]">({question.location})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : trackedItems.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--ink-muted)]">
                  {trackedItems.map((item, index) => (
                    <li key={`${item.kind}-${item.name}-${index}`}>
                      <span className="font-semibold text-[var(--ink)]">{item.name}</span> ({item.kind}
                      {item.kind === "Form" ? (item.submitted ? ", submitted" : ", no records yet") : ""})
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--ink-muted)]">No evidence tracked for this element yet.</p>
              )}
            </section>
          );
        })}

        <footer className="mt-8 border-t border-[var(--border)] pt-4 text-xs text-[var(--ink-muted)]">
          Generated from the COR audit evidence. Evidence locations: Policies and the Safety Manual live in the Resource
          Library; Forms are the submitted records; App means the evidence is gathered automatically by a module
          (Incidents, Equipment, Certifications, Visitor Log, Analytics).
        </footer>
      </article>
    </AdminShell>
  );
}
