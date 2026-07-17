import { NextResponse } from "next/server";
import { canUseAdminPanel } from "@/lib/access-control";
import { getCurrentUserContext } from "@/lib/current-user";
import { buildWorkerImportTemplateCsv, workerImportTemplateFilename } from "@/lib/worker-import";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getCurrentUserContext();
  const url = new URL(request.url);

  if (context.status === "signed_out") {
    return NextResponse.redirect(new URL("/login", url));
  }

  if (context.status !== "app_user" || !canUseAdminPanel(context.appUser)) {
    return NextResponse.redirect(new URL("/choose", url));
  }

  return new Response(buildWorkerImportTemplateCsv(), {
    headers: {
      "content-disposition": `attachment; filename="${workerImportTemplateFilename}"`,
      "content-type": "text/csv; charset=utf-8",
    },
  });
}
