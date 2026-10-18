// Browser-safe half of the AI Form Converter: limits, types, plain labels, storage paths and the
// checks on a converted form. The reader itself is in form-converter.ts, which is server only.

import { sanitizeStorageFilename } from "@/lib/document-control";
import { answerChoicesForField } from "@/lib/form-logic";

export const CONVERTER_MAX_FILES = 10;
export const CONVERTER_MAX_PDF_PAGES = 20;
export const CONVERTER_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CONVERTER_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
] as const;

const MAX_SECTIONS = 40;
const MAX_FIELDS = 400;
const MAX_OPTIONS = 60;
const MAX_LABEL = 200;
const MAX_HELP = 500;
const MAX_BODY = 4000;
const MAX_NOTES = 12;

/** The field types the converter may use. The rest need uploaded files or other setup first. */
export const CONVERTER_FIELD_TYPES = [
  "pass_fail_na",
  "yes_no_na",
  "checkbox",
  "short_text",
  "long_text",
  "text_info",
  "dropdown_select_one",
  "dropdown_select_multiple",
  "number",
  "date",
  "time",
  "worker_select",
  "workers_select",
  "equipment_select",
  "photo",
  "signature",
  "gps_coordinates",
] as const;

export type ConverterFieldType = (typeof CONVERTER_FIELD_TYPES)[number];

/** Plain names for the review screen. Clients do not know the builder's names. */
export const CONVERTER_FIELD_TYPE_LABELS: Record<ConverterFieldType, string> = {
  checkbox: "Tick box",
  date: "Date",
  dropdown_select_multiple: "Pick several",
  dropdown_select_one: "Pick one",
  equipment_select: "Pick a unit",
  gps_coordinates: "GPS location",
  long_text: "Long answer",
  number: "Number",
  pass_fail_na: "Pass / Fail / N/A",
  photo: "Photo",
  short_text: "Short answer",
  signature: "Signature",
  text_info: "Instructions (no answer)",
  time: "Time",
  worker_select: "Pick a person",
  workers_select: "Pick several people",
  yes_no_na: "Yes / No / N/A",
};

const converterTypeSet = new Set<string>(CONVERTER_FIELD_TYPES);

export type ConvertedRule = { anyOf: string[]; ref: string };

export type ConvertedField = {
  /** Only shown to office staff (an "office use only" box). */
  adminOnly: boolean;
  /** Instruction text, for text_info only. */
  body: string;
  fieldType: ConverterFieldType;
  help: string;
  label: string;
  options: string[];
  /** Short id, unique in the form, that rules use to name this field. */
  ref: string;
  required: boolean;
  showWhen: ConvertedRule | null;
};

export type ConvertedSection = {
  fields: ConvertedField[];
  repeatable: boolean;
  title: string;
};

export type ConvertedForm = {
  name: string;
  notes: string[];
  sections: ConvertedSection[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanLabel(value: unknown) {
  return cleanText(value, MAX_LABEL).replace(/[\s:_.-]+$/, "").trim();
}

const typeAliases: Record<string, ConverterFieldType> = {
  checkbox_group: "checkbox",
  dropdown: "dropdown_select_one",
  gps: "gps_coordinates",
  info: "text_info",
  instructions: "text_info",
  multi_select: "dropdown_select_multiple",
  pass_fail: "pass_fail_na",
  select: "dropdown_select_one",
  single_select: "dropdown_select_one",
  text: "short_text",
  textarea: "long_text",
  yes_no: "yes_no_na",
};

function coerceConverterType(value: unknown): ConverterFieldType | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";

  if (converterTypeSet.has(raw)) {
    return raw as ConverterFieldType;
  }

  return typeAliases[raw] ?? null;
}

/** Pulls the JSON object out of a model reply. Null when there is none. */
export function parseConverterOutput(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Turns whatever came back (from the model, or from the browser on save) into a form we can
 * build. Never throws; what it cannot use it drops and names in notes.
 */
export function sanitizeConvertedForm(raw: unknown): ConvertedForm {
  const record = isRecord(raw) ? raw : {};
  const notes = (Array.isArray(record.notes) ? record.notes : [])
    .map((note) => cleanText(note, 300))
    .filter(Boolean)
    .slice(0, MAX_NOTES);
  const dropped: string[] = [];
  const usedRefs = new Set<string>();
  let fieldCount = 0;
  let refCounter = 0;

  const sections: ConvertedSection[] = [];

  for (const rawSection of (Array.isArray(record.sections) ? record.sections : []).slice(0, MAX_SECTIONS)) {
    if (!isRecord(rawSection)) {
      continue;
    }

    const fields: ConvertedField[] = [];

    for (const rawField of Array.isArray(rawSection.fields) ? rawSection.fields : []) {
      if (!isRecord(rawField) || fieldCount >= MAX_FIELDS) {
        continue;
      }

      const label = cleanLabel(rawField.label);
      let fieldType = coerceConverterType(rawField.type ?? rawField.fieldType);

      if (!label) {
        continue;
      }

      if (!fieldType) {
        dropped.push(`"${label}" had a field type we do not have, so it is a short answer. Check it.`);
        fieldType = "short_text";
      }

      const options = Array.from(
        new Set(
          (Array.isArray(rawField.options) ? rawField.options : [])
            .map((option) => cleanText(option, 120))
            .filter(Boolean),
        ),
      ).slice(0, MAX_OPTIONS);

      if ((fieldType === "dropdown_select_one" || fieldType === "dropdown_select_multiple") && options.length === 0) {
        dropped.push(`"${label}" was a list with no choices, so it is a short answer.`);
        fieldType = "short_text";
      }

      let ref = cleanText(rawField.ref, 40).replace(/[^\w-]/g, "");

      while (!ref || usedRefs.has(ref)) {
        refCounter += 1;
        ref = `f${refCounter}`;
      }

      usedRefs.add(ref);
      fieldCount += 1;

      const usesOptions = fieldType === "checkbox" || fieldType.startsWith("dropdown_");
      const rawRule = isRecord(rawField.showWhen) ? rawField.showWhen : null;

      fields.push({
        adminOnly: rawField.adminOnly === true,
        body: fieldType === "text_info" ? (typeof rawField.body === "string" ? rawField.body.trim().slice(0, MAX_BODY) : "") : "",
        fieldType,
        help: cleanText(rawField.help ?? rawField.helperText, MAX_HELP),
        label,
        options: usesOptions ? options : [],
        ref,
        required: fieldType === "text_info" ? false : rawField.required === true,
        showWhen:
          rawRule && typeof rawRule.ref === "string"
            ? {
                anyOf: (Array.isArray(rawRule.anyOf) ? rawRule.anyOf : [])
                  .map((answer) => cleanText(answer, 120))
                  .filter(Boolean),
                ref: rawRule.ref.trim(),
              }
            : null,
      });
    }

    if (fields.length === 0) {
      continue;
    }

    sections.push({
      fields,
      repeatable: rawSection.repeatable === true,
      title: cleanText(rawSection.title, MAX_LABEL) || `Section ${sections.length + 1}`,
    });
  }

  if (fieldCount >= MAX_FIELDS) {
    dropped.push(`The form was cut at ${MAX_FIELDS} questions. Split a form this long into two.`);
  }

  // Rules last, once every ref is known. A rule must name another field that can decide it,
  // with answers that field can actually give.
  const byRef = new Map(sections.flatMap((section) => section.fields).map((field) => [field.ref, field]));

  for (const field of byRef.values()) {
    if (!field.showWhen) {
      continue;
    }

    const controller = byRef.get(field.showWhen.ref);
    const choices = controller && controller.ref !== field.ref
      ? answerChoicesForField(controller.fieldType, { options: controller.options })
      : [];
    const anyOf = field.showWhen.anyOf
      .map((answer) => choices.find((choice) => choice.value.toLowerCase() === answer.toLowerCase() || choice.label.toLowerCase() === answer.toLowerCase())?.value)
      .filter((answer): answer is string => Boolean(answer));

    if (anyOf.length === 0) {
      dropped.push(`"${field.label}" had a show-when rule that did not fit, so it always shows.`);
      field.showWhen = null;
    } else {
      field.showWhen = { anyOf: Array.from(new Set(anyOf)), ref: field.showWhen.ref };
    }
  }

  return {
    name: cleanText(record.name, 120) || "New form",
    notes: [...notes, ...dropped].slice(0, MAX_NOTES + 6),
    sections,
  };
}

export function countConvertedFields(form: ConvertedForm) {
  return form.sections.reduce((count, section) => count + section.fields.length, 0);
}

/** Where converter uploads wait. They are deleted as soon as they have been read. */
export function converterStoragePrefix(input: { batchId: string; tenantId: string }) {
  return `${input.tenantId}/form-import/${input.batchId}/`;
}

export function buildConverterStoragePath(input: { batchId: string; fileName: string; index: number; tenantId: string }) {
  return `${converterStoragePrefix(input)}${input.index}-${sanitizeStorageFilename(input.fileName)}`;
}

export type UploadedConverterFile = { name: string; path: string; size: number; type: string };

/** Keeps only paths inside this company's folder for this batch, with a plain file name. */
export function validateConverterUploads(
  files: readonly UploadedConverterFile[],
  location: { batchId: string; tenantId: string },
): { accepted: UploadedConverterFile[]; error: string | null } {
  const prefix = converterStoragePrefix(location);

  if (files.length === 0) {
    return { accepted: [], error: null };
  }

  if (files.length > CONVERTER_MAX_FILES) {
    return { accepted: [], error: `Add up to ${CONVERTER_MAX_FILES} files at a time.` };
  }

  for (const file of files) {
    const path = typeof file.path === "string" ? file.path : "";
    const rest = path.startsWith(prefix) ? path.slice(prefix.length) : "";

    if (!rest || !/^[\w.-]+$/.test(rest) || /^\.+$/.test(rest)) {
      return { accepted: [], error: "A file was not uploaded to this company's folder. Try again." };
    }

    if (!(CONVERTER_FILE_TYPES as readonly string[]).includes(file.type)) {
      return { accepted: [], error: `${file.name || "A file"} is not a PDF, photo, Excel sheet or text file.` };
    }

    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > CONVERTER_MAX_FILE_BYTES) {
      return { accepted: [], error: `${file.name || "A file"} is empty or larger than 10 MB.` };
    }
  }

  return { accepted: [...files], error: null };
}
