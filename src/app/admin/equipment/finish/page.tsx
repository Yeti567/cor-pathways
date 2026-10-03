import { redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { FinishUnitsView } from "@/app/admin/equipment/finish/FinishUnitsView";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { certificationTypeNameMap } from "@/lib/equipment";
import { fetchUnitCertificationRequirements } from "@/lib/equipment-certification-requirements";
import { ensureEquipmentCertificationTypes } from "@/lib/equipment-certification-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildUnitFinish, finishQueue, type FinishDocumentRow, type FinishUnitRow } from "@/lib/unit-finish";

// Finish your units: one unit at a time, closest to green first.
//
// The fleet dashboard says how many units are red. This page says which one to do next,
// exactly what it still needs, and gives the box to upload it in. When a unit has
// everything it moves on by itself and says so, because a client who sees units turning
// green keeps going, and one staring at 141 red dots gives up.

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FinishUnitsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestedId = firstParam(params.unit);
  const skipped = new Set((firstParam(params.skip) ?? "").split(",").filter((id) => UUID.test(id)));
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const [{ data: unitRows }, { data: documentRows }, certificationTypes, requirements] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, unit_number, name, category, is_commercial")
      .eq("tenant_id", tenantId)
      .in("category", ["vehicle", "trailer"])
      .is("deleted_at", null)
      .neq("status", "retired")
      .neq("status", "sold")
      .returns<FinishUnitRow[]>(),
    supabase
      .from("equipment_document")
      .select(
        "id, equipment_id, doc_type, certification_type_id, expiry_date, issued_date, is_active, reminder_lead_days, title, attachment_ids",
      )
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .returns<FinishDocumentRow[]>(),
    ensureEquipmentCertificationTypes(supabase, tenantId),
    fetchUnitCertificationRequirements(supabase, tenantId),
  ]);

  const documentsByUnit = new Map<string, FinishDocumentRow[]>();
  for (const document of documentRows ?? []) {
    documentsByUnit.set(document.equipment_id, [...(documentsByUnit.get(document.equipment_id) ?? []), document]);
  }

  const typeInputs = certificationTypes.map((type) => ({
    appliesByDefault: type.applies_by_default,
    id: type.id,
    name: type.name,
  }));
  const names = certificationTypeNameMap(typeInputs);
  const finishes = (unitRows ?? []).map((unit) =>
    buildUnitFinish({
      certificationTypeNames: names,
      certificationTypes: typeInputs,
      documents: documentsByUnit.get(unit.id) ?? [],
      requiredTypeIds: requirements.get(unit.id) ?? null,
      unit,
    }),
  );

  const queue = finishQueue(finishes);
  const requested = requestedId ? finishes.find((entry) => entry.unit.id === requestedId) : undefined;
  // The unit just worked on, if it has nothing left: say so, then move on.
  const justFinished = requested && requested.open === 0 ? requested : undefined;
  const current =
    requested && requested.open > 0 ? requested : (queue.find((entry) => !skipped.has(entry.unit.id)) ?? queue[0]);
  const upNext = queue.filter((entry) => entry.unit.id !== current?.unit.id && !skipped.has(entry.unit.id)).slice(0, 6);

  return (
    <AdminShell eyebrow="Onboarding" tenantName={context.tenant?.name ?? "Company profile"} title="Finish your units">
      <FinishUnitsView
        current={current}
        error={firstParam(params.error)}
        finished={finishes.filter((entry) => entry.open === 0).length}
        justFinished={justFinished}
        notice={firstParam(params.notice)}
        queueLength={queue.length}
        returnTo={current ? `/admin/equipment/finish?unit=${current.unit.id}` : "/admin/equipment/finish"}
        skipHref={
          current ? `/admin/equipment/finish?skip=${[...skipped, current.unit.id].join(",")}` : "/admin/equipment/finish"
        }
        tenantId={tenantId}
        total={finishes.length}
        upNext={upNext}
      />
    </AdminShell>
  );
}
