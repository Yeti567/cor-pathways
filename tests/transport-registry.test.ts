import { describe, expect, it } from "vitest";
import {
  TRANSPORT_REQUIREMENTS,
  companyDeficiencies,
  computeDeficiencies,
  driverDeficiencies,
  requirementsForScope,
  summarizeDeficiencies,
  type TransportDocumentRecord,
} from "@/lib/transport-registry";

const now = new Date("2026-05-29T12:00:00.000Z");

function driverDoc(
  slotKey: string,
  overrides: Partial<TransportDocumentRecord> = {},
): TransportDocumentRecord {
  return {
    registryKey: "dq",
    slotKey,
    scope: "driver",
    subjectId: "driver-1",
    status: "active",
    expiryDate: null,
    // Scanned by default, so these tests stay about the deficiency engine. The
    // proof-gap tests pass hasProof explicitly.
    hasProof: true,
    ...overrides,
  };
}

describe("transport registry deficiency engine", () => {
  it("flags every required driver slot as missing when nothing is filed", () => {
    const deficiencies = driverDeficiencies([], now);
    const requiredDriverSlots = requirementsForScope("driver").filter((requirement) => requirement.required);

    expect(deficiencies).toHaveLength(requiredDriverSlots.length);
    expect(deficiencies.every((deficiency) => deficiency.reason === "missing")).toBe(true);
  });

  it("does not flag a slot once an active document is filed", () => {
    const deficiencies = driverDeficiencies([driverDoc("application")], now);

    expect(deficiencies.some((deficiency) => deficiency.slotKey === "application")).toBe(false);
  });

  it("treats an expired document in an expiry-tracked slot as a deficiency", () => {
    const deficiencies = driverDeficiencies(
      [driverDoc("medical", { expiryDate: "2026-01-01" })],
      now,
    );
    const medical = deficiencies.find((deficiency) => deficiency.slotKey === "medical");

    expect(medical).toBeDefined();
    expect(medical?.reason).toBe("expired");
    expect(medical?.expiryDate).toBe("2026-01-01");
  });

  it("accepts an unexpired document in an expiry-tracked slot", () => {
    const deficiencies = driverDeficiencies(
      [driverDoc("medical", { expiryDate: "2026-12-31" })],
      now,
    );

    expect(deficiencies.some((deficiency) => deficiency.slotKey === "medical")).toBe(false);
  });

  it("ignores archived documents", () => {
    const deficiencies = driverDeficiencies([driverDoc("application", { status: "archived" })], now);

    expect(deficiencies.some((deficiency) => deficiency.slotKey === "application")).toBe(true);
  });

  it("does not require optional slots", () => {
    const supporting = TRANSPORT_REQUIREMENTS.find(
      (requirement) => requirement.slotKey === "supporting_documents",
    );

    expect(supporting?.required).toBe(false);
    expect(driverDeficiencies([], now).some((deficiency) => deficiency.slotKey === "supporting_documents")).toBe(
      false,
    );
  });

  it("computes company-scope deficiencies independently of driver slots", () => {
    const deficiencies = companyDeficiencies([], now);

    expect(deficiencies).toHaveLength(10); // the ten COR elements
    expect(deficiencies.every((deficiency) => deficiency.registryKey === "cor_program")).toBe(true);
  });

  it("summarizes missing vs expired and affected registries", () => {
    const deficiencies = computeDeficiencies({
      requirements: requirementsForScope("driver"),
      documents: [
        // Everything filed except medical (expired) and annual_abstract (missing).
        driverDoc("application"),
        driverDoc("initial_abstract"),
        driverDoc("work_history"),
        driverDoc("conviction_record"),
        driverDoc("collision_record"),
        driverDoc("training_log"),
        driverDoc("training_certificates"),
        driverDoc("duty_status_records", { registryKey: "hos" }),
        driverDoc("medical", { expiryDate: "2020-01-01" }),
      ],
      now,
    });
    const summary = summarizeDeficiencies(deficiencies);

    expect(summary.missing).toBe(1); // annual_abstract
    expect(summary.expired).toBe(1); // medical
    expect(summary.total).toBe(2);
    expect(summary.registriesAffected).toBe(1); // both are in dq
  });
});
