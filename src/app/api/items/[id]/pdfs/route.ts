import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getTenantItem,
  isJsonObject,
  jsonError,
  requireFormBuilderAccess,
  revalidateFormBuilder,
} from "@/app/api/form-builder/_lib";
import { sanitizeStorageFilename } from "@/lib/document-control";
import type { Database, Json } from "@/types/database";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type PdfReference = {
  bucket: string;
  name: string;
  path: string;
  size: number;
  type: string;
};

const bucket = "tenant-documents";

function existingPdfReferences(settings: Json) {
  if (!isJsonObject(settings) || !Array.isArray(settings.pdfReferences)) {
    return [];
  }

  return settings.pdfReferences.filter((item): item is PdfReference => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }

    const record = item as Record<string, Json | undefined>;

    return typeof record.name === "string" && typeof record.path === "string";
  });
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const access = await requireFormBuilderAccess();

  if ("error" in access) {
    return access.error;
  }

  const item = await getTenantItem(access.supabase, id, access.tenantId);

  if (!item) {
    return jsonError("Item not found.", 404);
  }

  if (item.field_type !== "pdf_insert") {
    return jsonError("PDF uploads are only supported for Insert PDFs items.", 400);
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length === 0) {
    return jsonError("Choose at least one PDF file.", 400);
  }

  if (files.some((file) => file.type !== "application/pdf")) {
    return jsonError("Only PDF files can be inserted.", 400);
  }

  const uploaded: PdfReference[] = [];

  for (const file of files) {
    const filename = sanitizeStorageFilename(file.name || "insert.pdf");
    const storagePath = `${access.tenantId}/form-builder/${item.form_id}/${item.id}/${randomUUID()}-${filename}`;
    const { error } = await access.supabase.storage.from(bucket).upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

    if (error) {
      return jsonError(error.message, 500);
    }

    uploaded.push({
      bucket,
      name: file.name,
      path: storagePath,
      size: file.size,
      type: file.type,
    });
  }

  const nextSettings = {
    ...(isJsonObject(item.settings) ? item.settings : {}),
    pdfReferences: [...existingPdfReferences(item.settings), ...uploaded],
  };

  const { data: updatedItem, error } = await access.supabase
    .from("form_items")
    .update({ settings: nextSettings })
    .eq("id", item.id)
    .eq("tenant_id", access.tenantId)
    .select("*")
    .maybeSingle<Database["public"]["Tables"]["form_items"]["Row"]>();

  if (error) {
    return jsonError(error.message, 500);
  }

  if (!updatedItem) {
    return jsonError("Item not found.", 404);
  }

  revalidateFormBuilder(item.form_id);

  return NextResponse.json({ item: updatedItem });
}
