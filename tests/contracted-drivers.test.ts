import { describe, expect, it } from "vitest";
import {
  contractedDriverCertificationStatuses,
  contractedDriverIdentityRecords,
  contractedDriverMissingTickets,
  contractedDriverObservations,
  contractedDriverOverallTone,
  contractedDriverSiteStandings,
  groupContractedDriverCertifications,
  type ContractedDriverCertificationInput,
  type ContractedDriverDocumentRow,
  type ContractedDriverObservationRow,
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

function identityDocument(
  overrides: Partial<ContractedDriverDocumentRow> = {},
): ContractedDriverDocumentRow {
  return {
    id: "doc-1",
    tenant_id: TENANT,
    contracted_driver_id: DRIVER,
    doc_type: "license",
    title: "Alberta Class 1 licence",
    issued_date: null,
    expiry_date: null,
    attachment_path: "scan.pdf",
    created_by: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const NO_IDENTITY_DATES = {
  license_expiry: null,
  license_province: null,
  abstract_expiry: null,
  abstract_issued: null,
  cso_completed: null,
};

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

describe("the licence, abstract and CSO scans", () => {
  it("hangs a filed document off the record it proves", () => {
    const records = contractedDriverIdentityRecords(
      { ...NO_IDENTITY_DATES, license_expiry: "2027-02-26", license_province: "AB" },
      NOW,
      [identityDocument({ expiry_date: "2027-02-26" })],
    );

    expect(records.find((record) => record.key === "license")?.documents).toHaveLength(1);
  });

  it("says so when the document disagrees with the date being tracked", () => {
    // The case this was built for: an SGI abstract states a licence expiry ten days
    // later than the carrier's sheet recorded, and the app had been carrying the
    // sheet's version. Showing the difference is the whole point of keeping the
    // document's own dates.
    const records = contractedDriverIdentityRecords(
      { ...NO_IDENTITY_DATES, license_expiry: "2027-10-21" },
      NOW,
      [identityDocument({ expiry_date: "2027-10-31" })],
    );

    expect(records.find((record) => record.key === "license")?.mismatch).toEqual({
      tracked: "2027-10-21",
      onDocument: "2027-10-31",
    });
  });

  it("is quiet when the document agrees", () => {
    const records = contractedDriverIdentityRecords(
      { ...NO_IDENTITY_DATES, license_expiry: "2027-02-26" },
      NOW,
      [identityDocument({ expiry_date: "2027-02-26" })],
    );

    expect(records.find((record) => record.key === "license")?.mismatch).toBeNull();
  });

  it("compares an abstract on its issue date, not on an expiry it does not have", () => {
    // An abstract carries no expiry at all. Comparing one would compare against null and
    // report every filed abstract as agreeing, whatever it says.
    const records = contractedDriverIdentityRecords(
      { ...NO_IDENTITY_DATES, abstract_issued: "2024-04-09" },
      NOW,
      [identityDocument({ doc_type: "abstract", issued_date: "2025-04-11", expiry_date: null })],
    );

    expect(records.find((record) => record.key === "abstract")?.mismatch).toEqual({
      tracked: "2024-04-09",
      onDocument: "2025-04-11",
    });
  });

  it("puts the newest document first and keeps the older one as history", () => {
    const records = contractedDriverIdentityRecords(
      { ...NO_IDENTITY_DATES, license_expiry: "2028-06-30" },
      NOW,
      [
        identityDocument({ id: "old", expiry_date: "2023-06-30" }),
        identityDocument({ id: "current", expiry_date: "2028-06-30" }),
      ],
    );

    expect(records.find((record) => record.key === "license")?.documents.map((doc) => doc.id)).toEqual([
      "current",
      "old",
    ]);
  });

  it("shows an abstract that has been filed even when no date is recorded against the driver", () => {
    // The abstract and CSO rows are only built when the driver carries that date, so a
    // scan filed against an empty column would otherwise never be drawn at all.
    const records = contractedDriverIdentityRecords(NO_IDENTITY_DATES, NOW, [
      identityDocument({ doc_type: "abstract", issued_date: "2025-04-11" }),
    ]);

    const abstract = records.find((record) => record.key === "abstract");

    expect(abstract?.documents).toHaveLength(1);
    expect(abstract?.date).toBeNull();
  });

  it("leaves every existing caller alone when no documents are passed", () => {
    const records = contractedDriverIdentityRecords(
      { ...NO_IDENTITY_DATES, license_expiry: "2027-02-26" },
      NOW,
    );

    expect(records.find((record) => record.key === "license")?.documents).toEqual([]);
    expect(records.find((record) => record.key === "license")?.mismatch).toBeNull();
  });
});

function observation(
  overrides: Partial<ContractedDriverObservationRow> = {},
): ContractedDriverObservationRow {
  return {
    id: "obs-1",
    tenant_id: TENANT,
    contracted_driver_id: DRIVER,
    observation_type: "audit",
    title: "PPE audit",
    observed_on: "2026-08-12",
    reported_on: null,
    issuing_company: "Northgate Terminals",
    observer: null,
    location: null,
    outcome: "clear",
    site_access: null,
    findings: null,
    action_taken: null,
    attachment_path: "report.pdf",
    created_by: null,
    deleted_at: null,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("what a client saw the driver do", () => {
  it("orders by the day the work was watched, not the day the report arrived", () => {
    const records = contractedDriverObservations([
      observation({ id: "may", observed_on: "2025-05-23", created_at: "2026-08-29T00:00:00.000Z" }),
      observation({ id: "august", observed_on: "2026-08-12", reported_on: "2026-08-14" }),
      observation({ id: "june", observed_on: "2026-06-17" }),
    ]);

    expect(records.map((record) => record.id)).toEqual(["august", "june", "may"]);
  });

  it("keeps every audit live, because an observation is never superseded", () => {
    // The rule this guards: certifications deliberately dim all but the newest of a
    // name. Six PPE audits are six facts, and dimming five of them would erase the
    // history this table exists to keep.
    const records = contractedDriverObservations([
      observation({ id: "old", observed_on: "2025-05-23", outcome: "deficiencies" }),
      observation({ id: "mid", observed_on: "2025-09-23", outcome: "deficiencies" }),
      observation({ id: "new", observed_on: "2026-08-12", outcome: "clear" }),
    ]);

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.badge.label)).toEqual([
      "Clear",
      "Deficiencies noted",
      "Deficiencies noted",
    ]);
  });

  it("reads a write-up as amber and a failed evaluation as red", () => {
    const [audit] = contractedDriverObservations([observation({ outcome: "deficiencies" })]);
    const [failed] = contractedDriverObservations([
      observation({ observation_type: "evaluation", outcome: "failed" }),
    ]);
    const [passed] = contractedDriverObservations([
      observation({ observation_type: "evaluation", outcome: "clear" }),
    ]);

    expect(audit.badge.tone).toBe("warning");
    expect(failed.badge.tone).toBe("danger");
    expect(passed.badge.label).toBe("Passed");
  });

  it("marks an observation written down with no report attached", () => {
    const [record] = contractedDriverObservations([observation({ attachment_path: null })]);

    expect(record.hasProof).toBe(false);
  });

  it("leaves out an observation that has been removed", () => {
    const records = contractedDriverObservations([
      observation({ id: "kept" }),
      observation({ id: "gone", deleted_at: "2026-08-29T00:00:00.000Z" }),
    ]);

    expect(records.map((record) => record.id)).toEqual(["kept"]);
  });
});

describe("where a driver stands at each client site", () => {
  it("takes the newest evaluation, so a restored access replaces a limited one", () => {
    const standings = contractedDriverSiteStandings(
      contractedDriverObservations([
        observation({
          id: "limited",
          observation_type: "evaluation",
          title: "Driver evaluation load",
          observed_on: "2025-05-20",
          site_access: "limited",
        }),
        observation({
          id: "restored",
          observation_type: "evaluation",
          title: "Driver evaluation load",
          observed_on: "2026-06-17",
          site_access: "unlimited",
        }),
      ]),
    );

    expect(standings).toHaveLength(1);
    expect(standings[0].access).toBe("unlimited");
    expect(standings[0].since).toBe("2026-06-17");
  });

  it("keeps one standing per client", () => {
    const standings = contractedDriverSiteStandings(
      contractedDriverObservations([
        observation({
          id: "northgate",
          observation_type: "evaluation",
          observed_on: "2026-06-17",
          issuing_company: "Northgate Terminals",
          site_access: "unlimited",
        }),
        observation({
          id: "ardmore",
          observation_type: "evaluation",
          observed_on: "2026-01-26",
          issuing_company: "Ardmore Energy",
          site_access: "limited",
        }),
      ]),
    );

    // Sorted by client, so the list reads the same way twice running.
    expect(standings.map((standing) => [standing.company, standing.access])).toEqual([
      ["Ardmore Energy", "limited"],
      ["Northgate Terminals", "unlimited"],
    ]);
  });

  it("says nothing when no report states an access level", () => {
    const standings = contractedDriverSiteStandings(
      contractedDriverObservations([observation({ observed_on: "2026-08-12", outcome: "deficiencies" })]),
    );

    expect(standings).toEqual([]);
  });

  it("lets an audit restrict a driver, because one did", () => {
    // 23 May 2025: a PPE audit cut this driver to 8am-4pm three days after an evaluation
    // had granted him unlimited access. Reading evaluations only would show "unlimited"
    // beside a report saying otherwise. See migration 20260829200000.
    const standings = contractedDriverSiteStandings(
      contractedDriverObservations([
        observation({
          id: "granted",
          observation_type: "evaluation",
          observed_on: "2025-05-20",
          site_access: "unlimited",
        }),
        observation({
          id: "restricted",
          observation_type: "audit",
          title: "PPE audit",
          observed_on: "2025-05-23",
          outcome: "deficiencies",
          site_access: "limited",
        }),
      ]),
    );

    expect(standings[0].access).toBe("limited");
    expect(standings[0].since).toBe("2025-05-23");
  });

  it("says nothing about a client an evaluation does not name", () => {
    const standings = contractedDriverSiteStandings(
      contractedDriverObservations([
        observation({ observation_type: "evaluation", issuing_company: null, site_access: "unlimited" }),
      ]),
    );

    expect(standings).toEqual([]);
  });

  it("counts write-ups since the standing, and ignores the ones before it", () => {
    const standings = contractedDriverSiteStandings(
      contractedDriverObservations([
        observation({ id: "before", observed_on: "2025-09-23", outcome: "deficiencies" }),
        observation({
          id: "evaluation",
          observation_type: "evaluation",
          observed_on: "2026-06-17",
          site_access: "unlimited",
        }),
        observation({ id: "after", observed_on: "2026-07-02", outcome: "deficiencies" }),
        observation({ id: "clean", observed_on: "2026-08-12", outcome: "clear" }),
      ]),
    );

    expect(standings[0].deficienciesSince).toBe(1);
    expect(standings[0].latestDeficiencyOn).toBe("2026-07-02");
  });

  it("does not count the report that set the standing against itself", () => {
    const standings = contractedDriverSiteStandings(
      contractedDriverObservations([
        observation({
          observation_type: "evaluation",
          observed_on: "2026-06-17",
          outcome: "deficiencies",
          site_access: "limited",
        }),
      ]),
    );

    expect(standings[0].deficienciesSince).toBe(0);
  });
});

describe("observations and the driver's compliance", () => {
  it("never colours the driver, however badly an evaluation went", () => {
    // Structural, and deliberately so: contractedDriverOverallTone cannot see
    // observations at all. If someone ever passes them in, this test is where the
    // argument for not doing it is written down. An audit that found deficiencies is
    // coaching that was recorded, not a lapsed ticket, and a carrier who learns that
    // forwarding one turns their driver red stops forwarding them.
    const tone = contractedDriverOverallTone({
      identity: contractedDriverIdentityRecords({ ...NO_IDENTITY_DATES, license_expiry: "2027-09-16" }, NOW),
      certifications: contractedDriverCertificationStatuses({ certifications: [certification()] }, NOW),
      missingMandatory: [],
    });

    expect(tone).toBe("success");
  });
});
