import { describe, expect, it } from "vitest";
import {
  carrierProfileNamesCarrier,
  gradeCarrierProfile,
  mergeCarrierProfileRead,
  parseCarrierProfileText,
} from "@/lib/carrier-profile-read";

// Fixtures are invented. They keep each province's LAYOUT exactly (label order, the
// run-together lines, the OCR damage) because the layout is what the parser depends on.

// Saskatchewan: real text layer, every label first and every value after.
const saskatchewan = `SASKATCHEWAN
CARRIER PROFILE SUMMARY
Legal Name:
Address:
NSC Number:
Average (NSC) Fleet Size:
Fleet Size:
Last Facility Audit Result:
NSC Rating:
Safety Fitness Certificate
Effective Date:
EXAMPLE HAULING INC
PO BOX 1, NOWHERE SK S0S 0S0
0123456 Dot Number:
Business Type: Oil and Gas
2
2
SATISFACTORY UNAUDITED
Jun 08, 2010 11:16
Average (NSC) Fleet Size Date: August 31, 2026 23:59
Fleet Size Date : August 31, 2026 23:59
Last Audit Date:
NSC Rating Date: June 08, 2010
Expiry Date: Jun 07, 2027 23:59
Status of Safety Fitness
Certificate: ACTIVE Effective Date: Jun 08, 2010 11:16
ACCIDENT SUMMARY
Total(All Accidents): 1
INCIDENTS SUMMARY (From September 01, 2025 00:00 To August 31, 2026 23:59)
Percentage of Maximum: 12.5%
CONVICTION SUMMARY
Total: 3
Percentage of Maximum: 40.0%
CVSA INSPECTION SUMMARY
Percentage of Maximum: 0.0%
Page 3 of 5Sep 01, 2026 03:58Generated:`;

// Alberta, as Tesseract reads a scan of it: "0CT" with a zero, "TOB" for T0B.
const alberta = `Adbetan PUBLIC PROFILE
12-month Report as of: 2026 SEP 16
Example Carrier Ltd.
PO Box 1
AB TOB 350
NSC Number: AB123-4567
MVID Number: 0000-00000
SAFETY FITNESS CERTIFICATE
Certificate Number: Effective Date: Expiry Date
000000001 2024 NOV 01 2027 0CT 31
Safety Fitness Rating: Satisfactory
Operating Status: Federal
R-Factor Score (carrier must strive for the lowest score): 0.000
Industry Average R-factor Score: 0.274
R-Factor Score: 0.000
Carriers Monitoring Stage (1 to 4, 4 being the highest risk): Not on Monitoring
Stage 1: 1.208 - 1.658`;

describe("parseCarrierProfileText", () => {
  it("reads a Saskatchewan summary whose values sit away from their labels", () => {
    const read = parseCarrierProfileText(saskatchewan);

    expect(read).toMatchObject({
      accidentsTotal: 1,
      convictionsTotal: 3,
      jurisdiction: "SK",
      nscNumber: "0123456",
      percentOfMaximum: 40,
      profileDate: "2026-09-01",
      safetyRating: "satisfactory_unaudited",
      safetyRatingAsPrinted: "Satisfactory Unaudited",
      sfcExpiry: "2027-06-07",
      sfcStatus: "Active",
    });
  });

  it("reads an OCR'd Alberta profile, spaces and zeros and all", () => {
    const read = parseCarrierProfileText(alberta);

    expect(read).toMatchObject({
      industryAverageRFactor: 0.274,
      jurisdiction: "AB",
      monitoringStage: "Not on monitoring",
      monitoringStatus: "none",
      nscNumber: "AB123-4567",
      profileDate: "2026-09-16",
      rFactor: 0,
      safetyRating: "satisfactory",
      sfcExpiry: "2027-10-31",
      stageOneThreshold: 1.208,
    });
  });

  it("does not take the report date from the table of contents as the certificate expiry", () => {
    const full = `Part 10 - Safety Fitness Certificate Information 31
Page 2 of 32
PART 1 - CARRIER INFORMATION
12-month Report as of: 2026 JAN 06
NSC Number: AB123-4567
SAFETY FITNESS CERTIFICATE
Certificate Number:
Effective Date:
Expiry Date
000000001
2024 JUL 12
2027 JUN 30
Safety Fitness Rating: Satisfactory Unaudited`;
    const read = parseCarrierProfileText(full);

    expect(read.sfcExpiry).toBe("2027-06-30");
    expect(read.profileDate).toBe("2026-01-06");
    expect(read.safetyRating).toBe("satisfactory_unaudited");
  });

  it("reads Alberta with every space gone, as RapidOCR returns it", () => {
    const squashed = "NSCNumber:AB123-4567\nSafetyFitnessRating:Satisfactory\nCarriersMonitoringStage(1 to 4,4being the highest risk):Stage 2";
    const read = parseCarrierProfileText(squashed);

    expect(read.nscNumber).toBe("AB123-4567");
    expect(read.safetyRating).toBe("satisfactory");
    expect(read.monitoringStage).toBe("Stage 2");
    expect(read.monitoringStatus).toBe("monitoring");
  });

  it("never reads Unsatisfactory as Satisfactory", () => {
    expect(parseCarrierProfileText("Safety Fitness Rating: Unsatisfactory").safetyRating).toBe("unsatisfactory");
  });

  it("ignores a rating mentioned inside a sentence", () => {
    const read = parseCarrierProfileText("SASKATCHEWAN\nA carrier rated conditional may be audited again.");

    expect(read.safetyRating).toBeNull();
  });

  it("returns nulls, not guesses, for text it does not recognise", () => {
    const read = parseCarrierProfileText("");

    expect(read.jurisdiction).toBe("unknown");
    expect(read.safetyRating).toBeNull();
    expect(read.nscNumber).toBeNull();
  });
});

describe("gradeCarrierProfile", () => {
  it("passes a clean profile", () => {
    expect(gradeCarrierProfile(parseCarrierProfileText(alberta), "2026-09-24")).toEqual({ grade: "pass", reasons: [] });
  });

  it("fails an unsatisfactory rating or a dead certificate", () => {
    const read = parseCarrierProfileText(saskatchewan);

    expect(gradeCarrierProfile({ ...read, safetyRating: "unsatisfactory" }, "2026-09-24").grade).toBe("fail");
    expect(gradeCarrierProfile({ ...read, sfcStatus: "Suspended" }, "2026-09-24").grade).toBe("fail");
    expect(gradeCarrierProfile(read, "2027-07-01").grade).toBe("fail");
  });

  it("sends monitoring, a conditional rating and a high R-Factor to review", () => {
    const read = parseCarrierProfileText(alberta);

    expect(gradeCarrierProfile({ ...read, monitoringStage: "Stage 1", monitoringStatus: "monitoring" }, "2026-09-24").grade).toBe("review");
    expect(gradeCarrierProfile({ ...read, safetyRating: "conditional" }, "2026-09-24").grade).toBe("review");
    expect(gradeCarrierProfile({ ...read, rFactor: 0.5 }, "2026-09-24").reasons[0]).toContain("above the industry average");
  });

  it("asks for a person when the rating cannot be read", () => {
    const read = parseCarrierProfileText(alberta);

    expect(gradeCarrierProfile({ ...read, safetyRating: null }, "2026-09-24").grade).toBe("review");
  });
});

describe("mergeCarrierProfileRead", () => {
  const blank = { issuedDate: null, monitoringStatus: null, nscNumber: null, safetyRating: null };

  it("fills every blank from the profile", () => {
    const merged = mergeCarrierProfileRead(parseCarrierProfileText(alberta), blank, "2026-09-24");

    expect(merged).toMatchObject({
      issuedDate: "2026-09-16",
      monitoringStatus: "none",
      nscNumber: "AB123-4567",
      safetyRating: "satisfactory",
    });
    expect(merged.extraFields.profile_grade).toBe("pass");
  });

  it("keeps what the person typed and reports the disagreement", () => {
    const merged = mergeCarrierProfileRead(
      parseCarrierProfileText(alberta),
      { ...blank, nscNumber: "AB 123 4567", safetyRating: "conditional" },
      "2026-09-24",
    );

    expect(merged.safetyRating).toBe("conditional");
    expect(merged.notes.some((note) => note.includes("safety rating"))).toBe(true);
    // Same number, different punctuation: not a conflict.
    expect(merged.notes.some((note) => note.includes("NSC number"))).toBe(false);
  });

  it("says so when nothing could be read", () => {
    const merged = mergeCarrierProfileRead(null, blank, "2026-09-24");

    expect(merged.grade).toBeNull();
    expect(merged.notes[0]).toContain("could not be read");
  });
});

describe("carrierProfileNamesCarrier", () => {
  it("matches through the operating name and the corporate suffix", () => {
    expect(carrierProfileNamesCarrier("EXAMPLE HAULING INC", "Example Hauling Inc. (EH Trucking)")).toBe(true);
    expect(carrierProfileNamesCarrier("SOMEONE ELSE LTD", "Example Hauling Inc.")).toBe(false);
  });
});
