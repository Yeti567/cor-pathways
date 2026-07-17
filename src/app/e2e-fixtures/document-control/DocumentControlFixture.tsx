"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, FileCheck2, FileClock, ToggleLeft, ToggleRight, Upload } from "lucide-react";
import {
  buildDocumentControlNumberSettings,
  createDocumentControlNumber,
  documentTypeOptions,
  formatDocumentType,
} from "@/lib/document-control";

type ApprovalStatus = "approved" | "pending";

type ControlledDocument = {
  active: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  approvalStatus: ApprovalStatus;
  dcn: string;
  documentType: string;
  fileName: string;
  id: string;
  name: string;
  revisionNotes: string | null;
  revisionOfId: string | null;
  updatedAt: string;
  version: string;
};

const reviewerName = "Jordan Admin";
const settings = buildDocumentControlNumberSettings({
  dcnCompanyPrefix: "ACME",
  dcnIncludeRevision: false,
  dcnIncludeSourceCode: true,
  dcnSequencePadding: 4,
});

function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function statusClass(status: ApprovalStatus) {
  return status === "approved"
    ? "border-[var(--success)] bg-emerald-50 text-[var(--success)]"
    : "border-[var(--warning)] bg-amber-50 text-[var(--warning)]";
}

function statusLabel(status: ApprovalStatus) {
  return status === "approved" ? "Approved" : "Pending approval";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function compareVersionDesc(left: ControlledDocument, right: ControlledDocument) {
  return Number.parseFloat(right.version) - Number.parseFloat(left.version);
}

export function DocumentControlFixture() {
  const [enabled, setEnabled] = useState(false);
  const [documents, setDocuments] = useState<ControlledDocument[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const activeDocuments = documents.filter((document) => document.active);
  const pendingCount = documents.filter((document) => document.approvalStatus === "pending").length;
  const historyByDcn = useMemo(() => {
    const history = new Map<string, ControlledDocument[]>();

    for (const document of documents) {
      history.set(document.dcn, [...(history.get(document.dcn) ?? []), document].sort(compareVersionDesc));
    }

    return history;
  }, [documents]);

  function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = stringValue(formData, "name");
    const documentType = stringValue(formData, "documentType") || "procedure";
    const version = stringValue(formData, "version") || "1.0";
    const sourceCode = stringValue(formData, "sourceCode") || "DOC";
    const revisionOfId = stringValue(formData, "revisionOfId") || null;
    const revisionNotes = stringValue(formData, "revisionNotes") || null;
    const file = formData.get("file");
    const fileName = file instanceof File ? file.name : "";
    const revisionBase = revisionOfId ? documents.find((document) => document.id === revisionOfId) : null;

    if (!name || !fileName) {
      setNotice("Document name and file are required.");
      return;
    }

    const dcn =
      revisionBase?.dcn ??
      createDocumentControlNumber({
        companyPrefix: settings.companyPrefix,
        documentType,
        includeRevision: settings.includeRevision,
        includeSourceCode: settings.includeSourceCode,
        sequence: documents.filter((document) => !document.revisionOfId).length + 1,
        sequencePadding: settings.sequencePadding,
        sourceCode,
      });
    const uploadedAt = "2026-05-25T16:00:00.000Z";
    const document: ControlledDocument = {
      active: true,
      approvedAt: null,
      approvedBy: null,
      approvalStatus: "pending",
      dcn,
      documentType,
      fileName,
      id: `${dcn}-${version}-${documents.length + 1}`,
      name,
      revisionNotes,
      revisionOfId,
      updatedAt: uploadedAt,
      version,
    };

    setDocuments((current) => [
      ...current.map((existing) => (existing.dcn === dcn ? { ...existing, active: false } : existing)),
      document,
    ]);
    setNotice(`Uploaded ${name} as ${dcn} v${version}.`);
    form.reset();
  }

  function approveDocument(documentId: string) {
    setDocuments((current) =>
      current.map((document) =>
        document.id === documentId
          ? {
              ...document,
              approvedAt: "2026-05-25T17:00:00.000Z",
              approvedBy: reviewerName,
              approvalStatus: "approved",
              updatedAt: "2026-05-25T17:00:00.000Z",
            }
          : document,
      ),
    );
    setNotice("Controlled document approved.");
  }

  return (
    <main className="min-h-screen bg-[var(--background)] p-4">
      <section className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-[var(--ink-muted)]">E2E Fixture</p>
            <h1 className="text-2xl font-bold text-[var(--ink)]">Document Control</h1>
          </div>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
            onClick={() => {
              setEnabled(true);
              setNotice("Document control enabled.");
            }}
            type="button"
          >
            <ToggleRight className="h-4 w-4" aria-hidden="true" />
            Enable Document Control
          </button>
        </div>

        {notice ? (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-[var(--success)]">
            {notice}
          </p>
        ) : null}

        <div className="mt-5 grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <p className="text-sm text-[var(--ink-muted)]">Document control</p>
            <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-[var(--ink)]">
              {enabled ? (
                <ToggleRight className="h-5 w-5 text-[var(--success)]" aria-hidden="true" />
              ) : (
                <ToggleLeft className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
              )}
              {enabled ? "Enabled" : "Disabled"}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <p className="text-sm text-[var(--ink-muted)]">Resources</p>
            <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{documents.length}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <p className="text-sm text-[var(--ink-muted)]">Active register</p>
            <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{activeDocuments.length}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <p className="text-sm text-[var(--ink-muted)]">Pending approval</p>
            <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{pendingCount}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <form
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
            onSubmit={uploadDocument}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <Upload className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Upload Controlled Document</h2>
                <p className="text-sm text-[var(--ink-muted)]">PDFs and images become registered source documents.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[1fr_170px_130px]">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Document name</span>
                <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" name="name" required />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Type</span>
                <select className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" defaultValue="procedure" name="documentType">
                  {documentTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Version</span>
                <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" defaultValue="1.0" name="version" />
              </label>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_170px]">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Revision of</span>
                <select className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm" name="revisionOfId">
                  <option value="">New controlled document</option>
                  {activeDocuments.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.dcn} v{document.version} - {formatDocumentType(document.documentType)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Source code</span>
                <input className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase" name="sourceCode" placeholder="WAP" />
              </label>
            </div>

            <label className="mt-4 block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">File</span>
              <input
                accept=".pdf,image/png,image/jpeg,image/webp"
                className="block h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-1 file:text-sm file:font-semibold"
                name="file"
                required
                type="file"
              />
            </label>

            <label className="mt-4 block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Revision notes</span>
              <textarea className="min-h-20 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm" name="revisionNotes" />
            </label>

            <button
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
              disabled={!enabled}
              type="submit"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Upload
            </button>
          </form>

          <section
            aria-labelledby="resource-library-heading"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
              <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]" id="resource-library-heading">
                Resource Library
              </h2>
              <FileClock className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            </div>
            {documents.length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {documents.map((document) => (
                  <div className="px-4 py-3" key={document.id}>
                    <p className="font-semibold text-[var(--ink)]">{document.name}</p>
                    <p className="text-sm text-[var(--ink-muted)]">
                      {document.dcn} v{document.version}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[var(--ink-muted)]">{document.fileName}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">No resources yet.</p>
            )}
          </section>
        </div>

        <section aria-labelledby="register-heading" className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
            <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]" id="register-heading">
              Register
            </h2>
            <FileCheck2 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          </div>
          {activeDocuments.length > 0 ? (
            <div className="divide-y divide-[var(--border)]">
              {activeDocuments.map((document) => {
                const history = historyByDcn.get(document.dcn) ?? [document];

                return (
                  <article aria-label={`${document.name} ${document.version}`} className="px-4 py-3" key={document.id}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold text-[var(--ink)]">{document.name}</p>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">
                          {document.dcn} v{document.version} - {formatDocumentType(document.documentType)}
                        </p>
                      </div>
                      <span className={`w-fit rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(document.approvalStatus)}`}>
                        {statusLabel(document.approvalStatus)}
                      </span>
                    </div>
                    {document.revisionNotes ? <p className="mt-2 text-sm text-[var(--ink-muted)]">{document.revisionNotes}</p> : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold text-[var(--ink-muted)]">{formatDate(document.updatedAt)}</p>
                      {document.approvedBy && document.approvedAt ? (
                        <p className="text-xs font-semibold text-[var(--ink-muted)]">
                          Reviewed by {document.approvedBy} on {formatDate(document.approvedAt)}
                        </p>
                      ) : null}
                      {document.approvalStatus !== "approved" ? (
                        <button
                          className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                          onClick={() => approveDocument(document.id)}
                          type="button"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" aria-hidden="true" />
                          Approve {document.name}
                        </button>
                      ) : null}
                    </div>
                    {history.length > 1 ? (
                      <details className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase text-[var(--ink-muted)]">
                          Revision history
                        </summary>
                        <div className="divide-y divide-[var(--border)] border-t border-[var(--border)] bg-white">
                          {history.map((revision) => (
                            <div className="px-3 py-2" key={revision.id}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-[var(--ink)]">v{revision.version}</p>
                                <span className={`w-fit rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(revision.approvalStatus)}`}>
                                  {statusLabel(revision.approvalStatus)}
                                </span>
                              </div>
                              {revision.revisionNotes ? (
                                <p className="mt-1 text-xs text-[var(--ink-muted)]">{revision.revisionNotes}</p>
                              ) : null}
                              <p className="mt-1 text-xs font-semibold text-[var(--ink-muted)]">
                                {formatDate(revision.updatedAt)}
                                {revision.approvedBy && revision.approvedAt
                                  ? `, reviewed by ${revision.approvedBy} on ${formatDate(revision.approvedAt)}`
                                  : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">No controlled documents yet.</p>
          )}
        </section>
      </section>
    </main>
  );
}
