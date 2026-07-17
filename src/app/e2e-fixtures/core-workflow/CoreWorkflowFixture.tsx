"use client";

import { useMemo, useState } from "react";
import { Camera, CheckCircle2, ClipboardList, FileText, Monitor, UploadCloud } from "lucide-react";

type WorkflowStep = "admin" | "worker" | "monitor" | "print";

type SubmittedRecord = {
  control: string;
  formCode: string;
  formName: string;
  observation: string;
  photoName: string;
  signature: string;
  status: "queued" | "synced";
  submittedAt: string;
};

type CoreWorkflowFixtureProps = {
  runId: string;
};

function normalizeOptions(value: string) {
  return value
    .split(/\r?\n/)
    .map((option) => option.trim())
    .filter(Boolean);
}

export function CoreWorkflowFixture({ runId }: CoreWorkflowFixtureProps) {
  const [step, setStep] = useState<WorkflowStep>("admin");
  const [managedListName, setManagedListName] = useState("Hazard Controls");
  const [managedListOptionsText, setManagedListOptionsText] = useState("Guardrail\nSpotter\nLockout");
  const [managedListOptions, setManagedListOptions] = useState<string[]>([]);
  const [formName, setFormName] = useState("Daily Field Report");
  const [formCode, setFormCode] = useState("DFR");
  const [formCreated, setFormCreated] = useState(false);
  const [control, setControl] = useState("Guardrail");
  const [observation, setObservation] = useState("North stair opening protected before shift.");
  const [signature, setSignature] = useState("Blake Cowan");
  const [photoName, setPhotoName] = useState("");
  const [workOffline, setWorkOffline] = useState(true);
  const [submittedRecord, setSubmittedRecord] = useState<SubmittedRecord | null>(null);
  const options = useMemo(() => (managedListOptions.length > 0 ? managedListOptions : normalizeOptions(managedListOptionsText)), [
    managedListOptions,
    managedListOptionsText,
  ]);

  function createManagedList() {
    const nextOptions = normalizeOptions(managedListOptionsText);
    setManagedListOptions(nextOptions);
    setControl(nextOptions[0] ?? "");
  }

  function createFormTemplate() {
    setFormCreated(true);
    setStep("worker");
  }

  function submitWorkerForm() {
    setSubmittedRecord({
      control,
      formCode,
      formName,
      observation,
      photoName: photoName || "No photo attached",
      signature,
      status: workOffline ? "queued" : "synced",
      submittedAt: new Date().toISOString(),
    });
  }

  function syncQueuedSubmission() {
    setSubmittedRecord((record) => (record ? { ...record, status: "synced" } : record));
  }

  const synced = submittedRecord?.status === "synced";

  return (
    <main className="min-h-screen bg-[var(--background)] p-4">
      <section className="mx-auto grid max-w-6xl gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-[var(--ink-muted)]">E2E Fixture</p>
            <h1 className="text-2xl font-bold text-[var(--ink)]">Core Workflow Fixture</h1>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Run {runId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["admin", "worker", "monitor", "print"] as WorkflowStep[]).map((item) => (
              <button
                className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold transition ${
                  step === item
                    ? "bg-[var(--primary)] text-white"
                    : "border border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                }`}
                key={item}
                onClick={() => setStep(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {step === "admin" ? (
          <section className="grid gap-5 lg:grid-cols-2">
            <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <ClipboardList className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink)]">Managed List</h2>
                  <p className="text-sm text-[var(--ink-muted)]">Control options used by the worker form.</p>
                </div>
              </div>
              <label className="mt-5 block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Managed list name</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                  onChange={(event) => setManagedListName(event.target.value)}
                  value={managedListName}
                />
              </label>
              <label className="mt-4 block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Managed list options</span>
                <textarea
                  className="min-h-28 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
                  onChange={(event) => setManagedListOptionsText(event.target.value)}
                  value={managedListOptionsText}
                />
              </label>
              <button
                className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
                onClick={createManagedList}
                type="button"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Create managed list
              </button>
              {managedListOptions.length > 0 ? (
                <p className="mt-3 text-sm font-semibold text-[var(--success)]">
                  Managed list ready: {managedListName} ({managedListOptions.length} options)
                </p>
              ) : null}
            </article>

            <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink)]">Form Template</h2>
                  <p className="text-sm text-[var(--ink-muted)]">Template assigned to the worker app.</p>
                </div>
              </div>
              <label className="mt-5 block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Form name</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                  onChange={(event) => setFormName(event.target.value)}
                  value={formName}
                />
              </label>
              <label className="mt-4 block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Form code</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase"
                  onChange={(event) => setFormCode(event.target.value.toUpperCase())}
                  value={formCode}
                />
              </label>
              <button
                className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={options.length === 0}
                onClick={createFormTemplate}
                type="button"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Create form template
              </button>
              {formCreated ? <p className="mt-3 text-sm font-semibold text-[var(--success)]">Form assigned to worker app.</p> : null}
            </article>
          </section>
        ) : null}

        {step === "worker" ? (
          <section aria-label="Worker Submission" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <UploadCloud className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Worker Submission</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  {formName} ({formCode})
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Selected control</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                  onChange={(event) => setControl(event.target.value)}
                  value={control}
                >
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Signature</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                  onChange={(event) => setSignature(event.target.value)}
                  value={signature}
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-[var(--ink)]">Observation</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
                  onChange={(event) => setObservation(event.target.value)}
                  value={observation}
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Photo evidence</span>
                <input
                  aria-label="Photo evidence"
                  className="block w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
                  onChange={(event) => setPhotoName(event.target.files?.[0]?.name ?? "")}
                  type="file"
                />
              </label>
              <label className="flex items-center gap-2 self-end text-sm font-medium text-[var(--ink)]">
                <input
                  checked={workOffline}
                  className="h-4 w-4 accent-[var(--primary)]"
                  onChange={(event) => setWorkOffline(event.target.checked)}
                  type="checkbox"
                />
                Work offline
              </label>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
                onClick={submitWorkerForm}
                type="button"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Submit form
              </button>
              {submittedRecord?.status === "queued" ? (
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                  onClick={syncQueuedSubmission}
                  type="button"
                >
                  Sync queued submission
                </button>
              ) : null}
              {synced ? (
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                  onClick={() => setStep("monitor")}
                  type="button"
                >
                  Open monitor
                </button>
              ) : null}
            </div>
            {submittedRecord ? (
              <p className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm font-semibold text-[var(--ink)]">
                {submittedRecord.status === "queued"
                  ? `${submittedRecord.formName} queued offline with signature and photo.`
                  : `${submittedRecord.formName} synced to monitor.`}
              </p>
            ) : null}
          </section>
        ) : null}

        {step === "monitor" ? (
          <section aria-label="Desktop Monitor" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <Monitor className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink)]">Desktop Monitor</h2>
                  <p className="text-sm text-[var(--ink-muted)]">Synced submission review.</p>
                </div>
              </div>
              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!synced}
                onClick={() => setStep("print")}
                type="button"
              >
                Open print preview
              </button>
            </div>
            {submittedRecord ? (
              <article className="mt-5 rounded-md border border-[var(--border)] bg-white p-4">
                <p className="text-sm font-semibold text-[var(--ink)]">
                  {submittedRecord.formName} ({submittedRecord.formCode})
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <p className="text-sm text-[var(--ink-muted)]">Control: {submittedRecord.control}</p>
                  <p className="text-sm text-[var(--ink-muted)]">Signature: {submittedRecord.signature}</p>
                  <p className="text-sm text-[var(--ink-muted)] md:col-span-2">Observation: {submittedRecord.observation}</p>
                  <p className="text-sm text-[var(--ink-muted)]">Photo: {submittedRecord.photoName}</p>
                  <p className="text-sm text-[var(--ink-muted)]">Status: {submittedRecord.status}</p>
                </div>
              </article>
            ) : (
              <p className="mt-5 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                No synced submission yet.
              </p>
            )}
          </section>
        ) : null}

        {step === "print" ? (
          <section aria-label="Monitor Print" className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
              <div>
                <p className="text-sm font-semibold uppercase text-[var(--ink-muted)]">Printable submission report</p>
                <h2 className="mt-1 text-xl font-bold text-[var(--ink)]">{submittedRecord?.formName ?? formName}</h2>
              </div>
              <Camera className="h-6 w-6 text-[var(--primary)]" aria-hidden="true" />
            </div>
            <dl className="mt-5 grid gap-4 md:grid-cols-2">
              {[
                ["Run", runId],
                ["Form code", submittedRecord?.formCode ?? formCode],
                ["Control", submittedRecord?.control ?? "Not submitted"],
                ["Observation", submittedRecord?.observation ?? "Not submitted"],
                ["Signature", submittedRecord?.signature ?? "Not submitted"],
                ["Photo", submittedRecord?.photoName ?? "Not submitted"],
              ].map(([label, value]) => (
                <div className="rounded-md border border-[var(--border)] p-3" key={label}>
                  <dt className="text-xs font-semibold uppercase text-[var(--ink-muted)]">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </section>
    </main>
  );
}
