import { describe, expect, it } from "vitest";
import { COR_ELEMENT_LABELS } from "@/lib/cor-elements";
import {
  CANONICAL_ELEMENTS,
  canonicalForAmtaElement,
  CERTIFYING_PARTNERS,
  coerceCertifyingPartner,
  COR_FRAMEWORKS,
  canonicalForElementNumber,
  elementCovers,
  elementNumberForCanonical,
  getCorFramework,
  isCanonicalElement,
} from "@/lib/cor-frameworks";

// The migration backfills cor_element_key from the AMTA integer with this exact
// mapping; the code must agree with it or existing tags would drift.
const MIGRATION_AMTA_MAP: Record<number, string> = {
  1: "management_commitment",
  2: "hazard_assessment",
  3: "hazard_control",
  4: "committees_reps",
  5: "training",
  6: "other_parties",
  7: "inspections",
  8: "emergency_response",
  9: "investigations",
  10: "program_administration",
};

describe("COR frameworks", () => {
  it("defines the finest-grain canonical backbone", () => {
    expect(CANONICAL_ELEMENTS).toHaveLength(16);
    expect(new Set(CANONICAL_ELEMENTS).size).toBe(16);
  });

  it("every canonical key is used by at least one framework (reachable)", () => {
    const used = new Set(
      Object.values(COR_FRAMEWORKS).flatMap((framework) =>
        framework.elements.flatMap((element) => elementCovers(element)),
      ),
    );
    for (const key of CANONICAL_ELEMENTS) {
      expect(used.has(key), `${key} should be used by some framework`).toBe(true);
    }
  });

  for (const [code, framework] of Object.entries(COR_FRAMEWORKS)) {
    it(`${code} framework: every element maps to valid canonical keys`, () => {
      for (const element of framework.elements) {
        expect(isCanonicalElement(element.canonical)).toBe(true);
        for (const key of elementCovers(element)) {
          expect(isCanonicalElement(key)).toBe(true);
        }
        // an element always covers its own primary key
        expect(elementCovers(element)).toContain(element.canonical);
      }
    });

    it(`${code} framework: primary keys are unique (picker options never collide)`, () => {
      const primaries = framework.elements.map((element) => element.canonical);
      expect(new Set(primaries).size).toBe(primaries.length);
    });

    it(`${code} framework: covers are disjoint and valid`, () => {
      const all = framework.elements.flatMap((element) => elementCovers(element));
      // disjoint: no canonical key covered by two elements (no double counting)
      expect(new Set(all).size).toBe(all.length);
      for (const key of all) {
        expect(isCanonicalElement(key)).toBe(true);
      }
    });

    it(`${code} framework: numbers are 1..N contiguous`, () => {
      const numbers = framework.elements.map((element) => element.number).sort((a, b) => a - b);
      expect(numbers).toEqual(framework.elements.map((_, index) => index + 1));
    });

    it(`${code} framework: round-trips number <-> primary canonical`, () => {
      for (const element of framework.elements) {
        expect(canonicalForElementNumber(code, element.number)).toBe(element.canonical);
        expect(elementNumberForCanonical(code, element.canonical)).toBe(element.number);
      }
    });
  }

  it("keeps the AMTA framework identical to the legacy element labels (no change for AMTA tenants)", () => {
    const amta = getCorFramework("amta");
    for (const element of amta.elements) {
      expect(element.name).toBe(COR_ELEMENT_LABELS[element.number]);
    }
    expect(amta.elements).toHaveLength(Object.keys(COR_ELEMENT_LABELS).length);
  });

  it("agrees with the migration's AMTA backfill mapping", () => {
    for (const [number, key] of Object.entries(MIGRATION_AMTA_MAP)) {
      expect(canonicalForAmtaElement(Number(number))).toBe(key);
    }
  });

  it("renumbers the same backbone between partners", () => {
    // Hazard assessment: AMTA element 2, ACSA element 5, AASP element 2.
    expect(elementNumberForCanonical("amta", "hazard_assessment")).toBe(2);
    expect(elementNumberForCanonical("acsa", "hazard_assessment")).toBe(5);
    expect(elementNumberForCanonical("aasp", "hazard_assessment")).toBe(2);
  });

  it("routes a finer MHSA topic to the coarse partner's covering element", () => {
    // MHSA tags preventative maintenance and first aid separately; a ten-element
    // partner aggregates them under inspections / emergency response.
    expect(elementNumberForCanonical("mhsa", "preventative_maintenance")).toBe(7);
    expect(elementNumberForCanonical("amta", "preventative_maintenance")).toBe(7); // AMTA Inspections covers it
    expect(elementNumberForCanonical("acsa", "preventative_maintenance")).toBe(7); // ACSA Inspections & Maintenance
    expect(elementNumberForCanonical("mhsa", "first_aid")).toBe(11);
    expect(elementNumberForCanonical("amta", "first_aid")).toBe(8); // AMTA Emergency Response covers it
    expect(elementNumberForCanonical("mhsa", "senior_management_leadership")).toBe(12);
    expect(elementNumberForCanonical("amta", "senior_management_leadership")).toBe(1); // AMTA Management
  });

  it("gives MHSA thirteen elements", () => {
    expect(getCorFramework("mhsa").elements).toHaveLength(13);
  });

  it("gives IHSA (national COR 2020) fourteen elements with its distinct topics", () => {
    const ihsa = getCorFramework("ihsa");
    expect(ihsa.elements).toHaveLength(14);
    const canonicals = ihsa.elements.map((e) => e.canonical);
    expect(canonicals).toContain("company_rules");
    expect(canonicals).toContain("ppe");
    expect(canonicals).toContain("legislation");
  });

  it("coerces unknown or unsupported partners to AMTA", () => {
    expect(coerceCertifyingPartner(null)).toBe("amta");
    expect(coerceCertifyingPartner("nope")).toBe("amta");
    // a known partner without a framework yet still falls back (amhsa is listed but unsupported)
    expect(coerceCertifyingPartner("amhsa")).toBe("amta");
    // supported partners are kept
    expect(coerceCertifyingPartner("acsa")).toBe("acsa");
    expect(coerceCertifyingPartner("aasp")).toBe("aasp");
    expect(coerceCertifyingPartner("mhsa")).toBe("mhsa");
  });

  it("lists supported partners that all have a framework", () => {
    for (const partner of CERTIFYING_PARTNERS) {
      if (partner.supported) {
        expect(COR_FRAMEWORKS[partner.code]).toBeDefined();
      }
    }
  });
});
