import { describe, expect, it } from "vitest";
import {
  buildFleetInspectionStatus,
  coerceInspectionType,
  coerceItemStatus,
  coerceProvince,
  overallResultFromItems,
  retentionSentence,
  vehicleBodyTypeFromCategory,
} from "@/lib/daily-inspection";
import { retentionPolicy } from "@/lib/dti-rules";

function inspection(over: Partial<Parameters<typeof buildFleetInspectionStatus>[1][number]> & { equipment_id: string }) {
  return {
    id: `i-${Math.round(Math.random() * 1e9)}`,
    completed_at: "2026-06-05T08:00:00.000Z",
    valid_until: "2026-06-06T08:00:00.000Z",
    out_of_service: false,
    out_of_service_cleared_at: null,
    ...over,
  };
}

describe("overallResultFromItems", () => {
  it("escalates major over minor over clean", () => {
    expect(overallResultFromItems(["pass", "pass"])).toBe("clean");
    expect(overallResultFromItems([])).toBe("clean");
    expect(overallResultFromItems(["pass", "minor", "pass"])).toBe("minor");
    expect(overallResultFromItems(["minor", "major", "pass"])).toBe("major");
  });
});

describe("coercers", () => {
  it("only accepts the three provinces", () => {
    expect(coerceProvince("ON")).toBe("ON");
    expect(coerceProvince("QC")).toBeNull();
    expect(coerceProvince("")).toBeNull();
  });

  it("defaults inspection type to pre and item status to pass", () => {
    expect(coerceInspectionType("post")).toBe("post");
    expect(coerceInspectionType("anything")).toBe("pre");
    expect(coerceItemStatus("major")).toBe("major");
    expect(coerceItemStatus("minor")).toBe("minor");
    expect(coerceItemStatus("garbage")).toBe("pass");
  });
});

describe("retentionSentence", () => {
  it("states the 6-month base and adds Alberta's forwarding chain", () => {
    const bc = retentionSentence(retentionPolicy("BC"));
    expect(bc).toContain("at least 6 months");
    expect(bc).not.toContain("forwards");

    const ab = retentionSentence(retentionPolicy("AB"));
    expect(ab).toContain("within 20 days");
    expect(ab).toContain("within 30 days");
  });
});

describe("buildFleetInspectionStatus", () => {
  const NOW = new Date("2026-06-05T20:00:00.000Z").getTime();

  it("marks a vehicle with a current inspection valid", () => {
    const [status] = buildFleetInspectionStatus(
      ["v1"],
      [inspection({ equipment_id: "v1", valid_until: "2026-06-06T08:00:00.000Z" })],
      NOW,
    );
    expect(status.status).toBe("valid");
    expect(status.validUntil).toBe("2026-06-06T08:00:00.000Z");
  });

  it("marks a vehicle with an expired latest inspection as due, keeping last-inspected", () => {
    const [status] = buildFleetInspectionStatus(
      ["v1"],
      [inspection({ equipment_id: "v1", completed_at: "2026-06-03T08:00:00.000Z", valid_until: "2026-06-04T08:00:00.000Z" })],
      NOW,
    );
    expect(status.status).toBe("due");
    expect(status.lastInspectedAt).toBe("2026-06-03T08:00:00.000Z");
  });

  it("marks a vehicle with no inspection as due with no history", () => {
    const [status] = buildFleetInspectionStatus(["v9"], [], NOW);
    expect(status.status).toBe("due");
    expect(status.lastInspectedAt).toBeNull();
  });

  it("keeps a vehicle out of service while a major defect is uncleared, even past validity", () => {
    const [status] = buildFleetInspectionStatus(
      ["v1"],
      [inspection({ equipment_id: "v1", completed_at: "2026-06-01T08:00:00.000Z", valid_until: "2026-06-02T08:00:00.000Z", out_of_service: true })],
      NOW,
    );
    expect(status.status).toBe("out_of_service");
  });

  it("out of service wins over a newer clean inspection until cleared", () => {
    const result = buildFleetInspectionStatus(
      ["v1"],
      [
        inspection({ equipment_id: "v1", id: "oos", completed_at: "2026-06-05T06:00:00.000Z", out_of_service: true }),
        inspection({ equipment_id: "v1", id: "clean", completed_at: "2026-06-05T10:00:00.000Z" }),
      ],
      NOW,
    );
    expect(result[0].status).toBe("out_of_service");
  });

  it("picks the latest inspection per vehicle regardless of input order", () => {
    const [status] = buildFleetInspectionStatus(
      ["v1"],
      [
        inspection({ equipment_id: "v1", completed_at: "2026-06-05T18:00:00.000Z", valid_until: "2026-06-06T18:00:00.000Z" }),
        inspection({ equipment_id: "v1", completed_at: "2026-06-04T08:00:00.000Z", valid_until: "2026-06-05T08:00:00.000Z" }),
      ],
      NOW,
    );
    expect(status.status).toBe("valid");
    expect(status.lastInspectedAt).toBe("2026-06-05T18:00:00.000Z");
  });
});

describe("vehicleBodyTypeFromCategory", () => {
  it("maps trailer to trailer and everything else to truck", () => {
    expect(vehicleBodyTypeFromCategory("trailer")).toBe("trailer");
    expect(vehicleBodyTypeFromCategory("vehicle")).toBe("truck");
    expect(vehicleBodyTypeFromCategory("mobile_equipment")).toBe("truck");
  });
});
