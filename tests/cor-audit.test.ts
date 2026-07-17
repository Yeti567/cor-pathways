import { describe, expect, it } from "vitest";
import { buildAuditReadiness } from "@/lib/cor-audit";

describe("buildAuditReadiness", () => {
  it("returns the partner framework's ten elements in its own numbering", () => {
    const readiness = buildAuditReadiness("amta", {}, {});
    expect(readiness.elements).toHaveLength(10);
    expect(readiness.elements[0].number).toBe(1);
    expect(readiness.elements[0].canonical).toBe("management_commitment");
    expect(readiness.elements.every((element) => element.autoSources.length >= 0)).toBe(true);
  });

  it("renders the same evidence through different partner numbering", () => {
    // Hazard assessment evidence: AMTA element 2, ACSA element 5.
    const amta = buildAuditReadiness("amta", { hazard_assessment: 3 }, {});
    const acsa = buildAuditReadiness("acsa", { hazard_assessment: 3 }, {});
    expect(amta.elements.find((e) => e.canonical === "hazard_assessment")?.number).toBe(2);
    expect(acsa.elements.find((e) => e.canonical === "hazard_assessment")?.number).toBe(5);
    expect(amta.elements.find((e) => e.canonical === "hazard_assessment")?.documented).toBe(true);
  });

  it("treats an element as documented when it has any manual or auto evidence", () => {
    const readiness = buildAuditReadiness(
      "amta",
      { management_commitment: 2 },
      { training: 7 },
    );

    const mgmt = readiness.elements.find((element) => element.canonical === "management_commitment");
    const training = readiness.elements.find((element) => element.canonical === "training");
    expect(mgmt?.documented).toBe(true);
    expect(training?.documented).toBe(true);
    expect(training?.evidenceCount).toBe(7);
  });

  it("computes readiness as the share of documented elements", () => {
    const readiness = buildAuditReadiness(
      "amta",
      {
        management_commitment: 1,
        hazard_control: 1,
        committees_reps: 1,
        training: 2,
      },
      { hazard_assessment: 3 },
    );

    expect(readiness.documentedCount).toBe(5);
    expect(readiness.total).toBe(10);
    expect(readiness.readinessPercent).toBe(50);
    expect(readiness.gaps).toHaveLength(5);
    expect(readiness.gaps.every((element) => !element.documented)).toBe(true);
  });

  it("reports zero readiness with no evidence", () => {
    const readiness = buildAuditReadiness("amta", {}, {});
    expect(readiness.documentedCount).toBe(0);
    expect(readiness.readinessPercent).toBe(0);
    expect(readiness.gaps).toHaveLength(10);
  });
});
