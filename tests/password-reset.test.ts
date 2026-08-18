import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { PASSWORD_RESET_NOTICE, buildPasswordResetEmail, sendPasswordResetEmail } from "@/lib/password-reset";

const ACTION_LINK = "https://iasq.supabase.co/auth/v1/verify?token=xyz&type=recovery";

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    EMAIL_DELIVERY_FROM: "Core Pathways <no-reply@corpathway360.com>",
    RESEND_API_KEY: "re_test",
    NEXT_PUBLIC_APP_URL: "https://corpathway360.com",
    ...overrides,
  };
}

// Minimal stand-in for the query chain the function uses: users lookup, then
// tenants lookup, then the auth admin call.
function adminClient({
  user,
  tenantName = "Acme Freight",
  generateLink = vi.fn(async () => ({ data: { properties: { action_link: ACTION_LINK } }, error: null })),
}: {
  user: { email: string; full_name: string; tenant_id: string } | null;
  tenantName?: string;
  generateLink?: ReturnType<typeof vi.fn>;
}) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (table === "users" ? { data: user } : { data: { name: tenantName } }),
        }),
      }),
    }),
    auth: { admin: { generateLink } },
  } as unknown as SupabaseClient<Database>;
}

const REAL_USER = { email: "dana@acme.test", full_name: "Dana Jones", tenant_id: "tenant-1" };
const notDemo = async () => false;

describe("buildPasswordResetEmail", () => {
  it("names the company and carries the link in both text and html", () => {
    const email = buildPasswordResetEmail({
      fullName: "Dana Jones",
      companyName: "Acme Freight",
      actionLink: ACTION_LINK,
    });

    expect(email.subject).toBe("Reset your Acme Freight password");
    expect(email.text).toContain("Hi Dana,");
    expect(email.text).toContain(ACTION_LINK);
    expect(email.html).toContain("Reset password");
  });

  it("tells the recipient nothing changes if they ignore it", () => {
    const email = buildPasswordResetEmail({ fullName: "Dana", companyName: "Acme", actionLink: ACTION_LINK });
    expect(email.text).toContain("your password will not change");
    expect(email.html).toContain("your password will not change");
  });

  it("escapes html-significant characters in the company and name", () => {
    const email = buildPasswordResetEmail({
      fullName: "<b>Mal</b>",
      companyName: "Tom & Jerry <Co>",
      actionLink: ACTION_LINK,
    });
    expect(email.html).toContain("Tom &amp; Jerry &lt;Co&gt;");
    expect(email.html).not.toContain("<b>Mal</b>");
  });
});

describe("sendPasswordResetEmail", () => {
  it("mints a recovery link and sends it for a real user", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_9" }), { status: 200 }));
    const generateLink = vi.fn(async () => ({ data: { properties: { action_link: ACTION_LINK } }, error: null }));

    const result = await sendPasswordResetEmail(adminClient({ user: REAL_USER, generateLink }), "dana@acme.test", {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result).toEqual({ handled: true });
    expect(generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "dana@acme.test",
      options: { redirectTo: "https://corpathway360.com/auth/confirm" },
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.to).toEqual(["dana@acme.test"]);
    expect(body.text).toContain(ACTION_LINK);
  });

  // The enumeration guarantee. Each of these must be indistinguishable from a
  // successful send, because this form is public and unauthenticated.
  it("returns the same result for an unknown address, and sends nothing", async () => {
    const fetchMock = vi.fn();
    const generateLink = vi.fn();

    const result = await sendPasswordResetEmail(adminClient({ user: null, generateLink }), "nobody@nowhere.test", {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result).toEqual({ handled: true });
    expect(generateLink).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the same result for a demo tenant, and sends nothing", async () => {
    const fetchMock = vi.fn();
    const generateLink = vi.fn();

    const result = await sendPasswordResetEmail(adminClient({ user: REAL_USER, generateLink }), REAL_USER.email, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: async () => true,
    });

    expect(result).toEqual({ handled: true });
    expect(generateLink).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the same result when Resend rejects the send", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));

    const result = await sendPasswordResetEmail(adminClient({ user: REAL_USER }), REAL_USER.email, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result).toEqual({ handled: true });
  });

  it("does nothing when email delivery is unconfigured", async () => {
    const generateLink = vi.fn();

    const result = await sendPasswordResetEmail(adminClient({ user: REAL_USER, generateLink }), REAL_USER.email, {
      env: { NODE_ENV: "test" },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result).toEqual({ handled: true });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("normalizes the address before looking it up", async () => {
    const generateLink = vi.fn(async () => ({ data: { properties: { action_link: ACTION_LINK } }, error: null }));
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

    await sendPasswordResetEmail(adminClient({ user: REAL_USER, generateLink }), "  DANA@Acme.test  ", {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(generateLink).toHaveBeenCalledWith(expect.objectContaining({ email: "dana@acme.test" }));
  });

  // An invited worker who never opened their invite has no confirmed address, so
  // Supabase refuses a recovery link for them. Before the magiclink fallback the
  // reset form accepted their address, minted nothing, and told them a link was
  // on the way, which left them permanently locked out with no way to find out.
  it("falls back to a magic link when recovery is refused", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const generateLink = vi.fn(async ({ type }: { type: string }) =>
      type === "recovery"
        ? { data: null, error: { message: "User not confirmed" } }
        : { data: { properties: { action_link: ACTION_LINK } }, error: null },
    );

    const result = await sendPasswordResetEmail(adminClient({ user: REAL_USER, generateLink }), REAL_USER.email, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result).toEqual({ handled: true });
    expect(generateLink).toHaveBeenCalledTimes(2);
    expect(generateLink).toHaveBeenLastCalledWith(expect.objectContaining({ type: "magiclink" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not reach for a magic link when recovery already worked", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const generateLink = vi.fn(async () => ({ data: { properties: { action_link: ACTION_LINK } }, error: null }));

    await sendPasswordResetEmail(adminClient({ user: REAL_USER, generateLink }), REAL_USER.email, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(generateLink).toHaveBeenCalledWith(expect.objectContaining({ type: "recovery" }));
  });

  it("sends nothing when neither link type can be minted", async () => {
    const fetchMock = vi.fn();
    const generateLink = vi.fn(async () => ({ data: null, error: { message: "nope" } }));

    const result = await sendPasswordResetEmail(adminClient({ user: REAL_USER, generateLink }), REAL_USER.email, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result).toEqual({ handled: true });
    expect(generateLink).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PASSWORD_RESET_NOTICE", () => {
  it("stays conditional so it confirms nothing about the address", () => {
    expect(PASSWORD_RESET_NOTICE).toContain("If that email has an account here");
  });

  it("names the wrong-deployment dead end, the one cause a real person can act on", () => {
    expect(PASSWORD_RESET_NOTICE).toContain("your own company's web address");
  });
});
