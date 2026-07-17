import { NextResponse } from "next/server";
import { loadVisitorRosterData } from "@/app/admin/visitors/_lib/roster-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { getCurrentUserContext } from "@/lib/current-user";
import { buildVisitorRoster, buildVisitorRosterCsv } from "@/lib/visitor-roster";

export const dynamic = "force-dynamic";

function filenameSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "all-locations"
  );
}

export async function GET(request: Request) {
  const context = await getCurrentUserContext();
  const url = new URL(request.url);

  if (context.status === "signed_out") {
    return NextResponse.redirect(new URL("/login", url));
  }

  if (context.status !== "app_user" || !canUseAdminPanel(context.appUser)) {
    return NextResponse.redirect(new URL("/choose", url));
  }

  const tenantName = context.tenant?.name ?? "Company profile";
  const locationId = url.searchParams.get("locationId")?.trim() || null;
  const rosterData = await loadVisitorRosterData(context.appUser.tenant_id);
  const roster = buildVisitorRoster({
    locationId,
    locations: rosterData.locations,
    now: rosterData.now,
    visitors: rosterData.visitors,
    workers: rosterData.workers,
  });
  const csv = buildVisitorRosterCsv({
    generatedAt: rosterData.now,
    groups: roster.groups,
    tenantName,
  });
  const locationSegment = roster.selectedLocation
    ? filenameSegment(roster.selectedLocation.name)
    : "all-locations";
  const dateSegment = rosterData.now.toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "content-disposition": `attachment; filename="visitor-roster-${locationSegment}-${dateSegment}.csv"`,
      "content-type": "text/csv; charset=utf-8",
    },
  });
}
