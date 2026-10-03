import { describe, expect, it } from "vitest";
import { matchUnit, normalizeVin, type MatchableUnit } from "@/lib/document-intake/match";
import {
  cvipExpiryFromInspection,
  matchCertificationType,
  planFiling,
  type PlanUnitDocument,
} from "@/lib/document-intake/plan";
import {
  normalizeIsoDate,
  sanitizeExtraction,
  type IntakeExtraction,
  type RawIntakeExtraction,
} from "@/lib/document-intake/schema";
import {
  buildIntakeStoragePath,
  intakeStoragePrefix,
  validateUploadedIntakeFiles,
} from "@/lib/document-intake/storage";

const TENANT = "11111111-1111-1111-1111-111111111111";
const BATCH = "22222222-2222-2222-2222-222222222222";

const fleet: MatchableUnit[] = [
  { id: "a", unit_number: "T-014", vin_or_serial: "2T9AB1234CD567890", license_plate: "ABC 123" },
  { id: "b", unit_number: "T-015", vin_or_serial: "2T9AB1234CD567891", license_plate: "XYZ 987" },
  { id: "c", unit_number: "P-200", vin_or_serial: null, license_plate: "QQQ 111" },
];

function raw(overrides: Partial<RawIntakeExtraction> = {}): RawIntakeExtraction {
  return {
    all_vins: [],
    certification_name: null,
    confidence: 0.95,
    document_kind: "registration",
    expiry_date: "2027-03-31",
    issued_date: "2026-03-31",
    legibility: "clear",
    license_plate: null,
    make: null,
    model_year: null,
    notes: "",
    unit_number: null,
    vin: null,
    ...overrides,
  };
}

function extraction(overrides: Partial<RawIntakeExtraction> = {}): IntakeExtraction {
  return sanitizeExtraction(raw(overrides));
}

describe("normalizeIsoDate", () => {
  it("accepts a real ISO date", () => {
    expect(normalizeIsoDate("2027-03-31")).toBe("2027-03-31");
  });

  it("refuses anything that is not strict ISO rather than guessing the order", () => {
    expect(normalizeIsoDate("05/06/26")).toBeNull();
    expect(normalizeIsoDate("31 MAR 2027")).toBeNull();
    expect(normalizeIsoDate("")).toBeNull();
    expect(normalizeIsoDate(null)).toBeNull();
  });

  it("refuses days that do not exist", () => {
    expect(normalizeIsoDate("2026-02-30")).toBeNull();
    expect(normalizeIsoDate("2026-13-01")).toBeNull();
  });

  it("refuses a century slip", () => {
    expect(normalizeIsoDate("1926-05-01")).toBeNull();
    expect(normalizeIsoDate("2126-05-01")).toBeNull();
  });
});

describe("sanitizeExtraction", () => {
  it("drops an unreadable date and says so", () => {
    const result = extraction({ expiry_date: "05/06/26" });
    expect(result.expiry_date).toBeNull();
    expect(result.date_issues[0]).toContain("expiry date");
  });

  it("flags an expiry before its issue date and keeps neither as trusted evidence of order", () => {
    const result = extraction({ expiry_date: "2025-01-01", issued_date: "2026-01-01" });
    expect(result.date_issues.some((issue) => issue.includes("before the issue date"))).toBe(true);
  });

  it("clamps confidence to 0..1", () => {
    expect(extraction({ confidence: 4 }).confidence).toBe(1);
    expect(extraction({ confidence: -2 }).confidence).toBe(0);
    expect(extraction({ confidence: Number.NaN }).confidence).toBe(0);
  });

  it("treats a lone VIN in the list as the VIN, and cleans punctuation", () => {
    const result = extraction({ all_vins: ["2t9ab 1234-cd567890"], vin: null });
    expect(result.vin).toBe("2T9AB1234CD567890");
    expect(result.all_vins).toEqual(["2T9AB1234CD567890"]);
  });
});

describe("normalizeVin", () => {
  it("folds the letters a VIN cannot contain onto the digits they are misread as", () => {
    expect(normalizeVin("1HGCM82633AO04352")).toBe(normalizeVin("1HGCM82633A004352"));
    expect(normalizeVin("1HGCM8263I3A004352")).toBe(normalizeVin("1HGCM826313A004352"));
  });

  it("leaves L alone, which is a legal VIN character", () => {
    expect(normalizeVin("1L")).toBe("1L");
  });
});

describe("matchUnit", () => {
  it("matches strongly on a full VIN", () => {
    const result = matchUnit({ license_plate: null, unit_number: null, vin: "2T9AB1234CD567890" }, fleet);
    expect(result).toMatchObject({ equipmentId: "a", status: "matched", strength: "strong" });
  });

  it("matches a VIN read with an O for a zero", () => {
    const result = matchUnit({ license_plate: null, unit_number: null, vin: "2T9AB1234CD5678QO" }, [
      { id: "z", unit_number: "T-1", vin_or_serial: "2T9AB1234CD567800", license_plate: null },
    ]);
    expect(result.equipmentId).toBe("z");
  });

  it("sends a VIN that disagrees with the plate to a person, not to either unit", () => {
    const result = matchUnit({ license_plate: "XYZ 987", unit_number: null, vin: "2T9AB1234CD567890" }, fleet);
    expect(result.status).toBe("ambiguous");
    expect(result.equipmentId).toBeNull();
    expect(result.candidateIds).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("is strong when the plate and the unit number agree with each other", () => {
    const result = matchUnit({ license_plate: "abc123", unit_number: "t014", vin: null }, fleet);
    expect(result).toMatchObject({ equipmentId: "a", status: "matched", strength: "strong" });
  });

  it("is only a weak lead on the plate alone", () => {
    const result = matchUnit({ license_plate: "QQQ 111", unit_number: null, vin: null }, fleet);
    expect(result).toMatchObject({ equipmentId: "c", status: "matched", strength: "weak" });
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("refuses a full VIN that contradicts the VIN on file for the unit the plate points at", () => {
    const result = matchUnit({ license_plate: "ABC 123", unit_number: null, vin: "9Z9ZZ9999ZZ999999" }, fleet);
    expect(result.status).toBe("ambiguous");
    expect(result.reasons[0]).toContain("does not match the VIN on file");
  });

  it("reports ambiguity when the same VIN is on two units in the fleet", () => {
    const result = matchUnit({ license_plate: null, unit_number: null, vin: "2T9AB1234CD567890" }, [
      ...fleet,
      { id: "dup", unit_number: "T-099", vin_or_serial: "2T9AB1234CD567890", license_plate: null },
    ]);
    expect(result.status).toBe("ambiguous");
  });

  it("reports none when nothing fits", () => {
    const result = matchUnit({ license_plate: "NOPE 1", unit_number: "Z-1", vin: null }, fleet);
    expect(result.status).toBe("none");
  });
});

describe("matchCertificationType", () => {
  const types = [
    { id: "t1", name: "Product hose" },
    { id: "t2", name: "Load/vent hose" },
    { id: "t3", name: "Crane/picker" },
  ];

  it("matches an exact name regardless of case and punctuation", () => {
    expect(matchCertificationType("PRODUCT HOSE", types)?.id).toBe("t1");
    expect(matchCertificationType("load vent hose", types)?.id).toBe("t2");
  });

  it("matches when the document's name contains the type's name", () => {
    expect(matchCertificationType("Annual crane/picker inspection", types)?.id).toBe("t3");
  });

  it("returns null rather than guess between two", () => {
    expect(matchCertificationType("hose", types)).toBeNull();
  });

  it("returns null for no name", () => {
    expect(matchCertificationType(null, types)).toBeNull();
  });
});

describe("planFiling", () => {
  const today = "2026-10-02";
  const matched = matchUnit({ license_plate: null, unit_number: null, vin: "2T9AB1234CD567890" }, fleet);

  function waitingRow(overrides: Partial<PlanUnitDocument> = {}): PlanUnitDocument {
    return {
      attachment_ids: [],
      certification_type_id: null,
      doc_type: "registration",
      expiry_date: "2026-12-31",
      id: "row1",
      is_active: true,
      issued_date: null,
      title: "Registration",
      ...overrides,
    };
  }

  it("attaches to the single waiting row and is ready", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({ vin: "2T9AB1234CD567890" }),
      match: matched,
      today,
      unitDocuments: [waitingRow()],
    });

    expect(result.ready).toBe(true);
    expect(result.proposal).toMatchObject({
      action: "attach_to_existing",
      expiryDate: "2027-03-31",
      targetDocumentId: "row1",
    });
    expect(result.notes[0]).toContain("Expiry will change from 2026-12-31");
  });

  it("keeps the stored dates when the document shows none", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({ expiry_date: null, issued_date: null, vin: "2T9AB1234CD567890" }),
      match: matched,
      today,
      unitDocuments: [waitingRow()],
    });

    expect(result.ready).toBe(true);
    expect(result.proposal.expiryDate).toBe("2026-12-31");
  });

  it("creates a new row, and is ready, when the unit has none of that type", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({ vin: "2T9AB1234CD567890" }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(true);
    expect(result.proposal.action).toBe("create_new");
  });

  it("leaves a renewal to a person", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({ vin: "2T9AB1234CD567890" }),
      match: matched,
      today,
      unitDocuments: [waitingRow({ attachment_ids: ["x/y.pdf"] })],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("renewal");
  });

  it("asks which row when several are waiting", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({ vin: "2T9AB1234CD567890" }),
      match: matched,
      today,
      unitDocuments: [waitingRow({ id: "r1" }), waitingRow({ id: "r2" })],
    });

    expect(result.ready).toBe(false);
    expect(result.proposal.targetDocumentId).toBeNull();
  });

  it("is not ready when the reader was unsure or the scan is poor", () => {
    const unsure = planFiling({
      certificationTypes: [],
      extraction: extraction({ confidence: 0.6, vin: "2T9AB1234CD567890" }),
      match: matched,
      today,
      unitDocuments: [waitingRow()],
    });
    const poor = planFiling({
      certificationTypes: [],
      extraction: extraction({ legibility: "poor", vin: "2T9AB1234CD567890" }),
      match: matched,
      today,
      unitDocuments: [waitingRow()],
    });

    expect(unsure.ready).toBe(false);
    expect(poor.ready).toBe(false);
  });

  it("is not ready when the document is already expired", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({ expiry_date: "2025-01-01", issued_date: "2024-01-01", vin: "2T9AB1234CD567890" }),
      match: matched,
      today,
      unitDocuments: [waitingRow()],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("expired");
  });

  it("is not ready on a weak match", () => {
    const weak = matchUnit({ license_plate: "QQQ 111", unit_number: null, vin: null }, fleet);
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({ license_plate: "QQQ 111" }),
      match: weak,
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(false);
  });

  it("never auto-files a fleet certificate", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({ all_vins: ["2T9AB1234CD567890", "2T9AB1234CD567891"], document_kind: "insurance" }),
      match: matchUnit({ license_plate: null, unit_number: null, vin: null }, fleet),
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("2 vehicles");
  });

  it("refuses medical records and gives them no filing target", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({ document_kind: "medical" }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(false);
    expect(result.proposal.action).toBe("none");
    expect(result.reasons[0]).toContain("medical");
  });

  it("needs a certification type for a certification", () => {
    const result = planFiling({
      certificationTypes: [{ id: "t1", name: "Product hose" }],
      extraction: extraction({
        certification_name: "Mystery inspection",
        document_kind: "certification",
        vin: "2T9AB1234CD567890",
      }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("Mystery inspection");
  });

  it("lands a certification on the waiting row for its own type only", () => {
    const result = planFiling({
      certificationTypes: [
        { id: "t1", name: "Product hose" },
        { id: "t2", name: "Crane/picker" },
      ],
      extraction: extraction({
        certification_name: "Product hose test",
        document_kind: "certification",
        vin: "2T9AB1234CD567890",
      }),
      match: matched,
      today,
      unitDocuments: [
        waitingRow({ certification_type_id: "t2", doc_type: "certification", id: "crane", title: "Crane/picker" }),
        waitingRow({ certification_type_id: "t1", doc_type: "certification", id: "hose", title: "Product hose" }),
      ],
    });

    expect(result.ready).toBe(true);
    expect(result.proposal.targetDocumentId).toBe("hose");
  });
});

describe("CVIP expiry", () => {
  const today = "2026-10-02";
  const matched = matchUnit({ license_plate: null, unit_number: null, vin: "2T9AB1234CD567890" }, fleet);

  it("runs to the end of the inspection month, one year on", () => {
    expect(cvipExpiryFromInspection("2025-11-21")).toBe("2026-11-30");
    expect(cvipExpiryFromInspection("2026-03-02")).toBe("2027-03-31");
    expect(cvipExpiryFromInspection("2026-01-15")).toBe("2027-01-31");
  });

  it("handles February in a leap year and a plain year", () => {
    expect(cvipExpiryFromInspection("2027-02-10")).toBe("2028-02-29");
    expect(cvipExpiryFromInspection("2025-02-10")).toBe("2026-02-28");
  });

  it("refuses anything that is not an ISO date", () => {
    expect(cvipExpiryFromInspection("03/02/2026")).toBeNull();
  });

  it("fills the expiry a CVIP does not print, and says it was worked out", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({
        document_kind: "cvip",
        expiry_date: null,
        issued_date: "2026-03-02",
        vin: "2T9AB1234CD567890",
      }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.proposal.expiryDate).toBe("2027-03-31");
    expect(result.notes.join(" ")).toContain("worked out from the inspection date");
    expect(result.ready).toBe(true);
  });

  it("never overrides an expiry the document prints", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({
        document_kind: "cvip",
        expiry_date: "2026-11-30",
        issued_date: "2025-11-21",
        vin: "2T9AB1234CD567890",
      }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.proposal.expiryDate).toBe("2026-11-30");
    expect(result.notes.join(" ")).not.toContain("worked out");
  });

  it("does not invent an expiry for a registration or any other kind", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({
        document_kind: "registration",
        expiry_date: null,
        issued_date: "2026-03-02",
        vin: "2T9AB1234CD567890",
      }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.proposal.expiryDate).toBeNull();
  });

  it("holds back a CVIP whose derived expiry has already passed", () => {
    const result = planFiling({
      certificationTypes: [],
      extraction: extraction({
        document_kind: "cvip",
        expiry_date: null,
        issued_date: "2024-03-02",
        vin: "2T9AB1234CD567890",
      }),
      match: matched,
      today,
      unitDocuments: [],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("expired");
  });
});

describe("intake storage paths", () => {
  const location = { batchId: BATCH, tenantId: TENANT };
  const prefix = intakeStoragePrefix(location);
  const good = { name: "reg.pdf", path: `${prefix}1-0-reg.pdf`, size: 1000, type: "application/pdf" };

  it("builds a path inside the tenant's intake folder", () => {
    const path = buildIntakeStoragePath({ ...location, fileName: "My Reg (1).pdf", index: 3 });
    expect(path.startsWith(prefix)).toBe(true);
    expect(path.slice(prefix.length)).toMatch(/^[\w.-]+$/);
  });

  it("accepts a well-formed upload", () => {
    expect(validateUploadedIntakeFiles([good], location).accepted).toHaveLength(1);
  });

  it("rejects another tenant's folder, traversal, and nested paths", () => {
    const other = { ...good, path: `99999999-9999-9999-9999-999999999999/intake/${BATCH}/1-0-reg.pdf` };
    const traversal = { ...good, path: `${prefix}..` };
    const nested = { ...good, path: `${prefix}sub/reg.pdf` };
    const { accepted, rejected } = validateUploadedIntakeFiles([other, traversal, nested], location);

    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(3);
  });

  it("rejects types the reader cannot open and oversize files, with a reason each", () => {
    const heic = { ...good, path: `${prefix}2-1-a.heic`, type: "image/heic" };
    const huge = { ...good, path: `${prefix}3-2-b.pdf`, size: 50 * 1024 * 1024 };
    const { accepted, rejected } = validateUploadedIntakeFiles([heic, huge], location);

    expect(accepted).toHaveLength(0);
    expect(rejected.map((entry) => entry.reason)).toEqual([
      expect.stringContaining("Only PDF"),
      expect.stringContaining("10 MB"),
    ]);
  });

  it("registers the same path once", () => {
    expect(validateUploadedIntakeFiles([good, good], location).accepted).toHaveLength(1);
  });
});
