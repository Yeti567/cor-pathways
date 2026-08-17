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
  const verifyAction = readFileSync(join(process.cwd(), "src/app/auth/verify/actions.ts"), "utf8");
  const verifyPage = readFileSync(join(process.cwd(), "src/app/auth/verify/page.tsx"), "utf8");

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
  });

  // Email tokens are single use, so redeeming them on GET let inbox security
  // scanners consume them before the recipient clicked. The callback must hand
  // email links to /auth/verify, which redeems on POST, and must not verify here.
  it("hands email confirmation links to the POST verify page instead of redeeming them on GET", () => {
    expect(confirmRoute).not.toContain("verifyOtp");
    expect(confirmRoute).toContain('verifyUrl.pathname = "/auth/verify"');
    expect(confirmRoute).toContain('verifyUrl.searchParams.set("token_hash", tokenHash)');
    expect(verifyAction).toContain("verifyOtp");
    expect(verifyAction).toContain('"use server"');
  });

  it("only redeems the email OTP types it expects", () => {
    expect(verifyAction).toContain("ALLOWED_TYPES");
    expect(verifyPage).toContain("action={confirmEmailLink}");
    // A GET render must not consume anything; the token only moves on submit.
    expect(verifyPage).toContain('name="token_hash"');
  });
});
