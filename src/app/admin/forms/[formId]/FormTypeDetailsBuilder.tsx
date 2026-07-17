"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Camera,
  Check,
  CheckSquare,
  ChevronDown,
  Clock3,
  ClipboardCheck,
  Copy,
  Eye,
  FileImage,
  FilePlus2,
  FileText,
  Flag,
  GripVertical,
  Hash,
  ListChecks,
  MapPin,
  MessageSquareText,
  PenLine,
  Plus,
  Rows3,
  Settings,
  TextCursorInput,
  Trash2,
  Type,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { formBuilderItemTypeOptions, type FormBuilderItemType } from "@/lib/form-templates";
import { getManagedListIdFromSettings } from "@/lib/managed-lists";
import type { Database, Json } from "@/types/database";

type FormRow = Pick<
  Database["public"]["Tables"]["forms"]["Row"],
  "allow_duplicates" | "code" | "id" | "name" | "status"
>;
type SectionRow = Database["public"]["Tables"]["form_sections"]["Row"];
type ItemRow = Database["public"]["Tables"]["form_items"]["Row"];

export type BuilderItem = ItemRow;
export type BuilderSection = SectionRow & { items: BuilderItem[] };

export type AvailableManagedList = {
  id: string;
  name: string;
  include_other: boolean;
};

type FormTypeDetailsBuilderProps = {
  availableLists: AvailableManagedList[];
  documentControlEnabled: boolean;
  formDocumentControl: FormDocumentControl | null;
  initialForm: FormRow;
  initialSections: BuilderSection[];
};

type FormDocumentControl = {
  approval_status: string;
  dcn: string;
  version: string;
};

type ToastState = {
  message: string;
  tone: "error" | "success";
} | null;

type ConfirmState =
  | {
      id: string;
      kind: "item";
      label: string;
      sectionId: string;
    }
  | {
      id: string;
      kind: "section";
      label: string;
    }
  | null;

type ItemPatch = {
  config?: Json;
  flaggable?: boolean;
  helpText?: string | null;
  prompt?: string;
  required?: boolean;
  sectionId?: string;
  sortOrder?: number;
};

type SectionPatch = {
  collapsible?: boolean;
  repeatable?: boolean;
  sortOrder?: number;
  title?: string;
};

type DropdownOption = {
  id: string;
  label: string;
  markedAsFail: boolean;
  value: string;
};

const noExtraConfigTypes = new Set<string>([
  "pass_fail_na",
  "yes_no_na",
  "checkbox",
  "date",
  "time",
  "worker_select",
  "workers_select",
  "photo",
  "signature",
  "gps_coordinates",
  "image_view",
  "pdf_view",
]);

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? "Request failed.");
  }

  return body as T;
}

function sortOrderForIndex(index: number) {
  return (index + 1) * 100;
}

function makeTempId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function orderedSections(sections: BuilderSection[]) {
  return [...sections].sort((left, right) => left.sort_order - right.sort_order || left.title.localeCompare(right.title));
}

function orderedItems(items: BuilderItem[]) {
  return [...items].sort((left, right) => left.sort_order - right.sort_order || left.label.localeCompare(right.label));
}

function recordFromJson(value: Json): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...value };
}

function stringSetting(settings: Json, key: string) {
  const value = recordFromJson(settings)[key];

  return typeof value === "string" ? value : "";
}

function numberSetting(settings: Json, key: string) {
  const value = recordFromJson(settings)[key];

  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function booleanSetting(settings: Json, key: string) {
  return recordFromJson(settings)[key] === true;
}

function stringArraySetting(settings: Json, key: string) {
  const value = recordFromJson(settings)[key];

  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function pdfReferencesFromSettings(settings: Json) {
  const value = recordFromJson(settings).pdfReferences;

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, Json | undefined>;

      return typeof record.name === "string" ? record.name : null;
    })
    .filter((name): name is string => Boolean(name));
}

function updateSettings(settings: Json, patch: Record<string, Json | undefined>) {
  const next = recordFromJson(settings);

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "") {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  return next;
}

function dropdownOptionsFromSettings(settings: Json): DropdownOption[] {
  const record = recordFromJson(settings);
  const rows = record.optionRows;

  if (Array.isArray(rows)) {
    return rows
      .map((row, index) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          return null;
        }

        const option = row as Record<string, Json | undefined>;
        const label = typeof option.label === "string" ? option.label : "";
        const value = typeof option.value === "string" ? option.value : label;

        if (!label && !value) {
          return null;
        }

        return {
          id: typeof option.id === "string" ? option.id : makeTempId(`option-${index}`),
          label: label || value,
          markedAsFail: option.markedAsFail === true,
          value: value || label,
        };
      })
      .filter((option): option is DropdownOption => Boolean(option));
  }

  const legacyOptions = record.options;

  if (!Array.isArray(legacyOptions)) {
    return [];
  }

  return legacyOptions
    .filter((option): option is string => typeof option === "string" && option.trim().length > 0)
    .map((label, index) => ({
      id: makeTempId(`option-${index}`),
      label,
      markedAsFail: false,
      value: label,
    }));
}

function settingsWithDropdownOptions(settings: Json, options: DropdownOption[]) {
  return updateSettings(settings, {
    optionRows: options.map((option) => ({
      id: option.id,
      label: option.label,
      markedAsFail: option.markedAsFail,
      value: option.value,
    })),
    options: options.map((option) => option.label).filter(Boolean),
  });
}

function defaultConfigForType(type: FormBuilderItemType): Json {
  if (type === "dropdown_select_one" || type === "dropdown_select_multiple") {
    return settingsWithDropdownOptions({}, []);
  }

  return {};
}

function sortableHandleAttributes(attributes: ReturnType<typeof useSortable>["attributes"]) {
  const { "aria-describedby": unstableDescriptionId, ...stableAttributes } = attributes;
  void unstableDescriptionId;

  return stableAttributes;
}

function FieldTypeIcon({ fieldType }: { fieldType: string }) {
  const className = "h-4 w-4";

  switch (fieldType) {
    case "pass_fail_na":
      return <ClipboardCheck className={className} aria-hidden="true" />;
    case "checkbox":
      return <CheckSquare className={className} aria-hidden="true" />;
    case "short_text":
      return <TextCursorInput className={className} aria-hidden="true" />;
    case "long_text":
      return <MessageSquareText className={className} aria-hidden="true" />;
    case "text_info":
      return <Rows3 className={className} aria-hidden="true" />;
    case "dropdown_select_one":
    case "dropdown_select_multiple":
      return <ListChecks className={className} aria-hidden="true" />;
    case "yes_no_na":
      return <Check className={className} aria-hidden="true" />;
    case "pass_fail_total":
    case "number":
      return <Hash className={className} aria-hidden="true" />;
    case "date":
      return <CalendarDays className={className} aria-hidden="true" />;
    case "time":
      return <Clock3 className={className} aria-hidden="true" />;
    case "worker_select":
      return <UserRound className={className} aria-hidden="true" />;
    case "workers_select":
      return <UsersRound className={className} aria-hidden="true" />;
    case "photo":
      return <FileImage className={className} aria-hidden="true" />;
    case "signature":
      return <PenLine className={className} aria-hidden="true" />;
    case "image_view":
      return <FileImage className={className} aria-hidden="true" />;
    case "gps_coordinates":
      return <MapPin className={className} aria-hidden="true" />;
    case "pdf_insert":
      return <FilePlus2 className={className} aria-hidden="true" />;
    case "pdf_view":
      return <FileText className={className} aria-hidden="true" />;
    default:
      return <Type className={className} aria-hidden="true" />;
  }
}

function FormStatusBadge({ form }: { form: FormRow }) {
  return (
    <span className="rounded-md border border-[var(--border)] bg-white px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
      {form.code} - {form.status}
    </span>
  );
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

function Toast({ toast, onDismiss }: { onDismiss: () => void; toast: ToastState }) {
  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(onDismiss, 3500);

    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast]);

  if (!toast) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-[var(--border)] bg-white p-3 text-sm font-semibold shadow-lg">
      <div className={toast.tone === "success" ? "text-[var(--success)]" : "text-[var(--danger)]"}>{toast.message}</div>
    </div>
  );
}

function ConfirmDeleteModal({
  confirm,
  onCancel,
  onConfirm,
}: {
  confirm: ConfirmState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirm) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-md rounded-md border border-[var(--border)] bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">Delete {confirm.kind === "section" ? "section" : "item"}?</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{confirm.label} will be permanently removed.</p>
          </div>
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
            onClick={onCancel}
            type="button"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--danger)] px-3 text-sm font-semibold text-white hover:bg-red-700"
            onClick={onConfirm}
            type="button"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function AddSectionComposer({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (title: string) => Promise<boolean>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  async function submit() {
    const nextTitle = title.trim();

    if (!nextTitle) {
      return;
    }

    setSubmitting(true);

    try {
      const created = await onCreate(nextTitle);

      if (created) {
        setTitle("");
        onCancel();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="grid gap-3 rounded-md border border-[var(--border)] bg-white p-3 shadow-sm"
      id="new-section-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm font-semibold text-[var(--ink)]">Create Section</p>
      <label className="grid gap-1 text-sm font-semibold text-[var(--ink)]">
        Section name
        <input
          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm font-normal text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Example: Worker information"
          ref={inputRef}
          value={title}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting || !title.trim()}
          type="submit"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create
        </button>
      </div>
    </form>
  );
}

function AddItemModal({
  onClose,
  onPickType,
  section,
}: {
  onClose: () => void;
  onPickType: (sectionId: string, type: FormBuilderItemType) => void;
  section: BuilderSection;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-md border border-zinc-700 bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between bg-zinc-700 px-4 py-3 text-white">
          <h2 className="text-base font-semibold">Create New Item Type</h2>
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white hover:bg-zinc-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="overflow-y-auto">
          {formBuilderItemTypeOptions.map((option) => (
            <button
              className="grid min-h-12 w-full grid-cols-[56px_1fr] items-center gap-3 border-b border-[var(--border)] bg-white text-left text-sm text-[var(--ink)] last:border-b-0 hover:bg-[var(--surface-muted)]"
              key={option.value}
              onClick={() => onPickType(section.id, option.value)}
              type="button"
            >
              <span className="flex h-12 items-center justify-center border-r border-[var(--border)] text-[var(--primary)]">
                <FieldTypeIcon fieldType={option.value} />
              </span>
              <span className="font-medium">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DraftItemRow({
  onCancel,
  onCreate,
  type,
}: {
  onCancel: () => void;
  onCreate: (prompt: string) => Promise<boolean>;
  type: FormBuilderItemType;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  async function submit() {
    const nextPrompt = question.trim();

    if (!nextPrompt) {
      return;
    }

    setSubmitting(true);

    try {
      const created = await onCreate(nextPrompt);

      if (created) {
        setQuestion("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="grid grid-cols-[44px_minmax(0,1fr)_auto_44px] items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)] px-2 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-sm border border-[var(--border)] bg-white text-[var(--primary)]">
        <FieldTypeIcon fieldType={type} />
      </span>
      <input
        className="h-10 w-full rounded-sm border border-zinc-400 bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Question"
        ref={inputRef}
        value={question}
      />
      <button
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={submitting || !question.trim()}
        type="submit"
      >
        <Check className="h-4 w-4" aria-hidden="true" />
        Create
      </button>
      <button
        aria-label="Cancel"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-white hover:text-[var(--ink)]"
        onClick={onCancel}
        title="Cancel"
        type="button"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}

function DropdownOptionsEditor({
  availableLists,
  item,
  onConfigChange,
}: {
  availableLists: AvailableManagedList[];
  item: BuilderItem;
  onConfigChange: (config: Json) => void;
}) {
  const [options, setOptions] = useState(() => dropdownOptionsFromSettings(item.settings));
  const selectedListId = getManagedListIdFromSettings(item.settings) ?? "";
  const selectedList = selectedListId ? availableLists.find((list) => list.id === selectedListId) ?? null : null;
  const usingManagedList = Boolean(selectedListId);

  function persist(nextOptions: DropdownOption[]) {
    setOptions(nextOptions);
    onConfigChange(settingsWithDropdownOptions(item.settings, nextOptions));
  }

  function updateOption(id: string, patch: Partial<DropdownOption>) {
    setOptions((current) => current.map((option) => (option.id === id ? { ...option, ...patch } : option)));
  }

  function handleListChange(nextId: string) {
    if (!nextId) {
      onConfigChange(updateSettings(item.settings, { list_id: undefined, list_name: undefined }));
      return;
    }

    const list = availableLists.find((candidate) => candidate.id === nextId);
    onConfigChange(updateSettings(item.settings, { list_id: nextId, list_name: list?.name ?? undefined }));
  }

  return (
    <div className="space-y-3 rounded-md border border-[var(--border)] bg-white p-3">
      <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">
        Options source
        <select
          className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-2 text-sm font-normal normal-case text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          onChange={(event) => handleListChange(event.target.value)}
          value={selectedListId}
        >
          <option value="">Manual options</option>
          {availableLists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
              {list.include_other ? " (with Other)" : ""}
            </option>
          ))}
        </select>
      </label>

      {usingManagedList ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink)]">
          <p>
            Options come from the <strong>{selectedList?.name ?? "selected"}</strong> managed list. Workers see the latest
            items every time they open the form.
          </p>
          <Link
            className="mt-2 inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] hover:bg-white/80"
            href="/admin/lists"
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
            Manage lists
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Options</p>
            <button
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
              onClick={() => {
                const label = `Option ${options.length + 1}`;
                persist([
                  ...options,
                  {
                    id: makeTempId("option"),
                    label,
                    markedAsFail: false,
                    value: label,
                  },
                ]);
              }}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Option
            </button>
          </div>
          <div className="space-y-2">
            {options.map((option, index) => (
          <div className="grid gap-2 rounded-md border border-[var(--border)] bg-white p-2 lg:grid-cols-[auto_1fr_1fr_auto_auto]" key={option.id}>
            <div className="flex items-center gap-1">
              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-40"
                disabled={index === 0}
                onClick={() => persist(arrayMove(options, index, index - 1))}
                title="Move option up"
                type="button"
              >
                <GripVertical className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-40"
                disabled={index === options.length - 1}
                onClick={() => persist(arrayMove(options, index, index + 1))}
                title="Move option down"
                type="button"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <label className="grid gap-1 text-xs font-medium text-[var(--ink-muted)]">
              Label
              <input
                className="h-9 rounded-md border border-[var(--border)] bg-white px-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                onBlur={() => persist(options)}
                onChange={(event) => updateOption(option.id, { label: event.target.value })}
                value={option.label}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-[var(--ink-muted)]">
              Value
              <input
                className="h-9 rounded-md border border-[var(--border)] bg-white px-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                onBlur={() => persist(options)}
                onChange={(event) => updateOption(option.id, { value: event.target.value })}
                value={option.value}
              />
            </label>
            <label className="flex min-h-9 items-center gap-2 text-xs font-medium text-[var(--ink)]">
              <input
                checked={option.markedAsFail}
                className="h-4 w-4 accent-[var(--primary)]"
                onChange={(event) => {
                  const next = options.map((current) =>
                    current.id === option.id ? { ...current, markedAsFail: event.target.checked } : current,
                  );
                  persist(next);
                }}
                type="checkbox"
              />
              Marked as Fail
            </label>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-red-50 hover:text-[var(--danger)]"
              onClick={() => persist(options.filter((current) => current.id !== option.id))}
              title="Remove option"
              type="button"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
          </div>
        </>
      )}
    </div>
  );
}

function ItemDetails({
  allItems,
  availableLists,
  item,
  onPatchItem,
  onUploadPdfs,
}: {
  allItems: BuilderItem[];
  availableLists: AvailableManagedList[];
  item: BuilderItem;
  onPatchItem: (itemId: string, patch: ItemPatch) => Promise<void>;
  onUploadPdfs: (itemId: string, files: File[]) => Promise<void>;
}) {
  const [helpText, setHelpText] = useState(item.helper_text ?? "");
  const [infoBody, setInfoBody] = useState(stringSetting(item.settings, "richTextBody"));
  const [numberMin, setNumberMin] = useState(numberSetting(item.settings, "min"));
  const [numberMax, setNumberMax] = useState(numberSetting(item.settings, "max"));
  const [decimalPlaces, setDecimalPlaces] = useState(numberSetting(item.settings, "decimalPlaces"));

  const passFailItems = allItems.filter((candidate) => candidate.field_type === "pass_fail_na");
  const selectedRollupIds = stringArraySetting(item.settings, "rollupItemIds");

  function patchConfig(patch: Record<string, Json | undefined>) {
    void onPatchItem(item.id, { config: updateSettings(item.settings, patch) });
  }

  function saveNumberConfig() {
    patchConfig({
      decimalPlaces: decimalPlaces.trim() ? Number(decimalPlaces) : undefined,
      max: numberMax.trim() ? Number(numberMax) : undefined,
      min: numberMin.trim() ? Number(numberMin) : undefined,
    });
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <div className="grid gap-3">
        <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">
          Help text / instructions
          <textarea
            className="min-h-16 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-normal normal-case text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            onBlur={() => void onPatchItem(item.id, { helpText: helpText.trim() || null })}
            onChange={(event) => setHelpText(event.target.value)}
            value={helpText}
          />
        </label>

        {item.field_type === "text_info" ? (
          <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">
            Rich-text body
            <textarea
              className="min-h-24 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-normal normal-case text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              onBlur={() => patchConfig({ richTextBody: infoBody.trim() || undefined })}
              onChange={(event) => setInfoBody(event.target.value)}
              value={infoBody}
            />
          </label>
        ) : null}

        {item.field_type === "dropdown_select_one" || item.field_type === "dropdown_select_multiple" ? (
          <DropdownOptionsEditor
            availableLists={availableLists}
            item={item}
            onConfigChange={(config) => void onPatchItem(item.id, { config })}
          />
        ) : null}

        {item.field_type === "pass_fail_total" ? (
          <fieldset className="space-y-2 rounded-md border border-[var(--border)] bg-white p-3">
            <legend className="px-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">Pass/Fail items to roll up</legend>
            {passFailItems.length > 0 ? (
              passFailItems.map((candidate) => {
                const checked = selectedRollupIds.includes(candidate.id);

                return (
                  <label className="flex items-center gap-2 text-sm text-[var(--ink)]" key={candidate.id}>
                    <input
                      checked={checked}
                      className="h-4 w-4 accent-[var(--primary)]"
                      onChange={(event) => {
                        const nextIds = event.target.checked
                          ? Array.from(new Set([...selectedRollupIds, candidate.id]))
                          : selectedRollupIds.filter((id) => id !== candidate.id);
                        patchConfig({ rollupItemIds: nextIds });
                      }}
                      type="checkbox"
                    />
                    {candidate.label}
                  </label>
                );
              })
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">No Pass / Fail / NA items are available.</p>
            )}
          </fieldset>
        ) : null}

        {item.field_type === "number" ? (
          <div className="grid gap-2 md:grid-cols-3">
            <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">
              Min
              <input
                className="h-9 rounded-md border border-[var(--border)] bg-white px-2 text-sm font-normal normal-case text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                onBlur={saveNumberConfig}
                onChange={(event) => setNumberMin(event.target.value)}
                type="number"
                value={numberMin}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">
              Max
              <input
                className="h-9 rounded-md border border-[var(--border)] bg-white px-2 text-sm font-normal normal-case text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                onBlur={saveNumberConfig}
                onChange={(event) => setNumberMax(event.target.value)}
                type="number"
                value={numberMax}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">
              Decimal places
              <input
                className="h-9 rounded-md border border-[var(--border)] bg-white px-2 text-sm font-normal normal-case text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                min={0}
                onBlur={saveNumberConfig}
                onChange={(event) => setDecimalPlaces(event.target.value)}
                type="number"
                value={decimalPlaces}
              />
            </label>
          </div>
        ) : null}

        {item.field_type === "pdf_insert" ? (
          <div className="grid gap-2">
            <label className="grid gap-1 text-xs font-semibold uppercase text-[var(--ink-muted)]">
              Insert PDFs
              <input
                accept="application/pdf"
                className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-normal normal-case text-[var(--ink)]"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);

                  if (files.length > 0) {
                    void onUploadPdfs(item.id, files);
                  }
                }}
                type="file"
              />
            </label>
            {pdfReferencesFromSettings(item.settings).length > 0 ? (
              <ul className="space-y-1 text-sm text-[var(--ink-muted)]">
                {pdfReferencesFromSettings(item.settings).map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortableItemRow({
  allItems,
  availableLists,
  detailsOpen,
  item,
  onDelete,
  onPatchItem,
  onToggleDetails,
  onUploadPdfs,
}: {
  allItems: BuilderItem[];
  availableLists: AvailableManagedList[];
  detailsOpen: boolean;
  item: BuilderItem;
  onDelete: (item: BuilderItem) => void;
  onPatchItem: (itemId: string, patch: ItemPatch) => Promise<void>;
  onToggleDetails: () => void;
  onUploadPdfs: (itemId: string, files: File[]) => Promise<void>;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(item.label);
  const handleAttributes = sortableHandleAttributes(attributes);
  const style = {
    opacity: isDragging ? 0.55 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const supportsLabel = item.field_type === "short_text" || item.field_type === "long_text";
  const useAsLabel = booleanSetting(item.settings, "useAsLabel");
  const allowEvidencePhotos = booleanSetting(item.settings, "allowEvidencePhotos");
  const hasDetails = !noExtraConfigTypes.has(item.field_type) || item.helper_text || detailsOpen;
  const isDropdownItem = item.field_type === "dropdown_select_one" || item.field_type === "dropdown_select_multiple";
  const dropdownNeedsSource =
    isDropdownItem &&
    !getManagedListIdFromSettings(item.settings) &&
    dropdownOptionsFromSettings(item.settings).length === 0;

  function savePrompt() {
    const nextPrompt = promptDraft.trim();

    if (nextPrompt && nextPrompt !== item.label) {
      void onPatchItem(item.id, { prompt: nextPrompt });
    } else {
      setPromptDraft(item.label);
    }

    setEditingPrompt(false);
  }

  function patchConfig(patch: Record<string, Json | undefined>) {
    void onPatchItem(item.id, { config: updateSettings(item.settings, patch) });
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div className="grid min-h-11 grid-cols-[34px_30px_104px_34px_34px_minmax(0,1fr)_auto] items-center gap-1 border-b border-[var(--border)] bg-white pr-2">
        <button
          className="flex h-11 w-full items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
          suppressHydrationWarning
          title="Drag to reorder"
          type="button"
          {...handleAttributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Drag to reorder</span>
        </button>
        <button
          className={`flex h-11 w-full items-center justify-center text-xl font-bold ${item.required ? "text-[var(--danger)]" : "text-zinc-400"}`}
          onClick={() => void onPatchItem(item.id, { required: !item.required })}
          title="Required"
          type="button"
        >
          *
        </button>
        <button
          className={`flex h-11 w-full items-center justify-center gap-1.5 rounded-md text-xs font-semibold ${
            item.flaggable ? "text-[var(--warning)]" : "text-zinc-400"
          } hover:bg-[var(--surface-muted)] hover:text-[var(--warning)]`}
          onClick={() => void onPatchItem(item.id, { flaggable: !item.flaggable })}
          title={
            item.flaggable
              ? "Workers can flag this question and assign a corrective action. Click to disable."
              : "Allow workers to flag this question on the worker app and assign a corrective action."
          }
          type="button"
        >
          <Flag className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{item.flaggable ? "Flag on" : "Allow flag"}</span>
        </button>
        <button
          className={`flex h-11 w-full items-center justify-center ${
            allowEvidencePhotos ? "text-[var(--primary)]" : "text-zinc-400"
          } hover:bg-[var(--surface-muted)] hover:text-[var(--primary)]`}
          onClick={() => patchConfig({ allowEvidencePhotos: allowEvidencePhotos ? undefined : true })}
          title={allowEvidencePhotos ? "Photo evidence enabled" : "Allow photo evidence"}
          type="button"
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{allowEvidencePhotos ? "Disable photo evidence" : "Allow photo evidence"}</span>
        </button>
        <span className="flex h-11 w-full items-center justify-center text-[var(--primary)]">
          <FieldTypeIcon fieldType={item.field_type} />
        </span>
        <div className="min-w-0 py-2">
          {editingPrompt ? (
            <textarea
              autoFocus
              className="min-h-16 w-full rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              onBlur={savePrompt}
              onChange={(event) => setPromptDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setPromptDraft(item.label);
                  setEditingPrompt(false);
                }
              }}
              value={promptDraft}
            />
          ) : (
            <button
              className="block max-w-full truncate text-left text-sm text-[var(--ink)] hover:text-[var(--primary)]"
              onClick={() => setEditingPrompt(true)}
              type="button"
            >
              {item.label}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {supportsLabel ? (
            <label className="hidden min-h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] md:flex">
              <input
                checked={useAsLabel}
                className="h-4 w-4 accent-[var(--primary)]"
                onChange={(event) => patchConfig({ useAsLabel: event.target.checked ? true : undefined })}
                type="checkbox"
              />
              Use As Label
            </label>
          ) : null}
          {dropdownNeedsSource && !detailsOpen ? (
            <button
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--warning)] bg-orange-50 px-2 text-xs font-semibold text-[var(--warning)] hover:bg-orange-100"
              onClick={onToggleDetails}
              title="Pick a managed list or add manual options"
              type="button"
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Choose list
            </button>
          ) : null}
          <button
            className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
            onClick={onToggleDetails}
            type="button"
          >
            Details
          </button>
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-red-50 hover:text-[var(--danger)]"
            onClick={() => onDelete(item)}
            title="Delete item"
            type="button"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Delete item</span>
          </button>
        </div>
      </div>
      {hasDetails && detailsOpen ? (
        <ItemDetails allItems={allItems} availableLists={availableLists} item={item} onPatchItem={onPatchItem} onUploadPdfs={onUploadPdfs} />
      ) : null}
    </div>
  );
}

function SortableSectionCard({
  allItems,
  availableLists,
  detailsOpen,
  draftType,
  onAddItem,
  onCancelDraft,
  onCommitDraft,
  onDeleteItem,
  onDeleteSection,
  onDuplicateSection,
  onItemDragEnd,
  onPatchItem,
  onPatchSection,
  onToggleDetails,
  onUploadPdfs,
  section,
}: {
  allItems: BuilderItem[];
  availableLists: AvailableManagedList[];
  detailsOpen: ReadonlySet<string>;
  draftType: FormBuilderItemType | null;
  onAddItem: (section: BuilderSection) => void;
  onCancelDraft: () => void;
  onCommitDraft: (sectionId: string, type: FormBuilderItemType, prompt: string) => Promise<boolean>;
  onDeleteItem: (item: BuilderItem, sectionId: string) => void;
  onDeleteSection: (section: BuilderSection) => void;
  onDuplicateSection: (section: BuilderSection) => void;
  onItemDragEnd: (sectionId: string, event: DragEndEvent) => void;
  onPatchItem: (itemId: string, patch: ItemPatch) => Promise<void>;
  onPatchSection: (sectionId: string, patch: SectionPatch) => Promise<void>;
  onToggleDetails: (itemId: string) => void;
  onUploadPdfs: (itemId: string, files: File[]) => Promise<void>;
  section: BuilderSection;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id });
  const [titleDraft, setTitleDraft] = useState(section.title);
  const handleAttributes = sortableHandleAttributes(attributes);
  const style = {
    opacity: isDragging ? 0.65 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const itemIds = section.items.map((item) => item.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function saveTitle() {
    const nextTitle = titleDraft.trim();

    if (nextTitle && nextTitle !== section.title) {
      void onPatchSection(section.id, { title: nextTitle });
    } else {
      setTitleDraft(section.title);
    }
  }

  return (
    <section className="scroll-mt-4" id={`section-${section.id}`} ref={setNodeRef} style={style}>
      <div className="overflow-hidden rounded-md border border-[var(--border)] bg-white shadow-sm">
        <div className="grid gap-2 bg-zinc-700 px-3 py-2 text-white md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <label className="flex min-w-0 items-center gap-2">
            <button
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white hover:bg-zinc-600"
              suppressHydrationWarning
              title="Drag to reorder"
              type="button"
              {...handleAttributes}
              {...listeners}
              aria-label="Drag to reorder"
            >
              <GripVertical className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Drag to reorder</span>
            </button>
            <span className="sr-only">Section name</span>
            <input
              className="h-8 min-w-0 flex-1 border-0 bg-transparent text-lg font-semibold text-white outline-none placeholder:text-zinc-300"
              onBlur={saveTitle}
              onChange={(event) => setTitleDraft(event.target.value)}
              value={titleDraft}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                checked={section.collapsible}
                className="h-4 w-4 accent-[var(--primary)]"
                onChange={(event) => void onPatchSection(section.id, { collapsible: event.target.checked })}
                type="checkbox"
              />
              Collapsible
            </label>
            <label className="flex items-center gap-2">
              <input
                checked={section.repeatable}
                className="h-4 w-4 accent-[var(--primary)]"
                onChange={(event) => void onPatchSection(section.id, { repeatable: event.target.checked })}
                type="checkbox"
              />
              Repeatable
            </label>
            <button
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md px-2 text-white hover:bg-zinc-600"
              onClick={() => onDuplicateSection(section)}
              title="Duplicate section"
              type="button"
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              <span className="hidden text-xs font-semibold md:inline">Duplicate</span>
            </button>
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white hover:bg-zinc-600"
              onClick={() => onDeleteSection(section)}
              title="Delete section"
              type="button"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Delete section</span>
            </button>
          </div>
        </div>
        <DndContext
          collisionDetection={closestCenter}
          id={`builder-items-${section.id}`}
          onDragEnd={(event) => onItemDragEnd(section.id, event)}
          sensors={sensors}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="divide-y divide-[var(--border)]">
              {section.items.length > 0 ? (
                section.items.map((item) => (
                  <SortableItemRow
                    allItems={allItems}
                    availableLists={availableLists}
                    detailsOpen={detailsOpen.has(item.id)}
                    item={item}
                    key={item.id}
                    onDelete={(targetItem) => onDeleteItem(targetItem, section.id)}
                    onPatchItem={onPatchItem}
                    onToggleDetails={() => onToggleDetails(item.id)}
                    onUploadPdfs={onUploadPdfs}
                  />
                ))
              ) : (
                <div className="px-3 py-4 text-sm text-[var(--ink-muted)]">No items in this section.</div>
              )}
            </div>
          </SortableContext>
        </DndContext>
        {draftType ? (
          <DraftItemRow
            onCancel={onCancelDraft}
            onCreate={(prompt) => onCommitDraft(section.id, draftType, prompt)}
            type={draftType}
          />
        ) : null}
        <div className="p-3">
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(draftType)}
            onClick={() => onAddItem(section)}
            type="button"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Item
          </button>
        </div>
      </div>
    </section>
  );
}

function SortableOutlineRow({ section }: { section: BuilderSection }) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id });
  const handleAttributes = sortableHandleAttributes(attributes);
  const style = {
    opacity: isDragging ? 0.6 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div className="grid grid-cols-[30px_1fr] items-center rounded-md border border-[var(--border)] bg-white text-sm" ref={setNodeRef} style={style}>
      <button
        className="inline-flex h-9 items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
        suppressHydrationWarning
        title="Drag to reorder"
        type="button"
        {...handleAttributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Drag to reorder</span>
      </button>
      <button
        className="truncate px-2 text-left font-medium text-[var(--ink)] hover:text-[var(--primary)]"
        onClick={() => document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
        type="button"
      >
        {section.title}
      </button>
    </div>
  );
}

function SectionsOutline({
  formId,
  formName,
  onAddSection,
  onSectionDragEnd,
  sections,
}: {
  formId: string;
  formName: string;
  onAddSection: () => void;
  onSectionDragEnd: (event: DragEndEvent) => void;
  sections: BuilderSection[];
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <aside className="h-fit rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm xl:sticky xl:top-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          {formName} Sections
        </h2>
      </div>
      <button
        className="mb-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
        onClick={onAddSection}
        type="button"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add Section
      </button>
      <DndContext collisionDetection={closestCenter} id={`sections-outline-${formId}`} onDragEnd={onSectionDragEnd} sensors={sensors}>
        <SortableContext items={sections.map((section) => section.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {sections.length > 0 ? (
              sections.map((section) => <SortableOutlineRow key={section.id} section={section} />)
            ) : (
              <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">No sections yet.</p>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </aside>
  );
}

export function FormTypeDetailsBuilder({
  availableLists,
  documentControlEnabled,
  formDocumentControl,
  initialForm,
  initialSections,
}: FormTypeDetailsBuilderProps) {
  const [form, setForm] = useState(initialForm);
  const [sections, setSections] = useState(() =>
    orderedSections(initialSections).map((section) => ({ ...section, items: orderedItems(section.items) })),
  );
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialForm.name);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [addItemSection, setAddItemSection] = useState<BuilderSection | null>(null);
  const [draftItem, setDraftItem] = useState<{ sectionId: string; type: FormBuilderItemType } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [detailsOpen, setDetailsOpen] = useState<ReadonlySet<string>>(new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const allItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => {
    if (!addSectionOpen) {
      return;
    }

    document.getElementById("new-section-composer")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [addSectionOpen]);

  function showToast(message: string, tone: "error" | "success" = "success") {
    setToast({ message, tone });
  }

  function openSectionComposer() {
    setAddSectionOpen(true);
  }

  async function patchForm(patch: { allowDuplicates?: boolean; name?: string }) {
    const previous = form;
    const optimistic = {
      ...form,
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.allowDuplicates === undefined ? {} : { allow_duplicates: patch.allowDuplicates }),
    };
    setForm(optimistic);
    setTitleDraft(optimistic.name);

    try {
      const result = await fetchJson<{ form: FormRow }>(`/api/form-types/${form.id}`, {
        body: JSON.stringify(patch),
        method: "PATCH",
      });
      setForm(result.form);
      setTitleDraft(result.form.name);
      showToast("Saved.");
    } catch (error) {
      setForm(previous);
      setTitleDraft(previous.name);
      showToast(apiErrorMessage(error, "Form was not saved."), "error");
    }
  }

  async function addSection(title: string) {
    const previous = sections;
    const sortOrder = sortOrderForIndex(sections.length);
    const sectionTitle = title.trim() || "New Section";
    const tempSection: BuilderSection = {
      collapsible: false,
      created_at: new Date().toISOString(),
      form_id: form.id,
      id: makeTempId("section"),
      items: [],
      repeatable: false,
      sort_order: sortOrder,
      tenant_id: "",
      title: sectionTitle,
      updated_at: new Date().toISOString(),
    };

    setSections(orderedSections([...sections, tempSection]));

    try {
      const result = await fetchJson<{ section: SectionRow }>(`/api/form-types/${form.id}/sections`, {
        body: JSON.stringify({
          collapsible: false,
          repeatable: false,
          sortOrder,
          title: sectionTitle,
        }),
        method: "POST",
      });
      setSections((current) =>
        orderedSections(current.map((section) => (section.id === tempSection.id ? { ...result.section, items: [] } : section))),
      );
      showToast("Section added.");
      return true;
    } catch (error) {
      setSections(previous);
      showToast(apiErrorMessage(error, "Section was not added."), "error");
      return false;
    }
  }

  async function patchSection(sectionId: string, patch: SectionPatch) {
    const previous = sections;
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              ...(patch.title ? { title: patch.title } : {}),
              ...(patch.collapsible === undefined ? {} : { collapsible: patch.collapsible }),
              ...(patch.repeatable === undefined ? {} : { repeatable: patch.repeatable }),
              ...(patch.sortOrder === undefined ? {} : { sort_order: patch.sortOrder }),
            }
          : section,
      ),
    );

    try {
      const result = await fetchJson<{ section: SectionRow }>(`/api/sections/${sectionId}`, {
        body: JSON.stringify(patch),
        method: "PATCH",
      });
      setSections((current) =>
        orderedSections(current.map((section) => (section.id === result.section.id ? { ...result.section, items: section.items } : section))),
      );
      showToast("Saved.");
    } catch (error) {
      setSections(previous);
      showToast(apiErrorMessage(error, "Section was not saved."), "error");
    }
  }

  async function patchItem(itemId: string, patch: ItemPatch) {
    const previous = sections;
    setSections((current) =>
      current.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                ...(patch.prompt ? { label: patch.prompt } : {}),
                ...(patch.required === undefined ? {} : { required: patch.required }),
                ...(patch.flaggable === undefined ? {} : { flaggable: patch.flaggable }),
                ...(patch.helpText === undefined ? {} : { helper_text: patch.helpText }),
                ...(patch.config === undefined ? {} : { settings: patch.config }),
                ...(patch.sortOrder === undefined ? {} : { sort_order: patch.sortOrder }),
                ...(patch.sectionId === undefined ? {} : { section_id: patch.sectionId }),
              }
            : item,
        ),
      })),
    );

    try {
      const result = await fetchJson<{ item: BuilderItem }>(`/api/items/${itemId}`, {
        body: JSON.stringify(patch),
        method: "PATCH",
      });
      setSections((current) =>
        current.map((section) => ({
          ...section,
          items: orderedItems(section.items.map((item) => (item.id === result.item.id ? result.item : item))),
        })),
      );
      showToast("Saved.");
    } catch (error) {
      setSections(previous);
      showToast(apiErrorMessage(error, "Item was not saved."), "error");
    }
  }

  async function createItem(sectionId: string, type: FormBuilderItemType, prompt: string) {
    const targetSection = sections.find((section) => section.id === sectionId);

    if (!targetSection) {
      showToast("Choose a valid section.", "error");
      return false;
    }

    const previous = sections;
    const sortOrder = sortOrderForIndex(targetSection.items.length);
    const tempItem: BuilderItem = {
      created_at: new Date().toISOString(),
      field_type: type,
      flaggable: true,
      form_id: form.id,
      helper_text: null,
      id: makeTempId("item"),
      label: prompt,
      required: false,
      section_id: sectionId,
      settings: defaultConfigForType(type),
      sort_order: sortOrder,
      tenant_id: "",
      updated_at: new Date().toISOString(),
    };

    setSections((current) =>
      current.map((section) => (section.id === sectionId ? { ...section, items: orderedItems([...section.items, tempItem]) } : section)),
    );

    try {
      const result = await fetchJson<{ item: BuilderItem }>(`/api/sections/${sectionId}/items`, {
        body: JSON.stringify({
          config: tempItem.settings,
          flaggable: true,
          prompt,
          required: false,
          sortOrder,
          type,
        }),
        method: "POST",
      });
      if (type === "dropdown_select_one" || type === "dropdown_select_multiple") {
        setDetailsOpen((current) => {
          const next = new Set(current);
          next.add(result.item.id);
          return next;
        });
      }
      setSections((current) =>
        current.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                items: orderedItems(section.items.map((item) => (item.id === tempItem.id ? result.item : item))),
              }
            : section,
        ),
      );
      showToast("A new item was added successfully.");
      return true;
    } catch (error) {
      setSections(previous);
      showToast(apiErrorMessage(error, "Item was not created."), "error");
      return false;
    }
  }

  async function deleteConfirmed() {
    if (!confirm) {
      return;
    }

    const previous = sections;
    const target = confirm;
    setConfirm(null);

    if (target.kind === "section") {
      setSections((current) => current.filter((section) => section.id !== target.id));

      try {
        await fetchJson<{ deleted: boolean }>(`/api/sections/${target.id}`, { method: "DELETE" });
        showToast("Section deleted.");
      } catch (error) {
        setSections(previous);
        showToast(apiErrorMessage(error, "Section was not deleted."), "error");
      }

      return;
    }

    setSections((current) =>
      current.map((section) =>
        section.id === target.sectionId ? { ...section, items: section.items.filter((item) => item.id !== target.id) } : section,
      ),
    );

    try {
      await fetchJson<{ deleted: boolean }>(`/api/items/${target.id}`, { method: "DELETE" });
      showToast("Item deleted.");
    } catch (error) {
      setSections(previous);
      showToast(apiErrorMessage(error, "Item was not deleted."), "error");
    }
  }

  async function duplicateSection(sectionId: string) {
    try {
      const result = await fetchJson<{ section: BuilderSection }>(`/api/sections/${sectionId}/duplicate`, {
        method: "POST",
      });
      setSections((current) => orderedSections([...current, { ...result.section, items: orderedItems(result.section.items) }]));
      showToast("Section duplicated.");
    } catch (error) {
      showToast(apiErrorMessage(error, "Section was not duplicated."), "error");
    }
  }

  async function uploadItemPdfs(itemId: string, files: File[]) {
    const formData = new FormData();

    for (const file of files) {
      formData.append("files", file);
    }

    try {
      const response = await fetch(`/api/items/${itemId}/pdfs`, {
        body: formData,
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; item?: BuilderItem };

      if (!response.ok || !body.item) {
        throw new Error(body.error ?? "PDF files were not uploaded.");
      }

      const uploadedItem = body.item;
      setSections((current) =>
        current.map((section) => ({
          ...section,
          items: section.items.map((item) => (item.id === uploadedItem.id ? uploadedItem : item)),
        })),
      );
      showToast("PDF uploaded.");
    } catch (error) {
      showToast(apiErrorMessage(error, "PDF files were not uploaded."), "error");
    }
  }

  async function persistSectionOrder(nextSections: BuilderSection[], previousSections: BuilderSection[]) {
    setSections(nextSections);

    try {
      await fetchJson<{ sections: SectionRow[] }>("/api/sections/reorder", {
        body: JSON.stringify({
          items: nextSections.map((section, index) => ({ id: section.id, order: sortOrderForIndex(index) })),
        }),
        method: "POST",
      });
      showToast("Section order saved.");
    } catch (error) {
      setSections(previousSections);
      showToast(apiErrorMessage(error, "Section order was not saved."), "error");
    }
  }

  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = sections.findIndex((section) => section.id === active.id);
    const newIndex = sections.findIndex((section) => section.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const previous = sections;
    const nextSections = arrayMove(sections, oldIndex, newIndex).map((section, index) => ({
      ...section,
      sort_order: sortOrderForIndex(index),
    }));
    void persistSectionOrder(nextSections, previous);
  }

  async function persistItemOrder(sectionId: string, nextItems: BuilderItem[], previousSections: BuilderSection[]) {
    setSections((current) => current.map((section) => (section.id === sectionId ? { ...section, items: nextItems } : section)));

    try {
      await fetchJson<{ items: BuilderItem[] }>("/api/items/reorder", {
        body: JSON.stringify({
          items: nextItems.map((item, index) => ({ id: item.id, order: sortOrderForIndex(index) })),
        }),
        method: "POST",
      });
      showToast("Item order saved.");
    } catch (error) {
      setSections(previousSections);
      showToast(apiErrorMessage(error, "Item order was not saved."), "error");
    }
  }

  function handleItemDragEnd(sectionId: string, event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const section = sections.find((current) => current.id === sectionId);

    if (!section) {
      return;
    }

    const oldIndex = section.items.findIndex((item) => item.id === active.id);
    const newIndex = section.items.findIndex((item) => item.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const previous = sections;
    const nextItems = arrayMove(section.items, oldIndex, newIndex).map((item, index) => ({
      ...item,
      sort_order: sortOrderForIndex(index),
    }));
    void persistItemOrder(sectionId, nextItems, previous);
  }

  function saveTitle() {
    const nextTitle = titleDraft.trim();

    if (nextTitle && nextTitle !== form.name) {
      void patchForm({ name: nextTitle });
    } else {
      setTitleDraft(form.name);
    }

    setTitleEditing(false);
  }

  return (
    <>
      <Toast onDismiss={() => setToast(null)} toast={toast} />
      <ConfirmDeleteModal confirm={confirm} onCancel={() => setConfirm(null)} onConfirm={() => void deleteConfirmed()} />
      {addItemSection ? (
        <AddItemModal
          onClose={() => setAddItemSection(null)}
          onPickType={(sectionId, type) => {
            setDraftItem({ sectionId, type });
            setAddItemSection(null);
            requestAnimationFrame(() => {
              document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            });
          }}
          section={addItemSection}
        />
      ) : null}

      <div className="space-y-5">
        <div className="relative border-b border-[var(--border)] pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <Link
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:text-[var(--primary-dark)]"
                href="/admin/forms"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back To Forms
              </Link>
              <div className="mt-2 min-w-0">
                {titleEditing ? (
                  <input
                    autoFocus
                    className="w-full min-w-0 border-0 bg-transparent text-3xl font-bold text-[var(--ink)] outline-none focus:ring-0"
                    onBlur={saveTitle}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }

                      if (event.key === "Escape") {
                        setTitleDraft(form.name);
                        setTitleEditing(false);
                      }
                    }}
                    value={titleDraft}
                  />
                ) : (
                  <button
                    className="block max-w-full truncate text-left text-3xl font-bold text-[var(--ink)] hover:text-[var(--primary)]"
                    onClick={() => setTitleEditing(true)}
                    type="button"
                  >
                    {form.name}
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-sm text-[var(--ink-muted)]">
                  <span className="font-bold text-[var(--danger)]">*</span> Indicate Required Fields
                </p>
                <FormStatusBadge form={form} />
                {formDocumentControl ? (
                  <>
                    <span className="rounded-md border border-[var(--border)] bg-white px-2 py-1 text-xs font-semibold text-[var(--ink)]">
                      DCN {formDocumentControl.dcn} v{formDocumentControl.version}
                    </span>
                    <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${approvalStatusClass(formDocumentControl.approval_status)}`}>
                      {formatApprovalStatus(formDocumentControl.approval_status)}
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
            </div>
            <div className="flex items-center gap-2">
              <Link
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                href={`/admin/forms/${form.id}/preview`}
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                Preview
              </Link>
              <div className="relative">
                <button
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                  onClick={() => setSettingsOpen((open) => !open)}
                  title="Form settings"
                  type="button"
                >
                  <Settings className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Form settings</span>
                </button>
                {settingsOpen ? (
                  <div className="absolute right-0 z-20 mt-2 w-56 rounded-md border border-[var(--border)] bg-white p-3 shadow-lg">
                    <label className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                      <input
                        checked={form.allow_duplicates}
                        className="h-4 w-4 accent-[var(--primary)]"
                        onChange={(event) => void patchForm({ allowDuplicates: event.target.checked })}
                        type="checkbox"
                      />
                      Allow Duplicates
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            <DndContext collisionDetection={closestCenter} id={`builder-sections-${form.id}`} onDragEnd={handleSectionDragEnd} sensors={sensors}>
              <SortableContext items={sections.map((section) => section.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-4">
                  {sections.length > 0 ? (
                    sections.map((section) => (
                      <SortableSectionCard
                        allItems={allItems}
                        availableLists={availableLists}
                        detailsOpen={detailsOpen}
                        draftType={draftItem?.sectionId === section.id ? draftItem.type : null}
                        key={section.id}
                        onAddItem={(targetSection) => {
                          setDraftItem(null);
                          setAddItemSection(targetSection);
                        }}
                        onCancelDraft={() => setDraftItem(null)}
                        onCommitDraft={async (sectionId, type, prompt) => {
                          const created = await createItem(sectionId, type, prompt);

                          if (created) {
                            setDraftItem(null);
                          }

                          return created;
                        }}
                        onDeleteItem={(item, sectionId) =>
                          setConfirm({
                            id: item.id,
                            kind: "item",
                            label: item.label,
                            sectionId,
                          })
                        }
                        onDeleteSection={(targetSection) =>
                          setConfirm({
                            id: targetSection.id,
                            kind: "section",
                            label: targetSection.title,
                          })
                        }
                        onDuplicateSection={(targetSection) => void duplicateSection(targetSection.id)}
                        onItemDragEnd={handleItemDragEnd}
                        onPatchItem={patchItem}
                        onPatchSection={patchSection}
                        onToggleDetails={(itemId) =>
                          setDetailsOpen((current) => {
                            const next = new Set(current);

                            if (next.has(itemId)) {
                              next.delete(itemId);
                            } else {
                              next.add(itemId);
                            }

                            return next;
                          })
                        }
                        onUploadPdfs={uploadItemPdfs}
                        section={section}
                      />
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-[var(--border)] bg-white p-6 text-center text-sm text-[var(--ink-muted)]">
                      No sections yet.
                    </div>
                  )}
                </div>
              </SortableContext>
            </DndContext>

            {addSectionOpen ? (
              <AddSectionComposer onCancel={() => setAddSectionOpen(false)} onCreate={addSection} />
            ) : (
              <button
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
                onClick={openSectionComposer}
                type="button"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Section
              </button>
            )}
          </div>

          <SectionsOutline
            formId={form.id}
            formName={form.name.toUpperCase()}
            onAddSection={openSectionComposer}
            onSectionDragEnd={handleSectionDragEnd}
            sections={sections}
          />
        </div>
      </div>
    </>
  );
}
