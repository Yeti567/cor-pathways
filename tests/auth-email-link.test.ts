import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEmailConfirmationLink } from "@/lib/auth-email-link";

const SUPABASE_VERIFY_URL =
  "https://iasq.supabase.co/auth/v1/verify?token=abc&type=recovery&redirect_to=https://app.example.com/auth/confirm";

describe("buildEmailConfirmationLink", () => {
  it("points at our own /auth/confirm, carrying the token where a server can read it", () => {
    const link = buildEmailConfirmationLink({
      properties: { hashed_token: "abc123" },
      redirectTo: "https://app.example.com/auth/confirm",
      type: "recovery",
    });

    expect(link).toBe("https://app.example.com/auth/confirm?token_hash=abc123&type=recovery");
  });

  it("keeps a next path the caller already put on the redirect", () => {
    // The subcontractor invite sends people to /sub, not the default landing.
    const link = buildEmailConfirmationLink({
      properties: { hashed_token: "abc123" },
      redirectTo: "https://app.example.com/auth/confirm?next=%2Fsub",
      type: "invite",
    });

    const url = new URL(link!);
    expect(url.searchParams.get("next")).toBe("/sub");
    expect(url.searchParams.get("token_hash")).toBe("abc123");
    expect(url.searchParams.get("type")).toBe("invite");
  });

  it("declares the type it was given, so the right flow runs on redemption", () => {
    // invite and recovery land on set-password as a wall; magiclink offers a skip.
    for (const type of ["invite", "recovery", "magiclink"] as const) {
      const link = buildEmailConfirmationLink({
        properties: { hashed_token: "t" },
        redirectTo: "https://app.example.com/auth/confirm",
        type,
      });
      expect(new URL(link!).searchParams.get("type")).toBe(type);
    }
  });

  it("returns null when there is no token, rather than a link that lands on an error", () => {
    const cases = [null, undefined, {}, { hashed_token: null }, { hashed_token: "   " }];

    for (const properties of cases) {
      expect(buildEmailConfirmationLink({ properties, redirectTo: "https://app.example.com/auth/confirm", type: "invite" })).toBeNull();
    }
  });

  it("returns null for an unusable redirect rather than throwing mid-send", () => {
    expect(
      buildEmailConfirmationLink({ properties: { hashed_token: "t" }, redirectTo: "not a url", type: "invite" }),
    ).toBeNull();
  });

  it("never produces a link to Supabase's own verify endpoint", () => {
    const link = buildEmailConfirmationLink({
      properties: { hashed_token: "abc123" },
      redirectTo: "https://app.example.com/auth/confirm",
      type: "recovery",
    });

    expect(link).not.toContain("supabase.co");
    expect(link).not.toContain("/auth/v1/verify");
    expect(SUPABASE_VERIFY_URL).toContain("/auth/v1/verify"); // the shape we refuse to send
  });
});

// The regression guard.
//
// Sending properties.action_link is the bug that locked a client's president out
// for four days: Supabase redeems the token on GET and returns the session in a
// URL fragment, so our own /auth/confirm sees nothing and errors. It is an easy
// mistake to make again, because action_link is the field that looks like "the
// link". Every mailer must go through buildEmailConfirmationLink instead.
describe("no mailer sends Supabase's action_link", () => {
  const MAILERS = ["src/lib/password-reset.ts", "src/lib/worker-invite.ts", "src/lib/subcontractor-invite.ts"];

  it.each(MAILERS)("%s builds its link from the hashed token", (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");

    expect(code).not.toContain("properties?.action_link");
    expect(code).not.toContain("properties.action_link");
    expect(code).toContain("buildEmailConfirmationLink");
  });
});
