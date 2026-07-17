import type { Json } from "@/types/database";

export const formStatusOptions = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] as const;

export const formFieldTypeOptions = [
  { value: "pass_fail_na", label: "Pass / Fail / NA" },
  { value: "checkbox", label: "Check Box" },
  { value: "short_text", label: "Short Answer" },
  { value: "long_text", label: "Long Answer" },
  { value: "text_info", label: "Text Info Block" },
  { value: "dropdown_select_one", label: "Drop-down List: Select One" },
  { value: "dropdown_select_multiple", label: "Drop-down List: Select Multiple" },
  { value: "yes_no_na", label: "Yes / No / NA" },
  { value: "pass_fail_total", label: "Pass / Fail Total" },
  { value: "number", label: "Number Only" },
  { value: "date", label: "Select Date" },
  { value: "time", label: "Select Time" },
  { value: "equipment_select", label: "Select Equipment" },
  { value: "worker_select", label: "Select Worker" },
  { value: "workers_select", label: "Select Multiple Workers" },
  { value: "signature", label: "Signature" },
  { value: "photo", label: "Take Photo" },
  { value: "image_view", label: "View Image" },
  { value: "gps_coordinates", label: "Add GPS Coordinates" },
  { value: "pdf_insert", label: "Insert PDFs" },
  { value: "pdf_view", label: "View PDF" },
] as const;

export const formBuilderItemTypeOptions = [
  { value: "pass_fail_na", label: "Pass / Fail / NA" },
  { value: "checkbox", label: "Check Box" },
  { value: "short_text", label: "Short Answer" },
  { value: "long_text", label: "Long Answer" },
  { value: "text_info", label: "Text Info Block" },
  { value: "dropdown_select_one", label: "Drop-down List: Select One" },
  { value: "dropdown_select_multiple", label: "Drop-down List: Select Multiple" },
  { value: "yes_no_na", label: "Yes/No/NA" },
  { value: "pass_fail_total", label: "Pass/Fail Total" },
  { value: "number", label: "Number Only" },
  { value: "date", label: "Select Date" },
  { value: "time", label: "Select Time" },
  { value: "worker_select", label: "Select Worker" },
  { value: "workers_select", label: "Select Multiple Workers" },
  { value: "photo", label: "Take Photo" },
  { value: "signature", label: "Signature" },
  { value: "image_view", label: "View Image" },
  { value: "gps_coordinates", label: "Add GPS Coordinates" },
  { value: "pdf_insert", label: "Insert PDFs" },
  { value: "pdf_view", label: "View PDF" },
] as const;

export const formItemVisibilityOptions = [
  { value: "worker", label: "Visible to workers" },
  { value: "admin_only", label: "Admin only" },
] as const;

export const workerPickerScopeOptions = [
  { value: "all_active", label: "All active workers" },
  { value: "current_worker", label: "Current worker only" },
] as const;

export const equipmentPickerScopeOptions = [
  { value: "reachable", label: "All reachable equipment" },
  { value: "assigned_to_worker", label: "Assigned to current worker" },
  { value: "current_location", label: "Selected form location" },
] as const;

export type FormTemplateStatus = (typeof formStatusOptions)[number]["value"];
export type FormFieldType = (typeof formFieldTypeOptions)[number]["value"];
export type FormBuilderItemType = (typeof formBuilderItemTypeOptions)[number]["value"];
export type FormItemVisibility = (typeof formItemVisibilityOptions)[number]["value"];
export type WorkerPickerScope = (typeof workerPickerScopeOptions)[number]["value"];
export type EquipmentPickerScope = (typeof equipmentPickerScopeOptions)[number]["value"];
export type FormBuilderMoveDirection = "up" | "down";

const formStatusValues = new Set<string>(formStatusOptions.map((option) => option.value));
const formFieldTypeValues = new Set<string>(formFieldTypeOptions.map((option) => option.value));
const formBuilderItemTypeValues = new Set<string>(formBuilderItemTypeOptions.map((option) => option.value));
const formItemVisibilityValues = new Set<string>(formItemVisibilityOptions.map((option) => option.value));
const workerPickerScopeValues = new Set<string>(workerPickerScopeOptions.map((option) => option.value));
const equipmentPickerScopeValues = new Set<string>(equipmentPickerScopeOptions.map((option) => option.value));
const managedListFieldTypes = new Set<FormFieldType>(["checkbox", "dropdown_select_multiple", "dropdown_select_one"]);
const legacyFormFieldTypes: Record<string, FormFieldType> = {
  multi_select: "dropdown_select_multiple",
  single_select: "dropdown_select_one",
  yes_no: "yes_no_na",
};

function isRecord(value: Json): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeFormCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function resolveFormCode(inputCode: string, name: string) {
  return normalizeFormCode(inputCode) || normalizeFormCode(name);
}

export function duplicateFormBuilderName(value: string) {
  const name = value.trim() || "Untitled";

  return `${name} (copy)`;
}

export function nextFormBuilderSortOrder(rows: Array<{ sort_order?: number | null }>, step = 100) {
  const maxSortOrder = rows.reduce((max, row) => {
    const sortOrder = typeof row.sort_order === "number" && Number.isFinite(row.sort_order) ? row.sort_order : 0;

    return Math.max(max, sortOrder);
  }, 0);

  return maxSortOrder + step;
}

export function coerceFormBuilderMoveDirection(value: string): FormBuilderMoveDirection | null {
  return value === "up" || value === "down" ? value : null;
}

export function getFormBuilderReorderUpdates(
  rows: Array<{ id: string }>,
  currentId: string,
  direction: FormBuilderMoveDirection,
  step = 100,
) {
  const currentIndex = rows.findIndex((row) => row.id === currentId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= rows.length) {
    return [];
  }

  const reorderedRows = [...rows];
  const [currentRow] = reorderedRows.splice(currentIndex, 1);
  reorderedRows.splice(targetIndex, 0, currentRow);

  return reorderedRows.map((row, index) => ({
    id: row.id,
    sort_order: (index + 1) * step,
  }));
}

export function coerceFormStatus(value: string): FormTemplateStatus {
  return formStatusValues.has(value) ? (value as FormTemplateStatus) : "draft";
}

export function formatFormStatus(value: string) {
  return formStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function coerceFormFieldType(value: string): FormFieldType {
  if (formFieldTypeValues.has(value)) {
    return value as FormFieldType;
  }

  return legacyFormFieldTypes[value] ?? "short_text";
}

export function isFormBuilderItemType(value: string): value is FormBuilderItemType {
  return formBuilderItemTypeValues.has(value);
}

export function coerceFormItemVisibility(value: string): FormItemVisibility {
  return formItemVisibilityValues.has(value) ? (value as FormItemVisibility) : "worker";
}

export function coerceWorkerPickerScope(value: string): WorkerPickerScope {
  return workerPickerScopeValues.has(value) ? (value as WorkerPickerScope) : "all_active";
}

export function coerceEquipmentPickerScope(value: string): EquipmentPickerScope {
  return equipmentPickerScopeValues.has(value) ? (value as EquipmentPickerScope) : "reachable";
}

export function formatFormFieldType(value: string) {
  const normalized = legacyFormFieldTypes[value] ?? value;
  return formFieldTypeOptions.find((option) => option.value === normalized)?.label ?? value;
}

export function formFieldTypeSupportsManagedList(value: string) {
  return managedListFieldTypes.has(coerceFormFieldType(value));
}

export function getFormItemSettingString(settings: Json, key: string) {
  if (!isRecord(settings)) {
    return "";
  }

  const value = settings[key];
  return typeof value === "string" ? value : "";
}

export function isFormItemAdminOnly(settings: Json) {
  return getFormItemSettingString(settings, "visibility") === "admin_only";
}

export function isFormItemUsedAsLabel(settings: Json) {
  return isRecord(settings) && settings.useAsLabel === true;
}

export function buildFormItemLabelSettings(settings: Json, useAsLabel: boolean) {
  const nextSettings: Record<string, Json | undefined> = isRecord(settings) ? { ...settings } : {};

  if (useAsLabel) {
    nextSettings.useAsLabel = true;
  } else {
    delete nextSettings.useAsLabel;
  }

  return nextSettings;
}

export function buildFormItemSettings(
  baseSettings: Json,
  input: {
    equipmentPickerScope?: string;
    sourceLabel?: string;
    sourceUrl?: string;
    visibility?: string;
    workerPickerScope?: string;
  },
) {
  const settings: Record<string, Json | undefined> = isRecord(baseSettings) ? { ...baseSettings } : {};
  const sourceUrl = input.sourceUrl?.trim() ?? "";
  const sourceLabel = input.sourceLabel?.trim() ?? "";
  const visibility = coerceFormItemVisibility(input.visibility ?? "");
  const workerPickerScope = coerceWorkerPickerScope(input.workerPickerScope ?? "");
  const equipmentPickerScope = coerceEquipmentPickerScope(input.equipmentPickerScope ?? "");

  if (sourceUrl) {
    settings.sourceUrl = sourceUrl;
  } else {
    delete settings.sourceUrl;
    delete settings.url;
  }

  if (sourceLabel) {
    settings.sourceLabel = sourceLabel;
  } else {
    delete settings.sourceLabel;
  }

  if (visibility === "admin_only") {
    settings.visibility = visibility;
  } else {
    delete settings.visibility;
  }

  if (workerPickerScope !== "all_active") {
    settings.workerPickerScope = workerPickerScope;
  } else {
    delete settings.workerPickerScope;
  }

  if (equipmentPickerScope !== "reachable") {
    settings.equipmentPickerScope = equipmentPickerScope;
  } else {
    delete settings.equipmentPickerScope;
  }

  return settings;
}
