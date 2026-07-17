import { NextResponse } from "next/server";
import { authorizeRelayRequest, parseRelayPayload, sendViaResend } from "@/lib/resend-relay";

export const dynamic = "force-dynamic";

/**
 * Relay endpoint for Auto-Share email delivery.
 *
 * The app's email-delivery layer (src/lib/email-delivery.ts) POSTs its own JSON
 * shape here with EMAIL_DELIVERY_WEBHOOK_SECRET as a bearer token. This route
 * verifies that secret and forwards the message to Resend using RESEND_API_KEY,
 * translating the payload into Resend's API format.
 */
export async function POST(request: Request) {
  const auth = authorizeRelayRequest(request.headers.get("authorization"));

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured." }, { status: 500 });
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseRelayPayload(raw);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await sendViaResend(parsed.payload, apiKey);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ id: result.id, ok: true });
}
