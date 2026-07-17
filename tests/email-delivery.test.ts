import { describe, expect, it, vi } from "vitest";
import {
  deliverEmailNotification,
  emailDeliveryConfigured,
  getMissingEmailDeliveryEnv,
  getEmailDeliveryConfig,
  type EmailNotificationRow,
} from "@/lib/email-delivery";

const baseNotification: EmailNotificationRow = {
  body: "Daily Field Report was submitted by Blake.",
  created_at: "2026-05-22T09:00:00.000Z",
  delivery_attempts: 0,
  id: "notification-1",
  recipient_contact: "client@example.com",
  recipient_name: "Client Inbox",
  recipient_type: "client_contact",
  submission_id: "submission-1",
  tenant_id: "tenant-1",
  title: "Auto-share: Daily Field Report",
};

function testEnv(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...values,
  };
}

describe("email delivery helpers", () => {
  it("reads webhook configuration from the environment", () => {
    const env = testEnv({
      EMAIL_DELIVERY_FROM: "forms@example.com",
      EMAIL_DELIVERY_WEBHOOK_SECRET: "secret",
      EMAIL_DELIVERY_WEBHOOK_URL: "https://email.example.test/send",
    });

    expect(getEmailDeliveryConfig(env)).toEqual({
      from: "forms@example.com",
      secret: "secret",
      webhookUrl: "https://email.example.test/send",
    });
    expect(emailDeliveryConfigured(env)).toBe(true);
    expect(getMissingEmailDeliveryEnv(env)).toEqual([]);
    expect(emailDeliveryConfigured(testEnv())).toBe(false);
    expect(getMissingEmailDeliveryEnv(testEnv({ EMAIL_DELIVERY_WEBHOOK_URL: "https://email.example.test/send" }))).toEqual([
      "EMAIL_DELIVERY_FROM",
      "EMAIL_DELIVERY_WEBHOOK_SECRET",
    ]);
  });

  it("posts queued notification details to the configured webhook", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch;

    const result = await deliverEmailNotification(
      baseNotification,
      testEnv({
        EMAIL_DELIVERY_FROM: "forms@example.com",
        EMAIL_DELIVERY_WEBHOOK_SECRET: "secret",
        EMAIL_DELIVERY_WEBHOOK_URL: "https://email.example.test/send",
      }),
      fetchMock,
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://email.example.test/send",
      expect.objectContaining({
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(JSON.parse(String((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body))).toMatchObject({
      body: baseNotification.body,
      from: "forms@example.com",
      id: baseNotification.id,
      subject: baseNotification.title,
      tenantId: baseNotification.tenant_id,
      to: baseNotification.recipient_contact,
    });
  });

  it("returns a failed delivery result when the webhook rejects the request", async () => {
    const fetchMock = vi.fn(async () => new Response("bad auth", { status: 401 })) as unknown as typeof fetch;

    const result = await deliverEmailNotification(
      baseNotification,
      testEnv({
        EMAIL_DELIVERY_FROM: "forms@example.com",
        EMAIL_DELIVERY_WEBHOOK_SECRET: "secret",
        EMAIL_DELIVERY_WEBHOOK_URL: "https://email.example.test/send",
      }),
      fetchMock,
    );

    expect(result).toEqual({
      error: "Email delivery failed with HTTP 401: bad auth",
      ok: false,
    });
  });

  it("does not send notifications without a configured webhook or recipient", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;

    await expect(deliverEmailNotification(baseNotification, testEnv(), fetchMock)).resolves.toEqual({
      error:
        "Email delivery is missing required configuration: EMAIL_DELIVERY_WEBHOOK_URL, EMAIL_DELIVERY_FROM, EMAIL_DELIVERY_WEBHOOK_SECRET.",
      ok: false,
    });
    await expect(
      deliverEmailNotification(
        baseNotification,
        testEnv({
          EMAIL_DELIVERY_WEBHOOK_URL: "https://email.example.test/send",
        }),
        fetchMock,
      ),
    ).resolves.toEqual({
      error: "Email delivery is missing required configuration: EMAIL_DELIVERY_FROM, EMAIL_DELIVERY_WEBHOOK_SECRET.",
      ok: false,
    });
    await expect(
      deliverEmailNotification(
        { ...baseNotification, recipient_contact: null },
        testEnv({
          EMAIL_DELIVERY_FROM: "forms@example.com",
          EMAIL_DELIVERY_WEBHOOK_SECRET: "secret",
          EMAIL_DELIVERY_WEBHOOK_URL: "https://email.example.test/send",
        }),
        fetchMock,
      ),
    ).resolves.toEqual({
      error: "Notification is missing an email recipient.",
      ok: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
