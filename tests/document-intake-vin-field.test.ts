import { describe, expect, it } from "vitest";
import { matchUnit, storedVinCandidates, type MatchableUnit } from "@/lib/document-intake/match";

// Made-up VINs. vin_or_serial often holds more than one identifier, and a document's VIN
// has to match any full VIN in it, not the whole field.
const CHASSIS = "2T9AB1234CD567890";
const LEAD_TRAILER = "2T9AB1234CD511111";
const PUP_TRAILER = "2T9AB1234CD522222";
const OTHER = "1FUJA6CK45LN99999";

function unit(id: string, vinOrSerial: string | null): MatchableUnit {
  return { id, license_plate: null, unit_number: `U-${id}`, vin_or_serial: vinOrSerial };
}

function byVin(vin: string, fleet: MatchableUnit[]) {
  return matchUnit({ license_plate: null, unit_number: null, vin }, fleet);
}

describe("storedVinCandidates", () => {
  it("splits on slashes, commas, semicolons, whitespace and 'and'", () => {
    const candidates = storedVinCandidates(`${LEAD_TRAILER} and ${PUP_TRAILER}; CR-55821`);
    expect(candidates).toEqual(expect.arrayContaining([LEAD_TRAILER, PUP_TRAILER]));
  });

  it("normalizes case, dashes and the letters a VIN cannot hold", () => {
    expect(storedVinCandidates("2t9ab-1234cd5678q0 / x")).toContain(CHASSIS.replace("90", "00"));
  });

  it("keeps the whole field for a plain serial", () => {
    expect(storedVinCandidates("SN 4471-B")).toEqual(["SN4471B"]);
  });
});

describe("matchUnit against a multi-identifier vin_or_serial", () => {
  it("matches a single VIN", () => {
    expect(byVin(CHASSIS, [unit("a", CHASSIS)])).toMatchObject({ equipmentId: "a", status: "matched", strength: "strong" });
  });

  it("matches the VIN in 'VIN / serial'", () => {
    const fleet = [unit("crane", `${CHASSIS} / CR-55821`), unit("other", OTHER)];
    expect(byVin(CHASSIS, fleet)).toMatchObject({ equipmentId: "crane", status: "matched", strength: "strong" });
  });

  it("matches either VIN of a Super B", () => {
    const fleet = [unit("superb", `${LEAD_TRAILER}, ${PUP_TRAILER}`), unit("other", OTHER)];
    expect(byVin(LEAD_TRAILER, fleet)).toMatchObject({ equipmentId: "superb", status: "matched" });
    expect(byVin(PUP_TRAILER, fleet)).toMatchObject({ equipmentId: "superb", status: "matched" });
  });

  it("does not flag a correct VIN as a mismatch when the unit number also points at the unit", () => {
    const fleet = [unit("crane", `${CHASSIS} / CR-55821`)];
    const result = matchUnit({ license_plate: null, unit_number: "U-crane", vin: CHASSIS }, fleet);
    expect(result).toMatchObject({ equipmentId: "crane", status: "matched", strength: "strong" });
    expect(result.reasons.join(" ")).not.toMatch(/does not match/);
  });

  it("still flags a genuine mismatch", () => {
    const fleet = [unit("crane", `${CHASSIS} / CR-55821`)];
    const result = matchUnit({ license_plate: null, unit_number: "U-crane", vin: OTHER }, fleet);
    expect(result.status).toBe("ambiguous");
    expect(result.equipmentId).toBeNull();
    expect(result.reasons.join(" ")).toMatch(/does not match/);
  });

  it("does not match a VIN one character off a token", () => {
    const nearMiss = `${CHASSIS.slice(0, 16)}1`;
    const fleet = [unit("crane", `${CHASSIS} / CR-55821`)];

    const alone = byVin(nearMiss, fleet);
    expect(alone.status).not.toBe("matched");
    expect(alone).toMatchObject({ equipmentId: "crane", status: "suggested", strength: "weak" });

    const withUnit = matchUnit({ license_plate: null, unit_number: "U-crane", vin: nearMiss }, fleet);
    expect(withUnit.status).toBe("suggested");
  });
});
