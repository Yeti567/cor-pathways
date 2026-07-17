import { NextResponse } from "next/server";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { extractDutyLogFromImage, getHosOcrStatus, parseDutyLogSegments } from "@/lib/hos-ocr";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

// Propose duty-status changes from a photographed paper daily log. The caller
// reviews and confirms the result before it is saved; this endpoint only reads.
export async function POST(request: Request) {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  if (!getHosOcrStatus().ready) {
    return NextResponse.json({ error: "Hours of Service OCR is not configured." }, { status: 503 });
  }

  const form = await request.formData();
  const image = form.get("image");
  const dateValue = form.get("date");
  const date = typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : null;

  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Attach a photo of the log." }, { status: 400 });
  }

  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large (max 15 MB)." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: companySettings } = await supabase
      .from("company_settings")
      .select("timezone")
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ timezone: string | null }>();

    const buffer = Buffer.from(await image.arrayBuffer());
    const dataUrl = `data:${image.type || "image/jpeg"};base64,${buffer.toString("base64")}`;
    const text = await extractDutyLogFromImage({ dataUrl });
    const segments = parseDutyLogSegments(text, { date, timeZone: companySettings?.timezone ?? null });

    return NextResponse.json({ segments });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Extraction failed." },
      { status: 502 },
    );
  }
}
