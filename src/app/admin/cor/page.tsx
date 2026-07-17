import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, BadgeCheck, Building2, ClipboardCheck, Eye, FileText, MessageSquare } from "lucide-react";
import { updateCorCertifyingPartner } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { crosswalkForPartnerElement, hasCrosswalk, type CorCrosswalkMethod } from "@/lib/cor-crosswalk";
import { CERTIFYING_PARTNERS, certifyingPartnerName, coerceCertifyingPartner, getCorFramework } from "@/lib/cor-frameworks";
import { loadCorAuditReadiness } from "./cor-readiness";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

const METHOD_LABEL: Record<CorCrosswalkMethod, string> = {
  documentation: "Doc",
  interview: "Interview",
  observation: "Observation",
};

function methodIcon(method: CorCrosswalkMethod) {
  if (method === "interview") {
    return MessageSquare;
  }
  if (method === "observation") {
    return Eye;
  }
  return FileText;
}

export default async function CorAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  // The COR module is gated by a tenant toggle. When off, the nav entry is hidden,
  // so send any direct hits to Setup where the toggle lives.
  if (!context.tenant?.cor_enabled) {
    redirect("/admin/setup");
  }

  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);
  const certifyingPartner = coerceCertifyingPartner(context.tenant?.cor_certifying_partner);
  const framework = getCorFramework(certifyingPartner);
  const showQuestions = hasCrosswalk(certifyingPartner);
  const readiness = await loadCorAuditReadiness(context.appUser.tenant_id, certifyingPartner);

  return (
    <AdminShell eyebrow="Compliance" tenantName={context.tenant?.name ?? "Company profile"} title="COR Audit">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">
                {certifyingPartnerName(certifyingPartner)} COR Health and Safety Management System
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
                Your evidence organized by the {framework.elements.length} {certifyingPartnerName(certifyingPartner)} audit
                elements. {framework.scoring} Turn this module off under{" "}
                <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/setup">
                  Setup
                </Link>{" "}
                if you use the app for purposes other than COR.
              </p>
            </div>
          </div>
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            href="/admin/cor/export"
          >
            <FileText className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Auditor package
          </Link>
        </div>
      </section>

      {notice ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-[var(--danger)]">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-[var(--ink)]">Certifying partner</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              COR is administered by several certifying partners, each with its own audit instrument. Choose yours so your
              evidence maps to the right audit. You are set up for{" "}
              <span className="font-semibold text-[var(--ink)]">{certifyingPartnerName(certifyingPartner)}</span>.
            </p>
            <form action={updateCorCertifyingPartner} className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Certifying partner</span>
                <select className={`${inputClass} w-72`} defaultValue={certifyingPartner} name="certifyingPartner">
                  {CERTIFYING_PARTNERS.map((partner) => (
                    <option disabled={!partner.supported} key={partner.code} value={partner.code}>
                      {partner.name}
                      {partner.supported ? "" : " (coming soon)"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                Save
              </button>
            </form>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              The elements below follow the numbering and names from your selected certifying partner.
              {showQuestions
                ? " Each element below lists its audit questions and the evidence that satisfies them."
                : ` The question-by-question crosswalk is being built for ${certifyingPartnerName(certifyingPartner)}; for now the auditor scores against that partner's own instrument.`}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">Audit readiness</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {readiness.documentedCount} of {readiness.total} elements have evidence on file.
            </p>
          </div>
          <span
            className={`text-3xl font-bold ${
              readiness.readinessPercent === 100 ? "text-[var(--success)]" : "text-[var(--ink)]"
            }`}
          >
            {readiness.readinessPercent}%
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
          <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${readiness.readinessPercent}%` }} />
        </div>
        {readiness.gaps.length > 0 ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--warning)]">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {readiness.gaps.length} element{readiness.gaps.length === 1 ? "" : "s"} still need evidence before the audit.
          </p>
        ) : (
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--success)]">
            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
            Every element has evidence on file.
          </p>
        )}
      </section>

      <div className="mt-5 grid gap-3">
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
            <section
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
              key={element.canonical}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-[var(--ink)]">{element.label}</h3>
                  {element.description ? (
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">{element.description}</p>
                  ) : null}
                </div>
                {element.documented ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--success)] bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-[var(--success)]">
                    <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                    Documented
                  </span>
                ) : (
                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--warning)] bg-amber-50 px-2.5 py-1 text-xs font-semibold text-[var(--warning)]">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    Gap
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--ink-muted)]">
                <span>
                  Records and documents:{" "}
                  <span className="font-semibold text-[var(--ink)]">{element.manualEvidenceCount}</span>
                </span>
                <span>
                  App-gathered: <span className="font-semibold text-[var(--ink)]">{element.autoEvidenceCount}</span>
                </span>
                {showQuestions ? (
                  <span>
                    Audit questions: <span className="font-semibold text-[var(--ink)]">{questions.length}</span>
                  </span>
                ) : null}
              </div>

              {trackedItems.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {trackedItems.map((item, index) => (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      key={`${item.kind}-${item.name}-${index}`}
                    >
                      <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                        {item.kind}
                      </span>
                      {item.name}
                      {item.kind === "Form" ? (
                        <span className={item.submitted ? "text-[var(--success)]" : "text-[var(--warning)]"}>
                          {item.submitted ? "submitted" : "no records yet"}
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-[var(--ink-muted)]">
                  Nothing tracked for this element yet. Tag a document or form to COR and it appears here.
                </p>
              )}

              {questions.length > 0 ? (
                <details className="mt-3 rounded-md border border-[var(--border)] bg-white">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--primary)]">
                    View the {questions.length} audit questions and their evidence
                  </summary>
                  <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                    {questions.map((question) => {
                      const Icon = methodIcon(question.method);

                      return (
                        <div className="grid gap-1 px-3 py-2 sm:grid-cols-[auto_1fr_auto] sm:items-start" key={question.id}>
                          <span className="text-xs font-semibold text-[var(--ink-muted)]">{question.id}</span>
                          <div>
                            <p className="text-sm text-[var(--ink)]">{question.question}</p>
                            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                              Evidence: {question.evidence} ({question.location})
                            </p>
                          </div>
                          <span className="inline-flex w-fit items-center gap-1 rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            {METHOD_LABEL[question.method]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ) : null}
            </section>
          );
        })}
      </div>
    </AdminShell>
  );
}
