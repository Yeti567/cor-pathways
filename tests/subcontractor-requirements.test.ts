import { describe, expect, it } from "vitest";
import {
  addMonthsToDateOnly,
  deriveSubcontractorDueDate,
  getSubcontractorSlot,
  resolveIntervalMonths,
  resolveSubcontractorSlots,
  summariseSubcontractorCompliance,
  SUBCONTRACTOR_SLOTS,
  type SubcontractorDocumentSummary,
  type SubcontractorRequirementSetting,
} from "@/lib/subcontractor-requirements";

const NOW = new Date("2026-08-04T00:00:00.000Z");

function slot(key: string) {
  const found = getSubcontractorSlot(key);

  if (!found) {
    throw new Error(`Test refers to a slot that does not exist: ${key}`);
  }

  return found;
}

function setting(overrides: Partial<SubcontractorRequirementSetting> = {}): SubcontractorRequirementSetting {
  return {
    enabled: true,
    intervalMonths: null,
    minimumCoverageAmount: null,
    reminderLeadDays: null,
    required: true,
    slotKey: "fleet_insurance",
    ...overrides,
  };
}

function filed(overrides: Partial<SubcontractorDocumentSummary> = {}): SubcontractorDocumentSummary {
  return {
    coverageAmount: null,
    dueDate: "2027-01-01",
    reviewStatus: "approved",
    slotKey: "fleet_insurance",
    ...overrides,
  };
}

/** Every required slot satisfied, so a test can knock out one thing at a time. */
function fullSet(overrides: Partial<SubcontractorDocumentSummary> = {}): SubcontractorDocumentSummary[] {
  return SUBCONTRACTOR_SLOTS.filter((entry) => entry.required).map((entry) =>
    filed({ slotKey: entry.key, ...overrides }),
  );
}

describe("addMonthsToDateOnly", () => {
  it("adds whole months", () => {
    expect(addMonthsToDateOnly("2026-08-04", 6)).toBe("2027-02-04");
  });

  it("clamps to the end of a shorter target month instead of overflowing", () => {
    // The JS Date rollover would land this on 2 or 3 March. A profile issued on the
    // 31st is due on the last day of the target month, not a few days into the next.
    expect(addMonthsToDateOnly("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDateOnly("2026-08-31", 6)).toBe("2027-02-28");
  });

  it("handles a leap year February", () => {
    expect(addMonthsToDateOnly("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("rolls the year over", () => {
    expect(addMonthsToDateOnly("2026-09-15", 12)).toBe("2027-09-15");
  });

  it("returns null for anything that is not a date-only string", () => {
    expect(addMonthsToDateOnly("", 6)).toBeNull();
    expect(addMonthsToDateOnly("not a date", 6)).toBeNull();
    expect(addMonthsToDateOnly("2026-13-01", 6)).toBeNull();
  });
});

describe("deriveSubcontractorDueDate", () => {
  it("uses the printed expiry for expiry-mode slots", () => {
    const due = deriveSubcontractorDueDate(slot("fleet_insurance"), {
      expiryDate: "2027-03-31",
      issuedDate: "2026-03-31",
    });

    expect(due).toBe("2027-03-31");
  });

  it("counts six months from issue for the carrier profile", () => {
    const due = deriveSubcontractorDueDate(slot("carrier_profile"), {
      expiryDate: null,
      issuedDate: "2026-08-04",
    });

    expect(due).toBe("2027-02-04");
  });

  it("counts twelve months from issue for the WCB rate statement", () => {
    const due = deriveSubcontractorDueDate(slot("wcb_rate_statement"), {
      expiryDate: null,
      issuedDate: "2026-02-01",
    });

    expect(due).toBe("2027-02-01");
  });

  it("lets a tenant override the interval", () => {
    const due = deriveSubcontractorDueDate(slot("carrier_profile"), {
      expiryDate: null,
      intervalMonths: 3,
      issuedDate: "2026-08-04",
    });

    expect(due).toBe("2026-11-04");
  });

  it("ignores a printed expiry on an interval slot", () => {
    // A carrier profile carries no expiry. If somebody types one in anyway, the
    // interval is still what governs, otherwise two subs get chased on different rules.
    const due = deriveSubcontractorDueDate(slot("carrier_profile"), {
      expiryDate: "2099-01-01",
      issuedDate: "2026-08-04",
    });

    expect(due).toBe("2027-02-04");
  });

  it("has no due date for a signed agreement", () => {
    const due = deriveSubcontractorDueDate(slot("carrier_agreement"), {
      expiryDate: "2027-01-01",
      issuedDate: "2026-01-01",
    });

    expect(due).toBeNull();
  });

  it("has no due date for an interval slot with no issue date", () => {
    const due = deriveSubcontractorDueDate(slot("carrier_profile"), { expiryDate: null, issuedDate: null });
    expect(due).toBeNull();
  });

  it("rejects a nonsense interval rather than inventing a date", () => {
    expect(
      deriveSubcontractorDueDate(slot("carrier_profile"), {
        expiryDate: null,
        intervalMonths: 0,
        issuedDate: "2026-08-04",
      }),
    ).toBeNull();
    expect(
      deriveSubcontractorDueDate(slot("carrier_profile"), {
        expiryDate: null,
        intervalMonths: -6,
        issuedDate: "2026-08-04",
      }),
    ).toBeNull();
  });
});

describe("resolveSubcontractorSlots", () => {
  it("returns the shipped list when a tenant has set nothing", () => {
    expect(resolveSubcontractorSlots()).toHaveLength(SUBCONTRACTOR_SLOTS.length);
    expect(resolveSubcontractorSlots([])).toHaveLength(SUBCONTRACTOR_SLOTS.length);
  });

  it("drops a slot the tenant has switched off", () => {
    const slots = resolveSubcontractorSlots([setting({ enabled: false, slotKey: "cargo_insurance" })]);
    expect(slots.map((entry) => entry.key)).not.toContain("cargo_insurance");
  });

  it("keeps a slot that is enabled but no longer required", () => {
    const slots = resolveSubcontractorSlots([setting({ required: false, slotKey: "carrier_agreement" })]);
    const agreement = slots.find((entry) => entry.key === "carrier_agreement");
    expect(agreement).toBeDefined();
    expect(agreement?.required).toBe(false);
  });

  it("applies the tenant's lead, interval, and minimum limit", () => {
    const slots = resolveSubcontractorSlots([
      setting({ minimumCoverageAmount: 5_000_000, reminderLeadDays: 60, slotKey: "fleet_insurance" }),
      setting({ intervalMonths: 3, slotKey: "carrier_profile" }),
    ]);

    const fleet = slots.find((entry) => entry.key === "fleet_insurance");
    expect(fleet?.reminderLeadDays).toBe(60);
    expect(fleet?.minimumCoverageAmount).toBe(5_000_000);
    expect(slots.find((entry) => entry.key === "carrier_profile")?.intervalMonths).toBe(3);
  });

  it("ignores a minimum limit on a slot that does not capture a coverage amount", () => {
    // Otherwise a stray value on, say, the WCB clearance would make it permanently
    // deficient with no field on the form that could ever satisfy it.
    const slots = resolveSubcontractorSlots([
      setting({ minimumCoverageAmount: 2_000_000, slotKey: "wcb_clearance" }),
    ]);

    expect(slots.find((entry) => entry.key === "wcb_clearance")?.minimumCoverageAmount).toBeNull();
  });
});

describe("resolveIntervalMonths", () => {
  const [carrierProfile] = resolveSubcontractorSlots().filter((entry) => entry.key === "carrier_profile");

  it("prefers the carrier's own exception", () => {
    expect(resolveIntervalMonths(carrierProfile, 3)).toBe(3);
  });

  it("falls back to the company policy, then the shipped default", () => {
    expect(resolveIntervalMonths(carrierProfile, null)).toBe(6);

    const [tenantWide] = resolveSubcontractorSlots([setting({ intervalMonths: 4, slotKey: "carrier_profile" })]).filter(
      (entry) => entry.key === "carrier_profile",
    );
    expect(resolveIntervalMonths(tenantWide, null)).toBe(4);
  });
});

describe("summariseSubcontractorCompliance", () => {
  it("reports nothing filed as its own state, not as non-compliant", () => {
    const summary = summariseSubcontractorCompliance([], undefined, NOW);
    expect(summary.state).toBe("not_started");
    expect(summary.missing).toHaveLength(summary.requiredCount);
  });

  it("is compliant when every required slot has an approved, in-date document", () => {
    const summary = summariseSubcontractorCompliance(fullSet(), undefined, NOW);
    expect(summary.state).toBe("compliant");
    expect(summary.satisfiedCount).toBe(summary.requiredCount);
    expect(summary.missing).toHaveLength(0);
  });

  it("does not count a pending upload as satisfying a slot", () => {
    // Uses a slot that is required by default. Cargo insurance is deliberately
    // optional, so a pending upload there would correctly leave the carrier compliant.
    const documents = fullSet().map((document) =>
      document.slotKey === "general_liability" ? { ...document, reviewStatus: "pending" } : document,
    );

    const summary = summariseSubcontractorCompliance(documents, undefined, NOW);
    expect(summary.state).toBe("non_compliant");
    expect(summary.missing.map((entry) => entry.slot.key)).toContain("general_liability");
  });

  it("distinguishes a rejected document from one that was never sent", () => {
    const documents = fullSet().map((document) =>
      document.slotKey === "wcb_clearance" ? { ...document, reviewStatus: "rejected" } : document,
    );

    const summary = summariseSubcontractorCompliance(documents, undefined, NOW);
    const outcome = summary.missing.find((entry) => entry.slot.key === "wcb_clearance");
    expect(outcome?.reason).toBe("rejected");
  });

  it("is non-compliant when a required document is past due", () => {
    const documents = fullSet().map((document) =>
      document.slotKey === "general_liability" ? { ...document, dueDate: "2026-07-01" } : document,
    );

    const summary = summariseSubcontractorCompliance(documents, undefined, NOW);
    expect(summary.state).toBe("non_compliant");
    expect(summary.overdue.map((entry) => entry.slot.key)).toEqual(["general_liability"]);
  });

  it("is expiring when something falls inside its warning window", () => {
    // 20 days out, inside the 30 day lead.
    const documents = fullSet().map((document) =>
      document.slotKey === "fleet_insurance" ? { ...document, dueDate: "2026-08-24" } : document,
    );

    const summary = summariseSubcontractorCompliance(documents, undefined, NOW);
    expect(summary.state).toBe("expiring");
    expect(summary.expiring.map((entry) => entry.slot.key)).toEqual(["fleet_insurance"]);
    // Expiring still counts as satisfied: the cover has not lapsed yet.
    expect(summary.satisfiedCount).toBe(summary.requiredCount);
  });

  it("takes the longest-running approved document when a renewal is filed early", () => {
    const documents = [
      ...fullSet(),
      // A renewal filed while the old certificate is still inside its warning window.
      filed({ dueDate: "2026-08-10", slotKey: "fleet_insurance" }),
    ];

    const summary = summariseSubcontractorCompliance(documents, undefined, NOW);
    expect(summary.state).toBe("compliant");
    expect(summary.expiring).toHaveLength(0);
  });

  it("treats a slot with no due date as satisfied once approved", () => {
    const documents = fullSet().map((document) =>
      document.slotKey === "carrier_agreement" ? { ...document, dueDate: null } : document,
    );

    const summary = summariseSubcontractorCompliance(documents, undefined, NOW);
    expect(summary.state).toBe("compliant");
  });

  it("widening the company's lead re-bands what is already on file", () => {
    // 45 days out. Silent at the default 30 day lead, expiring once the company asks
    // for 60, because the lead is read from the settings and not from the filed row.
    const documents = fullSet().map((document) =>
      document.slotKey === "fleet_insurance" ? { ...document, dueDate: "2026-09-18" } : document,
    );

    expect(summariseSubcontractorCompliance(documents, undefined, NOW).state).toBe("compliant");

    const widened = resolveSubcontractorSlots([setting({ reminderLeadDays: 60, slotKey: "fleet_insurance" })]);
    const summary = summariseSubcontractorCompliance(documents, widened, NOW);
    expect(summary.expiring.map((entry) => entry.slot.key)).toEqual(["fleet_insurance"]);
  });

  it("stops counting a slot the tenant switched off", () => {
    const documents = fullSet().filter((document) => document.slotKey !== "general_liability");

    expect(summariseSubcontractorCompliance(documents, undefined, NOW).state).toBe("non_compliant");

    const slots = resolveSubcontractorSlots([setting({ enabled: false, slotKey: "general_liability" })]);
    const summary = summariseSubcontractorCompliance(documents, slots, NOW);
    expect(summary.state).toBe("compliant");
    expect(summary.requiredCount).toBe(SUBCONTRACTOR_SLOTS.filter((entry) => entry.required).length - 1);
  });

  it("flags coverage below the company's minimum even though it is on file and in date", () => {
    const slots = resolveSubcontractorSlots([
      setting({ minimumCoverageAmount: 2_000_000, slotKey: "fleet_insurance" }),
    ]);
    const documents = fullSet().map((document) =>
      document.slotKey === "fleet_insurance" ? { ...document, coverageAmount: 1_000_000 } : document,
    );

    const summary = summariseSubcontractorCompliance(documents, slots, NOW);
    expect(summary.state).toBe("non_compliant");
    expect(summary.underLimit.map((entry) => entry.slot.key)).toEqual(["fleet_insurance"]);
    expect(summary.underLimit[0]?.coverageAmount).toBe(1_000_000);
  });

  it("accepts coverage exactly at the minimum", () => {
    const slots = resolveSubcontractorSlots([
      setting({ minimumCoverageAmount: 2_000_000, slotKey: "fleet_insurance" }),
    ]);
    const documents = fullSet().map((document) =>
      document.slotKey === "fleet_insurance" ? { ...document, coverageAmount: 2_000_000 } : document,
    );

    expect(summariseSubcontractorCompliance(documents, slots, NOW).state).toBe("compliant");
  });

  it("treats an unrecorded limit as failing a minimum rather than passing it", () => {
    // A certificate filed with the limit left blank cannot be shown to meet the bar, and
    // reading silence as compliance is how a gap survives until a claim.
    const slots = resolveSubcontractorSlots([
      setting({ minimumCoverageAmount: 2_000_000, slotKey: "fleet_insurance" }),
    ]);

    const summary = summariseSubcontractorCompliance(fullSet(), slots, NOW);
    expect(summary.underLimit.map((entry) => entry.slot.key)).toEqual(["fleet_insurance"]);
  });
});

describe("which subcontractor files are required by default", () => {
  // The hiring company's own due diligence, not a regulatory duty. Cargo
  // insurance is the one slot that is situational: a sub moving the hiring
  // company's own equipment between its own yards has no freight to insure, and
  // leaving it required paints the board permanently red for those carriers.
  it("requires everything except cargo insurance", () => {
    const optional = SUBCONTRACTOR_SLOTS.filter((slot) => !slot.required).map((slot) => slot.key);

    expect(optional).toEqual(["cargo_insurance"]);
  });

  it("keeps the two protections that cost nothing to hold", () => {
    const byKey = new Map(SUBCONTRACTOR_SLOTS.map((slot) => [slot.key, slot]));

    // Liability shield: hire a sub whose WCB account is in arrears without a
    // clearance and the hiring employer can be pursued for their premiums.
    expect(byKey.get("wcb_clearance")?.required).toBe(true);
    // Never expires, so it never nags, and it is the first thing an insurer asks
    // for after an incident.
    expect(byKey.get("carrier_agreement")?.required).toBe(true);
    expect(byKey.get("carrier_agreement")?.dueMode).toBe("none");
  });

  it("carries the two signals that say whether a carrier is high risk", () => {
    const byKey = new Map(SUBCONTRACTOR_SLOTS.map((slot) => [slot.key, slot]));
    const profile = byKey.get("carrier_profile");
    const rate = byKey.get("wcb_rate_statement");

    // Refreshed on an interval because neither document carries its own expiry.
    expect(profile?.dueMode).toBe("interval");
    expect(profile?.intervalMonths).toBe(6);
    expect(profile?.captures).toContain("safety_rating");

    expect(rate?.dueMode).toBe("interval");
    expect(rate?.intervalMonths).toBe(12);
    expect(rate?.captures).toEqual(expect.arrayContaining(["industry_rate", "employer_rate"]));
  });

  it("does not ask a subcontractor for unit-level truck documents", () => {
    // An independent carrier holds their own Safety Fitness Certificate, so their
    // registrations and CVIPs are their own duty and land on their own carrier
    // profile. A leased-on owner-operator runs under the hiring company's
    // certificate and belongs in Equipment and Transport instead.
    const keys = SUBCONTRACTOR_SLOTS.map((slot) => slot.key).join(" ");

    expect(keys).not.toMatch(/registration|cvip/i);
  });
});
