import { describe, expect, it } from "vitest";
import {
  contractedDriverCertificationStatuses,
  contractedDriverIdentityRecords,
  contractedDriverMissingTickets,
  contractedDriverOverallTone,
  groupContractedDriverCertifications,
  type ContractedDriverCertificationInput,
} from "@/lib/contracted-drivers";

const NOW = new Date("2026-08-26T00:00:00.000Z");

const TENANT = "11111111-1111-1111-1111-111111111111";
const DRIVER = "55555555-5555-5555-5555-555555555555";
const H2S = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SITE_ORIENTATION = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function certification(
  overrides: Partial<ContractedDriverCertificationInput> = {},
): ContractedDriverCertificationInput {
  return {
    id: "cert-1",
    tenant_id: TENANT,
    contracted_driver_id: DRIVER,
    certification_type_id: H2S,
    name: "H2S Alive",
    issued_on: "2025-01-01",
    expires_on: "2027-01-01",
    issuing_company: null,
    detail: null,
    attachment_path: "scan.pdf",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    typeCategory: "ticket",
    typeName: "H2S Alive",
    ...overrides,
  };
}

describe("a contracted driver's records", () => {
  it("sorts a ticket, an orientation and a badge into their own sections", () => {
    const statuses = contractedDriverCertificationStatuses({
      certifications: [
        certification(),
        certification({ id: "c2", typeCategory: "orientation", typeName: "Refinery orientation" }),
        certification({ id: "c3", typeCategory: "site_access", typeName: "Terminal badge" }),
      ],
    });

    const grouped = groupContractedDriverCertifications(statuses);

    expect(grouped.ticket.map((entry) => entry.label)).toEqual(["H2S Alive"]);
    expect(grouped.orientation.map((entry) => entry.label)).toEqual(["Refinery orientation"]);
    expect(grouped.site_access.map((entry) => entry.label)).toEqual(["Terminal badge"]);
  });

  it("only ever marks a mandatory ticket as expected", () => {
    // An orientation is never expected of everyone: a driver who does not run to that
    // client's site is not short of anything, and calling it a gap buries the driver who
    // genuinely has no H2S.
    const statuses = contractedDriverCertificationStatuses({
      certifications: [
        certification(),
        certification({ id: "c2", certification_type_id: SITE_ORIENTATION, typeCategory: "orientation" }),
      ],
      mandatoryTicketTypeIds: [H2S, SITE_ORIENTATION],
    });

    expect(statuses.find((entry) => entry.id === "cert-1")?.expected).toBe(true);
    expect(statuses.find((entry) => entry.id === "c2")?.expected).toBe(false);
  });

  it("reads a dated ticket with no scan as unproven rather than current", () => {
    const [status] = contractedDriverCertificationStatuses({
      certifications: [certification({ attachment_path: null })],
    });

    expect(status.hasProof).toBe(false);
    expect(status.status.tone).toBe("unproven");
  });

  it("does not call a never-expiring record overdue", () => {
    const [status] = contractedDriverCertificationStatuses({
      certifications: [certification({ expires_on: null })],
    });

    expect(status.status.tone).not.toBe("danger");
  });
});

describe("licence and abstract", () => {
  it("shows an abstract expiry as an expiry", () => {
    const records = contractedDriverIdentityRecords(
      {
        license_expiry: "2028-01-01",
        license_province: "AB",
        abstract_expiry: "2027-05-14",
        abstract_issued: null,
        cso_completed: null,
      },
      NOW,
    );

    expect(records.find((record) => record.key === "abstract")?.tracksExpiry).toBe(true);
  });

  it("shows an abstract with only an issue date as dated, not as an expiry", () => {
    // Their two sheets disagree: one tracks when the abstract expires, the
    // other tracks when it was pulled. An issue date is not a deadline, and calling
    // a stale abstract a deficiency would be wrong.
    const records = contractedDriverIdentityRecords(
      {
        license_expiry: "2028-01-01",
        license_province: "AB",
        abstract_expiry: null,
        abstract_issued: "2024-09-03",
        cso_completed: null,
      },
      NOW,
    );

    const abstract = records.find((record) => record.key === "abstract");

    expect(abstract?.tracksExpiry).toBe(false);
    expect(abstract?.status.tone).toBe("neutral");
  });

  it("treats the CSO as completed rather than as expiring", () => {
    const records = contractedDriverIdentityRecords(
      {
        license_expiry: null,
        license_province: null,
        abstract_expiry: null,
        abstract_issued: null,
        cso_completed: "2024-02-04",
      },
      NOW,
    );

    expect(records.find((record) => record.key === "cso")?.status.label).toBe("Completed");
  });
});

describe("missing mandatory tickets", () => {
  it("names a mandatory ticket the driver holds nothing for", () => {
    const missing = contractedDriverMissingTickets({
      certifications: [certification()],
      mandatoryTickets: [
        { id: H2S, name: "H2S Alive" },
        { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", name: "First Aid" },
      ],
    });

    expect(missing.map((ticket) => ticket.name)).toEqual(["First Aid"]);
  });
});

describe("how a driver reads at a glance", () => {
  it("is red when a mandatory ticket is not on file at all", () => {
    expect(
      contractedDriverOverallTone({
        identity: [],
        certifications: [],
        missingMandatory: [{ id: H2S }],
      }),
    ).toBe("danger");
  });

  it("ignores a lapsed orientation, which stops one gate rather than the driver", () => {
    const statuses = contractedDriverCertificationStatuses(
      {
        certifications: [
          certification({ expires_on: "2028-01-01" }),
          certification({
            id: "c2",
            typeCategory: "orientation",
            expires_on: "2020-01-01",
          }),
        ],
      },
      NOW,
    );

    expect(
      contractedDriverOverallTone({
        identity: [],
        certifications: statuses,
        missingMandatory: [],
      }),
    ).toBe("success");
  });

  it("is red when the licence itself has lapsed", () => {
    const identity = contractedDriverIdentityRecords(
      {
        license_expiry: "2020-01-01",
        license_province: "AB",
        abstract_expiry: null,
        abstract_issued: null,
        cso_completed: null,
      },
      NOW,
    );

    expect(contractedDriverOverallTone({ identity, certifications: [], missingMandatory: [] })).toBe("danger");
  });
});

describe("renewal history", () => {
  // The rule the whole historical load turns on: only the newest record of a kind speaks
  // for the driver. Without it a ticket renewed three times reads as one certificate and
  // two deficiencies, and the driver goes red on a roster they belong at the top of.
  function h2s(id: string, expires: string | null, overrides: Partial<ContractedDriverCertificationInput> = {}) {
    return certification({ id, expires_on: expires, typeName: "H2S Alive", ...overrides });
  }

  it("keeps only the newest as live and marks the rest history", () => {
    const statuses = contractedDriverCertificationStatuses(
      { certifications: [h2s("old", "2024-01-01"), h2s("new", "2028-01-01"), h2s("older", "2022-01-01")] },
      NOW,
    );

    const live = statuses.filter((entry) => !entry.superseded);

    expect(live).toHaveLength(1);
    expect(live[0].id).toBe("new");
    expect(statuses.filter((entry) => entry.superseded).map((entry) => entry.id).sort()).toEqual([
      "old",
      "older",
    ]);
  });

  it("gives a superseded record no colour of its own", () => {
    const statuses = contractedDriverCertificationStatuses(
      { certifications: [h2s("old", "2024-01-01"), h2s("new", "2028-01-01")] },
      NOW,
    );
    const old = statuses.find((entry) => entry.id === "old");

    // Long expired, but replaced. Saying "Deficiency" here is the exact noise the rule
    // exists to remove.
    expect(old?.status.tone).toBe("neutral");
    expect(old?.status.label).toBe("Superseded");
  });

  it("does not let an expired history record turn the driver red", () => {
    const statuses = contractedDriverCertificationStatuses(
      { certifications: [h2s("old", "2020-01-01"), h2s("new", "2028-01-01")] },
      NOW,
    );

    expect(
      contractedDriverOverallTone({ identity: [], certifications: statuses, missingMandatory: [] }),
    ).toBe("success");
  });

  it("still goes red when the newest one is itself expired", () => {
    const statuses = contractedDriverCertificationStatuses(
      { certifications: [h2s("old", "2020-01-01"), h2s("newest", "2024-01-01")] },
      NOW,
    );

    expect(
      contractedDriverOverallTone({ identity: [], certifications: statuses, missingMandatory: [] }),
    ).toBe("danger");
  });

  it("does not let an undated record displace a dated one", () => {
    // An undated acknowledgement says nothing about when the dated certificate beside it
    // runs out, so it must never become the record that speaks for the driver.
    const statuses = contractedDriverCertificationStatuses(
      { certifications: [h2s("dated", "2028-01-01"), h2s("undated", null)] },
      NOW,
    );

    expect(statuses.find((entry) => !entry.superseded)?.id).toBe("dated");
  });

  it("keeps different certifications apart", () => {
    const statuses = contractedDriverCertificationStatuses(
      {
        certifications: [
          h2s("h2s", "2028-01-01"),
          certification({ id: "fa", typeName: "Standard First Aid", expires_on: "2027-01-01" }),
        ],
      },
      NOW,
    );

    expect(statuses.filter((entry) => entry.superseded)).toEqual([]);
  });

  it("does not merge a ticket with an orientation that shares a name", () => {
    const statuses = contractedDriverCertificationStatuses(
      {
        certifications: [
          certification({ id: "t", typeName: "Site training", typeCategory: "ticket", expires_on: "2028-01-01" }),
          certification({
            id: "o",
            typeName: "Site training",
            typeCategory: "orientation",
            expires_on: "2020-01-01",
          }),
        ],
      },
      NOW,
    );

    expect(statuses.filter((entry) => entry.superseded)).toEqual([]);
  });
});
