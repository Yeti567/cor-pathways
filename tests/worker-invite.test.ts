import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { APP_NAME } from "@/lib/brand";
import { buildWorkerInviteEmail, inviteWorkerByEmail, resendWorkerInviteByEmail } from "@/lib/worker-invite";

const ACTION_LINK = "https://iasq.supabase.co/auth/v1/verify?token=abc&type=invite&redirect_to=https://corpathway360.com/auth/confirm";

function adminClientWithGenerateLink(impl: () => Promise<unknown>): SupabaseClient<Database> {
  return {
    auth: { admin: { generateLink: vi.fn(impl) } },
  } as unknown as SupabaseClient<Database>;
}

const okGenerateLink = () =>
  Promise.resolve({
    data: { user: { id: "user-1" }, properties: { action_link: ACTION_LINK } },
    error: null,
  });

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", EMAIL_DELIVERY_FROM: "no-reply@corpathway360.com", RESEND_API_KEY: "re_test", ...overrides };
}

describe("buildWorkerInviteEmail", () => {
  it("puts the company in the subject and the link in both text and html", () => {
    const email = buildWorkerInviteEmail({ fullName: "Dana Jones", companyName: "Acme Freight", actionLink: ACTION_LINK });
    // Reads as "<Company> has invited you to <App>", so it works whatever a fork
    // sets NEXT_PUBLIC_APP_NAME to, rather than the doubled-up "invited to Acme
    // Freight on Acme Freight Safety App" the old phrasing produced.
    expect(email.subject).toBe(`Acme Freight has invited you to ${APP_NAME}`);
    expect(email.text).toContain("Hi Dana,");
    expect(email.text).toContain(ACTION_LINK);
    // The plain link has `&` escaped to `&amp;` inside the html href.
    expect(email.html).toContain("auth/v1/verify?token=abc");
    expect(email.html).toContain("&amp;type=invite");
    expect(email.html).toContain("Accept invitation");
  });

  it("escapes html-significant characters in the company and name", () => {
    const email = buildWorkerInviteEmail({
      fullName: "<b>Mal</b>",
      companyName: "Tom & Jerry <Co>",
      actionLink: ACTION_LINK,
    });
    expect(email.html).toContain("Tom &amp; Jerry &lt;Co&gt;");
    expect(email.html).not.toContain("<b>Mal</b>");
  });

  it("falls back gracefully on blank name and company", () => {
    const email = buildWorkerInviteEmail({ fullName: "   ", companyName: "  ", actionLink: ACTION_LINK });
    expect(email.text).toContain("Hi there,");
    expect(email.subject).toContain("Your company");
  });
});

describe("inviteWorkerByEmail", () => {
  const params = {
    email: "dana@acme.test",
    fullName: "Dana Jones",
    companyName: "Acme Freight",
    redirectTo: "https://corpathway360.com/auth/confirm",
    tenantId: "tenant-1",
  };

  // Every real invite path runs after the demo check; default it to "not a demo"
  // so these tests exercise the send behaviour. The demo case is tested on its own.
  const notDemo = async () => false;

  it("generates a link and sends a branded email via Resend", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    const client = adminClientWithGenerateLink(okGenerateLink);

    const result = await inviteWorkerByEmail(client, params, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result).toEqual({ ok: true, user: { id: "user-1" }, emailWarning: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(firstCall[1].body as string);
    expect(body.to).toEqual(["dana@acme.test"]);
    expect(body.from).toBe("no-reply@corpathway360.com");
    expect(body.text).toContain(ACTION_LINK);
    expect(body.html).toContain("auth/v1/verify?token=abc");
  });

  it("passes the invite metadata to generateLink", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const generateLink = vi.fn(okGenerateLink);
    const client = { auth: { admin: { generateLink } } } as unknown as SupabaseClient<Database>;

    await inviteWorkerByEmail(client, params, { env: env(), fetchImpl: fetchMock as unknown as typeof fetch, isDemoTenant: notDemo });

    expect(generateLink).toHaveBeenCalledWith({
      type: "invite",
      email: "dana@acme.test",
      options: { data: { company_name: "Acme Freight", full_name: "Dana Jones" }, redirectTo: params.redirectTo },
    });
  });

  it("returns ok:false when the link cannot be created (no user)", async () => {
    const client = adminClientWithGenerateLink(() =>
      Promise.resolve({ data: { user: null, properties: null }, error: { message: "already registered" } }),
    );
    const result = await inviteWorkerByEmail(client, params, {
      env: env(),
      fetchImpl: vi.fn() as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });
    expect(result).toEqual({ ok: false, error: "already registered" });
  });

  it("returns ok:true with a warning when the email fails but the user was created", async () => {
    const fetchMock = vi.fn(async () => new Response("domain not verified", { status: 403 }));
    const client = adminClientWithGenerateLink(okGenerateLink);

    const result = await inviteWorkerByEmail(client, params, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user).toEqual({ id: "user-1" });
      expect(result.emailWarning).toContain("HTTP 403");
    }
  });

  it("does not attempt to send when email env is missing, but still provisions the user", async () => {
    const fetchMock = vi.fn();
    const client = adminClientWithGenerateLink(okGenerateLink);

    const result = await inviteWorkerByEmail(client, params, {
      env: { NODE_ENV: "test" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.emailWarning).toContain("Email delivery is not configured");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks the invite for a demo tenant without creating a user or sending", async () => {
    const fetchMock = vi.fn();
    const generateLink = vi.fn(okGenerateLink);
    const client = { auth: { admin: { generateLink } } } as unknown as SupabaseClient<Database>;

    const result = await inviteWorkerByEmail(client, params, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: async () => true,
    });

    expect(result).toEqual({ ok: false, error: "Inviting workers is disabled in the demo." });
    expect(generateLink).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resendWorkerInviteByEmail", () => {
  const params = {
    email: "dana@acme.test",
    fullName: "Dana Jones",
    companyName: "Acme Freight",
    redirectTo: "https://corpathway360.com/auth/confirm",
    tenantId: "tenant-1",
  };

  const notDemo = async () => false;

  it("uses a magic link, because type:invite refuses an existing address", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_2" }), { status: 200 }));
    const generateLink = vi.fn(okGenerateLink);
    const client = { auth: { admin: { generateLink } } } as unknown as SupabaseClient<Database>;

    const result = await resendWorkerInviteByEmail(client, params, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result).toEqual({ ok: true });
    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "dana@acme.test",
      options: { redirectTo: params.redirectTo },
    });
  });

  it("reports a failed send as a failure, since nothing was provisioned to keep", async () => {
    const fetchMock = vi.fn(async () => new Response("domain not verified", { status: 403 }));
    const client = adminClientWithGenerateLink(okGenerateLink);

    const result = await resendWorkerInviteByEmail(client, params, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("403");
  });

  it("does not mint a link when email delivery is unconfigured", async () => {
    const generateLink = vi.fn(okGenerateLink);
    const client = { auth: { admin: { generateLink } } } as unknown as SupabaseClient<Database>;

    const result = await resendWorkerInviteByEmail(client, params, {
      env: { NODE_ENV: "test" },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result.ok).toBe(false);
    // A link generated and never sent is a live credential created for nothing.
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("refuses to resend from a demo tenant", async () => {
    const generateLink = vi.fn(okGenerateLink);
    const client = { auth: { admin: { generateLink } } } as unknown as SupabaseClient<Database>;

    const result = await resendWorkerInviteByEmail(client, params, {
      env: env(),
      fetchImpl: vi.fn() as unknown as typeof fetch,
      isDemoTenant: async () => true,
    });

    expect(result).toEqual({ ok: false, error: "Inviting workers is disabled in the demo." });
    expect(generateLink).not.toHaveBeenCalled();
  });
});
