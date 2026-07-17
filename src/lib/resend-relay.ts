export type EmailRelayPayload = {
  body: string;
  from: string;
  subject: string;
  to: string;
  // Optional HTML alternative. When omitted, Resend gets a text-only email
  // (unchanged behaviour for the notification relay).
  html?: string;
};

export type RelayAuthResult = { ok: true } | { error: string; ok: false; status: number };

export type RelayParseResult = { ok: true; payload: EmailRelayPayload } | { error: string; ok: false };

export type RelaySendResult = { id: string | null; ok: true } | { error: string; ok: false; status: number };

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

function trimmed(value: string | undefined) {
  return value?.trim() ?? "";
}

/**
 * Verifies the inbound webhook request carries the shared bearer secret that the
 * Auto-Share email delivery layer sends (EMAIL_DELIVERY_WEBHOOK_SECRET).
 */
export function authorizeRelayRequest(
  authHeader: string | null,
  env: NodeJS.ProcessEnv = process.env,
): RelayAuthResult {
  const secret = trimmed(env.EMAIL_DELIVERY_WEBHOOK_SECRET);

  if (!secret) {
    return { error: "EMAIL_DELIVERY_WEBHOOK_SECRET is not configured.", ok: false, status: 500 };
  }

  if (authHeader !== `Bearer ${secret}`) {
    return { error: "Unauthorized", ok: false, status: 401 };
  }

  return { ok: true };
}

/**
 * Validates the JSON the app posts ({ to, from, subject, body, ... }) and narrows
 * it to the four fields Resend needs.
 */
export function parseRelayPayload(raw: unknown): RelayParseResult {
  if (!raw || typeof raw !== "object") {
    return { error: "Request body must be a JSON object.", ok: false };
  }

  const record = raw as Record<string, unknown>;
  const to = typeof record.to === "string" ? record.to.trim() : "";
  const from = typeof record.from === "string" ? record.from.trim() : "";
  const subject = typeof record.subject === "string" ? record.subject.trim() : "";
  const body = typeof record.body === "string" ? record.body : "";

  if (!to) {
    return { error: "Missing recipient (to).", ok: false };
  }

  if (!from) {
    return { error: "Missing sender (from).", ok: false };
  }

  if (!subject) {
    return { error: "Missing subject.", ok: false };
  }

  if (!body.trim()) {
    return { error: "Missing body.", ok: false };
  }

  return { ok: true, payload: { body, from, subject, to } };
}

export function buildResendRequest(payload: EmailRelayPayload, apiKey: string) {
  return {
    init: {
      body: JSON.stringify({
        from: payload.from,
        // JSON.stringify drops undefined keys, so a text-only payload is unchanged.
        html: payload.html,
        subject: payload.subject,
        text: payload.body,
        to: [payload.to],
      }),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    } satisfies RequestInit,
    url: RESEND_ENDPOINT,
  };
}

function extractResendId(responseText: string): string | null {
  try {
    const parsed = responseText ? (JSON.parse(responseText) as unknown) : null;

    if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).id === "string") {
      return (parsed as Record<string, string>).id;
    }
  } catch {
    // Resend returns JSON on success; a non-JSON body just means no id to surface.
  }

  return null;
}

export async function sendViaResend(
  payload: EmailRelayPayload,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RelaySendResult> {
  const { init, url } = buildResendRequest(payload, apiKey);

  try {
    const response = await fetchImpl(url, init);
    const responseText = await response.text().catch(() => "");

    if (!response.ok) {
      const detail = responseText.trim() || response.statusText || "No response body";
      return {
        error: `Resend rejected the email (HTTP ${response.status}): ${detail}`.slice(0, 500),
        ok: false,
        status: 502,
      };
    }

    return { id: extractResendId(responseText), ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Resend delivery error.";
    return { error: message.slice(0, 500), ok: false, status: 502 };
  }
}
