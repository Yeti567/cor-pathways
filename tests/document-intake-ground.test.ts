import { describe, expect, it } from "vitest";
import { dateAppearsIn, groundExtraction, MIN_TEXT_LAYER_CHARS } from "@/lib/document-intake/ground";
import { matchUnit, type MatchableUnit } from "@/lib/document-intake/match";
import { planFiling } from "@/lib/document-intake/plan";
import { sanitizeExtraction, type RawIntakeExtraction } from "@/lib/document-intake/schema";

function extraction(overrides: Partial<RawIntakeExtraction> = {}) {
  return sanitizeExtraction({
    all_vins: [],
    certification_name: null,
    confidence: 0.95,
    document_kind: "registration",
    expiry_date: "2027-03-31",
    issued_date: "2026-03-31",
    legibility: "clear",
    license_plate: "7ABC123",
    make: null,
    model_year: null,
    notes: "",
    unit_number: null,
    vin: "2T9AB1234CD567890",
    ...overrides,
  });
}

// Long enough to count as a text layer, whatever else is in it.
const filler = "Government of Alberta Certificate of Registration. ".repeat(3);

describe("dateAppearsIn", () => {
  const cases: [string, string][] = [
    ["2027-03-31", "Expiry 2027/03/31"],
    ["2027-03-31", "Expiry 2027-03-31"],
    ["2027-03-31", "Expiry date (Y/M/D) 2027 / 3 / 31"],
    ["2027-03-31", "valid until 31/03/2027"],
    ["2027-03-31", "valid until 31-03-27"],
    ["2027-03-31", "valid until 03/31/2027"],
    ["2027-03-31", "InspectionExpiryDate:31Mar2027"],
    ["2027-03-31", "expires 31 March 2027"],
    ["2027-03-31", "expires March 31, 2027"],
    ["2027-03-31", "expires Mar. 31st, 2027"],
    ["2027-03-31", "expires 31MAR27"],
    ["2027-03-31", "expires 2027 Mar 31"],
    ["2026-11-02", "Inspected Nov 2, 2026"],
    ["2026-11-02", "Inspected 02NOV2026"],
  ];

  it.each(cases)("finds %s in %s", (iso, text) => {
    expect(dateAppearsIn(iso, text)).toBe(true);
  });

  it("does not find a date that is not there", () => {
    expect(dateAppearsIn("2027-03-31", "Expiry 2027/03/13")).toBe(false);
    expect(dateAppearsIn("2027-03-31", "Expiry 31 April 2027")).toBe(false);
    expect(dateAppearsIn("2027-03-31", "no dates here")).toBe(false);
  });

  it("does not match inside a longer run of digits", () => {
    expect(dateAppearsIn("2027-03-31", "ref 120270331999")).toBe(false);
    expect(dateAppearsIn("2026-03-01", "serial 20260301")).toBe(true);
    expect(dateAppearsIn("2026-03-01", "serial 202603011")).toBe(false);
  });

  it("returns false for something that is not an ISO date", () => {
    expect(dateAppearsIn("March 31", "March 31 2027")).toBe(false);
  });
});

describe("groundExtraction", () => {
  const text = `${filler} VIN: 2T9AB 1234 CD567890  Plate No: 7ABC-123  Expiry Date (Y/M/D) 2027/03/31  Issued 2026/03/31`;

  it("passes when every value is on the page, whatever the spacing and punctuation", () => {
    const result = groundExtraction(extraction(), text);
    expect(result.checked).toBe(true);
    expect(result.ungrounded).toEqual([]);
    expect(result.lookedUp).toBe(4);
  });

  it("flags a VIN with one wrong character", () => {
    const result = groundExtraction(extraction({ vin: "2T9AB1234CD567899" }), text);
    expect(result.ungrounded).toEqual([expect.objectContaining({ field: "vin", label: "VIN" })]);
  });

  it("accepts a VIN the text layer spells with a letter O for the zero", () => {
    const result = groundExtraction(extraction({ vin: "2T9AB1234CD567890" }), text.replace("567890", "56789O"));
    expect(result.ungrounded).toEqual([]);
  });

  it("flags a wrong plate and a wrong date", () => {
    const result = groundExtraction(extraction({ expiry_date: "2027-03-13", license_plate: "7ABC124" }), text);
    expect(result.ungrounded.map((miss) => miss.field).sort()).toEqual(["expiry_date", "license_plate"]);
  });

  it("checks every VIN on a fleet document", () => {
    const result = groundExtraction(
      extraction({ all_vins: ["2T9AB1234CD567890", "9Z9ZZ9999ZZ999999"], vin: null }),
      text,
    );
    expect(result.ungrounded.map((miss) => miss.value)).toEqual(["9Z9ZZ9999ZZ999999"]);
  });

  it("skips values too short to prove anything instead of counting them as found", () => {
    const result = groundExtraction(extraction({ unit_number: "14", vin: null, license_plate: null }), text);
    expect(result.ungrounded).toEqual([]);
    expect(result.lookedUp).toBe(2);
  });

  it("is not checked at all when there is no text layer", () => {
    expect(groundExtraction(extraction(), null)).toEqual({ checked: false, lookedUp: 0, ungrounded: [] });
    expect(groundExtraction(extraction(), "x".repeat(MIN_TEXT_LAYER_CHARS - 1)).checked).toBe(false);
  });
});

describe("a failed cross-check in the plan", () => {
  const fleet: MatchableUnit[] = [
    { id: "a", unit_number: "T-014", license_plate: "7ABC123", vin_or_serial: "2T9AB1234CD567890" },
  ];
  const text = `${filler} VIN 2T9AB1234CD567890 Plate 7ABC123 Expiry 2027/03/31 Issued 2026/03/31`;
  const input = (read: RawIntakeExtraction["vin"], expiry: string) => {
    const value = extraction({ expiry_date: expiry, vin: read });
    return {
      certificationTypes: [],
      extraction: value,
      grounding: groundExtraction(value, text),
      match: matchUnit({ license_plate: value.license_plate, unit_number: null, vin: value.vin }, fleet),
      today: "2026-10-02",
      unitDocuments: [],
    };
  };

  it("stays ready when everything is on the page", () => {
    expect(planFiling(input("2T9AB1234CD567890", "2027-03-31")).ready).toBe(true);
  });

  it("holds a file back when a value is not on the page, and names it", () => {
    const result = planFiling(input("2T9AB1234CD567890", "2027-08-31"));
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("expiry date the reader gave (2027-08-31)");
  });

  it("does not block a scan, which has nothing to check against", () => {
    const value = extraction();
    const result = planFiling({
      certificationTypes: [],
      extraction: value,
      grounding: groundExtraction(value, null),
      match: matchUnit({ license_plate: value.license_plate, unit_number: null, vin: value.vin }, fleet),
      today: "2026-10-02",
      unitDocuments: [],
    });
    expect(result.ready).toBe(true);
  });
});
