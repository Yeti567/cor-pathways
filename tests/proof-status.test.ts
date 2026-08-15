import { describe, expect, it } from "vitest";
import {
  buildUnitCertificationStatuses,
  buildVehicleFileStatuses,
  statusesAwaitingProof,
  unitCertificationGaps,
  vehicleFileGaps,
  type UnitCertificationDocumentInput,
} from "@/lib/equipment";
import { hasAttachedProof, sortProofGaps, type ProofGap } from "@/lib/proof-status";
import { computeProofGaps, driverProofGaps, requirementsForScope, type TransportDocumentRecord } from "@/lib/transport-registry";
import { certificationStatus } from "@/lib/workers";

const NOW = new Date("2026-08-05T12:00:00.000Z");

function doc(
  docType: string,
  expiryDate: string | null,
  overrides: { hasProof?: boolean; reminderLeadDays?: number | null } = {},
) {
  return {
    docType,
    expiryDate,
    isActive: true,
    reminderLeadDays: overrides.reminderLeadDays ?? 30,
    hasProof: overrides.hasProof ?? false,
  };
}

function certification(input: Partial<UnitCertificationDocumentInput> = {}): UnitCertificationDocumentInput {
  return {
    certificationTypeId: "type-picker",
    docType: "certification",
    expiryDate: "2027-06-01",
    isActive: true,
    reminderLeadDays: 30,
    title: null,
    hasProof: false,
    ...input,
  };
}

function driverDoc(slotKey: string, overrides: Partial<TransportDocumentRecord> = {}): TransportDocumentRecord {
  return {
    registryKey: "dq",
    slotKey,
    scope: "driver",
    subjectId: "driver-1",
    status: "active",
    expiryDate: null,
    hasProof: false,
    ...overrides,
  };
}

describe("hasAttachedProof", () => {
  it("reads a single attachment path", () => {
    expect(hasAttachedProof("tenants/x/cert.pdf")).toBe(true);
    expect(hasAttachedProof(null)).toBe(false);
    expect(hasAttachedProof(undefined)).toBe(false);
  });

  it("reads an attachment id array", () => {
    expect(hasAttachedProof(["11111111-1111-1111-1111-111111111111"])).toBe(true);
    expect(hasAttachedProof([])).toBe(false);
    expect(hasAttachedProof([null, undefined])).toBe(false);
  });

  it("does not accept whitespace as a document", () => {
    // An emptied column is someone clearing the file, not proof of one.
    expect(hasAttachedProof("   ")).toBe(false);
    expect(hasAttachedProof(["  ", null])).toBe(false);
  });
});

describe("vehicle files gated on the document", () => {
  it("holds a valid date with no scan at amber instead of green", () => {
    const statuses = buildVehicleFileStatuses(
      { category: "vehicle", documents: [doc("cvip", "2027-06-01")] },
      NOW,
    );
    const cvip = statuses.find((status) => status.docType === "cvip")!;

    expect(cvip.state).toBe("awaiting_proof");
    expect(cvip.hasProof).toBe(false);
  });

  it("turns green once the certificate is attached", () => {
    const statuses = buildVehicleFileStatuses(
      { category: "vehicle", documents: [doc("cvip", "2027-06-01", { hasProof: true })] },
      NOW,
    );

    expect(statuses.find((status) => status.docType === "cvip")!.state).toBe("on_file");
  });

  it("is not a deficiency, so it never inflates the gap count", () => {
    const statuses = buildVehicleFileStatuses(
      {
        category: "vehicle",
        documents: [doc("registration", "2027-06-01"), doc("insurance", "2027-06-01"), doc("cvip", "2027-06-01")],
      },
      NOW,
    );

    expect(vehicleFileGaps(statuses)).toHaveLength(0);
    expect(statusesAwaitingProof(statuses)).toHaveLength(3);
  });

  it("keeps saying Expired rather than downgrading to a filing problem", () => {
    // An expired file needs a renewal. Reporting it as "no document" would send
    // someone looking for a scan of a certificate that has already run out.
    const statuses = buildVehicleFileStatuses(
      { category: "vehicle", documents: [doc("cvip", "2026-07-01")] },
      NOW,
    );

    expect(statuses.find((status) => status.docType === "cvip")!.state).toBe("expired");
  });

  it("keeps the renewal deadline on the badge but still chases the missing scan", () => {
    const statuses = buildVehicleFileStatuses(
      { category: "vehicle", documents: [doc("registration", "2026-08-20")] },
      NOW,
    );
    const registration = statuses.find((status) => status.docType === "registration")!;

    expect(registration.state).toBe("due_soon");
    expect(statusesAwaitingProof(statuses).map((status) => status.docType)).toContain("registration");
  });

  it("does not let last year's scan prove this year's renewal", () => {
    // The freshest document governs the file, so proof has to come from that one.
    const statuses = buildVehicleFileStatuses(
      {
        category: "vehicle",
        documents: [doc("cvip", "2025-08-01", { hasProof: true }), doc("cvip", "2027-06-01")],
      },
      NOW,
    );
    const cvip = statuses.find((status) => status.docType === "cvip")!;

    expect(cvip.expiryDate).toBe("2027-06-01");
    expect(cvip.state).toBe("awaiting_proof");
  });

  it("reports a never-filed requirement as missing, not as awaiting proof", () => {
    const statuses = buildVehicleFileStatuses({ category: "vehicle", documents: [] }, NOW);

    expect(statuses.find((status) => status.docType === "cvip")!.state).toBe("missing");
    expect(statusesAwaitingProof(statuses)).toHaveLength(0);
  });
});

describe("unit certifications gated on the document", () => {
  const types = [{ id: "type-picker", name: "Crane / picker inspection" }];

  it("holds a dated certification with no scan at amber", () => {
    const statuses = buildUnitCertificationStatuses(
      { certificationTypes: types, documents: [certification()] },
      NOW,
    );

    expect(statuses[0].state).toBe("awaiting_proof");
    expect(unitCertificationGaps(statuses)).toHaveLength(0);
    expect(statusesAwaitingProof(statuses)).toHaveLength(1);
  });

  it("turns green when the certificate is attached", () => {
    const statuses = buildUnitCertificationStatuses(
      { certificationTypes: types, documents: [certification({ hasProof: true })] },
      NOW,
    );

    expect(statuses[0].state).toBe("on_file");
  });

  it("chases a free-text certification too, even though it can never be a gap", () => {
    const statuses = buildUnitCertificationStatuses(
      {
        certificationTypes: [],
        documents: [certification({ certificationTypeId: null, title: "Spill kit inspection" })],
      },
      NOW,
    );

    expect(statuses[0].expected).toBe(false);
    expect(statusesAwaitingProof(statuses)).toHaveLength(1);
  });
});

describe("driver qualification files gated on the document", () => {
  it("reports a filed but unscanned required slot without calling it a deficiency", () => {
    const gaps = driverProofGaps([driverDoc("application")], NOW);

    expect(gaps.map((gap) => gap.slotKey)).toEqual(["application"]);
    expect(gaps[0].registryLabel).toBe("Driver Qualification Files");
  });

  it("clears once any document in that slot carries a file", () => {
    // Several DQ slots accumulate rather than supersede (training certificates,
    // conviction records), so one attachment among them is real evidence.
    const gaps = driverProofGaps(
      [driverDoc("training_certificates"), driverDoc("training_certificates", { hasProof: true })],
      NOW,
    );

    expect(gaps.map((gap) => gap.slotKey)).not.toContain("training_certificates");
  });

  it("says nothing about a slot that is missing entirely", () => {
    expect(driverProofGaps([], NOW)).toHaveLength(0);
  });

  it("ignores an expired document, which needs renewing rather than scanning", () => {
    const gaps = driverProofGaps([driverDoc("medical", { expiryDate: "2026-01-01" })], NOW);

    expect(gaps.map((gap) => gap.slotKey)).not.toContain("medical");
  });

  it("ignores an archived document", () => {
    const gaps = driverProofGaps([driverDoc("application", { status: "archived" })], NOW);

    expect(gaps).toHaveLength(0);
  });

  it("never reports an optional slot", () => {
    const optional = requirementsForScope("driver").filter((requirement) => !requirement.required);
    const gaps = computeProofGaps({
      requirements: requirementsForScope("driver"),
      documents: optional.map((requirement) =>
        driverDoc(requirement.slotKey, { registryKey: requirement.registryKey }),
      ),
      now: NOW,
    });

    expect(gaps).toHaveLength(0);
  });
});

describe("worker certification status gated on the document", () => {
  it("reads amber when the ticket is current but the card was never photographed", () => {
    const status = certificationStatus("2027-06-01", NOW, false);

    expect(status.tone).toBe("unproven");
    expect(status.label).toBe("No document");
  });

  it("reads Active once the photo is attached", () => {
    expect(certificationStatus("2027-06-01", NOW, true)).toEqual({ label: "Active", tone: "success" });
  });

  it("keeps calling an expired ticket a deficiency", () => {
    expect(certificationStatus("2026-01-01", NOW, false).tone).toBe("danger");
  });

  it("keeps the renewal warning on a ticket expiring inside the month", () => {
    expect(certificationStatus("2026-08-20", NOW, false).tone).toBe("warning");
  });

  it("chases a ticket with neither an expiry nor a document", () => {
    expect(certificationStatus(null, NOW, false).tone).toBe("unproven");
    expect(certificationStatus(null, NOW, true).tone).toBe("neutral");
  });

  it("behaves exactly as before when proof is not supplied", () => {
    // Callers that genuinely cannot know must not be silently downgraded.
    expect(certificationStatus("2027-06-01", NOW)).toEqual({ label: "Active", tone: "success" });
  });
});

describe("sortProofGaps", () => {
  it("puts the soonest expiry first and undated records last", () => {
    const gaps: ProofGap[] = [
      { subject: "unit", subjectName: "T-02", label: "CVIP", expiryDate: null, href: "#" },
      { subject: "worker", subjectName: "Dale Chase", label: "H2S Alive", expiryDate: "2026-09-01", href: "#" },
      { subject: "unit", subjectName: "T-01", label: "Registration", expiryDate: "2026-08-15", href: "#" },
    ];

    expect(sortProofGaps(gaps).map((gap) => gap.label)).toEqual(["Registration", "H2S Alive", "CVIP"]);
  });
});
