// ELD provider registry.
//
// Each certified-in-Canada platform we integrate is described here once. The UI
// renders the connect dropdown from this list, and each provider declares how it
// authenticates (OAuth for Motive/Samsara, an account session for Geotab, an API
// key for ISAAC) plus the credential env vars that must be present before it can
// go live. Adding a new certified ELD is a new entry here plus a connector
// module, the rest of the HOS module (driver files, dashboard, alerts) is
// already provider-agnostic.

import type { EldProvider } from "@/types/database";

export type EldAuthType = "oauth" | "session" | "api_key";

export type EldProviderConfig = {
  id: EldProvider;
  label: string;
  authType: EldAuthType;
  description: string;
  // Env vars that must be set for this provider to be connectable in production.
  credentialEnvVars: string[];
};

export const ELD_PROVIDERS: EldProviderConfig[] = [
  {
    id: "motive",
    label: "Motive (formerly KeepTruckin)",
    authType: "oauth",
    description: "OAuth connection to a Motive fleet account; pulls the whole fleet's Hours of Service.",
    credentialEnvVars: ["MOTIVE_CLIENT_ID", "MOTIVE_CLIENT_SECRET"],
  },
  {
    id: "samsara",
    label: "Samsara",
    authType: "oauth",
    description: "OAuth connection to a Samsara organization; pulls HOS logs and duty status.",
    credentialEnvVars: ["SAMSARA_CLIENT_ID", "SAMSARA_CLIENT_SECRET"],
  },
  {
    id: "geotab",
    label: "Geotab",
    authType: "session",
    description: "MyGeotab account session; reads DutyStatusLog records for the database.",
    credentialEnvVars: [],
  },
  {
    id: "isaac",
    label: "ISAAC Instruments",
    authType: "api_key",
    description: "API-key connection to an ISAAC account; reads driver Hours of Service.",
    credentialEnvVars: ["ISAAC_API_BASE"],
  },
];

const PROVIDER_BY_ID = new Map(ELD_PROVIDERS.map((provider) => [provider.id, provider]));

export function eldProviderConfig(id: EldProvider): EldProviderConfig | undefined {
  return PROVIDER_BY_ID.get(id);
}

export function isEldProvider(value: string): value is EldProvider {
  return PROVIDER_BY_ID.has(value as EldProvider);
}

/**
 * Whether a provider has the credentials it needs to be connected in this
 * environment. Session/API-key providers (Geotab) carry no app-level secret, so
 * they are considered ready; OAuth providers need their client id and secret.
 */
export function isEldProviderConfigured(
  id: EldProvider,
  env: Partial<Record<string, string>> = process.env,
): boolean {
  const provider = PROVIDER_BY_ID.get(id);

  if (!provider) {
    return false;
  }

  return provider.credentialEnvVars.every((key) => Boolean(env[key]?.trim()));
}
