import type { Provider } from "@supabase/supabase-js";

const supabaseOAuthProviders = new Set([
  "apple",
  "azure",
  "bitbucket",
  "discord",
  "facebook",
  "figma",
  "fly",
  "github",
  "gitlab",
  "google",
  "kakao",
  "keycloak",
  "linkedin",
  "linkedin_oidc",
  "notion",
  "slack",
  "slack_oidc",
  "spotify",
  "twitch",
  "twitter",
  "workos",
  "x",
  "zoom",
]);

export type SsoLoginState = {
  enabled: boolean;
  provider: Provider | null;
};

export function getConfiguredSsoProvider(value = process.env.NEXT_PUBLIC_SSO_PROVIDER): Provider | null {
  const provider = value?.trim().toLowerCase();

  if (!provider) {
    return null;
  }

  if (provider.startsWith("custom:") && provider.length > "custom:".length) {
    return provider as Provider;
  }

  return supabaseOAuthProviders.has(provider) ? (provider as Provider) : null;
}

export function getSsoLoginState(input: { supabaseConfigured: boolean; provider?: string | null }): SsoLoginState {
  const provider = getConfiguredSsoProvider(input.provider ?? undefined);

  return {
    enabled: input.supabaseConfigured && Boolean(provider),
    provider,
  };
}
