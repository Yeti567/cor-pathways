import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { motiveAuthorizeUrl } from "@/lib/eld/motive";
import { getMotiveCredentials } from "@/lib/eld/motive-sync";

export const dynamic = "force-dynamic";

const CONNECTIONS_PATH = "/admin/transport/connections";

// Start the Motive OAuth flow: set a CSRF state cookie and redirect the signed-in
// manager to Motive's authorize page. The admin's session identifies the tenant
// on the callback.
export async function GET(request: Request) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    return NextResponse.redirect(new URL("/choose", request.url));
  }

  if (!context.tenant?.transport_enabled) {
    return NextResponse.redirect(new URL("/admin/setup", request.url));
  }

  const credentials = getMotiveCredentials();

  if (!credentials) {
    return NextResponse.redirect(
      new URL(`${CONNECTIONS_PATH}?error=${encodeURIComponent("Motive credentials are not configured.")}`, request.url),
    );
  }

  const state = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("motive_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(
    motiveAuthorizeUrl({ clientId: credentials.clientId, redirectUri: credentials.redirectUri, state }),
  );
}
