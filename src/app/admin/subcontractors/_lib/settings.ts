import {
  resolveSubcontractorSlots,
  type ResolvedSubcontractorSlot,
  type SubcontractorRequirementSetting,
} from "@/lib/subcontractor-requirements";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type SettingRow = Database["public"]["Tables"]["subcontractor_requirement_setting"]["Row"];

/**
 * Load one tenant's requirement overrides and fold them into the slot list.
 *
 * Every screen, the action that files a document, and later the reminder job all have to
 * agree on which slots apply and what bar they set. Going through here is what makes
 * that true by construction rather than by four callers each remembering to do it.
 *
 * A read failure resolves to the shipped defaults rather than throwing. Losing the
 * overrides degrades to a stricter-than-configured checklist, which is the safe
 * direction to fail in; a blank page would not be.
 */
export async function loadResolvedSubcontractorSlots(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
): Promise<{ settings: SubcontractorRequirementSetting[]; slots: ResolvedSubcontractorSlot[] }> {
  const { data } = await supabase
    .from("subcontractor_requirement_setting")
    .select("slot_key, enabled, required, minimum_coverage_amount, reminder_lead_days, interval_months")
    .eq("tenant_id", tenantId)
    .returns<SettingRow[]>();

  const settings: SubcontractorRequirementSetting[] = (data ?? []).map((row) => ({
    enabled: row.enabled,
    intervalMonths: row.interval_months,
    minimumCoverageAmount: row.minimum_coverage_amount === null ? null : Number(row.minimum_coverage_amount),
    reminderLeadDays: row.reminder_lead_days,
    required: row.required,
    slotKey: row.slot_key,
  }));

  return { settings, slots: resolveSubcontractorSlots(settings) };
}
