"use client";

import { useActionState, useMemo, useState } from "react";
import { ScanLine, Trash2, Upload } from "lucide-react";
import {
  createFormFromReviewedFields,
  scanUploadedFormForReview,
  type FormImportActionState,
  type FormImportReviewField,
  type FormImportReviewState,
} from "@/app/admin/actions";
import { formFieldTypeOptions, type FormFieldType } from "@/lib/form-templates";

export type ImportAvailableList = {
  id: string;
  name: string;
};

const scanInitialState: FormImportReviewState = {
  message: "",
  status: "idle",
};

const saveInitialState: FormImportActionState = {
  message: "",
  status: "idle",
};

type EditableField = FormImportReviewField & { id: string };

function newRowId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function toEditableFields(fields: FormImportReviewField[]): EditableField[] {
  return fields.map((field, index) => ({ ...field, id: newRowId(`row-${index}`) }));
}

export function FormImportPanel({ availableLists = [] }: { availableLists?: ImportAvailableList[] }) {
  const [scanState, scanAction, scanning] = useActionState(scanUploadedFormForReview, scanInitialState);
  const scanReady = scanState.status === "ready";
  const reviewKey = scanReady
    ? `${scanState.sourceFileName ?? "manual"}-${scanState.detectedText.length}-${scanState.fields.length}`
    : "idle";

  return (
    <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <form action={scanAction}>
        {scanState.status === "error" ? (
          <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]" role="alert">
            {scanState.message}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
              <ScanLine className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Import Existing Form</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Upload a PDF, image, text, or CSV file to scan for fields. Review the detected fields before saving.
              </p>
            </div>
          </div>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={scanning}
            type="submit"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {scanning ? "Scanning" : scanReady ? "Re-scan" : "Scan Form"}
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_180px]">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Upload form</span>
            <input
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv"
              className="block h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              name="formFile"
              type="file"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Form name</span>
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              name="name"
              placeholder="Imported field report"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Form code</span>
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              maxLength={32}
              name="code"
              placeholder="Auto"
            />
          </label>
        </div>

        <label className="mt-4 block space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Detected text</span>
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            name="detectedText"
            placeholder={"Inspection date\nWorker name\nPass / Fail\nNotes"}
          />
        </label>
      </form>

      {scanReady ? (
        <ReviewPanel
          availableLists={availableLists}
          key={reviewKey}
          scanState={scanState as Extract<FormImportReviewState, { status: "ready" }>}
        />
      ) : null}
    </section>
  );
}

type ReviewPanelProps = {
  availableLists: ImportAvailableList[];
  scanState: Extract<FormImportReviewState, { status: "ready" }>;
};

function ReviewPanel({ availableLists, scanState }: ReviewPanelProps) {
  const [saveState, saveAction, saving] = useActionState(createFormFromReviewedFields, saveInitialState);
  const [editableFields, setEditableFields] = useState<EditableField[]>(() => toEditableFields(scanState.fields));
  const [formName, setFormName] = useState(scanState.name);
  const [formCode, setFormCode] = useState(scanState.code);

  const fieldsPayload = useMemo(
    () =>
      JSON.stringify(
        editableFields.map((field) => ({
          fieldType: field.fieldType,
          label: field.label,
          listId: field.listId,
          options: field.options,
          placeholder: field.placeholder,
          required: field.required,
        })),
      ),
    [editableFields],
  );

  function updateField(id: string, patch: Partial<FormImportReviewField>) {
    setEditableFields((previous) => previous.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  }

  function removeField(id: string) {
    setEditableFields((previous) => previous.filter((field) => field.id !== id));
  }

  return (
    <form action={saveAction} className="mt-6 border-t border-[var(--border)] pt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--ink)]">Review detected fields</h3>
          <p className="text-sm text-[var(--ink-muted)]">{scanState.message}</p>
          {scanState.sourceFileName ? (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Source file: {scanState.sourceFileName}</p>
          ) : null}
        </div>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={saving || editableFields.length === 0}
          type="submit"
        >
          {saving ? "Saving" : "Save form"}
        </button>
      </div>

      {saveState.status === "error" ? (
        <p className="mt-3 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]" role="alert">
          {saveState.message}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_180px]">
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Form name</span>
          <input
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            name="name"
            onChange={(event) => setFormName(event.target.value)}
            required
            value={formName}
          />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Form code</span>
          <input
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm uppercase text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            maxLength={32}
            name="code"
            onChange={(event) => setFormCode(event.target.value)}
            value={formCode}
          />
        </label>
      </div>

      <input name="detectedText" type="hidden" value={scanState.detectedText} />
      <input name="providerLabel" type="hidden" value={scanState.providerLabel} />
      <input name="sourceFileName" type="hidden" value={scanState.sourceFileName ?? ""} />
      <input name="fields" type="hidden" value={fieldsPayload} />

      <div className="mt-5 overflow-hidden rounded-md border border-[var(--border)]">
        <div className="grid grid-cols-[1fr_220px_120px_44px] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold uppercase text-[var(--ink-muted)] max-md:hidden">
          <span>Label</span>
          <span>Field type</span>
          <span>Required</span>
          <span className="sr-only">Remove</span>
        </div>

        {editableFields.length === 0 ? (
          <p className="px-3 py-4 text-sm text-[var(--ink-muted)]">
            All detected fields were removed. Re-scan or paste detected text to start over.
          </p>
        ) : (
          <ul>
            {editableFields.map((field) => {
              const isDropdown =
                field.fieldType === "dropdown_select_one" || field.fieldType === "dropdown_select_multiple";
              const isDateLike = field.fieldType === "date" || field.fieldType === "time";

              return (
                <li
                  className="grid items-start gap-3 border-b border-[var(--border)] px-3 py-3 last:border-b-0 md:grid-cols-[1fr_220px_120px_44px]"
                  key={field.id}
                >
                  <div className="space-y-2">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium uppercase text-[var(--ink-muted)] md:hidden">Label</span>
                      <input
                        aria-label="Field label"
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateField(field.id, { label: event.target.value })}
                        required
                        value={field.label}
                      />
                    </label>
                    {isDropdown ? (
                      <label className="block space-y-1">
                        <span className="text-xs font-medium uppercase text-[var(--ink-muted)]">Options source</span>
                        <select
                          aria-label="Options source"
                          className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          onChange={(event) =>
                            updateField(field.id, {
                              listId: event.target.value || null,
                            })
                          }
                          value={field.listId ?? ""}
                        >
                          <option value="">Manual options{field.options.length > 0 ? ` (${field.options.length} detected)` : ""}</option>
                          {availableLists.map((list) => (
                            <option key={list.id} value={list.id}>
                              {list.name}
                            </option>
                          ))}
                        </select>
                        {availableLists.length === 0 ? (
                          <span className="block text-xs text-[var(--ink-muted)]">
                            No managed lists yet. Add one in Managed Lists, then re-open this scanner.
                          </span>
                        ) : null}
                      </label>
                    ) : null}
                    {isDateLike ? (
                      <div className="space-y-1">
                        <span className="text-xs font-medium uppercase text-[var(--ink-muted)]">
                          {field.fieldType === "date" ? "Date picker preview" : "Time picker preview"}
                        </span>
                        <input
                          aria-label={field.fieldType === "date" ? "Date picker preview" : "Time picker preview"}
                          className="h-9 w-full cursor-pointer rounded-md border border-[var(--border)] bg-white px-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          title={field.fieldType === "date" ? "Click to confirm the calendar opens for workers" : "Click to confirm the time picker opens for workers"}
                          type={field.fieldType}
                        />
                        <span className="block text-xs text-[var(--ink-muted)]">
                          Sample only. Workers see the OS native picker; values entered here are not saved.
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase text-[var(--ink-muted)] md:hidden">Field type</span>
                    <select
                      aria-label="Field type"
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      onChange={(event) => {
                        const nextType = event.target.value as FormFieldType;
                        const stillDropdown =
                          nextType === "dropdown_select_one" || nextType === "dropdown_select_multiple";
                        updateField(field.id, {
                          fieldType: nextType,
                          listId: stillDropdown ? field.listId : null,
                        });
                      }}
                      value={field.fieldType}
                    >
                      {formFieldTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <input
                      checked={field.required}
                      className="h-4 w-4 accent-[var(--primary)]"
                      onChange={(event) => updateField(field.id, { required: event.target.checked })}
                      type="checkbox"
                    />
                    Required
                  </label>
                  <button
                    aria-label={`Remove ${field.label || "field"}`}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] text-[var(--ink-muted)] transition hover:border-[var(--danger)] hover:text-[var(--danger)] focus:outline-none focus:ring-2 focus:ring-[var(--danger)] focus:ring-offset-2"
                    onClick={() => removeField(field.id)}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </form>
  );
}
