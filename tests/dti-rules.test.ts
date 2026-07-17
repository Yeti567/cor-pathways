import { describe, expect, it } from "vitest";
import {
  applicableSchedule,
  carryDocuments,
  credentialAtRisk,
  getProvinceRule,
  inspectionValidUntil,
  isInspectionRequired,
  isInspectionValid,
  isProvince,
  PROVINCES,
  requiredInspectionTypes,
  requiresPostTrip,
  retentionPolicy,
  scheduleCitation,
  validityHours,
  type DtiVehicle,
} from "@/lib/dti-rules";

function truck(weightKg: number | null): DtiVehicle {
  return { bodyType: "truck", registeredWeightKg: weightKg };
}

describe("isProvince", () => {
  it("accepts the three launch provinces and rejects anything else", () => {
    expect(PROVINCES).toEqual(["BC", "AB", "ON"]);
    expect(isProvince("AB")).toBe(true);
    expect(isProvince("SK")).toBe(false);
    expect(isProvince(null)).toBe(false);
  });
});

describe("applicableSchedule", () => {
  it("maps body type to the NSC schedule number", () => {
    expect(applicableSchedule({ bodyType: "truck", registeredWeightKg: 9000 })).toBe(1);
    expect(applicableSchedule({ bodyType: "tractor", registeredWeightKg: 9000 })).toBe(1);
    expect(applicableSchedule({ bodyType: "trailer", registeredWeightKg: 9000 })).toBe(1);
    expect(applicableSchedule({ bodyType: "bus", registeredWeightKg: null, passengerCapacity: 24 })).toBe(2);
    expect(applicableSchedule({ bodyType: "motor_coach", registeredWeightKg: null, passengerCapacity: 50 })).toBe(3);
  });
});

describe("isInspectionRequired", () => {
  it("applies each province's truck weight threshold", () => {
    // BC: 5,000 kg
    expect(isInspectionRequired(truck(5000), "BC")).toBe(true);
    expect(isInspectionRequired(truck(4999), "BC")).toBe(false);
    // Ontario: 4,500 kg
    expect(isInspectionRequired(truck(4500), "ON")).toBe(true);
    expect(isInspectionRequired(truck(4499), "ON")).toBe(false);
    // Alberta: 11,794 kg
    expect(isInspectionRequired(truck(11794), "AB")).toBe(true);
    expect(isInspectionRequired(truck(11793), "AB")).toBe(false);
  });

  it("treats the same 9,000 kg truck differently per province", () => {
    expect(isInspectionRequired(truck(9000), "BC")).toBe(true);
    expect(isInspectionRequired(truck(9000), "ON")).toBe(true);
    expect(isInspectionRequired(truck(9000), "AB")).toBe(false);
  });

  it("errs toward required when the weight is unknown", () => {
    expect(isInspectionRequired(truck(null), "AB")).toBe(true);
  });

  it("uses the passenger threshold for buses (Alberta 11+, others any)", () => {
    const smallBus: DtiVehicle = { bodyType: "bus", registeredWeightKg: null, passengerCapacity: 8 };
    expect(isInspectionRequired(smallBus, "AB")).toBe(false);
    expect(isInspectionRequired(smallBus, "BC")).toBe(true);
    expect(isInspectionRequired(smallBus, "ON")).toBe(true);

    const coach: DtiVehicle = { bodyType: "motor_coach", registeredWeightKg: null, passengerCapacity: 50 };
    expect(isInspectionRequired(coach, "AB")).toBe(true);
  });
});

describe("inspection types", () => {
  it("requires pre-trip everywhere and post-trip only in BC", () => {
    expect(requiredInspectionTypes("AB")).toEqual(["pre"]);
    expect(requiredInspectionTypes("ON")).toEqual(["pre"]);
    expect(requiredInspectionTypes("BC")).toEqual(["pre", "post"]);
    expect(requiresPostTrip("BC")).toBe(true);
    expect(requiresPostTrip("AB")).toBe(false);
  });
});

describe("credential at risk", () => {
  it("names CVOR for Ontario and the Safety Fitness Certificate elsewhere", () => {
    expect(credentialAtRisk("ON")).toBe("CVOR");
    expect(credentialAtRisk("AB")).toBe("SFC");
    expect(credentialAtRisk("BC")).toBe("SFC");
  });
});

describe("retention", () => {
  it("keeps 6 months everywhere, with Alberta's forwarding chain", () => {
    expect(retentionPolicy("BC")).toEqual({ months: 6 });
    expect(retentionPolicy("ON")).toEqual({ months: 6 });
    expect(retentionPolicy("AB")).toEqual({ months: 6, driverForwardDays: 20, headOfficeForwardDays: 30 });
  });
});

describe("validity window", () => {
  it("is 24 hours in every launch province", () => {
    for (const province of PROVINCES) {
      expect(validityHours(province)).toBe(24);
    }
  });

  it("computes the expiry 24h after completion and checks current validity", () => {
    const completed = "2026-06-05T08:00:00.000Z";
    expect(inspectionValidUntil(completed, "ON").toISOString()).toBe("2026-06-06T08:00:00.000Z");
    expect(isInspectionValid(completed, "ON", "2026-06-05T20:00:00.000Z")).toBe(true);
    expect(isInspectionValid(completed, "ON", "2026-06-06T09:00:00.000Z")).toBe(false);
  });
});

describe("carry documents and citation", () => {
  it("requires the current report and the schedule in the cab", () => {
    expect(carryDocuments("BC")).toEqual(["current_report", "schedule"]);
  });

  it("cites the right authority per province and schedule", () => {
    expect(scheduleCitation("ON", 1)).toContain("O. Reg 199/07 Schedule 1");
    expect(scheduleCitation("AB", 2)).toContain("Commercial Vehicle Safety Regulation");
    expect(scheduleCitation("BC", 3)).toContain("Division 37");
  });
});

describe("getProvinceRule", () => {
  it("has all three launch-province thresholds verified", () => {
    expect(getProvinceRule("AB").thresholdVerified).toBe(true);
    expect(getProvinceRule("BC").thresholdVerified).toBe(true);
    expect(getProvinceRule("ON").thresholdVerified).toBe(true);
  });

  it("keeps Alberta at the verified 11,794 kg documented-report threshold", () => {
    expect(getProvinceRule("AB").truckThresholdKg).toBe(11794);
  });
});
