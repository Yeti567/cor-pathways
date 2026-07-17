import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getConfiguredSsoProvider, getSsoLoginState } from "@/lib/sso";

describe("SSO helpers", () => {
  it("accepts supported Supabase OAuth providers", () => {
    expect(getConfiguredSsoProvider(" Azure ")).toBe("azure");
    expect(getConfiguredSsoProvider("workos")).toBe("workos");
    expect(getConfiguredSsoProvider("custom:core-pathways")).toBe("custom:core-pathways");
  });

  it("rejects missing or unsupported SSO providers", () => {
    expect(getConfiguredSsoProvider("")).toBeNull();
    expect(getConfiguredSsoProvider("not-a-provider")).toBeNull();
    expect(getConfiguredSsoProvider("custom:")).toBeNull();
  });

  it("enables SSO only when Supabase and a provider are configured", () => {
    expect(getSsoLoginState({ provider: "azure", supabaseConfigured: true })).toEqual({
      enabled: true,
      provider: "azure",
    });
    expect(getSsoLoginState({ provider: null, supabaseConfigured: true })).toEqual({
      enabled: false,
      provider: null,
    });
    expect(getSsoLoginState({ provider: "azure", supabaseConfigured: false })).toEqual({
      enabled: false,
      provider: "azure",
    });
  });
});

describe("SSO wiring", () => {
  const loginPage = readFileSync(join(process.cwd(), "src/app/login/page.tsx"), "utf8");
  const loginActions = readFileSync(join(process.cwd(), "src/app/login/actions.ts"), "utf8");
  const confirmRoute = readFileSync(join(process.cwd(), "src/app/auth/confirm/route.ts"), "utf8");

  it("wires the login button to the SSO server action and disables it when unavailable", () => {
    expect(loginPage).toContain("formAction={loginWithSso}");
    expect(loginPage).toContain("disabled={!ssoLogin.enabled}");
  });

  it("starts Supabase OAuth with a safe app callback", () => {
    expect(loginActions).toContain("signInWithOAuth");
    expect(loginActions).toContain("provider,");
    expect(loginActions).toContain("redirectTo: getAuthRedirectUrl(appUrl, nextPath)");
  });

  it("exchanges OAuth codes in the auth callback route", () => {
    expect(confirmRoute).toContain('request.nextUrl.searchParams.get("code")');
    expect(confirmRoute).toContain("exchangeCodeForSession(oauthCode)");
    expect(confirmRoute).toContain("verifyOtp");
  });
});
