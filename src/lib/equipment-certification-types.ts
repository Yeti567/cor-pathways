import {
  DEFAULT_EQUIPMENT_CERTIFICATION_TYPES,
  OPTIONAL_EQUIPMENT_CERTIFICATION_TYPES,
} from "@/lib/equipment";
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
 * set down here. Writing on read mirrors the certification-types page, which already
 * sends reminder notifications during render.
 *
 * The seed returns the rows it just wrote rather than reading them back. An earlier
 * version inserted and then issued a second select, and that select came back empty on
 * the very first visit even though the insert had plainly succeeded, so a brand new
 * tenant saw no certifications at all until it reloaded. That is the exact "the feature
 * is missing" impression this whole area exists to remove, and one round trip cannot
 * disagree with itself the way two can.
 */
export async function ensureEquipmentCertificationTypes(
  supabase: ServerClient,
  tenantId: string,
): Promise<EquipmentCertificationTypeRow[]> {
  const byName = (rows: EquipmentCertificationTypeRow[]) =>
    [...rows].sort((a, b) => a.name.localeCompare(b.name));

  const { data: existing } = await supabase
    .from("equipment_certification_types")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name")
    .returns<EquipmentCertificationTypeRow[]>();

  if (existing && existing.length > 0) {
    return existing;
  }

  // Two groups in one insert. The standard set applies to every unit unless somebody
  // says otherwise; the specialised tank inspections are laid down switched off, so
  // they are there to tick when a tank trailer arrives and cost a tractor fleet
  // nothing in the meantime.
  const seed = [
    ...DEFAULT_EQUIPMENT_CERTIFICATION_TYPES.map((name) => ({
      applies_by_default: true,
      name,
      tenant_id: tenantId,
    })),
    ...OPTIONAL_EQUIPMENT_CERTIFICATION_TYPES.map((type) => ({
      applies_by_default: false,
      default_interval_days: type.defaultIntervalDays,
      name: type.name,
      notes: type.notes,
      tenant_id: tenantId,
    })),
  ];

  const { data: inserted, error: insertError } = await supabase
    .from("equipment_certification_types")
    .insert(seed)
    .select("*")
    .returns<EquipmentCertificationTypeRow[]>();

  if (inserted && inserted.length > 0) {
    return byName(inserted);
  }

  // The deployment's database has not run the migration that added
  // applies_by_default, so Postgres rejected the whole insert over an unknown
  // column. Client deployments are forks that pull code and migrations on their own
  // schedule, so code arriving before schema is a normal state here, not an
  // emergency. Seed the names alone rather than leaving the tenant with no
  // certification list at all, which is what a bare return would do.
  if (insertError) {
    const { data: namesOnly } = await supabase
      .from("equipment_certification_types")
      .insert(DEFAULT_EQUIPMENT_CERTIFICATION_TYPES.map((name) => ({ name, tenant_id: tenantId })))
      .select("*")
      .returns<EquipmentCertificationTypeRow[]>();

    if (namesOnly && namesOnly.length > 0) {
      return byName(namesOnly);
    }
  }

  // No rows came back, so this render lost a race with another first render and the
  // unique (tenant_id, lower(name)) index rejected the whole insert. The winner's rows
  // are there to be read.
  const { data: seeded } = await supabase
    .from("equipment_certification_types")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name")
    .returns<EquipmentCertificationTypeRow[]>();

  return seeded ?? [];
}
