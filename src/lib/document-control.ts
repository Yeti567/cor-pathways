import type { FormFieldType } from "@/lib/form-templates";

export const documentTypeOptions = [
  { value: "form", label: "Form" },
  { value: "form_import", label: "Form Import" },
  { value: "resource", label: "Resource" },
  { value: "manual", label: "Manual" },
  { value: "policy", label: "Policy" },
  { value: "procedure", label: "Procedure" },
  { value: "signed_document", label: "Signed Document" },
  { value: "other", label: "Other" },
] as const;

export const documentApprovalStatusFilterOptions = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Needs revision" },
  { value: "revision", label: "Revision records" },
] as const;

export type DocumentType = (typeof documentTypeOptions)[number]["value"];
export type DocumentApprovalStatusFilter = (typeof documentApprovalStatusFilterOptions)[number]["value"];

export type BuilderField = {
  id: string;
  label: string;
  fieldType: FormFieldType;
  required: boolean;
  options?: string[];
  placeholder?: string;
  listId?: string | null;
};

export type DetectedFormField = {
  label: string;
  fieldType: FormFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  listId?: string | null;
};

export type ResourceSearchTextInput = {
  name: string;
  fileName?: string | null;
  dcn?: string | null;
  documentType?: string | null;
  revisionNotes?: string | null;
  bodyText?: string | null;
};

export type DocumentControlNumberInput = {
  companyPrefix?: string | null;
  documentType: string;
  includeRevision?: boolean;
  includeSourceCode?: boolean;
  includeYear?: boolean;
  revision?: string | null;
  sequence: number;
  sequencePadding?: number | null;
  sourceCode?: string | null;
  tenantSlug?: string | null;
  year?: number | null;
};

export type DocumentControlNumberSettings = {
  companyPrefix: string;
  includeRevision: boolean;
  includeSourceCode: boolean;
  includeYear: boolean;
  sequencePadding: number;
};

export type OrderedResource = {
  id?: string;
  name: string;
  sort_order?: number | null;
  updated_at?: string | null;
};

export type ResourceMoveDirection = "up" | "down";

const documentTypeValues = new Set<string>(documentTypeOptions.map((option) => option.value));
const documentApprovalStatusFilterValues = new Set<string>(documentApprovalStatusFilterOptions.map((option) => option.value));
const documentTypePrefixes: Record<string, string> = {
  form: "FRM",
  form_import: "FRM",
  manual: "MAN",
  other: "DOC",
  policy: "POL",
  procedure: "PRC",
  resource: "RES",
  signed_document: "SIG",
};
const defaultSequencePadding = 4;

export function coerceDocumentType(value: string): DocumentType {
  return documentTypeValues.has(value) ? (value as DocumentType) : "other";
}

export function coerceDocumentApprovalStatusFilter(value: string | undefined): DocumentApprovalStatusFilter {
  return value && documentApprovalStatusFilterValues.has(value) ? (value as DocumentApprovalStatusFilter) : "all";
}

export function formatDocumentType(value: string) {
  return documentTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export function getDocumentTypePrefix(value: string) {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return documentTypePrefixes[key] ?? (normalizeDcnSegment(value).slice(0, 3) || "DOC");
}

export function normalizeDcnSegment(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

export function normalizeDcnSequencePadding(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return defaultSequencePadding;
  }

  return Math.min(8, Math.max(3, Math.trunc(value ?? defaultSequencePadding)));
}

export function normalizeDcnRevision(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();

  if (!trimmed) {
    return "";
  }

  if (/^[0-9][0-9.]*$/.test(trimmed)) {
    const leadingNumber = Number.parseInt(trimmed, 10);

    if (Number.isFinite(leadingNumber) && leadingNumber >= 0) {
      return `REV-${String(leadingNumber).padStart(2, "0")}`;
    }
  }

  const segment = normalizeDcnSegment(trimmed);
  return segment ? `REV-${segment}` : "";
}

export function buildDocumentControlNumberSettings(input: {
  companyId?: string | null;
  dcnCompanyPrefix?: string | null;
  dcnIncludeRevision?: boolean | null;
  dcnIncludeSourceCode?: boolean | null;
  dcnIncludeYear?: boolean | null;
  dcnSequencePadding?: number | null;
  tenantSlug?: string | null;
}): DocumentControlNumberSettings {
  return {
    companyPrefix: normalizeDcnSegment(input.dcnCompanyPrefix ?? "") || normalizeDcnSegment(input.companyId ?? "") || normalizeDcnSegment(input.tenantSlug ?? "") || "TENANT",
    includeRevision: Boolean(input.dcnIncludeRevision),
    includeSourceCode: input.dcnIncludeSourceCode ?? true,
    includeYear: Boolean(input.dcnIncludeYear),
    sequencePadding: normalizeDcnSequencePadding(input.dcnSequencePadding),
  };
}

export function createDocumentControlNumber(input: DocumentControlNumberInput) {
  const settings = buildDocumentControlNumberSettings({
    dcnCompanyPrefix: input.companyPrefix,
    dcnIncludeRevision: input.includeRevision,
    dcnIncludeSourceCode: input.includeSourceCode,
    dcnIncludeYear: input.includeYear,
    dcnSequencePadding: input.sequencePadding,
    tenantSlug: input.tenantSlug,
  });
  const type = getDocumentTypePrefix(input.documentType);
  const source = settings.includeSourceCode ? normalizeDcnSegment(input.sourceCode ?? "") : "";
  const sequence = String(Math.max(1, input.sequence)).padStart(settings.sequencePadding, "0");
  const revision = settings.includeRevision ? normalizeDcnRevision(input.revision) : "";
  const year = settings.includeYear ? String(input.year ?? new Date().getFullYear()) : "";

  return [settings.companyPrefix, year, type, source, sequence, revision].filter(Boolean).join("-");
}

export function sanitizeStorageFilename(value: string) {
  const cleaned = value
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-\./g, ".")
    .replace(/^-+|-+$/g, "");

  return cleaned || "document";
}

export function normalizeKnowledgeSearchQuery(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function getKnowledgeSearchTerms(value: string) {
  return normalizeKnowledgeSearchQuery(value)
    .split(" ")
    .map((term) => term.replace(/[^\w-]+/g, "").trim())
    .filter((term) => term.length > 1)
    .slice(0, 8);
}

export function buildResourceSearchText(input: ResourceSearchTextInput) {
  return [
    input.name,
    input.fileName,
    input.dcn,
    input.documentType ? formatDocumentType(input.documentType) : null,
    input.documentType,
    input.revisionNotes,
    input.bodyText,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
}

export function compareResourceOrder(left: OrderedResource, right: OrderedResource) {
  const leftOrder = typeof left.sort_order === "number" ? left.sort_order : 0;
  const rightOrder = typeof right.sort_order === "number" ? right.sort_order : 0;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const nameCompare = left.name.localeCompare(right.name);

  if (nameCompare !== 0) {
    return nameCompare;
  }

  return (right.updated_at ?? "").localeCompare(left.updated_at ?? "");
}

export function nextResourceSortOrder(resources: OrderedResource[]) {
  if (resources.length === 0) {
    return 100;
  }

  return Math.max(...resources.map((resource) => (typeof resource.sort_order === "number" ? resource.sort_order : 0))) + 100;
}

export function coerceResourceMoveDirection(value: string): ResourceMoveDirection | null {
  return value === "up" || value === "down" ? value : null;
}

export function getResourceReorderUpdates(
  resources: Array<OrderedResource & { id: string }>,
  currentId: string,
  direction: ResourceMoveDirection,
  step = 100,
) {
  const orderedResources = [...resources].sort(compareResourceOrder);
  const currentIndex = orderedResources.findIndex((resource) => resource.id === currentId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= orderedResources.length) {
    return [];
  }

  const reorderedResources = [...orderedResources];
  const [currentResource] = reorderedResources.splice(currentIndex, 1);
  reorderedResources.splice(targetIndex, 0, currentResource);

  return reorderedResources.map((resource, index) => ({
    id: resource.id,
    sort_order: (index + 1) * step,
  }));
}

function normalizedDetectedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function detectedFieldId(index: number, label: string) {
  const slug = normalizedDetectedKey(label).replace(/\s+/g, "-").slice(0, 40) || "field";

  return `import-${index + 1}-${slug}`;
}

function isRequiredDetectedLabel(value: string) {
  return /\*|\(\s*required\s*\)/i.test(value);
}

function cleanDetectedLabel(value: string) {
  return value
    .replace(/^[\s\d.)\-[\]]+/, "")
    .replace(/\(\s*required\s*\)/gi, "")
    .replace(/\*/g, "")
    .replace(/_{2,}.*/, "")
    .replace(/\s*\[[\s_]*\]\s*$/g, "")
    .replace(/[.:?_]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function inferDetectedFieldType(label: string): FormFieldType {
  const normalized = label.toLowerCase();

  if (/\bequipment|unit|vehicle|truck|trailer|machine|serial\b/.test(normalized)) {
    return "equipment_select";
  }

  if (/\bmultiple workers|workers\b/.test(normalized)) {
    return "workers_select";
  }

  if (/\b(worker|employee|crew member)\s+name\b/.test(normalized)) {
    return "short_text";
  }

  if (/\bworker|employee|crew member\b/.test(normalized)) {
    return "worker_select";
  }

  if (/\bsignature|signed by|sign off|sign here\b/.test(normalized)) {
    return "signature";
  }

  if (/\bphoto|picture|image|attach|attachment|upload\b/.test(normalized)) {
    return "photo";
  }

  if (/\bdate|dob|birth date\b/.test(normalized)) {
    return "date";
  }

  if (/\btime\b/.test(normalized)) {
    return "time";
  }

  if (/\bpass\b.*\bfail\b/.test(normalized)) {
    return "pass_fail_na";
  }

  if (/\byes\s*\/\s*no\b|\byes\b.*\bno\b/.test(normalized)) {
    return "yes_no_na";
  }

  if (/\bselect|choose|dropdown|drop down\b/.test(normalized)) {
    return "dropdown_select_one";
  }

  if (/\bnumber|qty|quantity|amount|total|count|#|hours?\b/.test(normalized)) {
    return "number";
  }

  if (/\bnotes?|comments?|description|details?|describe|explain|observations?\b/.test(normalized)) {
    return "long_text";
  }

  return "short_text";
}

function inferDetectedPlaceholder(label: string) {
  const normalized = label.toLowerCase();

  if (/\bemail\b/.test(normalized)) {
    return "email";
  }

  if (/\bphone|tel\b/.test(normalized)) {
    return "tel";
  }

  return "";
}

function checkboxOptionFromLine(value: string) {
  const match = value.match(/^(?:\[\s*\]|\(\s*\)|☐|□|- \[\s*\])\s*(.+)$/);

  return match ? cleanDetectedLabel(match[1]) : "";
}

function slashOptionsFromLine(value: string) {
  const normalized = value
    .replace(/\bor\b/gi, "/")
    .replace(/[()]/g, "")
    .trim();

  if (!normalized.includes("/")) {
    return [];
  }

  const options = normalized
    .split(/\s*\/\s*/)
    .map(cleanDetectedLabel)
    .filter((option) => option.length > 0 && option.length <= 30);

  if (options.length < 2 || options.length > 5) {
    return [];
  }

  if (options.some((option) => /\s{2,}/.test(option) || option.split(/\s+/).length > 3)) {
    return [];
  }

  return Array.from(new Set(options));
}

function choiceTypeForOptions(options: string[]): FormFieldType {
  const key = options.map((option) => option.toLowerCase()).join("|");

  if (key === "pass|fail" || key === "pass|fail|n/a" || key === "pass|fail|na") {
    return "pass_fail_na";
  }

  if (key === "yes|no" || key === "yes|no|n/a" || key === "yes|no|na") {
    return "yes_no_na";
  }

  return "dropdown_select_one";
}

function isLikelyHeading(label: string) {
  if (label.length < 4 || inferDetectedFieldType(label) !== "short_text") {
    return false;
  }

  const letters = label.replace(/[^A-Za-z]/g, "");

  return letters.length >= 4 && label === label.toUpperCase() && label.split(/\s+/).length <= 6;
}

function collectCheckboxOptions(lines: string[], startIndex: number) {
  const options: string[] = [];
  let nextIndex = startIndex;

  while (nextIndex < lines.length) {
    const option = checkboxOptionFromLine(lines[nextIndex]);

    if (!option) {
      break;
    }

    options.push(option);
    nextIndex += 1;
  }

  return { nextIndex, options };
}

function createBuilderField(input: {
  index: number;
  label: string;
  options?: string[];
  required: boolean;
  type?: FormFieldType;
}): BuilderField | null {
  const label = cleanDetectedLabel(input.label);

  if (label.length < 3 || /^page\s+\d+/i.test(label) || isLikelyHeading(label)) {
    return null;
  }

  const options = input.options?.map(cleanDetectedLabel).filter((option) => option.length > 0);
  const fieldType = input.type ?? (options && options.length >= 2 ? choiceTypeForOptions(options) : inferDetectedFieldType(label));
  const placeholder = inferDetectedPlaceholder(label);

  return {
    id: detectedFieldId(input.index, label),
    label,
    fieldType,
    required: input.required,
    ...(options && options.length >= 2 ? { options } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
}

export function parseDetectedTextToFields(detectedText: string): BuilderField[] {
  const seen = new Set<string>();
  const lines = detectedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fields: BuilderField[] = [];

  for (let index = 0; index < lines.length && fields.length < 80; index += 1) {
    const rawLine = lines[index];
    const checkboxOption = checkboxOptionFromLine(rawLine);

    if (checkboxOption) {
      const group = collectCheckboxOptions(lines, index);
      const label = group.options.length === 1 ? group.options[0] : "Checklist";
      const field = createBuilderField({
        index: fields.length,
        label,
        options: group.options.length >= 2 ? group.options : undefined,
        required: isRequiredDetectedLabel(rawLine),
        type: "checkbox",
      });

      index = Math.max(index, group.nextIndex - 1);

      if (!field) {
        continue;
      }

      const key = `${normalizedDetectedKey(field.label)}:${field.fieldType}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      fields.push(field);
      continue;
    }

    const required = isRequiredDetectedLabel(rawLine);
    const colonChoiceMatch = rawLine.match(/^(.+?)[:\-]\s*(.+)$/);
    const inlineOptions = colonChoiceMatch ? slashOptionsFromLine(colonChoiceMatch[2]) : slashOptionsFromLine(rawLine);
    const checkboxLookahead = collectCheckboxOptions(lines, index + 1);
    const slashLookaheadOptions = /[:?]$/.test(rawLine) ? slashOptionsFromLine(lines[index + 1] ?? "") : [];
    const lookaheadChoices =
      checkboxLookahead.options.length >= 2
        ? checkboxLookahead
        : slashLookaheadOptions.length >= 2
          ? { nextIndex: index + 2, options: slashLookaheadOptions }
          : { nextIndex: index + 1, options: [] };
    const label = colonChoiceMatch && inlineOptions.length >= 2 ? colonChoiceMatch[1] : rawLine;
    const options = inlineOptions.length >= 2 ? inlineOptions : lookaheadChoices.options;
    const field = createBuilderField({
      index: fields.length,
      label,
      options: options.length >= 2 ? options : undefined,
      required,
    });

    if (lookaheadChoices.options.length >= 2 && inlineOptions.length === 0) {
      index = lookaheadChoices.nextIndex - 1;
    }

    if (!field) {
      continue;
    }

    const key = `${normalizedDetectedKey(field.label)}:${field.fieldType}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    fields.push(field);
  }

  return fields;
}

export function parseDetectedFormFields(text: string): DetectedFormField[] {
  return parseDetectedTextToFields(text).map((field) => ({
    fieldType: field.fieldType,
    label: field.label,
    ...(field.options ? { options: field.options } : {}),
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.required ? { required: true } : {}),
  }));
}
