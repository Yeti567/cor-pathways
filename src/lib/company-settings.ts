import type { Database, Json } from "@/types/database";

export const timezoneOptions = [
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Toronto",
  "America/Halifax",
] as const;

export const printHeaderOptions = [
  { value: "company_info_only", label: "Company Info Only" },
  { value: "company_info_and_logo", label: "Company Info and Logo" },
  { value: "logo_only", label: "Logo Only" },
] as const;

export const logoPlacementOptions = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
] as const;

export const defaultPrintFooterNote =
  "Printed documents are uncontrolled unless issued through document control.";
export const defaultPreparedByLabel = "Prepared by";

export const integrationOptions = [
  { value: "document_ai", label: "Google Document AI" },
  { value: "openrouter_gemini", label: "OpenRouter Gemini Field Extraction" },
  { value: "email_delivery", label: "Email Delivery" },
  { value: "sso", label: "Single Sign-On" },
] as const;

export type CompanySettingsRow = Database["public"]["Tables"]["company_settings"]["Row"];
export type PrintSettingsRow = Database["public"]["Tables"]["print_settings"]["Row"];
export type PrintHeaderOption = (typeof printHeaderOptions)[number]["value"];
export type LogoPlacement = (typeof logoPlacementOptions)[number]["value"];
export type IntegrationKey = (typeof integrationOptions)[number]["value"];

const printHeaderValues = new Set<string>(printHeaderOptions.map((option) => option.value));
const logoPlacementValues = new Set<string>(logoPlacementOptions.map((option) => option.value));
const integrationValues = new Set<string>(integrationOptions.map((option) => option.value));

export function coercePrintHeaderOption(value: string): PrintHeaderOption {
  return printHeaderValues.has(value) ? (value as PrintHeaderOption) : "company_info_only";
}

export function coerceLogoPlacement(value: string): LogoPlacement {
  return logoPlacementValues.has(value) ? (value as LogoPlacement) : "left";
}

export function formatPrintHeaderOption(value: string) {
  return printHeaderOptions.find((option) => option.value === value)?.label ?? value;
}

export function formatLogoPlacement(value: string) {
  return logoPlacementOptions.find((option) => option.value === value)?.label ?? value;
}

export function normalizePrintFooterNote(value: string | null | undefined) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ").slice(0, 240);
  return normalized || defaultPrintFooterNote;
}

export function normalizePreparedByLabel(value: string | null | undefined) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
  return normalized || defaultPreparedByLabel;
}

export function normalizeCompanyId(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function parseAddressLines(value: string | null | undefined) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export function shouldShowCompanyInfo(headerOption: string) {
  return headerOption === "company_info_only" || headerOption === "company_info_and_logo";
}

export function shouldShowLogo(headerOption: string) {
  return headerOption === "company_info_and_logo" || headerOption === "logo_only";
}

export function integrationsFromFormKeys(keys: string[]) {
  const output: Record<IntegrationKey, boolean> = {
    document_ai: false,
    email_delivery: false,
    openrouter_gemini: false,
    sso: false,
  };

  for (const key of keys) {
    if (integrationValues.has(key)) {
      output[key as IntegrationKey] = true;
    }
  }

  return output;
}

export function isIntegrationEnabled(integrations: Json, key: IntegrationKey) {
  if (!integrations || typeof integrations !== "object" || Array.isArray(integrations)) {
    return false;
  }

  return Boolean((integrations as Record<string, Json | undefined>)[key]);
}
