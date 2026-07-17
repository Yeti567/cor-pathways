import { describe, expect, it } from "vitest";
import {
  coerceLogoPlacement,
  coercePrintHeaderOption,
  defaultPreparedByLabel,
  defaultPrintFooterNote,
  integrationsFromFormKeys,
  isIntegrationEnabled,
  normalizeCompanyId,
  normalizePreparedByLabel,
  normalizePrintFooterNote,
  parseAddressLines,
  shouldShowCompanyInfo,
  shouldShowLogo,
} from "@/lib/company-settings";

describe("company settings helpers", () => {
  it("normalizes company ids and address lines", () => {
    expect(normalizeCompanyId(" northwind civil inc. ")).toBe("NORTHWIND-CIVIL-INC");
    expect(parseAddressLines("100 Riverside Road\n\nVancouver, BC\nCanada")).toEqual([
      "100 Riverside Road",
      "Vancouver, BC",
      "Canada",
    ]);
  });

  it("coerces print header options and logo placement", () => {
    expect(coercePrintHeaderOption("logo_only")).toBe("logo_only");
    expect(coercePrintHeaderOption("not-real")).toBe("company_info_only");
    expect(coerceLogoPlacement("right")).toBe("right");
    expect(coerceLogoPlacement("top")).toBe("left");
  });

  it("resolves print header visibility", () => {
    expect(shouldShowCompanyInfo("company_info_only")).toBe(true);
    expect(shouldShowCompanyInfo("logo_only")).toBe(false);
    expect(shouldShowLogo("company_info_and_logo")).toBe(true);
    expect(shouldShowLogo("company_info_only")).toBe(false);
  });

  it("normalizes print footer settings", () => {
    expect(normalizePrintFooterNote("  controlled copy \n when approved  ")).toBe("controlled copy when approved");
    expect(normalizePrintFooterNote("")).toBe(defaultPrintFooterNote);
    expect(normalizePreparedByLabel("  Completed   by ")).toBe("Completed by");
    expect(normalizePreparedByLabel(null)).toBe(defaultPreparedByLabel);
  });

  it("builds integration flags from form keys", () => {
    const integrations = integrationsFromFormKeys(["document_ai", "email_delivery", "unknown"]);

    expect(isIntegrationEnabled(integrations, "document_ai")).toBe(true);
    expect(isIntegrationEnabled(integrations, "openrouter_gemini")).toBe(false);
  });
});
