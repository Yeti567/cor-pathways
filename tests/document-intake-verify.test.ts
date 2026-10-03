import { describe, expect, it } from "vitest";
import type { ReadOutcome } from "@/lib/document-intake/extract";
import { sanitizeExtraction, type RawIntakeExtraction } from "@/lib/document-intake/schema";
import { planFiling } from "@/lib/document-intake/plan";
import { matchUnit, type MatchableUnit } from "@/lib/document-intake/match";
import { readingDisagreements, secondOpinion } from "@/lib/document-intake/verify";

function read(overrides: Partial<RawIntakeExtraction> = {}) {
  return sanitizeExtraction({
    all_vins: [],
    certification_name: null,
    confidence: 0.98,
    document_kind: "cvip",
    expiry_date: "2027-05-31",
    issued_date: "2026-05-20",
    legibility: "clear",
    license_plate: "517XKL",
    make: null,
    model_year: null,
    notes: "",
    unit_number: null,
    vin: "1K4BB7M51RS462037",
    ...overrides,
  });
}

const ok = (overrides: Partial<RawIntakeExtraction> = {}): ReadOutcome => ({
  extraction: read(overrides),
  model: "test",
  ok: true,
});

describe("readingDisagreements", () => {
  it("is empty when the readings agree", () => {
    expect(readingDisagreements(read(), read())).toEqual([]);
  });

  it("ignores spacing, punctuation and case in identifiers", () => {
    expect(readingDisagreements(read({ license_plate: "517 XKL" }), read({ license_plate: "517-xkl" }))).toEqual([]);
  });

  it("treats a letter O and a zero in a VIN as the same character", () => {
    expect(readingDisagreements(read({ vin: "1K4BB7M51RS46203O" }), read({ vin: "1K4BB7M51RS462030" }))).toEqual([]);
  });

  it("names a VIN that differs by one character", () => {
    expect(readingDisagreements(read(), read({ vin: "TK4BB7M51RS462037" }))).toEqual(["the VIN"]);
  });

  it("names a date, a plate and the kind of document", () => {
    expect(readingDisagreements(read(), read({ expiry_date: "2027-05-30" }))).toEqual(["the expiry date"]);
    expect(readingDisagreements(read(), read({ issued_date: "2026-05-02" }))).toEqual(["the issue date"]);
    expect(readingDisagreements(read(), read({ license_plate: "517XKM" }))).toEqual(["the plate"]);
    expect(readingDisagreements(read(), read({ document_kind: "registration" }))).toEqual(["the kind of document"]);
  });

  it("counts a value found by one reading and missed by the other as a disagreement", () => {
    expect(readingDisagreements(read(), read({ license_plate: null }))).toEqual(["the plate"]);
  });

  it("lists everything that differs", () => {
    expect(readingDisagreements(read(), read({ expiry_date: null, vin: "TK4BB7M51RS462037" }))).toEqual([
      "the VIN",
      "the expiry date",
    ]);
  });
});

describe("secondOpinion", () => {
  it("agrees when the second reading matches", async () => {
    expect(await secondOpinion({ first: read(), read: async () => ok() })).toEqual({ agrees: true });
  });

  it("disagrees, and says on what, when it does not", async () => {
    const result = await secondOpinion({ first: read(), read: async () => ok({ vin: "TK4BB7M51RS462037" }) });
    expect(result).toEqual({ agrees: false, reason: "Two readings of this file disagreed on the VIN." });
  });

  it("does not confirm when the second reading fails to read", async () => {
    const failed: ReadOutcome = { needsPerson: false, ok: false, reason: "busy", retryable: true };
    const result = await secondOpinion({ first: read(), read: async () => failed });

    expect(result.agrees).toBe(false);
  });

  it("does not confirm when the second reading throws", async () => {
    const result = await secondOpinion({
      first: read(),
      read: async () => {
        throw new Error("network");
      },
    });

    expect(result.agrees).toBe(false);
  });
});

describe("no expiry on a new document", () => {
  const fleet: MatchableUnit[] = [{ id: "a", unit_number: "302A", vin_or_serial: "4D7MBB5S593048261", license_plate: null }];
  const plan = (docKind: RawIntakeExtraction["document_kind"], expiry: string | null) => {
    const extraction = read({ document_kind: docKind, expiry_date: expiry, vin: "4D7MBB5S593048261", license_plate: null });
    return planFiling({
      certificationTypes: [{ id: "t1", name: "CSA B620 tank" }],
      extraction: { ...extraction, certification_name: docKind === "certification" ? "CSA B620 tank" : null },
      match: matchUnit({ license_plate: null, unit_number: null, vin: extraction.vin }, fleet),
      today: "2026-10-03",
      unitDocuments: [],
    });
  };

  it("holds back a certification that prints no due date and has nothing waiting for it", () => {
    const result = plan("certification", null);

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("no due date");
  });

  it("allows a registration with no expiry, which may be continuous", () => {
    expect(plan("registration", null).ready).toBe(true);
  });

  it("allows a certification that does print its expiry", () => {
    expect(plan("certification", "2029-08-31").ready).toBe(true);
  });
});
