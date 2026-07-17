import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { exchangeMotiveCode, storeMotiveTokens } from "@/lib/eld/motive-sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CONNECTIONS_PATH = "/admin/transport/connections";

// Motive redirects the manager's browser here after they approve access. Verify
// the CSRF state, exchange the code for tokens, store them in the deny-all secret
// table, and mark the connection connected.
export async function GET(request: Request) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    return NextResponse.redirect(new URL("/choose", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const savedState = cookieStore.get("motive_oauth_state")?.value;
  cookieStore.delete("motive_oauth_state");

  const redirectError = (message: string) =>
    NextResponse.redirect(new URL(`${CONNECTIONS_PATH}?error=${encodeURIComponent(message)}`, request.url));

  if (!code || !state || !savedState || state !== savedState) {
    return redirectError("Motive authorization could not be verified. Please try connecting again.");
  }

  const exchange = await exchangeMotiveCode(code);

  if (!exchange.ok) {
    return redirectError(exchange.error);
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return redirectError("Service role key is not configured.");
  }

  const tenantId = context.appUser.tenant_id;
  const { data: connection, error } = await admin
    .from("eld_connection")
    .upsert(
      { tenant_id: tenantId, provider: "motive", status: "connected", last_error: null, created_by: context.appUser.id },
      { onConflict: "tenant_id,provider" },
    )
    .select("id")
    .single<{ id: string }>();

  if (error || !connection) {
    return redirectError(error?.message ?? "Could not save the Motive connection.");
  }

  await storeMotiveTokens({ admin, connectionId: connection.id, tenantId, tokens: exchange.tokens, now: new Date() });

  return NextResponse.redirect(
    new URL(`${CONNECTIONS_PATH}?notice=${encodeURIComponent("Motive connected. Run a sync to import Hours of Service.")}`, request.url),
  );
}
