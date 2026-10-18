import { describe, expect, it } from "vitest";
import {
  answerChoicesForField,
  answerMatches,
  buildFormLogicIndex,
  buildShowWhenSettings,
  isFormItemShown,
  pruneHiddenAnswers,
  readShowWhen,
  remapShowWhenForCopy,
} from "@/lib/form-logic";
import type { OfflineFormItem, OfflineFormSection } from "@/lib/offline/form-model";
import type { Json } from "@/types/database";

function item(id: string, fieldType: string, settings: Json = {}): OfflineFormItem {
  return { flaggable: false, fieldType, helperText: null, id, label: id, required: true, settings, sortOrder: 0 };
}

function section(id: string, items: OfflineFormItem[], repeatable = false): OfflineFormSection {
  return { collapsible: false, id, items, repeatable, sortOrder: 0, title: id };
}

describe("show-when rules", () => {
  it("reads only a well-formed rule", () => {
    expect(readShowWhen({ showWhen: { anyOf: ["fail"], itemId: "a" } })).toEqual({ anyOf: ["fail"], itemId: "a" });
    expect(readShowWhen({ showWhen: { anyOf: [], itemId: "a" } })).toBeNull();
    expect(readShowWhen({ showWhen: { anyOf: ["x"] } })).toBeNull();
    expect(readShowWhen(null)).toBeNull();
  });

  it("sets and clears the rule without touching other settings", () => {
    const set = buildShowWhenSettings({ options: ["A"] }, { anyOf: ["A"], itemId: "q" });
    expect(set).toEqual({ options: ["A"], showWhen: { anyOf: ["A"], itemId: "q" } });
    expect(buildShowWhenSettings(set, null)).toEqual({ options: ["A"] });
  });

  it("matches answers the way the renderer stores them", () => {
    expect(answerMatches("fail", ["Fail"])).toBe(true);
    expect(answerMatches(" No ", ["no"])).toBe(true);
    expect(answerMatches("pass", ["fail"])).toBe(false);
    expect(answerMatches(["Spill", "Fire"], ["fire"])).toBe(true);
    expect(answerMatches(true, ["checked"])).toBe(true);
    expect(answerMatches(false, ["checked"])).toBe(false);
    expect(answerMatches(undefined, ["fail"])).toBe(false);
    expect(answerMatches("", [""])).toBe(false);
  });

  it("offers answer choices only for fields that can decide", () => {
    expect(answerChoicesForField("pass_fail_na", {}).map((choice) => choice.value)).toEqual(["fail", "pass", "na"]);
    expect(answerChoicesForField("yes_no_na", {}).map((choice) => choice.value)).toEqual(["yes", "no", "na"]);
    expect(answerChoicesForField("dropdown_select_one", { options: ["Low", "High"] })).toHaveLength(2);
    expect(answerChoicesForField("checkbox", {})).toEqual([{ label: "Checked", value: "checked" }]);
    expect(answerChoicesForField("short_text", {})).toEqual([]);
  });

  const form = {
    sections: [
      section("s1", [
        item("result", "pass_fail_na"),
        item("reason", "long_text", { showWhen: { anyOf: ["fail"], itemId: "result" } }),
        item("photo", "photo", { showWhen: { anyOf: ["checked"], itemId: "reason-needs-photo" } }),
        item("orphan", "short_text", { showWhen: { anyOf: ["yes"], itemId: "deleted-item" } }),
      ]),
      section(
        "lines",
        [item("ok", "yes_no_na"), item("why", "short_text", { showWhen: { anyOf: ["no"], itemId: "ok" } })],
        true,
      ),
    ],
  };
  const index = buildFormLogicIndex(form);

  it("shows a dependent item only when its answer matches", () => {
    expect(isFormItemShown("reason", index, {})).toBe(false);
    expect(isFormItemShown("reason", index, { result: "pass" })).toBe(false);
    expect(isFormItemShown("reason", index, { result: "fail" })).toBe(true);
  });

  it("ignores a rule whose controlling item is gone", () => {
    expect(isFormItemShown("orphan", index, {})).toBe(true);
  });

  it("tests the same entry inside a repeatable section", () => {
    const values = { ok: ["yes", "no"] };
    expect(isFormItemShown("why", index, values, { index: 0, sectionId: "lines" })).toBe(false);
    expect(isFormItemShown("why", index, values, { index: 1, sectionId: "lines" })).toBe(true);
  });

  it("hides an item whose controller is itself hidden", () => {
    const chained = {
      sections: [
        section("s", [
          item("a", "yes_no_na"),
          item("b", "yes_no_na", { showWhen: { anyOf: ["yes"], itemId: "a" } }),
          item("c", "short_text", { showWhen: { anyOf: ["yes"], itemId: "b" } }),
        ]),
      ],
    };
    const chainIndex = buildFormLogicIndex(chained);
    // b was answered yes, then a was changed to no: b disappears, and so must c.
    expect(isFormItemShown("c", chainIndex, { a: "no", b: "yes" })).toBe(false);
    expect(isFormItemShown("c", chainIndex, { a: "yes", b: "yes" })).toBe(true);
  });

  it("survives a rule loop without hanging", () => {
    const loop = {
      sections: [
        section("s", [
          item("x", "yes_no_na", { showWhen: { anyOf: ["yes"], itemId: "y" } }),
          item("y", "yes_no_na", { showWhen: { anyOf: ["yes"], itemId: "x" } }),
        ]),
      ],
    };
    expect(typeof isFormItemShown("x", buildFormLogicIndex(loop), { x: "yes", y: "yes" })).toBe("boolean");
  });

  it("drops answers to hidden items on submit", () => {
    const pruned = pruneHiddenAnswers(form, { ok: ["yes", "no"], reason: "stale", result: "pass", why: ["a", "b"] });
    expect(pruned).not.toHaveProperty("reason");
    expect(pruned.result).toBe("pass");
    expect(pruned.why).toEqual([null, "b"]);
  });

  it("points a copied rule at the copy", () => {
    const map = new Map([["result", "result-copy"]]);
    expect(remapShowWhenForCopy({ showWhen: { anyOf: ["fail"], itemId: "result" } }, map)).toEqual({
      showWhen: { anyOf: ["fail"], itemId: "result-copy" },
    });
    expect(remapShowWhenForCopy({ showWhen: { anyOf: ["fail"], itemId: "elsewhere" } }, map)).toEqual({
      showWhen: { anyOf: ["fail"], itemId: "elsewhere" },
    });
  });
});
