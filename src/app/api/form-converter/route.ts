import { NextResponse } from "next/server";
import { canUseAdminPanel } from "@/lib/access-control";
import { getCurrentUserContext } from "@/lib/current-user";
import { equipmentAttachmentBucket } from "@/lib/equipment";
import {
  convertForm,
  isFormConverterConfigured,
  sanitizeConvertedForm,
  validateConverterUploads,
  type ConverterFile,
  type UploadedConverterFile,
} from "@/lib/form-converter";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// A 20-page form is one long model call.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uploadsFrom(value: unknown): UploadedConverterFile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name.slice(0, 200) : "",
      path: typeof entry.path === "string" ? entry.path : "",
      size: typeof entry.size === "number" ? entry.size : 0,
      type: typeof entry.type === "string" ? entry.type : "",
    }));
}

// Builds a draft form from uploaded pages or a description, or revises a draft from a request.
// It saves nothing: the person reviews the draft and saves it with createFormFromConvertedDraft.
// Uploaded files are read and then deleted; the form is the record, the scan is not kept.
export async function POST(request: Request) {
  // Not requireAppUser: that redirects, which a fetch cannot follow.
  const context = await getCurrentUserContext();

  if (context.status !== "app_user") {
    return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  }

  if (!canUseAdminPanel(context.appUser)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  if (!isFormConverterConfigured()) {
    return NextResponse.json({ error: "The form reader is not set up for this company yet." }, { status: 503 });
  }

  let body: Record<string, unknown>;

  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "The request was not readable." }, { status: 400 });
  }

  const tenantId = context.appUser.tenant_id;
  const batchId = typeof body.batchId === "string" && UUID.test(body.batchId) ? body.batchId : null;
  const uploads = uploadsFrom(body.files);
  const description = typeof body.description === "string" ? body.description : "";
  const instruction = typeof body.instruction === "string" ? body.instruction : "";
  const draft = body.draft ? sanitizeConvertedForm(body.draft) : null;

  if (uploads.length > 0 && !batchId) {
    return NextResponse.json({ error: "The upload was not recognised. Try again." }, { status: 400 });
  }

  const { accepted, error: uploadError } = batchId
    ? validateConverterUploads(uploads, { batchId, tenantId })
    : { accepted: [], error: null };

  const supabase = await createSupabaseServerClient();
  const paths = accepted.map((file) => file.path);

  try {
    if (uploadError) {
      return NextResponse.json({ error: uploadError }, { status: 400 });
    }

    const files: ConverterFile[] = [];

    for (const file of accepted) {
      const { data, error } = await supabase.storage.from(equipmentAttachmentBucket).download(file.path);

      if (error || !data) {
        return NextResponse.json({ error: `${file.name} could not be read back from storage. Try again.` }, { status: 502 });
      }

      files.push({ bytes: new Uint8Array(await data.arrayBuffer()), mimeType: file.type, name: file.name });
    }

    const outcome = await convertForm({ description, draft, files, instruction });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.reason, retryable: outcome.retryable }, { status: 422 });
    }

    return NextResponse.json({ form: outcome.form });
  } catch (error) {
    console.error("[form-converter] Conversion failed.", { name: error instanceof Error ? error.name : typeof error });

    return NextResponse.json({ error: "The form could not be built. Try again." }, { status: 500 });
  } finally {
    if (paths.length > 0) {
      // Uploads under this batch are removed whatever happened. The browser still holds the
      // files and uploads them again on a retry.
      await supabase.storage.from(equipmentAttachmentBucket).remove(paths);
    }
  }
}
