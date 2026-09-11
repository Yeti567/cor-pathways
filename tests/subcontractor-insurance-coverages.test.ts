import { describe, expect, it } from "vitest";
import {
  getSubcontractorSlot,
  resolveSubcontractorSlots,
  summariseSubcontractorCompliance,
  type SubcontractorDocumentSummary,
  type SubcontractorRequirementSetting,
} from "@/lib/subcontractor-requirements";

const NOW = new Date("2026-09-10T00:00:00.000Z");

/** The two coverages a client's management asked to start tracking, 2026-09-10. */
const NEW_COVERAGES = ["non_owned_trailer_insurance", "pollution_liability"] as const;

function required(slotKey: string, value: boolean): SubcontractorRequirementSetting {
  return {
    enabled: true,
    intervalMonths: null,
    minimumCoverageAmount: null,
    reminderLeadDays: null,
    required: value,
    slotKey,
  };
}

function approved(slotKey: string, dueDate: string | null): SubcontractorDocumentSummary {
  return { coverageAmount: null, dueDate, reviewStatus: "approved", slotKey };
}

describe("non-owned trailer and pollution coverage", () => {
  it("records both as company-level insurance, not per truck", () => {
    for (const key of NEW_COVERAGES) {
      const slot = getSubcontractorSlot(key);

      expect(slot).not.toBeNull();
      expect(slot?.group).toBe("insurance");
      // The certificate prints its own expiry, so it is used as given rather than
      // chased on an interval.
      expect(slot?.dueMode).toBe("expiry");
    }
  });

  // The limit is the whole point of recording these: a $150,000 non-owned trailer limit
  // against a trailer worth more is a gap you can only see if the number is stored.
  it("captures the limit and the deductible on both", () => {
    for (const key of NEW_COVERAGES) {
      expect(getSubcontractorSlot(key)?.captures).toEqual(
        expect.arrayContaining(["policy_number", "insurer", "coverage_amount", "deductible"]),
      );
    }
  });

  // Shipped optional so they do not turn every other company's board red, and switched
  // on per company under Subcontractors > Requirements. A client that owns only trailers
  // and hires every power unit needs both required; a company
  // whose subs bring their own equipment has nothing here to insure.
  it("ships optional and is turned on per company", () => {
    for (const key of NEW_COVERAGES) {
      expect(getSubcontractorSlot(key)?.required).toBe(false);

      const resolved = resolveSubcontractorSlots([required(key, true)]).find((slot) => slot.key === key);

      expect(resolved?.required).toBe(true);
    }
  });

  it("flags the carrier when a required coverage is missing", () => {
    const slots = resolveSubcontractorSlots(NEW_COVERAGES.map((key) => required(key, true)));
    const summary = summariseSubcontractorCompliance([approved("non_owned_trailer_insurance", "2027-06-01")], slots, NOW);

    const missing = summary.missing.map((entry) => entry.slot.key);

    expect(missing).toContain("pollution_liability");
    expect(missing).not.toContain("non_owned_trailer_insurance");
  });

  // One broker certificate carries automobile, general liability, cargo, non-owned
  // trailer and pollution on a single page, each line with its own limit and sometimes
  // its own dates. Pollution is typically an extension of the general liability policy,
  // so it shares that policy number and expiry while carrying a different limit. The
  // slots have to be able to hold that, which means each one keeps its own expiry rather
  // than inheriting one from the certificate.
  it("lets one certificate satisfy every coverage on it, each with its own expiry", () => {
    const keys = ["fleet_insurance", "general_liability", "cargo_insurance", ...NEW_COVERAGES];
    const slots = resolveSubcontractorSlots(keys.map((key) => required(key, true)));

    const summary = summariseSubcontractorCompliance(
      [
        // Automobile runs to a different day from the rest on a real certificate.
        approved("fleet_insurance", "2027-06-01"),
        approved("general_liability", "2027-06-05"),
        approved("cargo_insurance", "2027-06-05"),
        approved("non_owned_trailer_insurance", "2027-06-05"),
        approved("pollution_liability", "2027-06-05"),
      ],
      slots,
      NOW,
    );

    const insuranceGaps = [...summary.missing, ...summary.overdue]
      .map((entry) => entry.slot.key)
      .filter((key) => keys.includes(key));

    expect(insuranceGaps).toEqual([]);
  });

  // The other half of the same point, and the commoner arrangement: a carrier can hold
  // automobile with one insurer and general liability with another, so TWO certificates
  // arrive and neither covers everything. Pollution rides on the general liability
  // policy and non-owned trailer physical damage rides on the automobile policy, so the
  // split falls between them rather than along it.
  //
  // Nothing in the model ties these coverages to one document: each slot carries its own
  // policy number, its own insurer, its own dates and its own stored file. This test
  // exists so that stays true - a "one certificate per carrier" shortcut would break
  // every carrier whose broker is not also their auto insurer.
  it("lets two certificates from two insurers each cover their own half", () => {
    const keys = ["fleet_insurance", "non_owned_trailer_insurance", "general_liability", "pollution_liability"];
    const slots = resolveSubcontractorSlots(keys.map((key) => required(key, true)));

    const summary = summariseSubcontractorCompliance(
      [
        // Certificate A, the automobile insurer. Non-owned trailer cover sits under this
        // policy, so it shares these dates.
        approved("fleet_insurance", "2027-03-31"),
        approved("non_owned_trailer_insurance", "2027-03-31"),
        // Certificate B, the liability insurer, on a completely different renewal date.
        approved("general_liability", "2027-09-30"),
        approved("pollution_liability", "2027-09-30"),
      ],
      slots,
      NOW,
    );

    const gaps = [...summary.missing, ...summary.overdue]
      .map((entry) => entry.slot.key)
      .filter((key) => keys.includes(key));

    expect(gaps).toEqual([]);
  });

  // And the failure that arrangement creates: one insurer renews, the other lapses, and
  // the carrier still holds a current-looking certificate to wave at you.
  it("flags the lapsed half when a carrier's two policies renew on different dates", () => {
    const keys = ["fleet_insurance", "non_owned_trailer_insurance", "general_liability", "pollution_liability"];
    const slots = resolveSubcontractorSlots(keys.map((key) => required(key, true)));

    const summary = summariseSubcontractorCompliance(
      [
        approved("fleet_insurance", "2026-08-31"),
        approved("non_owned_trailer_insurance", "2026-08-31"),
        approved("general_liability", "2027-09-30"),
        approved("pollution_liability", "2027-09-30"),
      ],
      slots,
      NOW,
    );

    expect(summary.overdue.map((entry) => entry.slot.key).sort()).toEqual([
      "fleet_insurance",
      "non_owned_trailer_insurance",
    ]);
  });

  // A lapsed pollution extension is the case that matters: the liability policy behind it
  // can still be current, so nothing else on the certificate looks wrong.
  it("goes red on a lapsed coverage even when the rest of the certificate is current", () => {
    const slots = resolveSubcontractorSlots(
      ["general_liability", ...NEW_COVERAGES].map((key) => required(key, true)),
    );

    const summary = summariseSubcontractorCompliance(
      [
        approved("general_liability", "2027-06-05"),
        approved("non_owned_trailer_insurance", "2027-06-05"),
        approved("pollution_liability", "2026-07-31"),
      ],
      slots,
      NOW,
    );

    expect(summary.overdue.map((entry) => entry.slot.key)).toEqual(["pollution_liability"]);
    expect(summary.state).toBe("non_compliant");
  });
});
