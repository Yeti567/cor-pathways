import { NextResponse } from "next/server";
import { syncMotiveConnection } from "@/lib/eld/motive-sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Periodically pull Hours of Service from every connected ELD account. Bearer-
// authenticated with CRON_SECRET (the auth-redirect proxy already exempts
// /api/cron). Motive only for now; other providers slot in as they go live.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  }

  const { data: connections, error } = await admin
    .from("eld_connection")
    .select("tenant_id, provider")
    .eq("provider", "motive")
    .eq("status", "connected")
    .returns<{ tenant_id: string; provider: string }[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  const results = [];

  for (const connection of connections ?? []) {
    const result = await syncMotiveConnection(connection.tenant_id, now);
    results.push({ tenantId: connection.tenant_id, ...result });
  }

  const created = results.reduce((total, result) => total + (result.ok ? result.created : 0), 0);

  return NextResponse.json({
    ok: results.every((result) => result.ok),
    connections: results.length,
    created,
    results,
  });
}
