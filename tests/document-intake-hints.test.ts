import { describe, expect, it } from "vitest";
import { applyPathHint, editDistance, matchUnit, unitHintFromPath, type MatchableUnit } from "@/lib/document-intake/match";
import { planFiling } from "@/lib/document-intake/plan";
import { sanitizeExtraction, type RawIntakeExtraction } from "@/lib/document-intake/schema";

const fleet: MatchableUnit[] = [
  { id: "u312a", unit_number: "312A", vin_or_serial: "1K4BB7M59TS462133", license_plate: "312QRT" },
  { id: "u321a", unit_number: "321A", vin_or_serial: "1K4BB7M51RS462037", license_plate: "517XKL" },
  { id: "u309b", unit_number: "309B", vin_or_serial: "3FBSLCF68PW000714", license_plate: "8WM273" },
  { id: "u90", unit_number: "90", vin_or_serial: "5ABCD1234EF567890", license_plate: null },
];

const none = { license_plate: null, unit_number: null };

describe("editDistance", () => {
  it("counts substitutions, deletions and insertions", () => {
    expect(editDistance("abc", "abc", 3)).toBe(0);
    expect(editDistance("abc", "abd", 3)).toBe(1);
    expect(editDistance("abc", "ac", 3)).toBe(1);
    expect(editDistance("abc", "abxc", 3)).toBe(1);
  });

  it("gives up past the maximum rather than computing the exact distance", () => {
    expect(editDistance("aaaaaaaa", "bbbbbbbb", 2)).toBeGreaterThan(2);
    expect(editDistance("a", "aaaaaaa", 2)).toBeGreaterThan(2);
  });
});

describe("a VIN that is a misread, not a mismatch", () => {
  it("suggests the unit when one character was misread (a 1 read as a T)", () => {
    const result = matchUnit({ ...none, vin: "TK4BB7M51RS462037" }, fleet);

    expect(result.status).toBe("suggested");
    expect(result.equipmentId).toBe("u321a");
    expect(result.strength).toBe("weak");
    expect(result.reasons[0]).toContain("1 character");
  });

  it("suggests the unit when one character was dropped (a 16 character VIN)", () => {
    const result = matchUnit({ ...none, vin: "3FBSLCF6PW000714" }, fleet);

    expect(result.status).toBe("suggested");
    expect(result.equipmentId).toBe("u309b");
  });

  it("suggests the unit the plate points at when its VIN is a hair off", () => {
    const result = matchUnit({ license_plate: "8WM273", unit_number: null, vin: "3FBSLCF6PW000714" }, fleet);

    expect(result.status).toBe("suggested");
    expect(result.equipmentId).toBe("u309b");
  });

  it("still calls a VIN that is nothing like the one on file a mismatch", () => {
    const result = matchUnit({ license_plate: "8WM273", unit_number: null, vin: "9Z9ZZ9999ZZ999999" }, fleet);

    expect(result.status).toBe("ambiguous");
    expect(result.equipmentId).toBeNull();
  });

  it("offers nothing when two units are equally close", () => {
    const twins: MatchableUnit[] = [
      { id: "a", unit_number: "1", vin_or_serial: "1K4BB7M51RS462037", license_plate: null },
      { id: "b", unit_number: "2", vin_or_serial: "1K4BB7M51RS462038", license_plate: null },
    ];
    const result = matchUnit({ ...none, vin: "1K4BB7M51RS462039" }, twins);

    expect(result.status).toBe("ambiguous");
    expect(result.equipmentId).toBeNull();
  });

  it("does not guess from a short fragment", () => {
    expect(matchUnit({ ...none, vin: "462037" }, fleet).status).not.toBe("suggested");
  });

  it("an exact match is never downgraded to a suggestion", () => {
    expect(matchUnit({ ...none, vin: "1K4BB7M51RS462037" }, fleet)).toMatchObject({
      equipmentId: "u321a",
      status: "matched",
      strength: "strong",
    });
  });
});

describe("unitHintFromPath", () => {
  it("reads the unit from the file name", () => {
    expect(unitHintFromPath("Trailer 312.zip/Trailer 312/312A/312A - CVIP - Exp Oct 31, 2026.pdf", fleet)).toBe("u312a");
  });

  it("falls back to the folder when the file name names no unit", () => {
    expect(unitHintFromPath("Trailer 321.zip/Trailer 321/321A/scan0001.pdf", fleet)).toBe("u321a");
  });

  it("ignores day numbers and years in a date", () => {
    const withUnit31: MatchableUnit[] = [...fleet, { id: "u31", unit_number: "31", vin_or_serial: null, license_plate: null }];
    expect(unitHintFromPath("CVIP Exp Oct 31, 2026.pdf", withUnit31)).toBeNull();
  });

  it("returns null when the deepest named part names two units", () => {
    expect(unitHintFromPath("312A and 321A - CVIP.pdf", fleet)).toBeNull();
  });

  it("returns null when nothing in the path is a unit", () => {
    expect(unitHintFromPath("scan.pdf", fleet)).toBeNull();
    expect(unitHintFromPath("Trailer 999/999A/reg.pdf", fleet)).toBeNull();
  });

  it("does not take a short bare number for a unit, so a batch name like 90.zip is not unit 90", () => {
    expect(unitHintFromPath("90.zip/90/pivkuc.pdf", fleet)).toBeNull();
  });

  it("still finds the real unit deeper in the same path", () => {
    expect(unitHintFromPath("90.zip/90/Trailer 302/302A/302A - PIVKUC - Exp Aug 31, 2029.pdf", [
      ...fleet,
      { id: "u302a", unit_number: "302A", vin_or_serial: null, license_plate: null },
    ])).toBe("u302a");
  });
});

describe("applyPathHint", () => {
  it("catches a scan filed in the wrong unit's folder", () => {
    const matched = matchUnit({ ...none, vin: "1K4BB7M59TS462133" }, fleet);
    const result = applyPathHint(matched, "u321a", fleet);

    expect(result.status).toBe("ambiguous");
    expect(result.equipmentId).toBeNull();
    expect(result.reasons[0]).toContain("312A");
    expect(result.reasons[0]).toContain("321A");
  });

  it("leaves a match alone when the path agrees, and adds no certainty", () => {
    const matched = matchUnit({ ...none, vin: "1K4BB7M59TS462133" }, fleet);
    expect(applyPathHint(matched, "u312a", fleet)).toBe(matched);
  });

  it("suggests the pathed unit when the document names no unit at all", () => {
    const result = applyPathHint(matchUnit({ ...none, vin: null }, fleet), "u309b", fleet);

    expect(result.status).toBe("suggested");
    expect(result.equipmentId).toBe("u309b");
    expect(result.strength).toBe("weak");
  });

  it("does nothing without a hint, or with a hint that is not in the fleet", () => {
    const missing = matchUnit({ ...none, vin: null }, fleet);
    expect(applyPathHint(missing, null, fleet)).toBe(missing);
    expect(applyPathHint(missing, "ghost", fleet)).toBe(missing);
  });

  it("a conflicting hint also overrides a suggestion", () => {
    const near = matchUnit({ ...none, vin: "TK4BB7M51RS462037" }, fleet);
    expect(applyPathHint(near, "u312a", fleet).status).toBe("ambiguous");
  });
});

describe("a suggested unit in the plan", () => {
  function extraction(overrides: Partial<RawIntakeExtraction> = {}) {
    return sanitizeExtraction({
      all_vins: [],
      certification_name: null,
      confidence: 0.98,
      document_kind: "cvip",
      expiry_date: "2027-05-31",
      issued_date: "2026-05-20",
      legibility: "clear",
      license_plate: null,
      make: null,
      model_year: null,
      notes: "",
      unit_number: null,
      vin: "TK4BB7M51RS462037",
      ...overrides,
    });
  }

  it("builds the proposal so the reviewer sees the row it would fill, but is never ready", () => {
    const match = matchUnit({ ...none, vin: "TK4BB7M51RS462037" }, fleet);
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction(),
      match,
      today: "2026-10-03",
      unitDocuments: [
        {
          attachment_ids: [],
          certification_type_id: null,
          doc_type: "cvip",
          expiry_date: "2026-05-31",
          id: "waiting",
          is_active: true,
          issued_date: null,
          title: "CVIP",
        },
      ],
    });

    expect(result.ready).toBe(false);
    expect(result.proposal).toMatchObject({ action: "attach_to_existing", targetDocumentId: "waiting" });
    expect(result.reasons.join(" ")).toContain("most likely a misread");
  });
});
