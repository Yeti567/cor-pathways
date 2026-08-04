import type { Database } from "@/types/database";

export type EmailNotificationRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  | "body"
  | "created_at"
  | "delivery_attempts"
  | "id"
  | "recipient_contact"
  | "recipient_name"
  | "recipient_type"
  | "submission_id"
  | "tenant_id"
  | "title"
>;

export type EmailDeliveryConfig = {
  from: string | null;
  secret: string | null;
  webhookUrl: string | null;
};

export type EmailDeliveryResult = { ok: true } | { error: string; ok: false };

export const emailDeliveryRequiredEnv = [
  "EMAIL_DELIVERY_WEBHOOK_URL",
  "EMAIL_DELIVERY_FROM",
  "EMAIL_DELIVERY_WEBHOOK_SECRET",
] as const;

function optionalEnvValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getEmailDeliveryConfig(env: NodeJS.ProcessEnv = process.env): EmailDeliveryConfig {
  return {
    from: optionalEnvValue(env.EMAIL_DELIVERY_FROM),
    secret: optionalEnvValue(env.EMAIL_DELIVERY_WEBHOOK_SECRET),
    webhookUrl: optionalEnvValue(env.EMAIL_DELIVERY_WEBHOOK_URL),
  };
}

export function getMissingEmailDeliveryEnv(env: NodeJS.ProcessEnv = process.env) {
  const config = getEmailDeliveryConfig(env);
  const configured = {
    EMAIL_DELIVERY_FROM: config.from,
    EMAIL_DELIVERY_WEBHOOK_SECRET: config.secret,
    EMAIL_DELIVERY_WEBHOOK_URL: config.webhookUrl,
  } satisfies Record<(typeof emailDeliveryRequiredEnv)[number], string | null>;

  return emailDeliveryRequiredEnv.filter((key) => !configured[key]);
}

export function emailDeliveryConfigured(env: NodeJS.ProcessEnv = process.env) {
  return getMissingEmailDeliveryEnv(env).length === 0;
}

function responseFailureMessage(response: Response, responseText: string) {
  const detail = responseText.trim() || response.statusText || "No response body";
  return `Email delivery failed with HTTP ${response.status}: ${detail}`.slice(0, 500);
}

function unknownErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown email delivery error.";
}

export async function deliverEmailNotification(
  notification: EmailNotificationRow,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<EmailDeliveryResult> {
  const config = getEmailDeliveryConfig(env);
  const missingEnv = getMissingEmailDeliveryEnv(env);

  if (missingEnv.length > 0) {
    return {
      error: `Email delivery is missing required configuration: ${missingEnv.join(", ")}.`,
      ok: false,
    };
  }

  const to = notification.recipient_contact?.trim();

  if (!to) {
    return { error: "Notification is missing an email recipient.", ok: false };
  }

  const from = config.from!;
  const secret = config.secret!;
  const webhookUrl = config.webhookUrl!;
  const headers: HeadersInit = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };

  try {
    const response = await fetchImpl(webhookUrl, {
      body: JSON.stringify({
        body: notification.body,
        createdAt: notification.created_at,
        from,
        id: notification.id,
        recipientName: notification.recipient_name,
        recipientType: notification.recipient_type,
        submissionId: notification.submission_id,
        subject: notification.title || "Cor Pathways notification",
        tenantId: notification.tenant_id,
        to,
      }),
      headers,
      method: "POST",
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      return { error: responseFailureMessage(response, responseText), ok: false };
    }

    return { ok: true };
  } catch (error) {
    return { error: unknownErrorMessage(error).slice(0, 500), ok: false };
  }
}
