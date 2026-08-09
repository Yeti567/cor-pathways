import { DEFAULT_EQUIPMENT_CERTIFICATION_TYPES } from "@/lib/equipment";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type EquipmentCertificationTypeRow = Database["public"]["Tables"]["equipment_certification_types"]["Row"];

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * The tenant's vehicle certification type list, seeding the standard set the first time
 * it is read.
 *
 * Existing tenants were seeded by the 20260809011025 migration. A tenant created after
 * that migration has an empty list, so the first render that needs it lays the standard
 * set down here. The insert is best-effort: two concurrent first renders can race, and
 * the unique (tenant_id, lower(name)) index turns the loser into a harmless conflict
 * rather than a duplicate. Writing on read mirrors the certification-types page, which
 * already sends reminder notifications during render.
 */
export async function ensureEquipmentCertificationTypes(
  supabase: ServerClient,
  tenantId: string,
): Promise<EquipmentCertificationTypeRow[]> {
  const { data: existing } = await supabase
    .from("equipment_certification_types")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name")
    .returns<EquipmentCertificationTypeRow[]>();

  if (existing && existing.length > 0) {
    return existing;
  }

  await supabase
    .from("equipment_certification_types")
    .insert(DEFAULT_EQUIPMENT_CERTIFICATION_TYPES.map((name) => ({ name, tenant_id: tenantId })));

  const { data: seeded } = await supabase
    .from("equipment_certification_types")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name")
    .returns<EquipmentCertificationTypeRow[]>();

  return seeded ?? [];
}
