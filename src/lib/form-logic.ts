// Show-when rules: one form item appears only when another item's answer matches.
//
// Stored on the dependent item as settings.showWhen = { itemId, anyOf }. This is the rule a
// paper form prints as "If No, explain" or "If Fail, describe the defect and take a photo".
// The crew renderer hides the item until the answer matches; a hidden item is never required,
// and its answer is dropped on submit so a reason typed and then made irrelevant is not filed.
//
// A rule that points at an item that is not on the form (deleted, or copied from another form)
// is ignored and the item shows. A field that can never appear is worse than one that always does.

import type { Json } from "@/types/database";
import type { OfflineFormItem, OfflineFormSection } from "@/lib/offline/form-model";

export type ShowWhenRule = {
  /** The form item whose answer decides. */
  itemId: string;
  /** Answers that make this item appear. Compared without case or surrounding spaces. */
  anyOf: string[];
};

export type AnswerChoice = { label: string; value: string };

type Settings = Record<string, Json | undefined>;

function isRecord(value: Json | undefined): value is Settings {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase();
}

export function readShowWhen(settings: Json): ShowWhenRule | null {
  if (!isRecord(settings) || !isRecord(settings.showWhen)) {
    return null;
  }

  const { itemId, anyOf } = settings.showWhen;

  if (typeof itemId !== "string" || !itemId.trim() || !Array.isArray(anyOf)) {
    return null;
  }

  const answers = anyOf.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);

  return answers.length > 0 ? { anyOf: answers, itemId } : null;
}

/** Returns settings with the rule set, or removed when rule is null. Other keys are kept. */
export function buildShowWhenSettings(settings: Json, rule: ShowWhenRule | null): Settings {
  const next: Settings = isRecord(settings) ? { ...settings } : {};

  if (rule && rule.itemId && rule.anyOf.length > 0) {
    next.showWhen = { anyOf: rule.anyOf, itemId: rule.itemId };
  } else {
    delete next.showWhen;
  }

  return next;
}

/** True when an answer, as the renderer stores it, matches one of the rule's answers. */
export function answerMatches(value: Json | undefined, anyOf: readonly string[]) {
  const wanted = new Set(anyOf.map(normalizeAnswer));

  if (typeof value === "string") {
    return value.trim().length > 0 && wanted.has(normalizeAnswer(value));
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && wanted.has(String(value));
  }

  if (typeof value === "boolean") {
    // A single tick box stores true/false. Its rule answer is "checked".
    return value ? wanted.has("checked") : wanted.has("unchecked");
  }

  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && wanted.has(normalizeAnswer(entry)));
  }

  return false;
}

/** The answers a rule can test for, for a given controlling field. Empty means it cannot control. */
export function answerChoicesForField(fieldType: string, settings: Json): AnswerChoice[] {
  switch (fieldType) {
    case "pass_fail_na":
      return [
        { label: "Fail", value: "fail" },
        { label: "Pass", value: "pass" },
        { label: "N/A", value: "na" },
      ];
    case "yes_no":
    case "yes_no_na":
      return [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
        ...(fieldType === "yes_no_na" ? [{ label: "N/A", value: "na" }] : []),
      ];
    case "dropdown_select_one":
    case "dropdown_select_multiple":
    case "single_select":
    case "multi_select":
    case "checkbox": {
      const options =
        isRecord(settings) && Array.isArray(settings.options)
          ? settings.options.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
          : [];

      if (options.length > 0) {
        return options.map((option) => ({ label: option, value: option }));
      }

      return fieldType === "checkbox" ? [{ label: "Checked", value: "checked" }] : [];
    }
    default:
      return [];
  }
}

type IndexedItem = { item: OfflineFormItem; repeatable: boolean; sectionId: string };
export type FormLogicIndex = Map<string, IndexedItem>;

export function buildFormLogicIndex(form: { sections: OfflineFormSection[] }): FormLogicIndex {
  const index: FormLogicIndex = new Map();

  for (const section of form.sections) {
    for (const item of section.items) {
      index.set(item.id, { item, repeatable: section.repeatable, sectionId: section.id });
    }
  }

  return index;
}

/** Which entry of a repeatable section is being drawn, so a rule reads that entry's answer. */
export type RepeatContext = { index: number; sectionId: string } | null;

const MAX_RULE_DEPTH = 12;

function controllerValue(
  controller: IndexedItem,
  values: Record<string, Json | undefined>,
  repeat: RepeatContext,
): Json | undefined {
  const raw = values[controller.item.id];

  if (repeat && controller.repeatable && controller.sectionId === repeat.sectionId) {
    return Array.isArray(raw) ? raw[repeat.index] : undefined;
  }

  return raw;
}

export function isFormItemShown(
  itemId: string,
  index: FormLogicIndex,
  values: Record<string, Json | undefined>,
  repeat: RepeatContext = null,
  depth = 0,
): boolean {
  const entry = index.get(itemId);

  if (!entry || depth > MAX_RULE_DEPTH) {
    return true;
  }

  const rule = readShowWhen(entry.item.settings);

  if (!rule || rule.itemId === itemId) {
    return true;
  }

  const controller = index.get(rule.itemId);

  // Missing, or admin-only (a worker can never answer it): the rule cannot work, so ignore it.
  if (!controller || (isRecord(controller.item.settings) && controller.item.settings.visibility === "admin_only")) {
    return true;
  }

  // A rule on a field that is itself hidden stays hidden: "If No" under a question nobody sees.
  if (!isFormItemShown(controller.item.id, index, values, repeat, depth + 1)) {
    return false;
  }

  return answerMatches(controllerValue(controller, values, repeat), rule.anyOf);
}

/**
 * Drops answers to items that are hidden by a rule at submit time. Repeatable answers keep
 * their entry positions; a hidden entry becomes null.
 */
export function pruneHiddenAnswers(
  form: { sections: OfflineFormSection[] },
  values: Record<string, Json>,
): Record<string, Json> {
  const index = buildFormLogicIndex(form);
  const next: Record<string, Json> = { ...values };

  for (const section of form.sections) {
    for (const item of section.items) {
      if (!readShowWhen(item.settings) || !(item.id in next)) {
        continue;
      }

      if (section.repeatable) {
        const entries = Array.isArray(next[item.id]) ? (next[item.id] as Json[]) : [];
        next[item.id] = entries.map((entry, entryIndex) =>
          isFormItemShown(item.id, index, values, { index: entryIndex, sectionId: section.id }) ? entry : null,
        );
        continue;
      }

      if (!isFormItemShown(item.id, index, values)) {
        delete next[item.id];
      }
    }
  }

  return next;
}

/**
 * When a section is copied, a rule between two items inside it must point at the copy, not
 * the original. Rules on items outside the copied set are left as they are.
 */
export function remapShowWhenForCopy(settings: Json, idMap: ReadonlyMap<string, string>): Json {
  const rule = readShowWhen(settings);
  const mapped = rule ? idMap.get(rule.itemId) : undefined;

  return rule && mapped ? buildShowWhenSettings(settings, { ...rule, itemId: mapped }) : settings;
}
