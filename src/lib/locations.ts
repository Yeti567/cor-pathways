export const locationVisibilityOptions = [
  {
    value: "only_workers_assigned",
    label: "Only assigned workers",
    detail: "Workers see this location only when they are assigned to it.",
  },
  {
    value: "all_workers",
    label: "All workers",
    detail: "Every active worker can use this location.",
  },
] as const;

export const locationStatusOptions = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

export type LocationVisibilityRule = (typeof locationVisibilityOptions)[number]["value"];
export type LocationStatus = (typeof locationStatusOptions)[number]["value"];

const visibilityRuleValues = new Set<string>(locationVisibilityOptions.map((option) => option.value));
const statusValues = new Set<string>(locationStatusOptions.map((option) => option.value));

export function normalizeLocationCode(inputCode: string, name: string) {
  return (inputCode || name)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

export function coerceLocationVisibilityRule(value: string): LocationVisibilityRule {
  return visibilityRuleValues.has(value) ? (value as LocationVisibilityRule) : "only_workers_assigned";
}

export function coerceLocationStatus(value: string | null | undefined): LocationStatus {
  return value && statusValues.has(value) ? (value as LocationStatus) : "active";
}

export function locationIsActive(visibilityRule: string | null | undefined) {
  return visibilityRule !== "inactive";
}

export function formatLocationVisibilityRule(value: string | null | undefined) {
  if (value === "inactive") {
    return "Inactive";
  }

  return locationVisibilityOptions.find((option) => option.value === value)?.label ?? "Only assigned workers";
}
