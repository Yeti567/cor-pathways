// Loads a tenant's fleet and works out what each unit still needs. Shared by Finish Your
// Units and the Getting Started checklist so both count "finished" the same way.

import type { SupabaseClient } from "@supabase/supabase-js";
import { certificationTypeNameMap } from "@/lib/equipment";
import { fetchUnitCertificationRequirements } from "@/lib/equipment-certification-requirements";
import { ensureEquipmentCertificationTypes } from "@/lib/equipment-certification-types";
import { buildUnitFinish, type FinishDocumentRow, type FinishUnitRow, type UnitFinish } from "@/lib/unit-finish";
import { selectAllRows } from "@/lib/supabase/select-all";
import type { Database } from "@/types/database";

export async function loadUnitFinishes(supabase: SupabaseClient<Database>, tenantId: string): Promise<UnitFinish[]> {
  // Paged: a fleet's documents pass the 1,000-row cap long before the fleet is large.
  const [unitRows, documentRows, certificationTypes, requirements] = await Promise.all([
    selectAllRows<FinishUnitRow>((from, to) =>
      supabase
        .from("equipment")
        .select("id, unit_number, name, category, is_commercial")
        .eq("tenant_id", tenantId)
        .in("category", ["vehicle", "trailer"])
        .is("deleted_at", null)
        .neq("status", "retired")
        .neq("status", "sold")
        .order("id")
        .range(from, to)
        .returns<FinishUnitRow[]>(),
    ),
    selectAllRows<FinishDocumentRow>((from, to) =>
      supabase
        .from("equipment_document")
        .select(
          "id, equipment_id, doc_type, certification_type_id, expiry_date, issued_date, is_active, reminder_lead_days, title, attachment_ids",
        )
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("id")
        .range(from, to)
        .returns<FinishDocumentRow[]>(),
    ),
    ensureEquipmentCertificationTypes(supabase, tenantId),
    fetchUnitCertificationRequirements(supabase, tenantId),
  ]);

  const documentsByUnit = new Map<string, FinishDocumentRow[]>();
  for (const document of documentRows) {
    documentsByUnit.set(document.equipment_id, [...(documentsByUnit.get(document.equipment_id) ?? []), document]);
  }

  const typeInputs = certificationTypes.map((type) => ({
    appliesByDefault: type.applies_by_default,
    id: type.id,
    name: type.name,
  }));
  const names = certificationTypeNameMap(typeInputs);

  return unitRows.map((unit) =>
    buildUnitFinish({
      certificationTypeNames: names,
      certificationTypes: typeInputs,
      documents: documentsByUnit.get(unit.id) ?? [],
      requiredTypeIds: requirements.get(unit.id) ?? null,
      unit,
    }),
  );
}
