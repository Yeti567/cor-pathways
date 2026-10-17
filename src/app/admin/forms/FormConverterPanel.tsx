"use client";

// The AI Form Converter screen. Three steps, in plain words, for people who know nothing about
// the app: give us the form (file, photo, or a description), check what we built and ask for
// changes in your own words, then save it as a hidden draft.
//
// Files go from the browser straight to storage (a Server Action body is capped at 1 MB), are
// read by /api/form-converter, and are deleted there once read. Nothing is saved until the
// person presses Save, and what is saved is checked again on the server.

import {
  ArrowDown,
  ArrowUp,
  Camera,
  CircleAlert,
  FileUp,
  Loader2,
  Plus,
  Redo2,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { createFormFromConvertedDraft } from "@/app/admin/actions";
import {
  buildConverterStoragePath,
  CONVERTER_FIELD_TYPE_LABELS,
  CONVERTER_FIELD_TYPES,
  CONVERTER_MAX_FILE_BYTES,
  CONVERTER_MAX_FILES,
  countConvertedFields,
  type ConvertedField,
  type ConvertedForm,
  type ConverterFieldType,
  type UploadedConverterFile,
} from "@/lib/form-converter-shared";
import { answerChoicesForField } from "@/lib/form-logic";
import { equipmentAttachmentBucket } from "@/lib/equipment";
import { shrinkPhotoFile } from "@/lib/offline/shrink-photo";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const HISTORY_LIMIT = 20;

const IDEAS = [
  { label: "Pre-trip inspection", text: "A tractor-trailer pre-trip inspection: date, driver, unit, odometer, pass/fail checks for brakes, lights, tires, coupling, load securement and emergency equipment. If anything fails, ask for a note and a photo. Driver signature." },
  { label: "Toolbox talk", text: "A toolbox talk sign-in: date, location, topic, who led it, notes on what was discussed, and a list of attendees who each sign." },
  { label: "Incident report", text: "An incident report: date and time, location, who was involved, what happened, injuries yes/no (if yes, describe them), property damage yes/no, photos, immediate actions taken, supervisor signature." },
  { label: "Site hazard assessment", text: "A field-level hazard assessment before starting work: job, location, crew, a list of common hazards to tick, controls for each hazard found, PPE checklist, and everyone signs." },
  { label: "Spot check", text: "A supervisor spot check of a driver: date, driver, unit, yes/no observations for PPE, pre-trip done, paperwork in truck, safe driving. If No, explain. Supervisor signature." },
];

const CHANGE_EXAMPLES = [
  "If any check fails, ask for a note and a photo",
  "Make every question required",
  "Split this into sections",
  "Add a supervisor signature at the end",
];

const EXTENSION_TYPES: Record<string, string> = {
  csv: "text/csv",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function fileType(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "";
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const buttonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

function nextRef(form: ConvertedForm) {
  const used = new Set(form.sections.flatMap((section) => section.fields.map((field) => field.ref)));
  let index = used.size + 1;

  while (used.has(`f${index}`)) {
    index += 1;
  }

  return `f${index}`;
}

function cloneForm(form: ConvertedForm): ConvertedForm {
  return JSON.parse(JSON.stringify(form)) as ConvertedForm;
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || "Something went wrong. Try again.";
}

export function FormConverterPanel({ tenantId }: { tenantId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [history, setHistory] = useState<ConvertedForm[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [instruction, setInstruction] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const draft = cursor >= 0 ? history[cursor] : null;

  function addFiles(list: FileList | null) {
    if (!list) {
      return;
    }

    const incoming = Array.from(list);
    const unreadable = incoming.filter((file) => !fileType(file));
    setError(unreadable.length > 0 ? `${unreadable.map((file) => file.name).join(", ")}: use a PDF, photo, Excel sheet or text file. Save a Word file as PDF first.` : "");
    setFiles((current) => [...current, ...incoming.filter((file) => fileType(file))].slice(0, CONVERTER_MAX_FILES));
  }

  /** A version from the reader, or a change worth undoing on its own. */
  function pushVersion(form: ConvertedForm) {
    const next = [...history.slice(0, cursor + 1), form].slice(-HISTORY_LIMIT);
    setHistory(next);
    setCursor(next.length - 1);
  }

  /** Typing in a box: changes the current version rather than stacking one per keystroke. */
  function replaceVersion(form: ConvertedForm) {
    setHistory((current) => current.map((version, index) => (index === cursor ? form : version)));
  }

  function edit(mutate: (form: ConvertedForm) => void, options: { undoable: boolean }) {
    if (!draft) {
      return;
    }

    const next = cloneForm(draft);
    mutate(next);

    if (options.undoable) {
      pushVersion(next);
    } else {
      replaceVersion(next);
    }
  }

  async function uploadFiles(): Promise<{ batchId: string; uploaded: UploadedConverterFile[] }> {
    const batchId = crypto.randomUUID();
    const supabase = createSupabaseBrowserClient();
    const uploaded: UploadedConverterFile[] = [];

    for (const [index, original] of files.entries()) {
      const type = fileType(original);
      // A phone photo over the limit is shrunk; a PDF over it has to be split by the person.
      const file = original.size > CONVERTER_MAX_FILE_BYTES && type.startsWith("image/") ? await shrinkPhotoFile(original) : original;

      if (file.size > CONVERTER_MAX_FILE_BYTES) {
        throw new Error(`${original.name} is larger than 10 MB. Split it or scan it at a lower quality.`);
      }

      const path = buildConverterStoragePath({ batchId, fileName: original.name, index, tenantId });
      const { error: uploadError } = await supabase.storage
        .from(equipmentAttachmentBucket)
        .upload(path, file, { contentType: file.type || type, upsert: false });

      if (uploadError) {
        throw new Error(`${original.name} could not be uploaded: ${uploadError.message}`);
      }

      uploaded.push({ name: original.name, path, size: file.size, type: file.type || type });
    }

    return { batchId, uploaded };
  }

  async function callConverter(body: Record<string, unknown>) {
    const response = await fetch("/api/form-converter", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const result = (await response.json()) as { form?: ConvertedForm };

    if (!result.form) {
      throw new Error("No form came back. Try again.");
    }

    return result.form;
  }

  async function build() {
    if (files.length === 0 && !description.trim()) {
      setError("Add your form, take a photo of it, or describe it first.");
      return;
    }

    setError("");

    try {
      let upload: { batchId: string; uploaded: UploadedConverterFile[] } | null = null;

      if (files.length > 0) {
        setBusy(`Uploading ${files.length === 1 ? "your file" : `${files.length} files`}...`);
        upload = await uploadFiles();
      }

      setBusy(files.length > 0 ? "Reading your form. A long form takes a minute or two..." : "Building your form...");
      const form = await callConverter({
        batchId: upload?.batchId,
        description,
        files: upload?.uploaded ?? [],
      });
      setHistory([form]);
      setCursor(0);
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "The form could not be built. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function askForChange(request: string) {
    if (!draft || !request.trim()) {
      return;
    }

    setError("");
    setBusy("Making that change...");

    try {
      const form = await callConverter({ draft, instruction: request });
      pushVersion(form);
      setInstruction("");
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "That change could not be made. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!draft) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const sourceLabel = files.length > 0 ? files.map((file) => file.name).join(", ") : "a description";
      // Redirects to the builder on success; only an error comes back.
      const result = await createFormFromConvertedDraft({ form: draft, sourceLabel });

      if (result?.status === "error") {
        setError(result.message);
      }
    } catch (saveError) {
      // A redirect surfaces as a thrown navigation; anything else is a real failure.
      if (saveError instanceof Error && saveError.message.includes("NEXT_REDIRECT")) {
        throw saveError;
      }

      setError(saveError instanceof Error ? saveError.message : "The form was not saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function startOver() {
    setHistory([]);
    setCursor(-1);
    setInstruction("");
    setError("");
  }

  return (
    <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Turn a paper form into an app form</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            Upload the form you already use, take a photo of it, or describe it. We build it, you check it, then save.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-4 flex items-start gap-2 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]" role="alert">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {busy ? (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink)]" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {busy}
        </p>
      ) : null}

      {!draft ? (
        <div className="mt-5 grid gap-5">
          <div>
            <p className="text-sm font-semibold text-[var(--ink)]">1. Your form</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={buttonClass} disabled={Boolean(busy)} onClick={() => fileInput.current?.click()} type="button">
                <FileUp className="h-4 w-4" aria-hidden="true" />
                Choose files
              </button>
              <button className={buttonClass} disabled={Boolean(busy)} onClick={() => cameraInput.current?.click()} type="button">
                <Camera className="h-4 w-4" aria-hidden="true" />
                Take a photo
              </button>
              <input
                accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.csv,.txt"
                className="sr-only"
                multiple
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
                ref={fileInput}
                tabIndex={-1}
                type="file"
              />
              <input
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
                ref={cameraInput}
                tabIndex={-1}
                type="file"
              />
            </div>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              PDF, photos, Excel or text. Up to {CONVERTER_MAX_FILES} files or 20 pages, 10 MB each. Several photos of one form: add them in page order.
            </p>
            {files.length > 0 ? (
              <ul className="mt-3 grid gap-2">
                {files.map((file, index) => (
                  <li className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm" key={`${file.name}-${index}`}>
                    <span className="min-w-0 truncate text-[var(--ink)]">
                      Page {index + 1}: {file.name}
                    </span>
                    <button
                      aria-label={`Remove ${file.name}`}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] hover:text-[var(--danger)]"
                      onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}
                      type="button"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-[var(--ink)]">2. Or describe it (optional with a file)</span>
            <textarea
              className="mt-2 min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A daily yard inspection: date, inspector, 12 pass/fail checks, a photo of any defect, and a signature."
              value={description}
            />
          </label>
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Ideas to start from</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {IDEAS.map((idea) => (
                <button className={`${buttonClass} min-h-9 font-medium`} key={idea.label} onClick={() => setDescription(idea.text)} type="button">
                  {idea.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[var(--ink-muted)]">
              Upload blank forms. The pages are read by an AI service, then deleted from our storage straight away.
            </p>
            <button className={primaryClass} disabled={Boolean(busy)} onClick={() => void build()} type="button">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Build my form
            </button>
          </div>
        </div>
      ) : (
        <DraftReview
          busy={Boolean(busy)}
          canRedo={cursor < history.length - 1}
          canUndo={cursor > 0}
          draft={draft}
          edit={edit}
          instruction={instruction}
          onAsk={(request) => void askForChange(request)}
          onInstruction={setInstruction}
          onRedo={() => setCursor((current) => Math.min(current + 1, history.length - 1))}
          onSave={() => void save()}
          onStartOver={startOver}
          onUndo={() => setCursor((current) => Math.max(current - 1, 0))}
          saving={saving}
        />
      )}
    </section>
  );
}

type EditFn = (mutate: (form: ConvertedForm) => void, options: { undoable: boolean }) => void;

function DraftReview({
  busy,
  canRedo,
  canUndo,
  draft,
  edit,
  instruction,
  onAsk,
  onInstruction,
  onRedo,
  onSave,
  onStartOver,
  onUndo,
  saving,
}: {
  busy: boolean;
  canRedo: boolean;
  canUndo: boolean;
  draft: ConvertedForm;
  edit: EditFn;
  instruction: string;
  onAsk: (request: string) => void;
  onInstruction: (value: string) => void;
  onRedo: () => void;
  onSave: () => void;
  onStartOver: () => void;
  onUndo: () => void;
  saving: boolean;
}) {
  const fieldCount = countConvertedFields(draft);
  const ruleCount = draft.sections.reduce((count, section) => count + section.fields.filter((field) => field.showWhen).length, 0);
  const allFields = draft.sections.flatMap((section) => section.fields);

  return (
    <div className="mt-5 grid gap-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block">
          <span className="text-sm font-semibold text-[var(--ink)]">Form name</span>
          <input
            className={`${inputClass} mt-2`}
            onChange={(event) => edit((form) => void (form.name = event.target.value), { undoable: false })}
            value={draft.name}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button aria-label="Undo" className={buttonClass} disabled={!canUndo || busy} onClick={onUndo} title="Undo" type="button">
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            <span className="max-sm:sr-only">Undo</span>
          </button>
          <button aria-label="Redo" className={buttonClass} disabled={!canRedo || busy} onClick={onRedo} title="Redo" type="button">
            <Redo2 className="h-4 w-4" aria-hidden="true" />
            <span className="max-sm:sr-only">Redo</span>
          </button>
          <button className={buttonClass} disabled={busy} onClick={onStartOver} type="button">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Start over
          </button>
        </div>
      </div>

      <p className="text-sm text-[var(--ink-muted)]">
        We built {draft.sections.length} section{draft.sections.length === 1 ? "" : "s"} and {fieldCount} question{fieldCount === 1 ? "" : "s"}
        {ruleCount > 0 ? `, ${ruleCount} of them shown only after a certain answer` : ""}. Check them below.
      </p>

      {draft.notes.length > 0 ? (
        <div className="rounded-md border border-[var(--warning)] bg-amber-50 p-3">
          <p className="text-sm font-semibold text-[var(--ink)]">Please check</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[var(--ink)]">
            {draft.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        <label className="block">
          <span className="text-sm font-semibold text-[var(--ink)]">Want something changed? Say it in your own words.</span>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              className={inputClass}
              onChange={(event) => onInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onAsk(instruction);
                }
              }}
              placeholder="Add a question asking for the trailer's last CVIP date"
              value={instruction}
            />
            <button className={primaryClass} disabled={busy || !instruction.trim()} onClick={() => onAsk(instruction)} type="button">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Change it
            </button>
          </div>
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {CHANGE_EXAMPLES.map((example) => (
            <button className={`${buttonClass} min-h-8 text-xs font-medium`} disabled={busy} key={example} onClick={() => onAsk(example)} type="button">
              {example}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        {draft.sections.map((section, sectionIndex) => (
          <div className="rounded-md border border-[var(--border)] bg-white" key={`${sectionIndex}-${section.fields[0]?.ref ?? "empty"}`}>
            <div className="grid gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <input
                aria-label="Section title"
                className={`${inputClass} font-semibold`}
                onChange={(event) => edit((form) => void (form.sections[sectionIndex].title = event.target.value), { undoable: false })}
                value={section.title}
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-h-10 items-center gap-2 text-sm text-[var(--ink)]">
                  <input
                    checked={section.repeatable}
                    className="h-4 w-4 accent-[var(--primary)]"
                    onChange={(event) => edit((form) => void (form.sections[sectionIndex].repeatable = event.target.checked), { undoable: true })}
                    type="checkbox"
                  />
                  Can add more than one entry
                </label>
                <button
                  aria-label={`Remove section ${section.title}`}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] hover:text-[var(--danger)]"
                  onClick={() => edit((form) => void form.sections.splice(sectionIndex, 1), { undoable: true })}
                  type="button"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <ul className="divide-y divide-[var(--border)]">
              {section.fields.map((field, fieldIndex) => (
                <FieldRow
                  allFields={allFields}
                  canMoveDown={fieldIndex < section.fields.length - 1}
                  canMoveUp={fieldIndex > 0}
                  edit={edit}
                  field={field}
                  fieldIndex={fieldIndex}
                  key={field.ref}
                  sectionIndex={sectionIndex}
                />
              ))}
            </ul>

            <div className="p-3">
              <button
                className={buttonClass}
                onClick={() =>
                  edit(
                    (form) =>
                      void form.sections[sectionIndex].fields.push({
                        adminOnly: false,
                        body: "",
                        fieldType: "short_text",
                        help: "",
                        label: "New question",
                        options: [],
                        ref: nextRef(form),
                        required: false,
                        showWhen: null,
                      }),
                    { undoable: true },
                  )
                }
                type="button"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add a question
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--ink-muted)]">
          Saved as a hidden draft. Crews will not see it until you publish it from the form page.
        </p>
        <button className={primaryClass} disabled={saving || busy || fieldCount === 0 || !draft.name.trim()} onClick={onSave} type="button">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Saving..." : "Save as draft"}
        </button>
      </div>
    </div>
  );
}

function FieldRow({
  allFields,
  canMoveDown,
  canMoveUp,
  edit,
  field,
  fieldIndex,
  sectionIndex,
}: {
  allFields: ConvertedField[];
  canMoveDown: boolean;
  canMoveUp: boolean;
  edit: EditFn;
  field: ConvertedField;
  fieldIndex: number;
  sectionIndex: number;
}) {
  const [addingRule, setAddingRule] = useState(false);
  const usesOptions = field.fieldType === "checkbox" || field.fieldType.startsWith("dropdown_");
  const controller = field.showWhen ? allFields.find((candidate) => candidate.ref === field.showWhen?.ref) ?? null : null;
  const controllers = allFields.filter(
    (candidate) =>
      candidate.ref !== field.ref &&
      candidate.showWhen?.ref !== field.ref &&
      answerChoicesForField(candidate.fieldType, { options: candidate.options }).length > 0,
  );
  const choices = controller ? answerChoicesForField(controller.fieldType, { options: controller.options }) : [];

  function patch(change: (target: ConvertedField) => void, undoable: boolean) {
    edit((form) => change(form.sections[sectionIndex].fields[fieldIndex]), { undoable });
  }

  function move(offset: number) {
    edit((form) => {
      const list = form.sections[sectionIndex].fields;
      const [moved] = list.splice(fieldIndex, 1);
      list.splice(fieldIndex + offset, 0, moved);
    }, { undoable: true });
  }

  return (
    <li className="grid gap-3 p-3">
      <div className="grid gap-2 md:grid-cols-[1fr_200px]">
        <input
          aria-label="Question"
          className={inputClass}
          onChange={(event) => patch((target) => void (target.label = event.target.value), false)}
          value={field.label}
        />
        <select
          aria-label="Answer type"
          className={inputClass}
          onChange={(event) =>
            patch((target) => {
              target.fieldType = event.target.value as ConverterFieldType;
              target.required = target.fieldType === "text_info" ? false : target.required;
            }, true)
          }
          value={field.fieldType}
        >
          {CONVERTER_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {CONVERTER_FIELD_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      {usesOptions ? (
        <label className="block">
          <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Choices, one per line</span>
          <textarea
            className="mt-1 min-h-20 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            onChange={(event) => patch((target) => void (target.options = event.target.value.split("\n")), false)}
            onBlur={() => patch((target) => void (target.options = target.options.map((option) => option.trim()).filter(Boolean)), false)}
            value={field.options.join("\n")}
          />
        </label>
      ) : null}

      {field.fieldType === "text_info" ? (
        <label className="block">
          <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Text the crew reads</span>
          <textarea
            className="mt-1 min-h-20 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            onChange={(event) => patch((target) => void (target.body = event.target.value), false)}
            value={field.body}
          />
        </label>
      ) : null}

      {field.showWhen ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-2.5 text-sm text-[var(--ink)]">
          {controller ? (
            <>
              <span>Only shows when &ldquo;{controller.label}&rdquo; is </span>
              <span className="inline-flex flex-wrap gap-1.5 align-middle">
                {choices.map((choice) => {
                  const checked = field.showWhen?.anyOf.includes(choice.value) ?? false;

                  return (
                    <label
                      className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-white px-2 ${checked ? "border-[var(--primary)]" : "border-[var(--border)] text-[var(--ink-muted)]"}`}
                      key={choice.value}
                    >
                      <input
                        checked={checked}
                        className="h-4 w-4 accent-[var(--primary)]"
                        onChange={(event) =>
                          patch((target) => {
                            if (!target.showWhen) {
                              return;
                            }

                            const next = event.target.checked
                              ? [...target.showWhen.anyOf, choice.value]
                              : target.showWhen.anyOf.filter((answer) => answer !== choice.value);
                            target.showWhen = next.length > 0 ? { ...target.showWhen, anyOf: next } : null;
                          }, true)
                        }
                        type="checkbox"
                      />
                      {choice.label}
                    </label>
                  );
                })}
              </span>
            </>
          ) : (
            <span>The question this depended on was removed, so it will always show.</span>
          )}
          <button className="ml-2 inline-flex min-h-9 items-center text-sm font-semibold text-[var(--primary)] underline" onClick={() => patch((target) => void (target.showWhen = null), true)} type="button">
            Always show
          </button>
        </div>
      ) : addingRule ? (
        <label className="block">
          <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Only show this after an answer to</span>
          <select
            className={`${inputClass} mt-1`}
            onChange={(event) => {
              const chosen = controllers.find((candidate) => candidate.ref === event.target.value);
              const first = chosen ? answerChoicesForField(chosen.fieldType, { options: chosen.options })[0] : null;

              if (chosen && first) {
                patch((target) => void (target.showWhen = { anyOf: [first.value], ref: chosen.ref }), true);
              }

              setAddingRule(false);
            }}
            value=""
          >
            <option value="">Choose a question</option>
            {controllers.map((candidate) => (
              <option key={candidate.ref} value={candidate.ref}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {field.fieldType !== "text_info" ? (
          <label className="flex min-h-9 items-center gap-2 text-sm text-[var(--ink)]">
            <input
              checked={field.required}
              className="h-4 w-4 accent-[var(--primary)]"
              onChange={(event) => patch((target) => void (target.required = event.target.checked), true)}
              type="checkbox"
            />
            Must answer
          </label>
        ) : null}
        <label className="flex min-h-9 items-center gap-2 text-sm text-[var(--ink)]">
          <input
            checked={field.adminOnly}
            className="h-4 w-4 accent-[var(--primary)]"
            onChange={(event) => patch((target) => void (target.adminOnly = event.target.checked), true)}
            type="checkbox"
          />
          Office use only
        </label>
        {!field.showWhen && !addingRule && controllers.length > 0 ? (
          <button className="min-h-9 text-sm font-semibold text-[var(--primary)] underline" onClick={() => setAddingRule(true)} type="button">
            Only show after an answer
          </button>
        ) : null}
        <span className="ml-auto flex gap-1">
          <button aria-label="Move up" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--ink-muted)] disabled:opacity-40" disabled={!canMoveUp} onClick={() => move(-1)} type="button">
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button aria-label="Move down" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--ink-muted)] disabled:opacity-40" disabled={!canMoveDown} onClick={() => move(1)} type="button">
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            aria-label={`Remove ${field.label}`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--ink-muted)] hover:text-[var(--danger)]"
            onClick={() => edit((form) => void form.sections[sectionIndex].fields.splice(fieldIndex, 1), { undoable: true })}
            type="button"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      </div>
    </li>
  );
}
