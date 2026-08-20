import { describe, expect, it } from "vitest";
import {
  DEFAULT_EQUIPMENT_CERTIFICATION_TYPES,
  OPTIONAL_EQUIPMENT_CERTIFICATION_TYPES,
  expectedCertificationTypesForUnit,
} from "@/lib/equipment";

const PICKER = { id: "picker", name: "Crane / picker inspection", appliesByDefault: true };
const TANK = { id: "tank", name: "Tank inspection (CSA B620)", appliesByDefault: true };
const PIUC = { id: "piuc", name: "PIUC - pressure, internal, upper coupler", appliesByDefault: false };
const HOSE = { id: "hose", name: "Product hose", appliesByDefault: false };

const ALL = [PICKER, TANK, PIUC, HOSE];

describe("which certifications a unit is held to", () => {
  it("holds a unit with no chosen list to the default types only", () => {
    const expected = expectedCertificationTypesForUnit({
      category: "trailer",
      certificationTypes: ALL,
      requiredTypeIds: null,
    });

    expect(expected.map((type) => type.id)).toEqual(["picker", "tank"]);
  });

  // The reason the whole per-unit model exists. Before it, adding the tank
  // inspections to the type list made every tractor in the yard deficient for a
  // pressure test it will never have.
  it("never expects an off-by-default inspection until it is chosen", () => {
    const expected = expectedCertificationTypesForUnit({
      category: "vehicle",
      certificationTypes: ALL,
      requiredTypeIds: null,
    });

    expect(expected.map((type) => type.id)).not.toContain("piuc");
    expect(expected.map((type) => type.id)).not.toContain("hose");
  });

  it("holds a unit to exactly what was chosen for it", () => {
    const expected = expectedCertificationTypesForUnit({
      category: "trailer",
      certificationTypes: ALL,
      requiredTypeIds: ["tank", "piuc", "hose"],
    });

    expect(expected.map((type) => type.id)).toEqual(["tank", "piuc", "hose"]);
    expect(expected.map((type) => type.id)).not.toContain("picker");
  });

  // An empty choice is a real answer and must not be mistaken for "never set up".
  // A safety officer who deliberately clears every box on a yard trailer would
  // otherwise watch the default list reappear on the next page load.
  it("treats an empty chosen list as held to nothing, not as unset", () => {
    const expected = expectedCertificationTypesForUnit({
      category: "trailer",
      certificationTypes: ALL,
      requiredTypeIds: [],
    });

    expect(expected).toEqual([]);
  });

  it("ignores a chosen type that is no longer on the tenant's list", () => {
    const expected = expectedCertificationTypesForUnit({
      category: "trailer",
      certificationTypes: ALL,
      requiredTypeIds: ["tank", "deleted-type"],
    });

    expect(expected.map((type) => type.id)).toEqual(["tank"]);
  });

  it("expects nothing of a unit outside the road fleet, whatever was chosen", () => {
    const expected = expectedCertificationTypesForUnit({
      category: "tool",
      certificationTypes: ALL,
      requiredTypeIds: ["tank", "piuc"],
    });

    expect(expected).toEqual([]);
  });

  // A caller written before per-unit lists existed passes types with no flag at
  // all. Those have to keep behaving as they always did, or shipping this change
  // silently empties the requirement model everywhere it was not updated.
  it("counts a type with no default flag as applying by default", () => {
    const expected = expectedCertificationTypesForUnit({
      category: "trailer",
      certificationTypes: [{ id: "legacy", name: "Fire extinguisher inspection" }],
      requiredTypeIds: null,
    });

    expect(expected.map((type) => type.id)).toEqual(["legacy"]);
  });
});

describe("the seeded type lists", () => {
  it("keeps the tank inspections out of the default set", () => {
    const defaults = new Set<string>(DEFAULT_EQUIPMENT_CERTIFICATION_TYPES);

    for (const optional of OPTIONAL_EQUIPMENT_CERTIFICATION_TYPES) {
      expect(defaults.has(optional.name)).toBe(false);
    }
  });

  it("gives every optional inspection a note saying which units it is for", () => {
    for (const optional of OPTIONAL_EQUIPMENT_CERTIFICATION_TYPES) {
      expect(optional.notes.trim().length).toBeGreaterThan(0);
    }
  });

  it("carries the renewal intervals the inspection sheet uses", () => {
    const byName = new Map(OPTIONAL_EQUIPMENT_CERTIFICATION_TYPES.map((type) => [type.name, type]));

    expect(byName.get("PIUC - pressure, internal, upper coupler")?.defaultIntervalDays).toBe(1825);
    expect(byName.get("Upper coupler (UC)")?.defaultIntervalDays).toBe(1825);
    expect(byName.get("Product hose")?.defaultIntervalDays).toBe(365);
  });
});
