// Building the link that goes in an auth email.
//
// NEVER SEND properties.action_link. This is the bug that locked a client's
// president out of her own app for four days, and it is worth spelling out
// because the wrong value is the obvious-looking one.
//
// `generateLink` returns two things that both look like "the link":
//
//   action_link   https://<project>.supabase.co/auth/v1/verify?token=...&redirect_to=...
//   hashed_token  the raw token, for us to put in a URL of our own
//
// action_link points at Supabase's verify endpoint, not at us. Clicking it makes
// Supabase redeem the token itself, create the session on its side, and then
// redirect to redirect_to carrying the result in the URL FRAGMENT. A fragment is
// never sent to a server, so /auth/confirm receives no token_hash and no type,
// decides the link is malformed, and sends the person to /auth/error. The
// database meanwhile fills up with real sessions that the app never received,
// which is why this looks like "login is broken" rather than "the email is
// wrong": the account is fine, the session is real, and the person still cannot
// get in.
//
// It also quietly defeats the scanner protection in /auth/confirm. That route
// deliberately refuses to verify on GET, because inbox scanners follow links and
// would burn a single-use token before the recipient clicks. Supabase's verify
// endpoint has no such scruples: it redeems on GET, so action_link hands the
// token to the first scanner that touches the message.
//
// So we mint the link ourselves, pointed at our own /auth/confirm, carrying the
// token as a query parameter where the server can actually read it.

import type { EmailOtpType } from "@supabase/supabase-js";

export type GeneratedLinkProperties = {
  hashed_token?: string | null;
} | null | undefined;

/**
 * The link to email, built from the token `generateLink` minted.
 *
 * `redirectTo` is the same value handed to generateLink, which every caller
 * already points at /auth/confirm, sometimes with a `next` of its own. Both are
 * preserved: token_hash and type are added alongside whatever was there.
 *
 * Returns null when there is no token to send, so a caller can tell "no link"
 * apart from a link that would land on an error page.
 */
export function buildEmailConfirmationLink(input: {
  redirectTo: string;
  properties: GeneratedLinkProperties;
  type: EmailOtpType;
}): string | null {
  const hashedToken = input.properties?.hashed_token?.trim();

  if (!hashedToken) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(input.redirectTo);
  } catch {
    return null;
  }

  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", input.type);

  return url.toString();
}
