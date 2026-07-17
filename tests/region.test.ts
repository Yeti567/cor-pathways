import { describe, expect, it } from "vitest";
import { coerceCountry, corAvailable, regionConfig, REGION_PACK } from "@/lib/region";

describe("coerceCountry", () => {
  it("passes through known countries", () => {
    expect(coerceCountry("CA")).toBe("CA");
    expect(coerceCountry("US")).toBe("US");
  });

  it("defaults unknown, null, or empty values to Canada", () => {
    expect(coerceCountry(null)).toBe("CA");
    expect(coerceCountry(undefined)).toBe("CA");
    expect(coerceCountry("")).toBe("CA");
    expect(coerceCountry("MX")).toBe("CA");
  });
});

describe("regionConfig", () => {
  it("returns the Canada pack for CA (and the default)", () => {
    expect(regionConfig("CA")).toBe(REGION_PACK.CA);
    expect(regionConfig(null)).toBe(REGION_PACK.CA);
    expect(regionConfig("CA").safetyFrameworkShort).toBe("COR");
  });

  it("returns the US pack for US", () => {
    expect(regionConfig("US")).toBe(REGION_PACK.US);
    expect(regionConfig("US").safetyFrameworkShort).toBe("OSHA");
  });
});

describe("corAvailable", () => {
  it("offers COR only to Canadian tenants", () => {
    expect(corAvailable("CA")).toBe(true);
    expect(corAvailable(null)).toBe(true);
    expect(corAvailable("US")).toBe(false);
  });
});
