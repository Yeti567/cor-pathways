import { describe, expect, it } from "vitest";
import {
  COR_CROSSWALKS,
  crosswalkForPartnerElement,
  hasCrosswalk,
} from "@/lib/cor-crosswalk";
import { getCorFramework } from "@/lib/cor-frameworks";

const METHODS = new Set(["documentation", "interview", "observation"]);
const LOCATIONS = new Set(["Policies", "Safety Manual", "Forms", "App"]);

describe("COR crosswalks", () => {
  it("flags which partners have a crosswalk", () => {
    expect(hasCrosswalk("amta")).toBe(true);
    expect(hasCrosswalk("acsa")).toBe(true);
    expect(hasCrosswalk("aasp")).toBe(true);
    expect(hasCrosswalk("ihsa")).toBe(true);
    expect(hasCrosswalk("mhsa")).toBe(false);
    expect(hasCrosswalk(null)).toBe(false);
  });

  for (const [code, crosswalk] of Object.entries(COR_CROSSWALKS)) {
    it(`${code} crosswalk: every question targets a real element of that framework`, () => {
      const elementNumbers = new Set(getCorFramework(code).elements.map((element) => element.number));
      for (const question of crosswalk) {
        expect(elementNumbers.has(question.element), `${code} ${question.id} -> element ${question.element}`).toBe(true);
        expect(METHODS.has(question.method)).toBe(true);
        expect(LOCATIONS.has(question.location)).toBe(true);
        expect(question.question.length).toBeGreaterThan(0);
        expect(question.evidence.length).toBeGreaterThan(0);
      }
    });

    it(`${code} crosswalk: question ids are unique`, () => {
      const ids = crosswalk.map((q) => q.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }

  it("covers all ten ACSA elements with 108 questions", () => {
    expect(COR_CROSSWALKS.acsa).toHaveLength(108);
    const elements = new Set(COR_CROSSWALKS.acsa.map((q) => q.element));
    expect([...elements].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(crosswalkForPartnerElement("acsa", 5).length).toBeGreaterThan(0);
  });

  it("covers all ten AASP elements with 113 questions", () => {
    expect(COR_CROSSWALKS.aasp).toHaveLength(113);
    const elements = new Set(COR_CROSSWALKS.aasp.map((q) => q.element));
    expect([...elements].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // AASP element counts: 13/15/17/15/9/8/6/9/13/8
    const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => crosswalkForPartnerElement("aasp", n).length);
    expect(counts).toEqual([13, 15, 17, 15, 9, 8, 6, 9, 13, 8]);
  });

  it("covers all fourteen IHSA COR 2020 elements with 161 questions", () => {
    expect(COR_CROSSWALKS.ihsa).toHaveLength(161);
    const elements = new Set(COR_CROSSWALKS.ihsa.map((q) => q.element));
    expect([...elements].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    // IHSA element counts: 12/13/11/7/7/10/10/20/12/11/18/9/7/14
    const counts = Array.from({ length: 14 }, (_, i) => crosswalkForPartnerElement("ihsa", i + 1).length);
    expect(counts).toEqual([12, 13, 11, 7, 7, 10, 10, 20, 12, 11, 18, 9, 7, 14]);
  });
});
