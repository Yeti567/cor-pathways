import { describe, expect, it } from "vitest";
import {
  resolveSubcontractorSlots,
  summariseSubcontractorCompliance,
  LEGACY_WCB_CLEARANCE_SLOT,
  type SubcontractorDocumentSummary,
  type SubcontractorRequirementSetting,
} from "@/lib/subcontractor-requirements";
import {
  normaliseWcbJurisdictions,
  WCB_JURISDICTION_CODES,
  wcbClearanceSlotKey,
  wcbJurisdictionFromSlotKey,
} from "@/lib/wcb-jurisdictions";

const NOW = new Date("2026-09-09T00:00:00.000Z");

function requiredKeys(jurisdictions: string[] | null, settings: SubcontractorRequirementSetting[] = []) {
  return resolveSubcontractorSlots(settings, jurisdictions === null ? null : { wcbJurisdictions: jurisdictions })
    .filter((slot) => slot.required)
    .map((slot) => slot.key);
}

function approved(slotKey: string, dueDate: string | null): SubcontractorDocumentSummary {
  return { coverageAmount: null, dueDate, reviewStatus: "approved", slotKey };
}

/**
 * Just the WCB clearance outcomes.
 *
 * These carriers have no insurance, no carrier profile and no signed agreement either,
 * so the raw summary is full of unrelated gaps. Filtering keeps each test about the one
 * thing it is checking instead of asserting on the whole checklist.
 */
function clearanceKeys(entries: { slot: { key: string } }[]) {
  return entries.map((entry) => entry.slot.key).filter((key) => key.startsWith("wcb_clearance_"));
}

describe("wcb jurisdiction slot keys", () => {
  it("round-trips every jurisdiction through its slot key", () => {
    for (const code of WCB_JURISDICTION_CODES) {
      expect(wcbJurisdictionFromSlotKey(wcbClearanceSlotKey(code))).toBe(code);
    }
  });

  // The legacy key has no trailing code. Reading it as a jurisdiction would invent a
  // province for the letters filed before any of this existed, which is exactly the
  // guess the whole design is built to avoid.
  it("does not read the jurisdiction-less legacy slot as a province", () => {
    expect(wcbJurisdictionFromSlotKey(LEGACY_WCB_CLEARANCE_SLOT)).toBeNull();
  });

  it("is not fooled by a slot key that merely starts the same way", () => {
    expect(wcbJurisdictionFromSlotKey("wcb_clearance_zz")).toBeNull();
    expect(wcbJurisdictionFromSlotKey("wcb_rate_statement")).toBeNull();
  });

  it("drops codes it does not recognise and keeps a canonical order", () => {
    expect(normaliseWcbJurisdictions(["SK", "ON", "ab", "QC"])).toEqual(["AB", "SK"]);
    expect(normaliseWcbJurisdictions([])).toEqual([]);
    expect(normaliseWcbJurisdictions(null)).toEqual([]);
  });
});

describe("which WCB clearances a carrier has to hold", () => {
  it("requires only the jurisdictions the carrier actually runs in", () => {
    const keys = requiredKeys(["AB", "SK"]);

    expect(keys).toContain("wcb_clearance_ab");
    expect(keys).toContain("wcb_clearance_sk");
    expect(keys).not.toContain("wcb_clearance_bc");
    expect(keys).not.toContain("wcb_clearance_yt");
    expect(keys).not.toContain("wcb_clearance_nt");
    expect(keys).not.toContain("wcb_clearance_mb");
  });

  // The 31 carriers already on file have a clearance date and no province recorded
  // anywhere. Until somebody says which boards they hold coverage with, nothing about
  // them may change: the old slot goes on being chased exactly as it is today.
  it("keeps chasing the jurisdiction-less slot while no jurisdictions are set", () => {
    expect(requiredKeys([])).toContain(LEGACY_WCB_CLEARANCE_SLOT);
    expect(requiredKeys(null)).toContain(LEGACY_WCB_CLEARANCE_SLOT);
  });

  it("retires the jurisdiction-less slot once the carrier's provinces are known", () => {
    const keys = requiredKeys(["AB"]);

    expect(keys).not.toContain(LEGACY_WCB_CLEARANCE_SLOT);
    expect(keys).toContain("wcb_clearance_ab");
  });

  // Without a carrier in hand nothing knows which provinces apply, so requiring any of
  // them would be a guess. The tenant requirements editor and the reminder job both
  // resolve this way.
  it("requires no jurisdiction at all when there is no carrier in view", () => {
    const keys = requiredKeys(null);

    for (const code of WCB_JURISDICTION_CODES) {
      expect(keys).not.toContain(wcbClearanceSlotKey(code));
    }
  });

  // A company-wide "require WCB clearance" cannot sensibly mean "require Yukon coverage
  // from a carrier that never leaves Alberta". The per-carrier list is the more specific
  // fact and has to win, or the tenant setting creates a slot nobody can ever satisfy.
  it("does not let a tenant-wide override require a province the carrier does not run in", () => {
    const settings: SubcontractorRequirementSetting[] = [
      {
        enabled: true,
        intervalMonths: null,
        minimumCoverageAmount: null,
        reminderLeadDays: null,
        required: true,
        slotKey: "wcb_clearance_yt",
      },
    ];

    expect(requiredKeys(["AB"], settings)).not.toContain("wcb_clearance_yt");
  });

  it("still lets a tenant switch a jurisdiction slot off entirely", () => {
    const settings: SubcontractorRequirementSetting[] = [
      {
        enabled: false,
        intervalMonths: null,
        minimumCoverageAmount: null,
        reminderLeadDays: null,
        required: false,
        slotKey: "wcb_clearance_bc",
      },
    ];

    const all = resolveSubcontractorSlots(settings, { wcbJurisdictions: ["AB", "BC"] }).map((slot) => slot.key);

    expect(all).not.toContain("wcb_clearance_bc");
    expect(all).toContain("wcb_clearance_ab");
  });
});

describe("rolling a multi-jurisdiction carrier up", () => {
  // The reason the six are separate slot keys rather than six rows under one. Grouped
  // under a single key the rollup keeps the longest-running document, so a current
  // Alberta letter would satisfy the requirement and the missing BC one would never
  // surface.
  it("does not let one province's letter cover another", () => {
    const slots = resolveSubcontractorSlots([], { wcbJurisdictions: ["AB", "BC"] });
    const summary = summariseSubcontractorCompliance([approved("wcb_clearance_ab", "2027-01-31")], slots, NOW);

    expect(clearanceKeys(summary.missing)).toEqual(["wcb_clearance_bc"]);
    expect(summary.state).toBe("non_compliant");
  });

  it("reads as compliant only when every jurisdiction is covered", () => {
    const slots = resolveSubcontractorSlots([], { wcbJurisdictions: ["AB", "BC"] });
    const summary = summariseSubcontractorCompliance(
      [approved("wcb_clearance_ab", "2027-01-31"), approved("wcb_clearance_bc", "2027-03-31")],
      slots,
      NOW,
    );

    expect(clearanceKeys(summary.missing)).toEqual([]);
  });

  // Filing a letter for somewhere they do not run is allowed and keeps the paperwork,
  // but it must not invent a requirement or start counting toward one.
  it("does not count a letter filed for a province the carrier does not run in", () => {
    const slots = resolveSubcontractorSlots([], { wcbJurisdictions: ["AB"] });
    const summary = summariseSubcontractorCompliance(
      [approved("wcb_clearance_ab", "2027-01-31"), approved("wcb_clearance_mb", "2027-05-31")],
      slots,
      NOW,
    );

    expect(clearanceKeys(summary.missing)).toEqual([]);
    expect(slots.find((entry) => entry.key === "wcb_clearance_mb")?.required).toBe(false);
  });

  // An expired letter is not cover. This is the case the single slot could never show:
  // Alberta current, Saskatchewan lapsed, and the carrier reading green.
  it("goes red on the one province whose letter has run out", () => {
    const slots = resolveSubcontractorSlots([], { wcbJurisdictions: ["AB", "SK"] });
    const summary = summariseSubcontractorCompliance(
      [approved("wcb_clearance_ab", "2027-01-31"), approved("wcb_clearance_sk", "2026-06-30")],
      slots,
      NOW,
    );

    expect(clearanceKeys(summary.overdue)).toEqual(["wcb_clearance_sk"]);
    expect(clearanceKeys(summary.missing)).toEqual([]);
  });
});
