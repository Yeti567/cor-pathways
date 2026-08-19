import { describe, expect, it, vi } from "vitest";
import { buildSubcontractorInviteEmail, inviteSubcontractorContact } from "@/lib/subcontractor-invite";

const LINK = "https://app.example.com/auth/confirm?token_hash=abc&next=%2Fsub";

describe("buildSubcontractorInviteEmail", () => {
  it("says who is asking and why, because the reader does not work here", () => {
    const email = buildSubcontractorInviteEmail({
      actionLink: LINK,
      carrierName: "Redwater Hauling Ltd.",
      companyName: "Northbound Carriers",
      fullName: "Dana Whitfield",
    });

    expect(email.subject).toContain("Northbound Carriers");
    expect(email.text).toContain("Hi Dana,");
    expect(email.text).toContain("Redwater Hauling Ltd.");
    expect(email.text).toContain(LINK);
    // The HTML carries the same link with its ampersands entity-escaped, which is what
    // makes it safe to drop into an href.
    expect(email.html).toContain(LINK.replace(/&/g, "&amp;"));
  });

  it("promises no password, because that is the whole point of the flow", () => {
    const email = buildSubcontractorInviteEmail({
      actionLink: LINK,
      carrierName: "Redwater Hauling Ltd.",
      companyName: "Northbound Carriers",
      fullName: "Dana Whitfield",
    });

    expect(email.text).toContain("no password");
    expect(email.html).toContain("no password");
  });

  it("reads as a resend for somebody who already has an account", () => {
    const email = buildSubcontractorInviteEmail({
      actionLink: LINK,
      carrierName: "Redwater Hauling Ltd.",
      companyName: "Northbound Carriers",
      fullName: "Dana Whitfield",
      returning: true,
    });

    expect(email.subject).toContain("sign-in link");
    expect(email.text).toContain("fresh sign-in link");
  });

  it("escapes a company name that contains markup", () => {
    const email = buildSubcontractorInviteEmail({
      actionLink: LINK,
      carrierName: "<script>alert(1)</script>",
      companyName: "Acme & Sons <b>",
      fullName: "Dana Whitfield",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&amp;");
    expect(email.html).toContain("&lt;b&gt;");
  });

  it("falls back to a greeting when the name is blank", () => {
    const email = buildSubcontractorInviteEmail({
      actionLink: LINK,
      carrierName: "",
      companyName: "",
      fullName: "   ",
    });

    expect(email.text).toContain("Hi there,");
  });
});

function adminStub(overrides: {
  generateLink?: unknown;
  upsertError?: null;
} = {}) {
  return {
    auth: {
      admin: {
        generateLink:
          overrides.generateLink ??
          vi.fn(async () => ({
            data: { user: { id: "user-1" }, properties: { action_link: LINK, hashed_token: "abc" } },
            error: null,
          })),
      },
    },
  } as never;
}

describe("inviteSubcontractorContact", () => {
  it("refuses before creating anything when the tenant is a demo", async () => {
    const generateLink = vi.fn();
    const result = await inviteSubcontractorContact(
      adminStub({ generateLink }),
      {
        carrierName: "Redwater Hauling Ltd.",
        companyName: "Northbound Carriers",
        email: "dana@redwater.example",
        fullName: "Dana Whitfield",
        redirectTo: "https://app.example.com/auth/confirm",
        tenantId: "tenant-1",
      },
      { isDemoTenant: async () => true },
    );

    expect(result).toEqual({ ok: false, error: "Inviting carriers is disabled in the demo." });
    // Nothing was created and nothing was sent: a demo must never mint an auth user for
    // an outside email address.
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("falls back to a sign-in link when the account already exists", async () => {
    const generateLink = vi
      .fn()
      .mockResolvedValueOnce({ data: { user: null }, error: { message: "already registered" } })
      .mockResolvedValueOnce({
        data: { user: { id: "user-1" }, properties: { action_link: LINK, hashed_token: "abc" } },
        error: null,
      });

    const result = await inviteSubcontractorContact(
      adminStub({ generateLink }),
      {
        carrierName: "Redwater Hauling Ltd.",
        companyName: "Northbound Carriers",
        email: "dana@redwater.example",
        fullName: "Dana Whitfield",
        redirectTo: "https://app.example.com/auth/confirm",
        tenantId: "tenant-1",
      },
      { env: {} as NodeJS.ProcessEnv, isDemoTenant: async () => false },
    );

    expect(generateLink).toHaveBeenCalledTimes(2);
    expect(generateLink.mock.calls[0][0].type).toBe("invite");
    expect(generateLink.mock.calls[1][0].type).toBe("magiclink");
    expect(result.ok).toBe(true);
  });

  it("still reports success when email delivery is unconfigured, so the login is not lost", async () => {
    const result = await inviteSubcontractorContact(
      adminStub(),
      {
        carrierName: "Redwater Hauling Ltd.",
        companyName: "Northbound Carriers",
        email: "dana@redwater.example",
        fullName: "Dana Whitfield",
        redirectTo: "https://app.example.com/auth/confirm",
        tenantId: "tenant-1",
      },
      { env: {} as NodeJS.ProcessEnv, isDemoTenant: async () => false },
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.emailWarning).toContain("Email delivery is not configured");
    }
  });
});
