"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, ChevronRight, HelpCircle, ListChecks, Plus, Trash2, X } from "lucide-react";
import type { ManagedListTreeItem } from "@/lib/managed-lists";

type FormListSummary = {
  id: string;
  name: string;
  usageCount: number;
  usageFormNames: string[];
};

type FormListDetail = FormListSummary & {
  includeOther: boolean;
  items: ManagedListTreeItem[];
};

type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastState = {
  action?: ToastAction;
  message: string;
  tone: "error" | "success";
} | null;

type ConfirmState =
  | {
      id: string;
      kind: "list";
      name: string;
      usageCount: number;
    }
  | {
      childrenCount: number;
      id: string;
      kind: "item";
      label: string;
    }
  | null;

type VisibleNode = {
  depth: number;
  item: ManagedListTreeItem;
  parentId: string | null;
};

function t(value: string, replacements?: Record<string, string | number>) {
  if (!replacements) {
    return value;
  }

  return Object.entries(replacements).reduce((next, [key, replacement]) => next.replace(`{${key}}`, String(replacement)), value);
}

function sortItems(items: ManagedListTreeItem[]) {
  return [...items].sort((left, right) => left.sort_order - right.sort_order || left.label.localeCompare(right.label));
}

function normalizeTree(items: ManagedListTreeItem[]): ManagedListTreeItem[] {
  return sortItems(items).map((item) => ({
    ...item,
    children: normalizeTree(item.children ?? []),
  }));
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

function flattenVisibleItems(items: ManagedListTreeItem[], collapsedIds: ReadonlySet<string>, depth = 0, parentId: string | null = null) {
  const nodes: VisibleNode[] = [];

  for (const item of normalizeTree(items)) {
    nodes.push({ depth, item, parentId });

    if (!collapsedIds.has(item.id)) {
      nodes.push(...flattenVisibleItems(item.children, collapsedIds, depth + 1, item.id));
    }
  }

  return nodes;
}

function findItem(items: ManagedListTreeItem[], itemId: string): ManagedListTreeItem | null {
  for (const item of items) {
    if (item.id === itemId) {
      return item;
    }

    const child = findItem(item.children, itemId);

    if (child) {
      return child;
    }
  }

  return null;
}

function findParentId(items: ManagedListTreeItem[], itemId: string, parentId: string | null = null): string | null {
  for (const item of items) {
    if (item.id === itemId) {
      return parentId;
    }

    const childParentId = findParentId(item.children, itemId, item.id);

    if (childParentId !== null) {
      return childParentId;
    }
  }

  return null;
}

function removeItem(items: ManagedListTreeItem[], itemId: string): { item: ManagedListTreeItem | null; tree: ManagedListTreeItem[] } {
  let removed: ManagedListTreeItem | null = null;
  const tree: ManagedListTreeItem[] = [];

  for (const item of items) {
    if (item.id === itemId) {
      removed = item;
      continue;
    }

    const childResult = removeItem(item.children, itemId);

    if (childResult.item) {
      removed = childResult.item;
    }

    tree.push({ ...item, children: childResult.tree });
  }

  return { item: removed, tree };
}

function updateItem(
  items: ManagedListTreeItem[],
  itemId: string,
  updater: (item: ManagedListTreeItem) => ManagedListTreeItem,
): ManagedListTreeItem[] {
  return items.map((item) => {
    if (item.id === itemId) {
      return updater(item);
    }

    return { ...item, children: updateItem(item.children, itemId, updater) };
  });
}

function addItemToParent(items: ManagedListTreeItem[], item: ManagedListTreeItem, parentId: string | null): ManagedListTreeItem[] {
  if (!parentId) {
    return normalizeTree([...items, item]);
  }

  return updateItem(items, parentId, (parent) => ({
    ...parent,
    children: normalizeTree([...parent.children, item]),
  }));
}

function reorderSibling(items: ManagedListTreeItem[], activeId: string, overId: string, parentId: string | null) {
  const siblings = parentId ? findItem(items, parentId)?.children ?? [] : items;
  const oldIndex = siblings.findIndex((item) => item.id === activeId);
  const newIndex = siblings.findIndex((item) => item.id === overId);

  if (oldIndex === -1 || newIndex === -1) {
    return { nextTree: items, siblings: [] as ManagedListTreeItem[] };
  }

  const nextSiblings = [...siblings];
  const [moved] = nextSiblings.splice(oldIndex, 1);
  nextSiblings.splice(newIndex, 0, moved);
  const orderedSiblings = nextSiblings.map((item, index) => ({ ...item, sort_order: sortOrderForIndex(index) }));

  if (!parentId) {
    return { nextTree: orderedSiblings, siblings: orderedSiblings };
  }

  return {
    nextTree: updateItem(items, parentId, (parent) => ({ ...parent, children: orderedSiblings })),
    siblings: orderedSiblings,
  };
}

function isDescendant(items: ManagedListTreeItem[], itemId: string, possibleDescendantId: string) {
  const item = findItem(items, itemId);

  if (!item) {
    return false;
  }

  return Boolean(findItem(item.children, possibleDescendantId));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? t("Request failed."));
  }

  return body as T;
}

function SaveStatusIndicator({ savingCount }: { savingCount: number }) {
  return (
    <span className={`text-sm ${savingCount > 0 ? "font-semibold text-[var(--primary)]" : "text-[var(--ink-muted)]"}`}>
      {savingCount > 0 ? t("Saving list...") : t("List saved")}
    </span>
  );
}

function Toast({ toast, onDismiss }: { onDismiss: () => void; toast: ToastState }) {
  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(onDismiss, 4500);

    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast]);

  if (!toast) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-md border border-[var(--border)] bg-white p-3 text-sm font-semibold shadow-lg">
      <span className={toast.tone === "success" ? "text-[var(--success)]" : "text-[var(--danger)]"}>{toast.message}</span>
      {toast.action ? (
        <button className="text-[var(--primary)] hover:text-[var(--primary-dark)]" onClick={toast.action.onClick} type="button">
          {toast.action.label}
        </button>
      ) : null}
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

  const title = confirm.kind === "list" ? t("Delete list \"{name}\"?", { name: confirm.name }) : t("Delete item \"{name}\"?", { name: confirm.label });
  const detail =
    confirm.kind === "list"
      ? t("It is used in {count} forms. This cannot be undone.", { count: confirm.usageCount })
      : t("This item has {count} child items. This cannot be undone.", { count: confirm.childrenCount });
  const blocked = confirm.kind === "list" && confirm.usageCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-md rounded-md border border-[var(--border)] bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{detail}</p>
            {blocked ? <p className="mt-2 text-sm font-semibold text-[var(--danger)]">{t("Remove this list from forms before deleting it.")}</p> : null}
          </div>
          <button
            aria-label={t("Close")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
            onClick={onCancel}
            type="button"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
            onClick={onCancel}
            type="button"
          >
            {t("Cancel")}
          </button>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--danger)] px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={blocked}
            onClick={onConfirm}
            type="button"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("Delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateListModal({
  existingNames,
  onClose,
  onCreate,
}: {
  existingNames: string[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit() {
    const normalizedName = name.trim().replace(/\s+/g, " ");

    if (!normalizedName) {
      setError(t("List Name is required."));
      return;
    }

    if (normalizedName.length > 80) {
      setError(t("List Name must be 80 characters or fewer."));
      return;
    }

    if (existingNames.some((existingName) => existingName.toLowerCase() === normalizedName.toLowerCase())) {
      setError(t("A list with that name already exists."));
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await onCreate(normalizedName);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <form
        className="w-full max-w-md overflow-hidden rounded-md border border-[var(--border)] bg-white shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-center justify-between bg-zinc-700 px-4 py-3 text-white">
          <h2 className="text-base font-semibold">{t("Create List")}</h2>
          <button
            aria-label={t("Close")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white hover:bg-zinc-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-2 p-4">
          <label className="grid gap-2 text-sm font-medium text-[var(--ink)]">
            {t("List Name")}
            <input
              autoFocus
              className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          {error ? <p className="text-sm font-semibold text-[var(--danger)]">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface-muted)] p-3">
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            {t("Cancel")}
          </button>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {t("Add")}
          </button>
        </div>
      </form>
    </div>
  );
}

function ListSidebar({
  lists,
  onAddList,
  onSelectList,
  selectedListId,
}: {
  lists: FormListSummary[];
  onAddList: () => void;
  onSelectList: (listId: string) => void;
  selectedListId: string | null;
}) {
  return (
    <aside className="h-fit max-h-[calc(100vh-160px)] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-sm xl:sticky xl:top-4">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] p-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink-muted)]">{t("LISTS")}</h2>
        <button
          className="inline-flex h-8 items-center justify-center gap-1 rounded-full bg-[var(--primary)] px-3 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
          onClick={onAddList}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t("Add List")}
        </button>
      </div>
      <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-2">
        {lists.length > 0 ? (
          lists.map((list) => {
            const selected = selectedListId === list.id;

            return (
              <button
                className={`mb-1 block min-h-10 w-full whitespace-normal rounded-md px-3 py-2 text-left text-sm font-medium transition ${
                  selected ? "bg-blue-600 text-white" : "text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                }`}
                key={list.id}
                onClick={() => onSelectList(list.id)}
                type="button"
              >
                {list.name}
              </button>
            );
          })
        ) : (
          <p className="p-3 text-sm text-[var(--ink-muted)]">{t("No lists yet.")}</p>
        )}
      </div>
    </aside>
  );
}

function EditableListTitle({
  list,
  onRename,
}: {
  list: FormListDetail;
  onRename: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(list.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function save() {
    const nextName = draft.trim().replace(/\s+/g, " ");

    if (!nextName || nextName === list.name) {
      setDraft(list.name);
      setEditing(false);
      return;
    }

    void onRename(nextName);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <input
          ref={inputRef}
          className="h-11 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-white px-3 text-2xl font-semibold text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          maxLength={80}
          onBlur={save}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }

            if (event.key === "Escape") {
              setDraft(list.name);
              setEditing(false);
            }
          }}
          value={draft}
        />
        <button
          aria-label={t("Save list name")}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)]"
          onMouseDown={(event) => event.preventDefault()}
          onClick={save}
          type="button"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <button
      className="min-w-0 truncate text-left text-2xl font-semibold text-[var(--ink)] hover:text-[var(--primary)]"
      onClick={() => {
        setDraft(list.name);
        setEditing(true);
      }}
      type="button"
    >
      {list.name}
    </button>
  );
}

function ListItemRow({
  collapsed,
  depth,
  editing,
  item,
  onAddChild,
  onDelete,
  onEdit,
  onRename,
  onToggle,
}: {
  collapsed: boolean;
  depth: number;
  editing: boolean;
  item: ManagedListTreeItem;
  onAddChild: (item: ManagedListTreeItem) => void;
  onDelete: (item: ManagedListTreeItem) => void;
  onEdit: (itemId: string) => void;
  onRename: (item: ManagedListTreeItem, label: string) => Promise<void>;
  onToggle: (itemId: string) => void;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  const [draft, setDraft] = useState(item.label);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasChildren = item.children.length > 0;

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function save() {
    const label = draft.trim().replace(/\s+/g, " ");

    if (!label || label === item.label) {
      setDraft(item.label);
      onEdit("");
      return;
    }

    void onRename(item, label);
    onEdit("");
  }

  return (
    <div
      aria-expanded={hasChildren ? !collapsed : undefined}
      aria-level={depth + 1}
      aria-selected={editing}
      className="group grid min-h-10 grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-[var(--border)] bg-white px-2 py-1 last:border-b-0"
      data-item-row={item.id}
      ref={setNodeRef}
      role="treeitem"
      style={{
        opacity: isDragging ? 0.55 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      tabIndex={0}
    >
      <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 24 }}>
        <button
          aria-label={collapsed ? t("Expand {label}", { label: item.label }) : t("Collapse {label}", { label: item.label })}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30"
          disabled={!hasChildren}
          onClick={() => onToggle(item.id)}
          type="button"
        >
          {hasChildren ? collapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" /> : null}
        </button>
        <button
          aria-label={t("Drag {label}", { label: item.label })}
          className="inline-flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
          type="button"
          {...attributes}
          {...listeners}
        >
          <ListChecks className="h-4 w-4" aria-hidden="true" />
        </button>
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              ref={inputRef}
              className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-white px-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              maxLength={200}
              onBlur={save}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }

                if (event.key === "Escape") {
                  setDraft(item.label);
                  onEdit("");
                }
              }}
              value={draft}
            />
            <button
              aria-label={t("Save item {label}", { label: item.label })}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)]"
              onMouseDown={(event) => event.preventDefault()}
              onClick={save}
              type="button"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            className="min-w-0 truncate text-left text-sm text-[var(--ink)] hover:text-[var(--primary)]"
            onClick={() => {
              setDraft(item.label);
              onEdit(item.id);
            }}
            type="button"
          >
            {item.label}
          </button>
        )}
      </div>
      <button
        aria-label={t("Add child item to {label}", { label: item.label })}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--primary)] text-white opacity-90 hover:bg-[var(--primary-dark)]"
        onClick={() => onAddChild(item)}
        type="button"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        aria-label={t("Delete item {label}", { label: item.label })}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--danger)] hover:bg-red-50"
        onClick={() => onDelete(item)}
        type="button"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function ListEditor({
  detail,
  editingItemId,
  onAddItem,
  onDeleteItem,
  onDeleteList,
  onDragEnd,
  onEditItem,
  onRenameItem,
  onRenameList,
  onToggleIncludeOther,
  onToggleItem,
  savingCount,
  collapsedIds,
}: {
  collapsedIds: ReadonlySet<string>;
  detail: FormListDetail | null;
  editingItemId: string;
  onAddItem: (parentId: string | null) => void;
  onDeleteItem: (item: ManagedListTreeItem) => void;
  onDeleteList: () => void;
  onDragEnd: (event: DragEndEvent) => void;
  onEditItem: (itemId: string) => void;
  onRenameItem: (item: ManagedListTreeItem, label: string) => Promise<void>;
  onRenameList: (name: string) => Promise<void>;
  onToggleIncludeOther: (value: boolean) => void;
  onToggleItem: (itemId: string) => void;
  savingCount: number;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const visibleNodes = useMemo(() => flattenVisibleItems(detail?.items ?? [], collapsedIds), [collapsedIds, detail?.items]);

  function focusNodeByIndex(index: number) {
    const node = visibleNodes[index];

    if (!node) {
      return;
    }

    document.querySelector<HTMLElement>(`[data-item-row="${node.item.id}"]`)?.focus();
  }

  function onTreeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const row = (event.target as HTMLElement).closest("[data-item-row]") as HTMLElement | null;
    const itemId = row?.dataset.itemRow;

    if (!itemId) {
      return;
    }

    const currentIndex = visibleNodes.findIndex((node) => node.item.id === itemId);
    const node = visibleNodes[currentIndex];

    if (!node) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusNodeByIndex(Math.min(currentIndex + 1, visibleNodes.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusNodeByIndex(Math.max(currentIndex - 1, 0));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (node.item.children.length > 0 && !collapsedIds.has(node.item.id)) {
        onToggleItem(node.item.id);
      } else if (node.parentId) {
        document.querySelector<HTMLElement>(`[data-item-row="${node.parentId}"]`)?.focus();
      }
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (node.item.children.length > 0 && collapsedIds.has(node.item.id)) {
        onToggleItem(node.item.id);
      } else if (node.item.children[0]) {
        document.querySelector<HTMLElement>(`[data-item-row="${node.item.children[0].id}"]`)?.focus();
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      onEditItem(node.item.id);
    } else if (event.key === "Delete") {
      event.preventDefault();
      onDeleteItem(node.item);
    }
  }

  if (!detail) {
    return (
      <section className="flex min-h-80 items-center justify-center rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <div>
          <ListChecks className="mx-auto h-9 w-9 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-3 text-lg font-semibold text-[var(--ink)]">{t("Pick a list on the left, or create a new one.")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <EditableListTitle list={detail} onRename={onRenameList} />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            {t("Currently used in {count} forms.", { count: detail.usageCount })}{" "}
            {detail.usageFormNames.length > 0 ? detail.usageFormNames.join(", ") : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-medium text-[var(--ink)]">
            <input
              checked={detail.includeOther}
              className="h-4 w-4 accent-[var(--primary)]"
              onChange={(event) => onToggleIncludeOther(event.target.checked)}
              type="checkbox"
            />
            {t('Include "Other"')}
          </label>
          <button
            aria-label={t("Delete list {name}", { name: detail.name })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--danger)] bg-white text-[var(--danger)] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={detail.usageCount > 0}
            onClick={onDeleteList}
            title={detail.usageCount > 0 ? t("Remove this list from form fields before deleting it.") : t("Delete list")}
            type="button"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          onClick={() => onAddItem(null)}
          type="button"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("Add Item")}
        </button>
        <SaveStatusIndicator savingCount={savingCount} />
      </div>

      <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} sensors={sensors}>
        <SortableContext items={visibleNodes.map((node) => node.item.id)} strategy={verticalListSortingStrategy}>
          <div className="mt-4 overflow-hidden rounded-md border border-[var(--border)]" onKeyDown={onTreeKeyDown} role="tree">
            {visibleNodes.length > 0 ? (
              visibleNodes.map((node) => (
                <ListItemRow
                  collapsed={collapsedIds.has(node.item.id)}
                  depth={node.depth}
                  editing={editingItemId === node.item.id}
                  item={node.item}
                  key={node.item.id}
                  onAddChild={(item) => onAddItem(item.id)}
                  onDelete={onDeleteItem}
                  onEdit={onEditItem}
                  onRename={onRenameItem}
                  onToggle={onToggleItem}
                />
              ))
            ) : (
              <div className="px-4 py-10 text-center text-sm text-[var(--ink-muted)]">{t("Add the first item for this list.")}</div>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}

export function ListManagerClient({ initialListId }: { initialListId: string | null }) {
  const router = useRouter();
  const [lists, setLists] = useState<FormListSummary[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(initialListId);
  const [detail, setDetail] = useState<FormListDetail | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [savingCount, setSavingCount] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    let cancelled = false;

    fetchJson<FormListSummary[]>("/api/form-lists")
      .then((nextLists) => {
        if (!cancelled) {
          setLists(nextLists);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : t("Lists were not loaded."), "error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedListId) {
      queueMicrotask(() => setDetail(null));
      return;
    }

    let cancelled = false;

    fetchJson<FormListDetail>(`/api/form-lists/${selectedListId}`)
      .then((nextDetail) => {
        if (!cancelled) {
          nextDetail.items = normalizeTree(nextDetail.items);
          setDetail(nextDetail);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : t("List was not loaded."), "error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedListId]);

  useEffect(() => {
    if (!selectedListId) {
      queueMicrotask(() => setCollapsedIds(new Set()));
      return;
    }

    const storedValue = window.localStorage.getItem(`managed-list-collapsed:${selectedListId}`);
    queueMicrotask(() => setCollapsedIds(new Set(storedValue ? JSON.parse(storedValue) : [])));
  }, [selectedListId]);

  useEffect(() => {
    if (selectedListId) {
      window.localStorage.setItem(`managed-list-collapsed:${selectedListId}`, JSON.stringify([...collapsedIds]));
    }
  }, [collapsedIds, selectedListId]);

  function showToast(message: string, tone: "error" | "success" = "success", action?: ToastAction) {
    setToast({ action, message, tone });
  }

  async function withSaving<T>(task: () => Promise<T>) {
    setSavingCount((count) => count + 1);

    try {
      return await task();
    } finally {
      setSavingCount((count) => Math.max(0, count - 1));
    }
  }

  function selectList(listId: string) {
    setSelectedListId(listId);
    router.push(`/admin/lists?listId=${listId}`, { scroll: false });
  }

  async function createList(name: string) {
    try {
      const created = await withSaving(() =>
        fetchJson<FormListSummary & { includeOther: boolean }>("/api/form-lists", {
          body: JSON.stringify({ name }),
          method: "POST",
        }),
      );
      const nextLists = [...lists, created].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
      setLists(nextLists);
      setCreateModalOpen(false);
      selectList(created.id);
      setDetail({ ...created, includeOther: created.includeOther, items: [] });
      showToast(t("List created."));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("List was not created."), "error");
    }
  }

  async function patchList(patch: { includeOther?: boolean; name?: string }) {
    if (!detail) {
      return;
    }

    const previousDetail = detail;
    const previousLists = lists;
    const optimisticDetail = {
      ...detail,
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.includeOther === undefined ? {} : { includeOther: patch.includeOther }),
    };
    setDetail(optimisticDetail);
    setLists((current) =>
      current
        .map((list) => (list.id === detail.id ? { ...list, ...(patch.name ? { name: patch.name } : {}) } : list))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
    );

    try {
      await withSaving(() =>
        fetchJson(`/api/form-lists/${detail.id}`, {
          body: JSON.stringify(patch),
          method: "PATCH",
        }),
      );
      showToast(t("List saved."));
    } catch (error) {
      setDetail(previousDetail);
      setLists(previousLists);
      showToast(error instanceof Error ? error.message : t("List was not saved."), "error");
    }
  }

  async function addItem(parentId: string | null) {
    if (!detail) {
      return;
    }

    const tempId = makeTempId("item");
    const parent = parentId ? findItem(detail.items, parentId) : null;
    const tempItem: ManagedListTreeItem = {
      active: true,
      children: [],
      id: tempId,
      label: t("New Item"),
      parent_id: parentId,
      sort_order: sortOrderForIndex(parent ? parent.children.length : detail.items.length),
    };
    const previousDetail = detail;
    setDetail({ ...detail, items: addItemToParent(detail.items, tempItem, parentId) });
    setEditingItemId(tempId);

    if (parentId) {
      setCollapsedIds((current) => {
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
    }

    try {
      const created = await withSaving(() =>
        fetchJson<ManagedListTreeItem>(`/api/form-lists/${detail.id}/items`, {
          body: JSON.stringify({ label: tempItem.label, parentId }),
          method: "POST",
        }),
      );
      setDetail((current) =>
        current
          ? {
              ...current,
              items: updateItem(current.items, tempId, () => ({ ...created, children: [] })),
            }
          : current,
      );
      setEditingItemId(created.id);
      showToast(t("Item added."));
    } catch (error) {
      setDetail(previousDetail);
      setEditingItemId("");
      showToast(error instanceof Error ? error.message : t("Item was not added."), "error");
    }
  }

  async function renameItem(item: ManagedListTreeItem, label: string) {
    if (!detail) {
      return;
    }

    const siblingParentId = findParentId(detail.items, item.id);
    const siblingLabels = (siblingParentId ? findItem(detail.items, siblingParentId)?.children ?? [] : detail.items).map((sibling) => sibling.label.toLowerCase());

    if (siblingLabels.includes(label.toLowerCase())) {
      console.warn(`Managed list item duplicate among siblings: ${label}`);
    }

    const previousDetail = detail;
    setDetail({ ...detail, items: updateItem(detail.items, item.id, (current) => ({ ...current, label })) });

    try {
      await withSaving(() =>
        fetchJson(`/api/form-lists/${detail.id}/items/${item.id}`, {
          body: JSON.stringify({ label }),
          method: "PATCH",
        }),
      );
      showToast(t("Item saved."));
    } catch (error) {
      setDetail(previousDetail);
      showToast(error instanceof Error ? error.message : t("Item was not saved."), "error");
    }
  }

  async function deleteItem(item: ManagedListTreeItem) {
    if (!detail) {
      return;
    }

    const previousDetail = detail;
    const result = removeItem(detail.items, item.id);
    setDetail({ ...detail, items: result.tree });

    try {
      await withSaving(() => fetchJson(`/api/form-lists/${detail.id}/items/${item.id}`, { method: "DELETE" }));
      showToast(t("Item deleted."), "success", {
        label: t("Undo"),
        onClick: () => {
          setDetail(previousDetail);
          setToast(null);
        },
      });
    } catch (error) {
      setDetail(previousDetail);
      showToast(error instanceof Error ? error.message : t("Item was not deleted."), "error");
    }
  }

  async function deleteList() {
    if (!detail) {
      return;
    }

    const target = detail;
    setConfirm(null);

    try {
      await withSaving(() => fetchJson(`/api/form-lists/${target.id}`, { method: "DELETE" }));
      setLists((current) => current.filter((list) => list.id !== target.id));
      setSelectedListId(null);
      setDetail(null);
      router.push("/admin/lists", { scroll: false });
      showToast(t("List deleted."));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("List was not deleted."), "error");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!detail || !event.over || event.active.id === event.over.id) {
      return;
    }

    const activeId = String(event.active.id);
    const overId = String(event.over.id);

    if (isDescendant(detail.items, activeId, overId)) {
      showToast(t("An item cannot be moved under its own child."), "error");
      return;
    }

    const activeParentId = findParentId(detail.items, activeId);
    const overParentId = findParentId(detail.items, overId);
    const previousDetail = detail;

    if (activeParentId === overParentId) {
      const { nextTree, siblings } = reorderSibling(detail.items, activeId, overId, activeParentId);
      setDetail({ ...detail, items: nextTree });

      try {
        await withSaving(async () => {
          await Promise.all(
            siblings.map((sibling) =>
              fetchJson(`/api/form-lists/${detail.id}/items/${sibling.id}`, {
                body: JSON.stringify({ sortOrder: sibling.sort_order }),
                method: "PATCH",
              }),
            ),
          );
        });
        showToast(t("Item order saved."));
      } catch (error) {
        setDetail(previousDetail);
        showToast(error instanceof Error ? error.message : t("Item order was not saved."), "error");
      }

      return;
    }

    const removed = removeItem(detail.items, activeId);

    if (!removed.item) {
      return;
    }

    const overItem = findItem(removed.tree, overId);
    const nextSortOrder = sortOrderForIndex(overItem?.children.length ?? 0);
    const movedItem = { ...removed.item, parent_id: overId, sort_order: nextSortOrder };
    const nextTree = addItemToParent(removed.tree, movedItem, overId);
    setDetail({ ...detail, items: nextTree });
    setCollapsedIds((current) => {
      const next = new Set(current);
      next.delete(overId);
      return next;
    });

    try {
      await withSaving(() =>
        fetchJson(`/api/form-lists/${detail.id}/items/${activeId}`, {
          body: JSON.stringify({ parentId: overId, sortOrder: nextSortOrder }),
          method: "PATCH",
        }),
      );
      showToast(t("Item moved."));
    } catch (error) {
      setDetail(previousDetail);
      showToast(error instanceof Error ? error.message : t("Item was not moved."), "error");
    }
  }

  const existingNames = lists.map((list) => list.name);

  return (
    <>
      <Toast onDismiss={() => setToast(null)} toast={toast} />
      <ConfirmDeleteModal
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "list") {
            void deleteList();
          } else if (confirm?.kind === "item") {
            const item = detail ? findItem(detail.items, confirm.id) : null;
            setConfirm(null);

            if (item) {
              void deleteItem(item);
            }
          }
        }}
      />
      {createModalOpen ? (
        <CreateListModal existingNames={existingNames} onClose={() => setCreateModalOpen(false)} onCreate={createList} />
      ) : null}

      <div className="mb-5 flex items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <h1 className="text-3xl font-light text-[var(--ink)]">{t("List Manager")}</h1>
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
          type="button"
        >
          <HelpCircle className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          {t("How to Use This Page")}
        </button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <ListSidebar lists={lists} onAddList={() => setCreateModalOpen(true)} onSelectList={selectList} selectedListId={selectedListId} />
        <ListEditor
          collapsedIds={collapsedIds}
          detail={detail}
          editingItemId={editingItemId}
          onAddItem={(parentId) => void addItem(parentId)}
          onDeleteItem={(item) => {
            if (item.children.length > 0) {
              setConfirm({ childrenCount: item.children.length, id: item.id, kind: "item", label: item.label });
            } else {
              void deleteItem(item);
            }
          }}
          onDeleteList={() =>
            detail ? setConfirm({ id: detail.id, kind: "list", name: detail.name, usageCount: detail.usageCount }) : undefined
          }
          onDragEnd={(event) => void handleDragEnd(event)}
          onEditItem={setEditingItemId}
          onRenameItem={renameItem}
          onRenameList={(name) => patchList({ name })}
          onToggleIncludeOther={(includeOther) => void patchList({ includeOther })}
          onToggleItem={(itemId) =>
            setCollapsedIds((current) => {
              const next = new Set(current);

              if (next.has(itemId)) {
                next.delete(itemId);
              } else {
                next.add(itemId);
              }

              return next;
            })
          }
          savingCount={savingCount}
        />
      </div>
    </>
  );
}
