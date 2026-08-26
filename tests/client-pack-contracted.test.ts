import { describe, expect, it } from "vitest";
import {
  parseContractedDriverCertifications,
  parseContractedDrivers,
  parseContractedEquipment,
  type RawSheet,
} from "@/lib/client-pack/parse";
import {
  planContractedDriverCertifications,
  planContractedDrivers,
  planContractedEquipment,
  planContractedEquipmentCertifications,
  type TenantSnapshot,
} from "@/lib/client-pack/plan";

const EMPTY: TenantSnapshot = {
  users: [],
  locations: [],
  equipment: [],
  certifications: [],
  unitCertifications: [],
  subcontractors: [],
  contractedCompanyDocuments: [],
  contractedEquipment: [],
  contractedDrivers: [],
  contractedEquipmentCertifications: [],
  contractedDriverCertifications: [],
};

function sheet(header: string[], rows: unknown[][]): RawSheet {
  return { headerRowNumber: 1, header, rows };
}

describe("parsing contracted equipment", () => {
  it("reads a row and splits the inspection list on semicolons", () => {
    const result = parseContractedEquipment(
      sheet(
        ["unit_number", "company", "vin", "plate", "cvip_expiry", "inspections"],
        [["7710", "Delta Hauling Ltd.", "1AAAAAAAAAAAAAAAA", "ABC-123", "2027-01-15", "Product hose; Belly hose certification"]],
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0].unitNumber).toBe("7710");
    expect(result.rows[0].company).toBe("Delta Hauling Ltd.");
    expect(result.rows[0].cvipExpiry).toBe("2027-01-15");
    // Commas must not split: "PIUC - pressure, internal, upper coupler" is one name.
    expect(result.rows[0].inspections).toEqual(["Product hose", "Belly hose certification"]);
  });

  it("refuses a row with no company rather than filing it against nobody", () => {
    const result = parseContractedEquipment(sheet(["unit_number", "company"], [["7710", ""]]));

    expect(result.rows).toEqual([]);
    expect(result.errors[0].column).toBe("company");
  });
});

describe("planning contracted equipment", () => {
  it("reports a unit whose carrier is nowhere to be found", () => {
    const { items, errors } = planContractedEquipment(
      [
        {
          rowNumber: 2,
          unitNumber: "7710",
          company: "Nobody Hauling Ltd.",
          ownerName: null,
          year: null,
          make: null,
          modelOrColour: null,
          vin: null,
          plate: null,
          registrationProvince: null,
          status: "active",
          notes: null,
          cvipExpiry: null,
          registrationExpiry: null,
          inspections: [],
        },
      ],
      EMPTY,
      [],
    );

    expect(items).toEqual([]);
    expect(errors[0].message).toContain("Nobody Hauling Ltd.");
  });

  it("accepts a carrier that this same pack introduces", () => {
    const { items, errors } = planContractedEquipment(
      [
        {
          rowNumber: 2,
          unitNumber: "7710",
          company: "New Carrier Ltd.",
          ownerName: null,
          year: null,
          make: null,
          modelOrColour: null,
          vin: null,
          plate: null,
          registrationProvince: null,
          status: "active",
          notes: null,
          cvipExpiry: null,
          registrationExpiry: null,
          inspections: [],
        },
      ],
      EMPTY,
      [
        {
          rowNumber: 2,
          legalName: "New Carrier Ltd.",
          operatingName: null,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          nscNumber: null,
          wcbAccountNumber: null,
          craBusinessNumber: null,
          notes: null,
        },
      ],
    );

    expect(errors).toEqual([]);
    expect(items[0].action).toBe("create");
  });
});

describe("planning contracted unit certificates", () => {
  const unitSnapshot: TenantSnapshot = {
    ...EMPTY,
    contractedEquipment: [{ id: "u1", unitNumber: "7710", subcontractorId: "c1" }],
  };

  function certRow(component: string | null) {
    return {
      rowNumber: 2,
      unitNumber: "7710",
      certificationType: "Product hose",
      issuedOn: null,
      expiresOn: "2027-06-01",
      componentId: component,
    };
  }

  it("keeps a primary and a spare apart instead of overwriting one with the other", () => {
    // The bug this guards: keying on (unit, type) alone resolves both hoses to one
    // stored record, and the second write silently destroys the first.
    const { items } = planContractedEquipmentCertifications(
      [certRow("primary"), { ...certRow("spare"), rowNumber: 3 }],
      {
        ...unitSnapshot,
        contractedEquipmentCertifications: [
          { id: "d1", contractedEquipmentId: "u1", label: "Product hose - primary" },
        ],
      },
      [],
    );

    expect(items[0].action).toBe("update");
    expect(items[0].existingId).toBe("d1");
    expect(items[1].action).toBe("create");
  });

  it("reports a certificate for a unit that does not exist", () => {
    const { items, errors } = planContractedEquipmentCertifications(
      [{ ...certRow(null), unitNumber: "9999" }],
      unitSnapshot,
      [],
    );

    expect(items).toEqual([]);
    expect(errors[0].message).toContain("9999");
  });
});

describe("planning contracted drivers", () => {
  const twoCarriers: TenantSnapshot = {
    ...EMPTY,
    subcontractors: [
      { id: "c1", legalName: "Alpha Hauling Ltd." },
      { id: "c2", legalName: "Beta Trucking Ltd." },
    ],
  };

  function driverRow(company: string, name = "John Smith", rowNumber = 2) {
    return {
      rowNumber,
      fullName: name,
      company,
      unitNumber: null,
      licenseProvince: null,
      licenseExpiry: null,
      abstractIssued: null,
      abstractExpiry: null,
      csoCompleted: null,
      driverType: "contracted" as const,
      status: "active" as const,
      notes: null,
    };
  }

  it("lets two carriers each employ a driver of the same name", () => {
    const { items, errors } = planContractedDrivers(
      [driverRow("Alpha Hauling Ltd."), driverRow("Beta Trucking Ltd.", "John Smith", 3)],
      twoCarriers,
      [],
    );

    expect(errors).toEqual([]);
    expect(items).toHaveLength(2);
  });

  it("rejects the same driver twice at the same carrier", () => {
    const { errors } = planContractedDrivers(
      [driverRow("Alpha Hauling Ltd."), driverRow("Alpha Hauling Ltd.", "John Smith", 3)],
      twoCarriers,
      [],
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
  });
});

describe("planning contracted driver tickets", () => {
  it("resolves a driver by company AND name, never by name alone", () => {
    // Two carriers each employ a John Smith. Matching on the name alone would file one
    // carrier's ticket onto the other carrier's driver.
    const snapshot: TenantSnapshot = {
      ...EMPTY,
      subcontractors: [
        { id: "c1", legalName: "Alpha Hauling Ltd." },
        { id: "c2", legalName: "Beta Trucking Ltd." },
      ],
      contractedDrivers: [
        { id: "d1", fullName: "John Smith", subcontractorId: "c1" },
        { id: "d2", fullName: "John Smith", subcontractorId: "c2" },
      ],
    };

    const { items, errors } = planContractedDriverCertifications(
      [
        {
          rowNumber: 2,
          driverName: "John Smith",
          company: "Beta Trucking Ltd.",
          certificationType: "H2S Alive",
          category: "ticket",
          issuedOn: null,
          expiresOn: "2027-01-01",
          issuingCompany: null,
          detail: null,
        },
      ],
      snapshot,
      [],
    );

    expect(errors).toEqual([]);
    expect(items[0].row.contractedDriverId).toBe("d2");
  });
});

describe("parsing contracted driver records", () => {
  it("defaults an unlabelled row to a ticket and reads an explicit category", () => {
    const result = parseContractedDriverCertifications(
      sheet(
        ["driver_name", "company", "certification_type", "category", "expires_on", "detail"],
        [
          ["John Smith", "Alpha Hauling Ltd.", "H2S Alive", "", "2027-01-01", ""],
          ["John Smith", "Alpha Hauling Ltd.", "Refinery orientation", "orientation", "2027-02-01", ""],
          ["John Smith", "Alpha Hauling Ltd.", "Terminal badge", "site access", "", "PIN 1234"],
        ],
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.category)).toEqual(["ticket", "orientation", "site_access"]);
    // A badge with no expiry is a real record, not a broken one.
    expect(result.rows[2].expiresOn).toBeNull();
    expect(result.rows[2].detail).toBe("PIN 1234");
  });
});

describe("parsing contracted drivers", () => {
  it("keeps both abstract dates apart, because the two sheets disagree", () => {
    const result = parseContractedDrivers(
      sheet(
        ["full_name", "company", "abstract_issued", "abstract_expiry"],
        [["John Smith", "Alpha Hauling Ltd.", "2024-09-03", ""]],
      ),
    );

    expect(result.rows[0].abstractIssued).toBe("2024-09-03");
    expect(result.rows[0].abstractExpiry).toBeNull();
  });
});
