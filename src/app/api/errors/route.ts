import { NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/current-user";
import { prepareErrorBatch } from "@/lib/error-sink";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Where a failure gets reported.
//
// Three rules shape this route.
//
// It never trusts the payload for identity. The tenant and the user come from the
// session, so a caller cannot file a failure into someone else's tenant, and the
// insert policy on app_error enforces the same thing a second time.
//
// It never throws loudly. An error reporter that fails noisily turns one bug into
// two, and the worst case is a loop where reporting a failure causes a failure. A
// caller gets 202 and moves on regardless; nothing here is worth interrupting a
// driver mid-inspection.
//
// It is not an authentication surface. A signed-out caller is accepted and
// discarded rather than told anything, because a reporter firing during sign-out
// is normal and a 401 in the console would look like the bug.
const ACCEPTED = { status: 202 } as const;

export async function POST(request: Request) {
  try {
    const context = await getCurrentUserContext();

    if (!context?.appUser) {
      return NextResponse.json({ accepted: 0 }, ACCEPTED);
    }

    const payload = await request.json().catch(() => null);
    const prepared = prepareErrorBatch(payload);

    if (prepared.length === 0) {
      return NextResponse.json({ accepted: 0 }, ACCEPTED);
    }

    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.from("app_error").insert(
      prepared.map((entry) => ({
        tenant_id: context.appUser.tenant_id,
        signature: entry.signature,
        source: entry.source,
        kind: entry.kind,
        message: entry.message,
        stack: entry.stack,
        route: entry.route,
        user_id: context.appUser.id,
        user_role: context.appUser.power_level,
        release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
        user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
        context: entry.context,
        occurred_at: entry.occurredAt,
      })),
    );

    if (error) {
      // Swallowed on purpose. If the sink itself is broken the app must carry on
      // working; the watcher noticing nothing arrives is the backstop.
      return NextResponse.json({ accepted: 0 }, ACCEPTED);
    }

    return NextResponse.json({ accepted: prepared.length }, ACCEPTED);
  } catch {
    return NextResponse.json({ accepted: 0 }, ACCEPTED);
  }
}
