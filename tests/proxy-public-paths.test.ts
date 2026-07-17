import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/supabase/proxy";

describe("auth proxy public paths", () => {
  it("allows offline shell assets before a user signs in", () => {
    expect(isPublicPath("/offline")).toBe(true);
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
    expect(isPublicPath("/sw.js")).toBe(true);
    expect(isPublicPath("/icons/icon.svg")).toBe(true);
    expect(isPublicPath("/e2e-fixtures/print-settings")).toBe(true);
    expect(isPublicPath("/e2e-fixtures/resources")).toBe(true);
    expect(isPublicPath("/e2e-fixtures/worker-certification-ticket")).toBe(true);
  });

  it("lets anonymous visitors see the marketing landing and help center", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/help")).toBe(true);
    expect(isPublicPath("/help/create-your-first-form")).toBe(true);
  });

  it("lets bearer-token API endpoints bypass the session redirect", () => {
    expect(isPublicPath("/api/cron/certification-reminders")).toBe(true);
    expect(isPublicPath("/api/email-delivery")).toBe(true);
  });

  it("keeps protected app routes behind auth", () => {
    expect(isPublicPath("/admin")).toBe(false);
    expect(isPublicPath("/web")).toBe(false);
    expect(isPublicPath("/api/items/123")).toBe(false);
  });
});
