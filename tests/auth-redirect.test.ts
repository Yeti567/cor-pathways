import { describe, expect, it } from "vitest";
import { getAuthRedirectUrl, getSafeRedirectPath } from "@/lib/auth-redirect";

describe("auth redirect helpers", () => {
  it("keeps relative app redirects", () => {
    expect(getSafeRedirectPath("/forms?status=open")).toBe("/forms?status=open");
  });

  it("rejects external and auth-loop redirects", () => {
    expect(getSafeRedirectPath("https://example.com")).toBe("/");
    expect(getSafeRedirectPath("//example.com")).toBe("/");
    expect(getSafeRedirectPath("/login")).toBe("/");
    expect(getSafeRedirectPath("/auth/error")).toBe("/");
  });

  it("builds auth callback URLs with sanitized next paths", () => {
    expect(getAuthRedirectUrl("https://app.example.test", "/web?tab=forms")).toBe(
      "https://app.example.test/auth/confirm?next=%2Fweb%3Ftab%3Dforms",
    );
    expect(getAuthRedirectUrl("https://app.example.test", "https://example.com")).toBe(
      "https://app.example.test/auth/confirm?next=%2F",
    );
  });
});
