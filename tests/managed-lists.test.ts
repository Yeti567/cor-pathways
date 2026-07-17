import { describe, expect, it } from "vitest";
import {
  buildManagedListOptions,
  buildManagedListTree,
  buildManualChoiceSettings,
  flattenManagedListOptions,
  getManagedListIdFromSettings,
  getManualOptionLabels,
  normalizeManagedListItemLabel,
  normalizeManagedListName,
  resolveManagedListSettings,
} from "@/lib/managed-lists";

describe("managed list helpers", () => {
  it("normalizes list names and item labels", () => {
    expect(normalizeManagedListName("  Control   Implementation  ")).toBe("Control Implementation");
    expect(normalizeManagedListItemLabel("  High   Priority  ")).toBe("High Priority");
  });

  it("reads managed list ids from current and legacy setting keys", () => {
    expect(getManagedListIdFromSettings({ list_id: "list-1" })).toBe("list-1");
    expect(getManagedListIdFromSettings({ listId: "list-2" })).toBe("list-2");
    expect(getManagedListIdFromSettings({ options: [] })).toBeNull();
  });

  it("builds manual option settings from line-separated values", () => {
    expect(getManualOptionLabels("High\n\nLow\n  Medium  ")).toEqual(["High", "Low", "Medium"]);
    expect(buildManualChoiceSettings(["Pass", "Fail"])).toEqual({ options: ["Pass", "Fail"] });
    expect(buildManualChoiceSettings([])).toEqual({});
  });

  it("resolves active managed list options and appends Other when enabled", () => {
    const settings = resolveManagedListSettings(
      {},
      { id: "list-1", include_other: true, name: "Risk Rating" },
      [
        { active: true, label: "Medium", sort_order: 20 },
        { active: false, label: "Hidden", sort_order: 30 },
        { active: true, label: "High", sort_order: 10 },
      ],
    );

    expect(buildManagedListOptions([{ active: true, label: "Low", sort_order: 1 }], false)).toEqual(["Low"]);
    expect(settings).toEqual({
      include_other: true,
      list_id: "list-1",
      list_name: "Risk Rating",
      options: ["High", "Medium", "Other"],
    });
  });

  it("builds and flattens nested managed list trees depth-first", () => {
    const tree = buildManagedListTree([
      { active: true, id: "minor", label: "3 - Minor", parent_id: null, sort_order: 300 },
      { active: true, id: "serious", label: "2 - Serious", parent_id: null, sort_order: 200 },
      { active: true, id: "remote", label: "C - Remote", parent_id: "serious", sort_order: 300 },
      { active: true, id: "probable", label: "A - Probable", parent_id: "serious", sort_order: 100 },
      { active: false, id: "hidden", label: "Hidden", parent_id: "serious", sort_order: 200 },
    ]);

    expect(flattenManagedListOptions(tree, true)).toEqual([
      { depth: 0, id: "serious", label: "2 - Serious" },
      { depth: 1, id: "probable", label: "  A - Probable" },
      { depth: 1, id: "remote", label: "  C - Remote" },
      { depth: 0, id: "minor", label: "3 - Minor" },
      { depth: 0, id: "__other__", label: "Other" },
    ]);
    expect(buildManagedListOptions(tree.flatMap((item) => [item, ...item.children]), false)).toEqual([
      "2 - Serious",
      "  A - Probable",
      "  C - Remote",
      "3 - Minor",
    ]);
  });
});
