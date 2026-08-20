import type { createSupabaseServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type RequirementRow = {
  certification_type_id: string;
  equipment_id: string;
};

/**
 * Which certifications each unit in the tenant is held to.
 *
 * One query for the whole fleet rather than one per unit, because every caller is a
 * page rendering a table of every unit, and a per-unit query there is a hundred and
 * fifty round trips on Crude Master's trailer fleet alone.
 *
 * A unit missing from the returned map has never had its list edited. That is not the
 * same as a unit held to nothing, and the distinction is load bearing: the first falls
 * back to the types marked as applying by default, the second is respected as the
 * deliberate choice it was. Callers pass `map.get(id) ?? null` for exactly that reason.
 */
export async function fetchUnitCertificationRequirements(
  supabase: ServerClient,
  tenantId: string,
): Promise<Map<string, string[]>> {
  const { data } = await supabase
    .from("equipment_certification_requirement")
    .select("equipment_id, certification_type_id")
    .eq("tenant_id", tenantId)
    .returns<RequirementRow[]>();

  const byEquipment = new Map<string, string[]>();

  for (const row of data ?? []) {
    byEquipment.set(row.equipment_id, [...(byEquipment.get(row.equipment_id) ?? []), row.certification_type_id]);
  }

  return byEquipment;
}
