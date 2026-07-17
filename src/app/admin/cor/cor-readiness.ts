import { buildAuditReadiness } from "@/lib/cor-audit";
import {
  canonicalForAmtaElement,
  type CorCanonicalElement,
  isCanonicalElement,
} from "@/lib/cor-frameworks";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type FormRow = Pick<
  Database["public"]["Tables"]["forms"]["Row"],
  "id" | "code" | "name" | "cor_element" | "cor_element_key" | "cor_tracked"
>;
type SubmissionRow = Pick<Database["public"]["Tables"]["submissions"]["Row"], "form_id">;
type ResourceRow = Pick<
  Database["public"]["Tables"]["resources"]["Row"],
  "name" | "cor_element" | "cor_element_key" | "cor_tracked"
>;

export type CorTrackedItem = { name: string; submitted: boolean };
export type CorTrackedEvidence = { documents: CorTrackedItem[]; forms: CorTrackedItem[] };

// The canonical element an item is tagged to: prefer the canonical key, falling
// back to the legacy AMTA-numbered integer for any row not yet backfilled.
function canonicalOf(corElementKey: string | null, corElement: number | null): CorCanonicalElement | null {
  if (corElementKey && isCanonicalElement(corElementKey)) {
    return corElementKey;
  }
  return corElement ? canonicalForAmtaElement(corElement) : null;
}

function emptyEvidence(): Record<CorCanonicalElement, CorTrackedEvidence> {
  return {
    management_commitment: { documents: [], forms: [] },
    senior_management_leadership: { documents: [], forms: [] },
    hazard_assessment: { documents: [], forms: [] },
    hazard_control: { documents: [], forms: [] },
    committees_reps: { documents: [], forms: [] },
    training: { documents: [], forms: [] },
    other_parties: { documents: [], forms: [] },
    inspections: { documents: [], forms: [] },
    preventative_maintenance: { documents: [], forms: [] },
    emergency_response: { documents: [], forms: [] },
    first_aid: { documents: [], forms: [] },
    investigations: { documents: [], forms: [] },
    program_administration: { documents: [], forms: [] },
    company_rules: { documents: [], forms: [] },
    ppe: { documents: [], forms: [] },
    legislation: { documents: [], forms: [] },
  };
}

/**
 * Load COR audit readiness for a tenant, rendered through its chosen certifying
 * partner framework. Evidence is grouped by the canonical backbone element (from
 * cor_element_key) so it maps correctly no matter which partner is selected:
 *   documents: a tracked resource is evidence on file the moment it is uploaded.
 *   forms: a tracked form becomes evidence when it has a submitted record.
 *   modules: training certificates, visitor records, and scheduled equipment
 *            maintenance still count automatically.
 * The tracked items are returned per canonical element so the audit can list
 * exactly what is mapped to each element.
 */
export async function loadCorAuditReadiness(tenantId: string, frameworkCode: string) {
  const supabase = await createSupabaseServerClient();

  const [
    { data: forms },
    { data: submissions },
    { data: resources },
    { count: certCount },
    { count: serviceCount },
    { count: visitorCount },
  ] = await Promise.all([
    supabase
      .from("forms")
      .select("id, code, name, cor_element, cor_element_key, cor_tracked")
      .eq("tenant_id", tenantId)
      .returns<FormRow[]>(),
    supabase
      .from("submissions")
      .select("form_id")
      .eq("tenant_id", tenantId)
      .not("submitted_at", "is", null)
      .returns<SubmissionRow[]>(),
    supabase
      .from("resources")
      .select("name, cor_element, cor_element_key, cor_tracked")
      .eq("tenant_id", tenantId)
      .returns<ResourceRow[]>(),
    supabase.from("certifications").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase
      .from("equipment_scheduled_service")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .is("deleted_at", null),
    supabase.from("visitors").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);

  const submissionCountByFormId = new Map<string, number>();
  for (const submission of submissions ?? []) {
    submissionCountByFormId.set(submission.form_id, (submissionCountByFormId.get(submission.form_id) ?? 0) + 1);
  }

  // Group the tracked documents and forms under their canonical element.
  const trackedByCanonical = emptyEvidence();

  for (const resource of resources ?? []) {
    if (!resource.cor_tracked) {
      continue;
    }
    const canonical = canonicalOf(resource.cor_element_key, resource.cor_element);
    if (canonical) {
      trackedByCanonical[canonical].documents.push({ name: resource.name ?? "Untitled document", submitted: true });
    }
  }

  for (const form of forms ?? []) {
    if (!form.cor_tracked) {
      continue;
    }
    const canonical = canonicalOf(form.cor_element_key, form.cor_element);
    if (canonical) {
      trackedByCanonical[canonical].forms.push({
        name: form.name ?? form.code,
        submitted: (submissionCountByFormId.get(form.id) ?? 0) > 0,
      });
    }
  }

  const autoByCanonical: Partial<Record<CorCanonicalElement, number>> = {
    training: certCount ?? 0,
    other_parties: visitorCount ?? 0,
    // Scheduled equipment service is preventative maintenance; ten-element partners
    // roll it into Inspections via that element's covers.
    preventative_maintenance: serviceCount ?? 0,
  };

  const manualByCanonical: Partial<Record<CorCanonicalElement, number>> = {};
  for (const canonical of Object.keys(trackedByCanonical) as CorCanonicalElement[]) {
    const tracked = trackedByCanonical[canonical];
    // Documents on file are evidence immediately; forms are evidence once submitted.
    manualByCanonical[canonical] = tracked.documents.length + tracked.forms.filter((form) => form.submitted).length;
  }

  return { ...buildAuditReadiness(frameworkCode, manualByCanonical, autoByCanonical), trackedByCanonical };
}
