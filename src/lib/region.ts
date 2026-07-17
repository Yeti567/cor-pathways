// Region (country) pack for cross-border support.
//
// The app started as a Canadian COR safety program and is expanding to the United
// States, which does not use COR. Rather than branch on country throughout the
// code, this module encodes the per-country differences as DATA, the same way
// `dti-rules.ts` encodes per-province trip-inspection rules. A country is a config
// entry, not new branching code.
//
// What differs between Canada and the USA, at the safety/compliance layer:
//   - the safety framework name (COR vs OSHA)
//   - the workers' compensation body (WCB/WSIB vs Workers' Comp)
//   - the headline safety metric (COR audit score vs EMR / OSHA 300 logs)
//   - everyday terminology and spelling ("jobsite" vs "site", etc.)
//   - default secondary language (French vs Spanish) [used in a later slice]
//
// Slice 1 only needs `country`, the labels, and `corAvailable`. The rest of the
// config is scaffolding for the US safety surface and the trades modules that
// follow (see "Construction app/05-implementation-plan.md").

export type Country = "CA" | "US";

export const COUNTRIES: Country[] = ["CA", "US"];

export const COUNTRY_LABELS: Record<Country, string> = {
  CA: "Canada",
  US: "United States",
};

const countryValues = new Set<string>(COUNTRIES);

/** Normalize an unknown/legacy value to a Country, defaulting to Canada. */
export function coerceCountry(value: string | null | undefined): Country {
  return countryValues.has(value ?? "") ? (value as Country) : "CA";
}

export type RegionConfig = {
  country: Country;
  /** Display name of the country. */
  label: string;
  /** The health-and-safety framework this country is built around. */
  safetyFramework: string;
  /** Short code used in headings/badges for the safety surface. */
  safetyFrameworkShort: string;
  /** The workers' compensation authority, generically named. */
  workersComp: string;
  /** The headline external safety metric a buyer cares about. */
  safetyMetric: string;
  /** Whether the COR audit module is offered to this country at all. */
  corAvailable: boolean;
  /** Word for a work site, used in shared copy. */
  siteTerm: string;
  /** Default secondary language for field crews (used in a later slice). */
  secondaryLanguage: "fr" | "es";
};

export const REGION_PACK: Record<Country, RegionConfig> = {
  CA: {
    country: "CA",
    label: COUNTRY_LABELS.CA,
    safetyFramework: "COR (Certificate of Recognition)",
    safetyFrameworkShort: "COR",
    workersComp: "WCB / WSIB",
    safetyMetric: "COR audit score",
    corAvailable: true,
    siteTerm: "site",
    secondaryLanguage: "fr",
  },
  US: {
    country: "US",
    label: COUNTRY_LABELS.US,
    safetyFramework: "OSHA safety and recordkeeping",
    safetyFrameworkShort: "OSHA",
    workersComp: "Workers' Comp",
    safetyMetric: "EMR and OSHA 300 logs",
    corAvailable: false,
    siteTerm: "jobsite",
    secondaryLanguage: "es",
  },
};

/** The region config for a tenant's country (accepts a raw/legacy value). */
export function regionConfig(value: string | null | undefined): RegionConfig {
  return REGION_PACK[coerceCountry(value)];
}

/**
 * Whether the COR audit module is available for a country. COR is a Canadian
 * concept; US tenants never see it and get the OSHA surface instead.
 */
export function corAvailable(value: string | null | undefined): boolean {
  return regionConfig(value).corAvailable;
}
