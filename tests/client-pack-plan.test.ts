import { describe, expect, it } from "vitest";
import type { CertificationRow, EmployeeRow, EquipmentRow, LocationRow, UnitCertificationRow } from "@/lib/client-pack/parse";
import {
  countActions,
  planCertifications,
  planEmployees,
  planEquipment,
  planLocations,
  planUnitCertifications,
  type TenantSnapshot,
} from "@/lib/client-pack/plan";

const EMPTY: TenantSnapshot = {
  users: [],
  locations: [],
  equipment: [],
  certifications: [],
  unitCertifications: [],
};

function employee(input: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    rowNumber: 2,
    fullName: "Dale Chase",
    email: "dale@crudemaster.com",
    jobTitle: null,
    phone: null,
    powerLevel: "worker",
    ...input,
  };
}

function unit(input: Partial<EquipmentRow> = {}): EquipmentRow {
  return {
    rowNumber: 2,
    unitNumber: "T-014",
    category: "vehicle",
    year: null,
    make: null,
    model: null,
    vin: null,
    plate: null,
    trackingMode: "mileage",
    meterReading: null,
    cvipExpiry: null,
    registrationExpiry: null,
    insuranceExpiry: null,
    isCommercial: true,
    ...input,
  };
}

describe("employees", () => {
  it("creates somebody new", () => {
    const { items, errors } = planEmployees([employee()], EMPTY);

    expect(errors).toHaveLength(0);
    expect(items[0].action).toBe("create");
    expect(items[0].detail).toContain("dale@crudemaster.com");
  });

  it("updates rather than duplicating when the pack is sent back corrected", () => {
    // This is the property that makes a re-send safe. Clients correct and resend.
    const snapshot: TenantSnapshot = {
      ...EMPTY,
      users: [{ id: "u1", email: "Dale@CrudeMaster.com", full_name: "Dale Chase" }],
    };
    const { items } = planEmployees([employee({ powerLevel: "manager" })], snapshot);

    expect(items[0]).toMatchObject({ action: "update", existingId: "u1" });
  });

  it("refuses a pack that lists the same login twice", () => {
    // Neither last-wins nor first-wins is acceptable: both silently discard a
    // real person, so this has to go back to the client.
    const { errors } = planEmployees(
      [employee({ rowNumber: 2 }), employee({ rowNumber: 7, fullName: "D. Chase" })],
      EMPTY,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 7, column: "Work Email" });
    expect(errors[0].message).toContain("row 2");
  });
});

describe("equipment", () => {
  it("matches an existing unit the same way the Add Equipment form does", () => {
    const snapshot: TenantSnapshot = {
      ...EMPTY,
      equipment: [{ id: "e1", unit_number: "T014", vin_or_serial: null, license_plate: null }],
    };
    const { items } = planEquipment([unit({ unitNumber: "T-014" })], snapshot);

    expect(items[0]).toMatchObject({ action: "update", existingId: "e1" });
    expect(items[0].detail).toContain("unit number");
  });

  it("matches on VIN even when the yard renamed the unit", () => {
    const snapshot: TenantSnapshot = {
      ...EMPTY,
      equipment: [{ id: "e1", unit_number: "OLD-1", vin_or_serial: "1XKYDP9X5KJ123456", license_plate: null }],
    };
    const { items } = planEquipment([unit({ unitNumber: "T-014", vin: "1xkydp9x5kj123456" })], snapshot);

    expect(items[0]).toMatchObject({ action: "update", existingId: "e1" });
    expect(items[0].detail).toContain("VIN");
  });

  it("refuses a pack listing one VIN on two rows", () => {
    const { errors } = planEquipment(
      [unit({ rowNumber: 2, vin: "1XKYDP9X5KJ123456" }), unit({ rowNumber: 5, unitNumber: "T-015", vin: "1XKYDP9X5KJ123456" })],
      EMPTY,
    );

    expect(errors.map((e) => e.column)).toEqual(["vin"]);
  });
});

describe("locations", () => {
  it("matches on code when the name was reworded", () => {
    const snapshot: TenantSnapshot = { ...EMPTY, locations: [{ id: "l1", name: "Main Yard", code: "YARD" }] };
    const row: LocationRow = { rowNumber: 2, name: "Grande Prairie Yard", code: "YARD", address: null, type: "yard", active: true };

    expect(planLocations([row], snapshot).items[0]).toMatchObject({ action: "update", existingId: "l1" });
  });
});

describe("worker tickets", () => {
  const ticket = (input: Partial<CertificationRow> = {}): CertificationRow => ({
    rowNumber: 2,
    workerEmail: "dale@crudemaster.com",
    workerName: "Dale Chase",
    certificationType: "H2S Alive",
    issuedOn: null,
    expiresOn: "2027-05-01",
    ...input,
  });

  const withDale: TenantSnapshot = {
    ...EMPTY,
    users: [{ id: "u1", email: "dale@crudemaster.com", full_name: "Dale Chase" }],
  };

  it("attaches a ticket to an existing worker", () => {
    const { items, errors } = planCertifications([ticket()], withDale, []);

    expect(errors).toHaveLength(0);
    expect(items[0]).toMatchObject({ action: "create" });
    expect(items[0].row.workerId).toBe("u1");
  });

  it("renews rather than stacking a second copy of the same ticket", () => {
    const snapshot: TenantSnapshot = {
      ...withDale,
      certifications: [{ id: "c1", userId: "u1", name: "H2S ALIVE" }],
    };
    const { items } = planCertifications([ticket()], snapshot, []);

    expect(items[0]).toMatchObject({ action: "update", existingId: "c1" });
  });

  it("accepts a ticket for someone the same pack is creating", () => {
    const { items, errors } = planCertifications([ticket()], EMPTY, [employee()]);

    expect(errors).toHaveLength(0);
    expect(items[0].action).toBe("create");
  });

  it("reports a ticket whose owner is nowhere, rather than dropping it", () => {
    // A silently dropped ticket is a missing qualification nobody knows about.
    const { items, errors } = planCertifications([ticket({ workerEmail: "ghost@crudemaster.com" })], withDale, []);

    expect(items).toHaveLength(0);
    expect(errors[0]).toMatchObject({ sheet: "certifications", row: 2, column: "worker_email" });
    expect(errors[0].message).toContain("ghost@crudemaster.com");
  });
});

describe("unit tickets", () => {
  const ticket = (input: Partial<UnitCertificationRow> = {}): UnitCertificationRow => ({
    rowNumber: 2,
    unitNumber: "TR-88",
    certificationType: "B620 Tank Pressure Test",
    issuedOn: null,
    expiresOn: "2027-06-01",
    ...input,
  });

  it("attaches to a unit already on file, matching loose unit spellings", () => {
    const snapshot: TenantSnapshot = {
      ...EMPTY,
      equipment: [{ id: "e1", unit_number: "TR88", vin_or_serial: null, license_plate: null }],
    };
    const { items, errors } = planUnitCertifications([ticket()], snapshot, []);

    expect(errors).toHaveLength(0);
    expect(items[0].row.equipmentId).toBe("e1");
  });

  it("updates the dates when that certificate is already on the unit", () => {
    const snapshot: TenantSnapshot = {
      ...EMPTY,
      equipment: [{ id: "e1", unit_number: "TR-88", vin_or_serial: null, license_plate: null }],
      unitCertifications: [{ id: "d1", equipmentId: "e1", label: "B620 tank pressure test" }],
    };

    expect(planUnitCertifications([ticket()], snapshot, []).items[0]).toMatchObject({
      action: "update",
      existingId: "d1",
    });
  });

  it("reports a certificate for a unit that does not exist", () => {
    const { errors } = planUnitCertifications([ticket({ unitNumber: "NOPE-1" })], EMPTY, []);

    expect(errors[0].message).toContain("NOPE-1");
  });
});

describe("countActions", () => {
  it("summarises a plan for the preview header", () => {
    const { items } = planEmployees(
      [employee({ rowNumber: 2 }), employee({ rowNumber: 3, email: "tracy@crudemaster.com", fullName: "Tracy MacDonald" })],
      { ...EMPTY, users: [{ id: "u1", email: "dale@crudemaster.com", full_name: "Dale Chase" }] },
    );

    expect(countActions(items)).toEqual({ create: 1, update: 1, skip: 0 });
  });
});
