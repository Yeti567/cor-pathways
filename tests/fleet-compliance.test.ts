import { describe, expect, it } from "vitest";
import { buildFleetComplianceSummary, type FleetUnitInput } from "@/lib/fleet-compliance";
import type { UnitCertificationStatus, VehicleFileState, VehicleFileStatus } from "@/lib/equipment";

function file(state: VehicleFileState, daysUntilExpiry: number | null, hasProof = true): VehicleFileStatus {
  return {
    registryKey: "vehicle_cvip",
    docType: "cvip",
    label: "CVIP inspection certificate",
    description: "",
    required: true,
    state,
    expiryDate: daysUntilExpiry === null ? null : "2027-01-01",
    daysUntilExpiry,
    hasProof,
  };
}

function certification(
  state: VehicleFileState,
  daysUntilExpiry: number | null,
  overrides: Partial<UnitCertificationStatus> = {},
): UnitCertificationStatus {
  return {
    certificationTypeId: "type-1",
    label: "Crane / picker inspection",
    state,
    expiryDate: daysUntilExpiry === null ? null : "2027-01-01",
    daysUntilExpiry,
    expected: true,
    hasProof: true,
    ...overrides,
  };
}

function unit(input: Partial<FleetUnitInput> = {}): FleetUnitInput {
  return {
    id: "e1",
    unitNumber: "T-014",
    status: "active",
    registryFiles: [],
    certifications: [],
    ...input,
  };
}

describe("a unit is as good as its worst document", () => {
  it("counts a unit with everything on file as compliant", () => {
    const summary = buildFleetComplianceSummary([unit({ registryFiles: [file("on_file", 300)] })]);

    expect(summary.compliance).toEqual({ compliant: 1, attention: 0, deficient: 0 });
  });

  it("counts a truck with one expired file as deficient, not two thirds compliant", () => {
    // It cannot legally roll, so partial credit would be a lie.
    const summary = buildFleetComplianceSummary([
      unit({ registryFiles: [file("on_file", 300), file("expired", -10)] }),
    ]);

    expect(summary.compliance.deficient).toBe(1);
    expect(summary.compliance.compliant).toBe(0);
  });

  it("puts a unit waiting on a scan in attention rather than deficient", () => {
    const summary = buildFleetComplianceSummary([
      unit({ registryFiles: [file("awaiting_proof", 200, false)] }),
    ]);

    expect(summary.compliance.attention).toBe(1);
    expect(summary.awaitingProof).toBe(1);
  });

  it("does not let an unexpected certification make a unit deficient", () => {
    // A type the tenant does not hold everyone to cannot be missing.
    const summary = buildFleetComplianceSummary([
      unit({ certifications: [certification("missing", null, { expected: false })] }),
    ]);

    expect(summary.compliance.deficient).toBe(0);
  });
});

describe("the expiry windows", () => {
  it("is cumulative, so something due in 3 days is inside all three", () => {
    // Exclusive bands would make the 30-day count DROP as something got more
    // urgent, which reads as an improvement when it is the opposite.
    const summary = buildFleetComplianceSummary([unit({ registryFiles: [file("due_soon", 3)] })]);

    expect(summary.expiring).toEqual({ within7: 1, within30: 1, within60: 1 });
  });

  it("places each document in only the windows it actually falls inside", () => {
    const summary = buildFleetComplianceSummary([
      unit({ registryFiles: [file("due_soon", 5), file("due_soon", 20), file("on_file", 45), file("on_file", 200)] }),
    ]);

    expect(summary.expiring).toEqual({ within7: 1, within30: 2, within60: 3 });
  });

  it("counts documents, not units, because a renewal is booked per certificate", () => {
    const summary = buildFleetComplianceSummary([
      unit({ registryFiles: [file("due_soon", 4), file("due_soon", 6)] }),
    ]);

    expect(summary.expiring.within7).toBe(2);
    expect(summary.units.total).toBe(1);
  });

  it("keeps an expired document out of the windows and in its own count", () => {
    const summary = buildFleetComplianceSummary([unit({ registryFiles: [file("expired", -3)] })]);

    expect(summary.expiring).toEqual({ within7: 0, within30: 0, within60: 0 });
    expect(summary.expired).toBe(1);
  });
});

describe("out of service", () => {
  it("counts a down unit without excusing its paperwork", () => {
    // Hiding a down unit would make the fleet look healthier the longer
    // something stayed broken.
    const summary = buildFleetComplianceSummary([
      unit({ status: "down", registryFiles: [file("expired", -5)] }),
    ]);

    expect(summary.units).toEqual({ total: 1, outOfService: 1 });
    expect(summary.compliance.deficient).toBe(1);
  });
});

describe("the unit list under the tiles", () => {
  it("puts the worst first, then the soonest to expire", () => {
    const summary = buildFleetComplianceSummary([
      unit({ id: "a", unitNumber: "T-001", registryFiles: [file("on_file", 300)] }),
      unit({ id: "b", unitNumber: "T-002", registryFiles: [file("due_soon", 20)] }),
      unit({ id: "c", unitNumber: "T-003", registryFiles: [file("expired", -1)] }),
      unit({ id: "d", unitNumber: "T-004", registryFiles: [file("due_soon", 2)] }),
    ]);

    expect(summary.units_.map((row) => row.unitNumber)).toEqual(["T-003", "T-004", "T-002", "T-001"]);
  });

  it("reports the soonest expiry on each unit", () => {
    const summary = buildFleetComplianceSummary([
      unit({ registryFiles: [file("on_file", 90)], certifications: [certification("due_soon", 12)] }),
    ]);

    expect(summary.units_[0].daysUntilNext).toBe(12);
  });

  it("says nothing expires when nothing does", () => {
    const summary = buildFleetComplianceSummary([unit({ registryFiles: [file("on_file", null)] })]);

    expect(summary.units_[0].daysUntilNext).toBeNull();
  });
});

describe("an empty fleet", () => {
  it("reads as zeroes rather than dividing by nothing", () => {
    const summary = buildFleetComplianceSummary([]);

    expect(summary.units.total).toBe(0);
    expect(summary.compliance).toEqual({ compliant: 0, attention: 0, deficient: 0 });
  });
});
