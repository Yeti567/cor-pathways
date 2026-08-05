import { describe, expect, it } from "vitest";
import {
  buildVehicleFileStatuses,
  vehicleFileGaps,
  vehicleFileRequirementsForCategory,
  VEHICLE_FILE_REQUIREMENTS,
} from "@/lib/equipment";

const NOW = new Date("2026-08-05T12:00:00.000Z");

function doc(docType: string, expiryDate: string | null, overrides: { isActive?: boolean; reminderLeadDays?: number | null } = {}) {
  return {
    docType,
    expiryDate,
    isActive: overrides.isActive ?? true,
    reminderLeadDays: overrides.reminderLeadDays ?? 30,
  };
}

describe("vehicle file requirements", () => {
  it("splits into the two files an audit asks for separately", () => {
    expect(new Set(VEHICLE_FILE_REQUIREMENTS.map((requirement) => requirement.registryKey))).toEqual(
      new Set(["vehicle_registration", "vehicle_cvip"]),
    );
  });

  it("asks a trailer for registration and CVIP but not its own insurance", () => {
    const trailer = vehicleFileRequirementsForCategory("trailer").map((requirement) => requirement.docType);

    expect(trailer).toContain("registration");
    expect(trailer).toContain("cvip");
    expect(trailer).not.toContain("insurance");
  });

  it("asks a power unit for all three", () => {
    const vehicle = vehicleFileRequirementsForCategory("vehicle").map((requirement) => requirement.docType);

    expect(vehicle).toEqual(expect.arrayContaining(["registration", "insurance", "cvip"]));
  });
});

describe("buildVehicleFileStatuses", () => {
  it("reports a unit with nothing on file as missing every required file", () => {
    const statuses = buildVehicleFileStatuses({ category: "vehicle", documents: [] }, NOW);

    expect(vehicleFileGaps(statuses).map((status) => status.docType)).toEqual([
      "registration",
      "insurance",
      "cvip",
    ]);
  });

  it("does not count an optional permit as a gap", () => {
    const statuses = buildVehicleFileStatuses({ category: "vehicle", documents: [] }, NOW);
    const permit = statuses.find((status) => status.docType === "permit")!;

    expect(permit.state).toBe("missing");
    expect(vehicleFileGaps(statuses).some((status) => status.docType === "permit")).toBe(false);
  });

  it("counts an expired file as a gap, not as on file", () => {
    const statuses = buildVehicleFileStatuses(
      { category: "vehicle", documents: [doc("cvip", "2026-07-01")] },
      NOW,
    );
    const cvip = statuses.find((status) => status.docType === "cvip")!;

    expect(cvip.state).toBe("expired");
    expect(vehicleFileGaps(statuses).map((status) => status.docType)).toContain("cvip");
  });

  it("lets a renewed certificate clear last year's expired one", () => {
    const statuses = buildVehicleFileStatuses(
      { category: "vehicle", documents: [doc("cvip", "2025-08-01"), doc("cvip", "2027-06-01")] },
      NOW,
    );
    const cvip = statuses.find((status) => status.docType === "cvip")!;

    expect(cvip.state).toBe("on_file");
    expect(cvip.expiryDate).toBe("2027-06-01");
  });

  it("warns inside the document's own reminder window", () => {
    const statuses = buildVehicleFileStatuses(
      { category: "vehicle", documents: [doc("registration", "2026-08-20", { reminderLeadDays: 30 })] },
      NOW,
    );
    const registration = statuses.find((status) => status.docType === "registration")!;

    expect(registration.state).toBe("due_soon");
    expect(registration.daysUntilExpiry).toBe(15);
  });

  it("respects a shorter warning window on one file without changing another", () => {
    const statuses = buildVehicleFileStatuses(
      {
        category: "vehicle",
        documents: [
          doc("registration", "2026-08-20", { reminderLeadDays: 7 }),
          doc("insurance", "2026-08-20", { reminderLeadDays: 30 }),
        ],
      },
      NOW,
    );

    expect(statuses.find((status) => status.docType === "registration")!.state).toBe("on_file");
    expect(statuses.find((status) => status.docType === "insurance")!.state).toBe("due_soon");
  });

  it("ignores an archived document, so filing over it does not hide a gap", () => {
    const statuses = buildVehicleFileStatuses(
      { category: "vehicle", documents: [doc("cvip", "2027-06-01", { isActive: false })] },
      NOW,
    );

    expect(statuses.find((status) => status.docType === "cvip")!.state).toBe("missing");
  });
});
