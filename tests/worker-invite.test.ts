import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { APP_NAME } from "@/lib/brand";
import { buildWorkerInviteEmail, createWorkerAccount, sendWorkerInviteByEmail } from "@/lib/worker-invite";

const ACTION_LINK = "https://iasq.supabase.co/auth/v1/verify?token=abc&type=invite&redirect_to=https://corpathway360.com/auth/confirm";
const HASHED_TOKEN = "hashed-token-abc";
const EXPECTED_INVITE_LINK = "https://corpathway360.com/auth/confirm?token_hash=hashed-token-abc&type=invite";
const EXPECTED_MAGIC_LINK = "https://corpathway360.com/auth/confirm?token_hash=hashed-token-abc&type=magiclink";

function adminClientWithGenerateLink(impl: () => Promise<unknown>): SupabaseClient<Database> {
  return {
    auth: { admin: { generateLink: vi.fn(impl) } },
  } as unknown as SupabaseClient<Database>;
}

const okGenerateLink = () =>
  Promise.resolve({
    data: { user: { id: "user-1" }, properties: { action_link: ACTION_LINK, hashed_token: HASHED_TOKEN } },
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

describe("createWorkerAccount", () => {
  const params = {
    email: "dana@acme.test",
    fullName: "Dana Jones",
    companyName: "Acme Freight",
    tenantId: "tenant-1",
  };

  const notDemo = async () => false;

  it("creates the account and sends nothing at all", async () => {
    const fetchMock = vi.fn();
    const client = adminClientWithGenerateLink(okGenerateLink);

    const result = await createWorkerAccount(client, params, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result).toEqual({ ok: true, user: { id: "user-1" } });
    // The whole point of the change: entering a worker puts nothing in an inbox.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("provisions through generateLink, because createUser is refused by the signup trigger", async () => {
    const generateLink = vi.fn(okGenerateLink);
    const createUser = vi.fn();
    const client = { auth: { admin: { createUser, generateLink } } } as unknown as SupabaseClient<Database>;

    await createWorkerAccount(client, params, { env: env(), isDemoTenant: notDemo });

    // Measured against a local stack: admin createUser writes a password hash even
    // when no password is passed, the signup trigger reads that as somebody signing
    // themselves up, and refuses once a company exists. An invite link leaves the
    // password column genuinely empty, which is the branch the trigger allows.
    expect(createUser).not.toHaveBeenCalled();
    expect(generateLink).toHaveBeenCalledWith({
      type: "invite",
      email: "dana@acme.test",
      options: { data: { company_name: "Acme Freight", full_name: "Dana Jones" } },
    });
  });

  it("asks for no redirect, since the link it mints is thrown away unsent", async () => {
    const generateLink = vi.fn(okGenerateLink);
    const client = { auth: { admin: { generateLink } } } as unknown as SupabaseClient<Database>;

    await createWorkerAccount(client, params, { env: env(), isDemoTenant: notDemo });

    const options = (generateLink.mock.calls as unknown as Record<string, Record<string, unknown>>[][])[0][0]
      .options as Record<string, unknown>;
    expect(options).not.toHaveProperty("redirectTo");
  });

  it("returns ok:false when the account cannot be created", async () => {
    const client = adminClientWithGenerateLink(() =>
      Promise.resolve({ data: { user: null, properties: null }, error: { message: "already registered" } }),
    );

    const result = await createWorkerAccount(client, params, { env: env(), isDemoTenant: notDemo });

    expect(result).toEqual({ ok: false, error: "already registered" });
  });

  it("blocks a demo tenant without creating anything", async () => {
    const generateLink = vi.fn(okGenerateLink);
    const client = { auth: { admin: { generateLink } } } as unknown as SupabaseClient<Database>;

    const result = await createWorkerAccount(client, params, { env: env(), isDemoTenant: async () => true });

    expect(result).toEqual({ ok: false, error: "Adding workers is disabled in the demo." });
    expect(generateLink).not.toHaveBeenCalled();
  });
});

describe("sendWorkerInviteByEmail", () => {
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

    const result = await sendWorkerInviteByEmail(client, params, {
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

    // The link must declare type=magiclink, not the invite type, or /auth/verify
    // redeems it as the wrong flow. And like every other mailer it points at us,
    // never at Supabase's verify endpoint.
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.text).toContain(EXPECTED_MAGIC_LINK);
    expect(body.text).not.toContain("supabase.co");
  });

  it("marks a first-time invitation so the password step cannot be skipped", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const generateLink = vi.fn(okGenerateLink);
    const client = { auth: { admin: { generateLink } } } as unknown as SupabaseClient<Database>;

    await sendWorkerInviteByEmail(
      client,
      { ...params, requireSetup: true },
      { env: env(), fetchImpl: fetchMock as unknown as typeof fetch, isDemoTenant: notDemo },
    );

    // Without this the worker lands on a skippable page, skips it, and is left
    // with a session-only account that cannot sign in from a second device.
    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "dana@acme.test",
      options: { redirectTo: "https://corpathway360.com/auth/confirm?setup=1" },
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.text).toContain("setup=1");
  });

  it("leaves the marker off for somebody who already has a password", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const generateLink = vi.fn(okGenerateLink);
    const client = { auth: { admin: { generateLink } } } as unknown as SupabaseClient<Database>;

    await sendWorkerInviteByEmail(client, params, {
      env: env(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.text).not.toContain("setup=1");
  });

  it("reports a failed send as a failure, since nothing was provisioned to keep", async () => {
    const fetchMock = vi.fn(async () => new Response("domain not verified", { status: 403 }));
    const client = adminClientWithGenerateLink(okGenerateLink);

    const result = await sendWorkerInviteByEmail(client, params, {
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

    const result = await sendWorkerInviteByEmail(client, params, {
      env: { NODE_ENV: "test" },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      isDemoTenant: notDemo,
    });

    expect(result.ok).toBe(false);
    // A link generated and never sent is a live credential created for nothing.
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("refuses to send from a demo tenant", async () => {
    const generateLink = vi.fn(okGenerateLink);
    const client = { auth: { admin: { generateLink } } } as unknown as SupabaseClient<Database>;

    const result = await sendWorkerInviteByEmail(client, params, {
      env: env(),
      fetchImpl: vi.fn() as unknown as typeof fetch,
      isDemoTenant: async () => true,
    });

    expect(result).toEqual({ ok: false, error: "Inviting workers is disabled in the demo." });
    expect(generateLink).not.toHaveBeenCalled();
  });
});
