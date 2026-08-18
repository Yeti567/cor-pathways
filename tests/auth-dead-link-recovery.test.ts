import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard for 2026-08-18.
//
// The /auth/error page offers a button to anyone whose emailed link is dead. It
// was wired to Supabase's own `auth.resend` with a signup type, which cannot work
// on these deployments: the type is meaningless for an already-confirmed account,
// and that call delivers through Supabase's built-in SMTP, which is never
// configured here because all mail goes through Resend. It returned 200, sent
// nothing, and the visitor was shown a success notice.
//
// A client president pressed it twice, an hour apart, and got nowhere. The auth
// log held two `/resend` 200s and no `generate_link` at all. These tests fail if
// anyone reintroduces either half of that.
const errorActions = readFileSync(join(process.cwd(), "src/app/auth/error/actions.ts"), "utf8");
const errorPage = readFileSync(join(process.cwd(), "src/app/auth/error/page.tsx"), "utf8");
const forgotActions = readFileSync(join(process.cwd(), "src/app/auth/forgot-password/actions.ts"), "utf8");

// The source files deliberately DOCUMENT the old broken call in their comments, so
// every "must not contain" assertion runs against code only. Otherwise the
// explanation of the bug reads as the bug.
function code(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join(" ");
}

describe("dead-link recovery on /auth/error", () => {
  it("never resends through Supabase's own mailer", () => {
    expect(code(errorActions)).not.toMatch(/auth\.resend\(/);
    expect(code(errorActions)).not.toContain('type: "signup"');
  });

  it("sends the replacement link down the Resend pipeline instead", () => {
    expect(errorActions).toContain('from "@/lib/password-reset"');
    expect(errorActions).toContain("sendPasswordResetEmail(adminSupabase, email)");
  });

  it("needs the admin client, because a dead link leaves no session to read", () => {
    expect(errorActions).toContain("createSupabaseAdminClient");
    expect(code(errorActions)).not.toContain("createSupabaseServerClient");
  });

  it("wires the page form to the action that actually sends", () => {
    expect(errorPage).toContain('import { sendReplacementLink } from "./actions"');
    expect(errorPage).toContain("action={sendReplacementLink}");
    expect(code(errorPage)).not.toContain("resendSignupConfirmation");
  });

  it("stops promising a confirmation email it does not send", () => {
    expect(code(errorPage)).not.toContain("Resend confirmation email");
  });
});

describe("reset notice is shared, not duplicated", () => {
  // Two public forms that ask for the same thing must answer identically. If one
  // drifts, the difference between them tells a stranger which addresses exist.
  it("both entry points use the one exported constant", () => {
    for (const source of [errorActions, forgotActions]) {
      expect(source).toContain("PASSWORD_RESET_NOTICE");
      expect(source).toContain("encodeURIComponent(PASSWORD_RESET_NOTICE)");
    }
  });

  it("neither form hardcodes its own copy of the wording", () => {
    for (const source of [errorActions, forgotActions]) {
      expect(code(source)).not.toContain("If that email has an account here");
    }
  });
});
