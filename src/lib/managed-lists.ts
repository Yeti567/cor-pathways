import type { Json } from "@/types/database";

export type ManagedListSummary = {
  id: string;
  include_other: boolean;
  name: string;
};

export type ManagedListItemSummary = {
  active: boolean;
  id?: string;
  label: string;
  parent_id?: string | null;
  sort_order: number;
};

export type ManagedListTreeItem = ManagedListItemSummary & {
  children: ManagedListTreeItem[];
  id: string;
  parent_id: string | null;
};

export type FormListFlatOption = {
  depth: number;
  id: string;
  label: string;
};

function isRecord(value: Json): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeManagedListName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

export function normalizeManagedListItemLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 200);
}

export function getManualOptionLabels(value: string) {
  return value
    .split(/\r?\n/)
    .map((option) => option.trim())
    .filter(Boolean);
}

export function getManagedListIdFromSettings(settings: Json) {
  if (!isRecord(settings)) {
    return null;
  }

  const value = settings.list_id ?? settings.listId;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function getManagedListNameFromSettings(settings: Json) {
  if (!isRecord(settings) || typeof settings.list_name !== "string") {
    return null;
  }

  return settings.list_name;
}

export function buildManagedListOptions(items: ManagedListItemSummary[], includeOther: boolean) {
  const itemsWithIds = items.filter(
    (item): item is ManagedListItemSummary & { id: string; parent_id?: string | null } =>
      typeof item.id === "string" && item.id.trim().length > 0,
  );
  const labels =
    itemsWithIds.length === items.length && itemsWithIds.length > 0
      ? flattenManagedListOptions(buildManagedListTree(itemsWithIds), includeOther)
          .filter((option) => option.id !== "__other__")
          .map((option) => option.label)
      : items
          .filter((item) => item.active)
          .sort((left, right) => left.sort_order - right.sort_order || left.label.localeCompare(right.label))
          .map((item) => item.label.trim())
          .filter(Boolean);

  return includeOther ? [...labels, "Other"] : labels;
}

export function buildManagedListTree(items: Array<ManagedListItemSummary & { id: string; parent_id?: string | null }>) {
  const nodeById = new Map<string, ManagedListTreeItem>();
  const roots: ManagedListTreeItem[] = [];

  for (const item of items) {
    if (!item.active) {
      continue;
    }

    nodeById.set(item.id, {
      active: item.active,
      children: [],
      id: item.id,
      label: item.label,
      parent_id: item.parent_id ?? null,
      sort_order: item.sort_order,
    });
  }

  for (const node of nodeById.values()) {
    if (node.parent_id && nodeById.has(node.parent_id)) {
      nodeById.get(node.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: ManagedListTreeItem[]) => {
    nodes.sort((left, right) => left.sort_order - right.sort_order || left.label.localeCompare(right.label));
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);

  return roots;
}

export function flattenManagedListOptions(tree: ManagedListTreeItem[], includeOther: boolean): FormListFlatOption[] {
  const options: FormListFlatOption[] = [];

  const visit = (items: ManagedListTreeItem[], depth: number) => {
    for (const item of items) {
      // Indent nested options with spaces to show hierarchy.
      const prefix = depth > 0 ? "  ".repeat(depth) : "";
      options.push({
        depth,
        id: item.id,
        label: `${prefix}${item.label}`,
      });
      visit(item.children, depth + 1);
    }
  };

  visit(tree, 0);

  if (includeOther) {
    options.push({ depth: 0, id: "__other__", label: "Other" });
  }

  return options;
}

export function resolveManagedListSettings(settings: Json, list: ManagedListSummary, items: ManagedListItemSummary[]): Json {
  const nextSettings: Record<string, Json | undefined> = isRecord(settings) ? { ...settings } : {};

  nextSettings.list_id = list.id;
  nextSettings.list_name = list.name;
  nextSettings.include_other = list.include_other;
  nextSettings.options = buildManagedListOptions(items, list.include_other);

  return nextSettings;
}

export function buildManualChoiceSettings(options: string[]): Json {
  return options.length > 0 ? { options } : {};
}
