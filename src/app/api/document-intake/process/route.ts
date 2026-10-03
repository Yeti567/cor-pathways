import { NextResponse } from "next/server";
import { canUseAdminPanel } from "@/lib/access-control";
import { getCurrentUserContext } from "@/lib/current-user";
import { isIntakeReaderConfigured } from "@/lib/document-intake/extract";
import { processQueuedIntake } from "@/lib/document-intake/process";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Each call reads a handful of files in parallel. The upload page makes repeated calls
// until the queue is empty, so no single call has to carry a whole batch.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reads queued intake files and records what was found. It files nothing: a person approves
// every filing. Runs as the signed-in user, so row-level security is the tenant boundary.
export async function POST(request: Request) {
  // Not requireAppUser: that redirects, which a fetch from the upload page cannot follow.
  const context = await getCurrentUserContext();

  if (context.status !== "app_user") {
    return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  }

  if (!canUseAdminPanel(context.appUser)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  if (!isIntakeReaderConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let batchId: string | null = null;

  try {
    const body = (await request.json()) as { batchId?: unknown };
    batchId = typeof body.batchId === "string" && UUID.test(body.batchId) ? body.batchId : null;
  } catch {
    // No body means "any batch for this company", which is what a page reload resumes.
  }

  try {
    const supabase = await createSupabaseServerClient();
    const result = await processQueuedIntake({ batchId, supabase, tenantId: context.appUser.tenant_id });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[document-intake] Processing call failed.", {
      name: error instanceof Error ? error.name : typeof error,
    });

    return NextResponse.json({ error: "Processing failed. Try again." }, { status: 500 });
  }
}
