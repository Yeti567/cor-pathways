import { describe, expect, it, vi } from "vitest";
import {
  authorizeRelayRequest,
  buildResendRequest,
  parseRelayPayload,
  RESEND_ENDPOINT,
  sendViaResend,
} from "@/lib/resend-relay";

const validPayload = {
  body: "Your form was submitted.",
  from: "forms@example.com",
  subject: "Notification",
  to: "worker@example.com",
};

function testEnv(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...values,
  };
}

describe("authorizeRelayRequest", () => {
  it("rejects when the secret is not configured", () => {
    const result = authorizeRelayRequest("Bearer anything", testEnv());
    expect(result).toEqual({ error: "EMAIL_DELIVERY_WEBHOOK_SECRET is not configured.", ok: false, status: 500 });
  });

  it("rejects a mismatched bearer token", () => {
    const result = authorizeRelayRequest("Bearer wrong", testEnv({ EMAIL_DELIVERY_WEBHOOK_SECRET: "right" }));
    expect(result).toEqual({ error: "Unauthorized", ok: false, status: 401 });
  });

  it("accepts the matching bearer token", () => {
    const result = authorizeRelayRequest("Bearer right", testEnv({ EMAIL_DELIVERY_WEBHOOK_SECRET: "right" }));
    expect(result).toEqual({ ok: true });
  });
});

describe("parseRelayPayload", () => {
  it("accepts a complete payload and narrows extra fields away", () => {
    const result = parseRelayPayload({ ...validPayload, id: "abc", tenantId: "t1" });
    expect(result).toEqual({ ok: true, payload: validPayload });
  });

  it.each(["to", "from", "subject", "body"] as const)("rejects a payload missing %s", (field) => {
    const result = parseRelayPayload({ ...validPayload, [field]: "   " });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseRelayPayload("nope").ok).toBe(false);
    expect(parseRelayPayload(null).ok).toBe(false);
  });
});

describe("buildResendRequest", () => {
  it("maps the payload into Resend's API shape with the api key", () => {
    const { init, url } = buildResendRequest(validPayload, "re_test_key");
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "forms@example.com",
      subject: "Notification",
      text: "Your form was submitted.",
      to: ["worker@example.com"],
    });
  });
});

describe("sendViaResend", () => {
  it("returns the resend id on success", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_123" }), { status: 200 }));
    const result = await sendViaResend(validPayload, "re_key", fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ id: "email_123", ok: true });
    expect(fetchMock).toHaveBeenCalledWith(RESEND_ENDPOINT, expect.objectContaining({ method: "POST" }));
  });

  it("surfaces a Resend error body", async () => {
    const fetchMock = vi.fn(async () => new Response("domain not verified", { status: 403 }));
    const result = await sendViaResend(validPayload, "re_key", fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toContain("HTTP 403");
      expect(result.error).toContain("domain not verified");
    }
  });

  it("handles network errors", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await sendViaResend(validPayload, "re_key", fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ error: "network down", ok: false, status: 502 });
  });
});
