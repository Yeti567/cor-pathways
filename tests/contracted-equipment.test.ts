import { describe, expect, it } from "vitest";
import {
  contractedStoragePrefix,
  contractedUnitCertificationStatuses,
  contractedUnitFileStatuses,
  contractedUnitOverallState,
  parseUploadedContractedAttachmentPaths,
  rollUpContractedFleet,
  summarizeContractedUnit,
  type ContractedEquipmentDocumentRow,
  type ContractedStorageLocation,
} from "@/lib/contracted-equipment";

const NOW = new Date("2026-08-26T00:00:00.000Z");

const TENANT = "11111111-1111-1111-1111-111111111111";
const CARRIER = "22222222-2222-2222-2222-222222222222";
const OTHER_CARRIER = "33333333-3333-3333-3333-333333333333";
const UNIT = "44444444-4444-4444-4444-444444444444";

const LOCATION: ContractedStorageLocation = {
  tenantId: TENANT,
  subcontractorId: CARRIER,
  subjectId: UNIT,
  scope: "contracted-equipment",
};

const HOSE_TYPE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EXTINGUISHER_TYPE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const TYPES = [
  { id: HOSE_TYPE, name: "Product hose", appliesByDefault: false },
  { id: EXTINGUISHER_TYPE, name: "Fire extinguisher inspection", appliesByDefault: true },
];

function document(overrides: Partial<ContractedEquipmentDocumentRow> = {}): ContractedEquipmentDocumentRow {
  return {
    id: "doc-1",
    tenant_id: TENANT,
    contracted_equipment_id: UNIT,
    doc_type: "certification",
    certification_type_id: null,
    title: "Certificate",
    issued_date: null,
    expiry_date: "2027-01-01",
    reminder_lead_days: 30,
    attachment_ids: [],
    is_active: true,
    created_by: null,
    deleted_at: null,
    action_metadata: {},
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("contracted unit documents with no expiry", () => {
  // The whole reason contracted_equipment_document.expiry_date is nullable where the
  // fleet's own column is not. A fire extinguisher tag carrying a serial and no printed
  // date is a real certificate; the fleet load lost 52 of them to the not-null column.
  it("reads as on file when a scan is attached", () => {
    const [status] = contractedUnitCertificationStatuses(
      {
        category: "vehicle",
        certificationTypes: TYPES,
        requiredTypeIds: [EXTINGUISHER_TYPE],
        documents: [
          document({
            certification_type_id: EXTINGUISHER_TYPE,
            expiry_date: null,
            attachment_ids: ["scan.pdf"],
          }),
        ],
      },
      NOW,
    );

    expect(status.state).toBe("on_file");
    expect(status.expiryDate).toBeNull();
  });

  it("reads as awaiting proof, never expired, when there is no scan", () => {
    const [status] = contractedUnitCertificationStatuses(
      {
        category: "vehicle",
        certificationTypes: TYPES,
        requiredTypeIds: [EXTINGUISHER_TYPE],
        documents: [document({ certification_type_id: EXTINGUISHER_TYPE, expiry_date: null })],
      },
      NOW,
    );

    expect(status.state).toBe("awaiting_proof");
  });
});

describe("which inspections a contracted unit is held to", () => {
  it("uses the ticked list when there is one", () => {
    const statuses = contractedUnitCertificationStatuses(
      { category: "vehicle", certificationTypes: TYPES, requiredTypeIds: [HOSE_TYPE], documents: [] },
      NOW,
    );

    expect(statuses.map((status) => status.label)).toEqual(["Product hose"]);
  });

  it("treats an empty tick list as held to nothing, not as unset", () => {
    // The trap this guards: an empty array collapsing back into the defaults silently
    // refills a unit somebody deliberately cleared.
    const statuses = contractedUnitCertificationStatuses(
      { category: "vehicle", certificationTypes: TYPES, requiredTypeIds: [], documents: [] },
      NOW,
    );

    expect(statuses).toEqual([]);
  });

  it("falls back to the default-on types when nobody has chosen", () => {
    const statuses = contractedUnitCertificationStatuses(
      { category: "vehicle", certificationTypes: TYPES, requiredTypeIds: null, documents: [] },
      NOW,
    );

    expect(statuses.map((status) => status.label)).toEqual(["Fire extinguisher inspection"]);
  });
});

describe("two certificates of one type on one unit", () => {
  // A tractor carries a primary and a spare product hose, and two extinguishers of
  // different sizes. They must not collapse into one overwritten row.
  it("keeps the freshest expiry and does not lose the second record", () => {
    const statuses = contractedUnitCertificationStatuses(
      {
        category: "vehicle",
        certificationTypes: TYPES,
        requiredTypeIds: [HOSE_TYPE],
        documents: [
          document({
            id: "hose-primary",
            certification_type_id: HOSE_TYPE,
            title: "Product hose",
            expiry_date: "2026-09-01",
            attachment_ids: ["primary.pdf"],
          }),
          document({
            id: "hose-spare",
            certification_type_id: HOSE_TYPE,
            title: "Product hose (spare)",
            expiry_date: "2027-06-01",
            attachment_ids: ["spare.pdf"],
          }),
        ],
      },
      NOW,
    );

    expect(statuses).toHaveLength(1);
    expect(statuses[0].expiryDate).toBe("2027-06-01");
    expect(statuses[0].state).toBe("on_file");
  });
});

describe("a tractor's fixed files", () => {
  it("expects a registration and CVIP, and treats permits as optional", () => {
    const statuses = contractedUnitFileStatuses({ category: "vehicle", documents: [] }, NOW);
    const required = statuses.filter((status) => status.required).map((status) => status.docType);

    expect(required).toContain("registration");
    expect(required).toContain("cvip");
    expect(statuses.find((status) => status.docType === "permit")?.required).toBe(false);
  });

  // The fleet's own power units still carry a pink card; only the contracted side drops
  // it, because a hired carrier insures its whole fleet under one policy filed against
  // the company. A row here would ask 73 tractors for a document filed 38 times.
  it("never asks a contracted tractor for its own pink card", () => {
    const statuses = contractedUnitFileStatuses({ category: "vehicle", documents: [] }, NOW);

    expect(statuses.map((status) => status.docType)).not.toContain("insurance");
  });

  // An insurance row left over from before the change must not resurrect the file, and
  // must not quietly count as proof of something else either.
  it("ignores an insurance document that is still on the unit", () => {
    const statuses = contractedUnitFileStatuses(
      {
        category: "vehicle",
        documents: [document({ doc_type: "insurance", expiry_date: "2028-01-01", attachment_ids: ["i.pdf"] })],
      },
      NOW,
    );

    expect(statuses.map((status) => status.docType)).not.toContain("insurance");
    expect(statuses.every((status) => status.expiryDate !== "2028-01-01")).toBe(true);
  });
});

describe("how a unit reads at a glance", () => {
  it("does not go red for an optional file nobody has filed", () => {
    expect(
      contractedUnitOverallState([
        { state: "on_file", required: true },
        { state: "missing", required: false },
      ]),
    ).toBe("on_file");
  });

  it("takes the worst state that counts", () => {
    expect(
      contractedUnitOverallState([
        { state: "on_file", required: true },
        { state: "due_soon", required: true },
        { state: "expired", required: true },
      ]),
    ).toBe("expired");
  });
});

describe("carrier rollup", () => {
  it("counts units, not documents, so one bad truck is one problem", () => {
    const deficient = summarizeContractedUnit(
      {
        category: "vehicle",
        certificationTypes: TYPES,
        requiredTypeIds: [EXTINGUISHER_TYPE],
        documents: [],
      },
      NOW,
    );
    const clean = summarizeContractedUnit(
      {
        category: "vehicle",
        certificationTypes: TYPES,
        requiredTypeIds: [],
        documents: [
          // Registration and CVIP are the whole required set for a contracted tractor.
          document({ doc_type: "registration", expiry_date: "2028-01-01", attachment_ids: ["r.pdf"] }),
          document({ doc_type: "cvip", expiry_date: "2028-01-01", attachment_ids: ["c.pdf"] }),
        ],
      },
      NOW,
    );

    const rollup = rollUpContractedFleet([deficient, clean]);

    expect(rollup.units).toBe(2);
    expect(rollup.deficient).toBe(1);
    expect(rollup.clean).toBe(1);
  });
});

describe("upload paths are not trusted", () => {
  it("keeps a path directly inside this unit's own folder", () => {
    const prefix = contractedStoragePrefix(LOCATION);

    expect(parseUploadedContractedAttachmentPaths([`${prefix}1234-0-cvip.pdf`], LOCATION)).toEqual([
      `${prefix}1234-0-cvip.pdf`,
    ]);
  });

  it("drops another carrier's folder, another tenant's, a nested path and a traversal", () => {
    const prefix = contractedStoragePrefix(LOCATION);
    const otherCarrier = contractedStoragePrefix({ ...LOCATION, subcontractorId: OTHER_CARRIER });

    expect(
      parseUploadedContractedAttachmentPaths(
        [
          `${otherCarrier}1234-0-cvip.pdf`,
          `99999999-9999-9999-9999-999999999999/${CARRIER}/contracted-equipment/${UNIT}/x.pdf`,
          `${prefix}nested/deeper.pdf`,
          `${prefix}..`,
          `${prefix}../../escape.pdf`,
        ],
        LOCATION,
      ),
    ).toEqual([]);
  });

  it("puts the carrier second so the portal policy can scope a carrier to its own files", () => {
    // can_access_subcontractor_storage_path reads folder[2] as the carrier. If that ever
    // stops being a carrier uuid, a portal login would reach the wrong company's scans.
    expect(contractedStoragePrefix(LOCATION).split("/").slice(0, 2)).toEqual([TENANT, CARRIER]);
  });
});
