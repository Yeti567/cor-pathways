import type { Database, Json } from "@/types/database";

export type FormRow = Database["public"]["Tables"]["forms"]["Row"];
export type FormSectionRow = Database["public"]["Tables"]["form_sections"]["Row"];
export type FormItemRow = Database["public"]["Tables"]["form_items"]["Row"];

export type OfflineFormItem = {
  id: string;
  label: string;
  fieldType: string;
  helperText: string | null;
  required: boolean;
  flaggable: boolean;
  settings: Json;
  sortOrder: number;
};

export type OfflineFormSection = {
  id: string;
  title: string;
  sortOrder: number;
  collapsible: boolean;
  repeatable: boolean;
  items: OfflineFormItem[];
};

export type OfflineFormSummary = {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  status: string;
  sections: OfflineFormSection[];
  updatedAt: string;
};

export type OfflineFormSummarySourceSection = Pick<
  FormSectionRow,
  "collapsible" | "form_id" | "id" | "repeatable" | "sort_order" | "title"
>;
export type OfflineFormSummarySourceItem = Pick<
  FormItemRow,
  "field_type" | "flaggable" | "form_id" | "helper_text" | "id" | "label" | "required" | "section_id" | "settings" | "sort_order"
>;

function isRecord(value: Json): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toOfflineFormItem(
  item: Pick<
    FormItemRow,
    "id" | "label" | "field_type" | "helper_text" | "required" | "flaggable" | "settings" | "sort_order"
  >,
): OfflineFormItem {
  return {
    id: item.id,
    label: item.label,
    fieldType: item.field_type,
    helperText: item.helper_text,
    required: item.required,
    flaggable: item.flaggable,
    settings: item.settings,
    sortOrder: item.sort_order,
  };
}

export function toOfflineFormSection(
  section: Pick<FormSectionRow, "id" | "title" | "sort_order" | "collapsible" | "repeatable">,
  items: OfflineFormItem[] = [],
): OfflineFormSection {
  return {
    id: section.id,
    title: section.title,
    sortOrder: section.sort_order,
    collapsible: section.collapsible,
    repeatable: section.repeatable,
    items: [...items].sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label)),
  };
}

export function toOfflineFormSummary(
  form: Pick<FormRow, "id" | "tenant_id" | "name" | "code" | "description" | "status" | "updated_at">,
  sections: OfflineFormSection[] = [],
): OfflineFormSummary {
  return {
    id: form.id,
    tenantId: form.tenant_id,
    name: form.name,
    code: form.code,
    description: form.description,
    status: form.status,
    sections: [...sections].sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title)),
    updatedAt: form.updated_at ?? form.id,
  };
}

export function buildOfflineFormSummary(
  form: Pick<FormRow, "id" | "tenant_id" | "name" | "code" | "description" | "status" | "updated_at">,
  sections: OfflineFormSummarySourceSection[],
  items: OfflineFormSummarySourceItem[],
) {
  const itemsBySection = new Map<string, OfflineFormItem[]>();

  for (const item of items) {
    if (item.form_id !== form.id) {
      continue;
    }

    const sectionItems = itemsBySection.get(item.section_id) ?? [];
    sectionItems.push(toOfflineFormItem(item));
    itemsBySection.set(item.section_id, sectionItems);
  }

  return toOfflineFormSummary(
    form,
    sections
      .filter((section) => section.form_id === form.id)
      .map((section) => toOfflineFormSection(section, itemsBySection.get(section.id) ?? [])),
  );
}

export function getOfflineFieldOptions(item: OfflineFormItem) {
  if (!isRecord(item.settings) || !Array.isArray(item.settings.options)) {
    return [];
  }

  return item.settings.options.filter((option): option is string => typeof option === "string" && option.trim().length > 0);
}
