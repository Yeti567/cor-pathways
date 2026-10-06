import { describe, expect, it } from "vitest";
import { expiryHintFromName, matchUnit, type MatchableUnit } from "@/lib/document-intake/match";
import { planFiling } from "@/lib/document-intake/plan";
import { sanitizeExtraction, type IntakeExtraction, type RawIntakeExtraction } from "@/lib/document-intake/schema";

// Why these tests exist. On a real pile (2026-10-06) the reader marked three B620 external
// visual inspections ready to file with an expiry it had worked out itself: one a year early
// (the inspection month read back as the expiry), one a year on from the inspection date, one
// eight months off anything. Each certificate printed only its inspection date, each was read
// the same way twice, and the only thing on the machine that disagreed was the date the yard
// had written into the file name. So the file name became a witness, and an expiry within
// weeks of the issue date became a reason to stop.

const fleet: MatchableUnit[] = [
  { id: "u413a", unit_number: "413A", vin_or_serial: "1XAAATAH95V000417", license_plate: null },
];

const today = "2026-10-06";
const certTypes = [{ id: "ct-ev", name: "External visual inspection" }];

function raw(overrides: Partial<RawIntakeExtraction> = {}): RawIntakeExtraction {
  return {
    all_vins: [],
    certification_name: "External visual inspection",
    confidence: 0.95,
    document_kind: "certification",
    expiry_date: "2027-09-30",
    issued_date: "2026-09-17",
    legibility: "clear",
    license_plate: null,
    make: null,
    model_year: null,
    notes: "",
    unit_number: "413A",
    vin: "1XAAATAH95V000417",
    ...overrides,
  };
}

function extraction(overrides: Partial<RawIntakeExtraction> = {}): IntakeExtraction {
  return sanitizeExtraction(raw(overrides));
}

const matched = matchUnit({ license_plate: null, unit_number: null, vin: "1XAAATAH95V000417" }, fleet);

describe("expiryHintFromName", () => {
  it("reads the yard's usual spellings", () => {
    expect(expiryHintFromName("412A - CVIP - Exp Oct 31, 2026.pdf")).toBe("2026-10-31");
    expect(expiryHintFromName("420B - VK - Exp. April 30, 2027.pdf")).toBe("2027-04-30");
    expect(expiryHintFromName("423B - Hose Certs - Exp Sept 9, 2027.pdf")).toBe("2027-09-09");
    expect(expiryHintFromName("413B VK  - Exp. May 31, 2027.pdf")).toBe("2027-05-31");
    expect(expiryHintFromName("410A-CVIP-Exp Mar 31, 2027.pdf")).toBe("2027-03-31");
    expect(expiryHintFromName("409A - VIK - Expires Jan 31 2030.pdf")).toBe("2030-01-31");
  });

  it("reads an ISO date after Exp", () => {
    expect(expiryHintFromName("Trailer 5/5A - PIUC - Exp 2029-02-28.pdf")).toBe("2029-02-28");
  });

  it("looks only at the file name, not its folders", () => {
    expect(expiryHintFromName("Exp Jan 31, 2027/402A - Registration.pdf")).toBeNull();
    expect(expiryHintFromName("Trailer 412/412A/412A - CVIP - Exp Oct 31, 2026.pdf")).toBe("2026-10-31");
  });

  it("returns null for a name with no expiry, or a date that does not exist", () => {
    expect(expiryHintFromName("402A - Registration.pdf")).toBeNull();
    expect(expiryHintFromName("402A - Registration Plate.pdf")).toBeNull();
    expect(expiryHintFromName("410B - VK - Exp Feb 30, 2027.pdf")).toBeNull();
    expect(expiryHintFromName("410B - VK - Exp Smarch 1, 2027.pdf")).toBeNull();
  });
});

describe("planFiling with the file name's expiry", () => {
  it("holds a file whose read expiry is a different month or year from the name", () => {
    // The 413A case: inspected 2026-09-17, the reader gave the end of that month as the expiry.
    const result = planFiling({
      certificationTypes: certTypes,
      expiryHint: "2027-09-30",
      extraction: extraction({ expiry_date: "2026-09-30", issued_date: "2026-09-17" }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("The file name says it expires 2027-09-30 but the document reads 2026-09-30");
  });

  it("treats the same month as agreement, because yards round to month end", () => {
    const result = planFiling({
      certificationTypes: certTypes,
      expiryHint: "2027-09-30",
      extraction: extraction({ expiry_date: "2027-09-17", issued_date: "2026-09-17" }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("notes, without blocking, a name that carries an expiry when the document prints none", () => {
    const result = planFiling({
      certificationTypes: certTypes,
      expiryHint: "2027-09-30",
      extraction: extraction({ expiry_date: null, issued_date: "2026-09-17" }),
      match: matched,
      today,
      unitDocuments: [
        {
          attachment_ids: [],
          certification_type_id: "ct-ev",
          doc_type: "certification",
          expiry_date: "2027-09-30",
          id: "waiting",
          is_active: true,
          issued_date: null,
          title: "External visual inspection",
        },
      ],
    });

    expect(result.ready).toBe(true);
    expect(result.notes.join(" ")).toContain("the document itself prints no expiry");
  });

  it("changes nothing when the name has no expiry in it", () => {
    const result = planFiling({
      certificationTypes: certTypes,
      expiryHint: null,
      extraction: extraction(),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(true);
  });
});

describe("planFiling and an expiry too close to the issue date", () => {
  it("holds a certification whose expiry is days after its issue date", () => {
    const result = planFiling({
      certificationTypes: certTypes,
      extraction: extraction({ expiry_date: "2026-09-30", issued_date: "2026-09-17" }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("only 13 days after the issue date");
  });

  it("holds a CVIP the same way", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({
        certification_name: null,
        document_kind: "cvip",
        expiry_date: "2026-10-31",
        issued_date: "2026-10-02",
      }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("No inspection runs that short");
  });

  it("leaves a year-long certificate and a short permit alone", () => {
    const year = planFiling({
      certificationTypes: certTypes,
      extraction: extraction({ expiry_date: "2027-09-17", issued_date: "2026-09-17" }),
      match: matched,
      today,
      unitDocuments: [],
    });
    const permit = planFiling({
      certificationTypes: [],
      extraction: extraction({
        certification_name: null,
        document_kind: "permit",
        expiry_date: "2026-10-20",
        issued_date: "2026-10-06",
      }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(year.ready).toBe(true);
    expect(permit.ready).toBe(true);
  });
});
