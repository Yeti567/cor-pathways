import { describe, expect, it } from "vitest";
import {
  buildUnitCertificationStatuses,
  certificationTypeNameMap,
  unitCertificationGaps,
  unitCertificationLabel,
  unitExpectsCertifications,
  type UnitCertificationDocumentInput,
  type UnitCertificationTypeInput,
} from "@/lib/equipment";

const now = new Date("2026-05-24T12:00:00Z");

const PICKER: UnitCertificationTypeInput = { id: "type-picker", name: "Crane / picker inspection" };
const TANK: UnitCertificationTypeInput = { id: "type-tank", name: "Tank inspection (CSA B620)" };

function certification(input: Partial<UnitCertificationDocumentInput> = {}): UnitCertificationDocumentInput {
  return {
    certificationTypeId: PICKER.id,
    docType: "certification",
    expiryDate: "2026-12-01",
    isActive: true,
    reminderLeadDays: 30,
    title: null,
    ...input,
  };
}

describe("unit certification statuses", () => {
  it("reports a type the unit has never filed as a gap", () => {
    const statuses = buildUnitCertificationStatuses({ certificationTypes: [PICKER, TANK], documents: [] }, now);

    expect(statuses.map((status) => [status.label, status.state])).toEqual([
      ["Crane / picker inspection", "missing"],
      ["Tank inspection (CSA B620)", "missing"],
    ]);
    expect(unitCertificationGaps(statuses)).toHaveLength(2);
  });

  it("ages a filed certification off its own reminder lead", () => {
    const statuses = buildUnitCertificationStatuses(
      {
        certificationTypes: [PICKER],
        documents: [certification({ expiryDate: "2026-06-10" })],
      },
      now,
    );

    expect(statuses[0]).toMatchObject({ state: "due_soon", daysUntilExpiry: 17 });
    // A renewal window is not a deficiency at an audit.
    expect(unitCertificationGaps(statuses)).toEqual([]);
  });

  it("counts a lapsed certification as a gap", () => {
    const statuses = buildUnitCertificationStatuses(
      { certificationTypes: [PICKER], documents: [certification({ expiryDate: "2026-04-01" })] },
      now,
    );

    expect(statuses[0].state).toBe("expired");
    expect(unitCertificationGaps(statuses)).toHaveLength(1);
  });

  it("lets the freshest certificate represent the type", () => {
    const statuses = buildUnitCertificationStatuses(
      {
        certificationTypes: [PICKER],
        documents: [
          certification({ expiryDate: "2025-04-01" }),
          certification({ expiryDate: "2027-04-01" }),
        ],
      },
      now,
    );

    // One line, not one per renewal, and last year's expired copy does not win.
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ state: "on_file", expiryDate: "2027-04-01" });
  });

  it("ignores documents that are not active certifications", () => {
    const statuses = buildUnitCertificationStatuses(
      {
        certificationTypes: [PICKER],
        documents: [
          certification({ docType: "registration", certificationTypeId: null, title: "Registration" }),
          certification({ isActive: false, expiryDate: "2026-04-01" }),
        ],
      },
      now,
    );

    expect(statuses[0].state).toBe("missing");
  });

  it("shows a free-text certification without ever counting it as a gap", () => {
    const statuses = buildUnitCertificationStatuses(
      {
        certificationTypes: [PICKER],
        documents: [
          certification({ certificationTypeId: null, title: "Boom inspection", expiryDate: "2026-04-01" }),
        ],
      },
      now,
    );

    expect(statuses).toHaveLength(2);
    expect(statuses[1]).toMatchObject({ label: "Boom inspection", state: "expired", expected: false });
    // The free-text one is expired, but nobody expects it, so only the never-filed
    // picker inspection counts against this unit.
    expect(unitCertificationGaps(statuses).map((gap) => gap.label)).toEqual(["Crane / picker inspection"]);
  });

  it("keeps a certificate visible after its type is deleted from the list", () => {
    const statuses = buildUnitCertificationStatuses(
      {
        certificationTypes: [PICKER],
        documents: [certification({ certificationTypeId: "type-deleted", title: "Pressure test" })],
      },
      now,
    );

    expect(statuses.map((status) => [status.label, status.expected])).toEqual([
      ["Crane / picker inspection", true],
      ["Pressure test", false],
    ]);
  });

  it("treats a unit with no expected types as tracking only what it filed", () => {
    const statuses = buildUnitCertificationStatuses(
      { certificationTypes: [], documents: [certification({ certificationTypeId: null, title: "Boom inspection" })] },
      now,
    );

    expect(statuses.map((status) => status.label)).toEqual(["Boom inspection"]);
    expect(unitCertificationGaps(statuses)).toEqual([]);
  });

  it("follows a rename even on a unit that is not held to the list", () => {
    // A generator expects nothing, but if someone filed a certification against it, that
    // certification should still be called whatever the list calls it today.
    const statuses = buildUnitCertificationStatuses(
      {
        certificationTypes: [],
        certificationTypeNames: certificationTypeNameMap([{ id: PICKER.id, name: "Picker inspection (annual)" }]),
        documents: [certification({ title: "Crane / picker inspection" })],
      },
      now,
    );

    expect(statuses.map((status) => [status.label, status.expected])).toEqual([
      ["Picker inspection (annual)", false],
    ]);
  });
});

describe("unit certification labels", () => {
  it("resolves the current type name rather than the title frozen in at upload", () => {
    const names = certificationTypeNameMap([{ id: PICKER.id, name: "Picker inspection (renamed)" }]);

    expect(unitCertificationLabel({ certificationTypeId: PICKER.id, title: "Crane / picker inspection" }, names)).toBe(
      "Picker inspection (renamed)",
    );
  });

  it("falls back to the title when there is no type", () => {
    expect(unitCertificationLabel({ certificationTypeId: null, title: "  Boom inspection " }, new Map())).toBe(
      "Boom inspection",
    );
  });
});

describe("which units are held to the certification list", () => {
  it("expects certifications on road units only", () => {
    expect(unitExpectsCertifications("vehicle")).toBe(true);
    expect(unitExpectsCertifications("trailer")).toBe(true);
    // A picker inspection expected on a bench grinder is noise that buries real gaps.
    expect(unitExpectsCertifications("small_tool")).toBe(false);
  });
});
