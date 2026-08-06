// Server-side: keep the pre-trip form in step with the schedule, and keep the
// compliance module in step with the form.
//
// Two jobs, both idempotent so they are safe to run on every page load:
//   syncPreTripForm      - create or update the electronic pre-trip form so its
//                          items carry the current NSC Schedule 1 checks and
//                          defect definitions.
//   reconcilePreTripSubmissions - read completed submissions of that form back
//                          into dti_inspection.

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  normalizePreTripLabel,
  preTripFormDefinition,
  PRE_TRIP_FORM_CODE,
  PRE_TRIP_ITEMS_SECTION_TITLE,
  PRE_TRIP_ITEM_NO_KEY,
  scheduleItemNoForLabel,
} from "@/lib/pre-trip-form";
import {
  derivePreTripInspections,
  type PreTripChosenSeverity,
  type PreTripFormItemRow,
} from "@/lib/pre-trip-reconcile";
import { severityFromInspectionDefectTitle } from "@/lib/offline/follow-ups";
import type { Province } from "@/lib/dti-rules";
import type { Json } from "@/types/database";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type FormRow = { id: string; name: string; status: string };
type SectionRow = { id: string; title: string; sort_order: number };
type ItemRow = { id: string; label: string; field_type: string; settings: unknown; section_id: string };

export type PreTripFormSummary = {
  formId: string | null;
  name: string;
  status: string | null;
  itemCount: number;
  scheduleItemCount: number;
  // How many of the schedule's items are present and carry guidance text.
  documentedItemCount: number;
};

function settingsRecord(settings: unknown): Record<string, Json> {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, Json>)
    : {};
}

function itemNoOf(item: { label: string; settings: unknown }): number | null {
  const tagged = settingsRecord(item.settings)[PRE_TRIP_ITEM_NO_KEY];
  const parsed = typeof tagged === "number" ? tagged : typeof tagged === "string" ? Number(tagged) : Number.NaN;

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  // Untagged items were seeded before this module owned the content, so fall
  // back to the label the seed used rather than adding a near-duplicate beside it.
  return scheduleItemNoForLabel(item.label.replace(/^\d+\.\s*/, ""));
}

/** What the module knows about a tenant's pre-trip form, for the UI. */
export async function getPreTripFormSummary(supabase: Client, tenantId: string): Promise<PreTripFormSummary> {
  const definition = preTripFormDefinition(1);
  const scheduleItemCount = definition.sections.find((section) => section.title === PRE_TRIP_ITEMS_SECTION_TITLE)?.items.length ?? 0;

  const { data: form } = await supabase
    .from("forms")
    .select("id, name, status")
    .eq("tenant_id", tenantId)
    .eq("code", PRE_TRIP_FORM_CODE)
    .maybeSingle<FormRow>();

  if (!form) {
    return { formId: null, name: definition.name, status: null, itemCount: 0, scheduleItemCount, documentedItemCount: 0 };
  }

  const { data: items } = await supabase
    .from("form_items")
    .select("id, label, field_type, settings, helper_text")
    .eq("tenant_id", tenantId)
    .eq("form_id", form.id)
    .returns<(ItemRow & { helper_text: string | null })[]>();

  const inspectionItems = (items ?? []).filter((item) => item.field_type === "pass_fail_na");
  const documented = new Set(
    inspectionItems
      .filter((item) => (item.helper_text ?? "").trim().length > 0)
      .map((item) => itemNoOf(item))
      .filter((no): no is number => no !== null),
  );

  return {
    formId: form.id,
    name: form.name,
    status: form.status,
    itemCount: inspectionItems.length,
    scheduleItemCount,
    documentedItemCount: documented.size,
  };
}

export type SyncPreTripFormResult = {
  formId: string;
  created: boolean;
  itemsInserted: number;
  itemsUpdated: number;
};

/**
 * Create or refresh the electronic pre-trip form from the NSC schedule.
 *
 * Non-destructive by design. Items the carrier added themselves are left alone,
 * and an item that already exists is updated in place rather than replaced, so
 * every historical submission_value keeps pointing at a live form item.
 */
export async function syncPreTripForm(
  supabase: Client,
  input: { tenantId: string; userId: string },
): Promise<SyncPreTripFormResult> {
  const definition = preTripFormDefinition(1);
  const { tenantId, userId } = input;

  const { data: existingForm } = await supabase
    .from("forms")
    .select("id, name, status")
    .eq("tenant_id", tenantId)
    .eq("code", definition.code)
    .maybeSingle<FormRow>();

  let formId = existingForm?.id ?? null;
  let created = false;

  if (!formId) {
    const { data: inserted, error } = await supabase
      .from("forms")
      .insert({
        tenant_id: tenantId,
        name: definition.name,
        code: definition.code,
        description: definition.description,
        status: "published",
        app_menu_visible: true,
        is_private: false,
        allow_duplicates: true,
        use_item_data_in_analytics: true,
        created_by: userId,
      })
      .select("id, name, status")
      .single<FormRow>();

    if (error || !inserted) {
      throw new Error(error?.message ?? "Could not create the pre-trip form.");
    }

    formId = inserted.id;
    created = true;
  } else {
    await supabase
      .from("forms")
      .update({ description: definition.description })
      .eq("id", formId)
      .eq("tenant_id", tenantId);
  }

  const { data: sections } = await supabase
    .from("form_sections")
    .select("id, title, sort_order")
    .eq("tenant_id", tenantId)
    .eq("form_id", formId)
    .returns<SectionRow[]>();

  const { data: existingItems } = await supabase
    .from("form_items")
    .select("id, label, field_type, settings, section_id")
    .eq("tenant_id", tenantId)
    .eq("form_id", formId)
    .returns<ItemRow[]>();

  let itemsInserted = 0;
  let itemsUpdated = 0;

  for (const section of definition.sections) {
    let sectionId =
      (sections ?? []).find((row) => normalizePreTripLabel(row.title) === normalizePreTripLabel(section.title))?.id ?? null;

    if (!sectionId) {
      const { data: insertedSection, error } = await supabase
        .from("form_sections")
        .insert({ tenant_id: tenantId, form_id: formId, title: section.title, sort_order: section.sortOrder })
        .select("id, title, sort_order")
        .single<SectionRow>();

      if (error || !insertedSection) {
        throw new Error(error?.message ?? "Could not create a pre-trip form section.");
      }

      sectionId = insertedSection.id;
    }

    for (const item of section.items) {
      const wantedItemNo = itemNoOf({ label: item.label, settings: item.settings });
      const wantedRole = settingsRecord(item.settings).dti_field;

      const match = (existingItems ?? []).find((existing) => {
        if (existing.field_type !== item.fieldType && existing.field_type !== "pass_fail_na") {
          // Field types other than the checklist must match exactly, so a
          // province dropdown never lands on top of a text note.
          return false;
        }

        if (wantedItemNo !== null) {
          return itemNoOf(existing) === wantedItemNo && existing.field_type === "pass_fail_na";
        }

        if (typeof wantedRole === "string") {
          return (
            settingsRecord(existing.settings).dti_field === wantedRole ||
            (existing.field_type === item.fieldType &&
              normalizePreTripLabel(existing.label) === normalizePreTripLabel(item.label))
          );
        }

        return false;
      });

      if (match) {
        const { error } = await supabase
          .from("form_items")
          .update({
            label: item.label,
            field_type: item.fieldType,
            helper_text: item.helperText,
            required: item.required,
            flaggable: item.flaggable,
            sort_order: item.sortOrder,
            settings: { ...settingsRecord(match.settings), ...item.settings },
            section_id: sectionId,
          })
          .eq("id", match.id)
          .eq("tenant_id", tenantId);

        if (error) {
          throw new Error(error.message);
        }

        itemsUpdated += 1;
        continue;
      }

      const { error } = await supabase.from("form_items").insert({
        tenant_id: tenantId,
        form_id: formId,
        section_id: sectionId,
        label: item.label,
        field_type: item.fieldType,
        helper_text: item.helperText,
        required: item.required,
        flaggable: item.flaggable,
        sort_order: item.sortOrder,
        settings: item.settings,
      });

      if (error) {
        throw new Error(error.message);
      }

      itemsInserted += 1;
    }
  }

  return { formId, created, itemsInserted, itemsUpdated };
}

export type ReconcileResult = { created: number; skipped: number; escalated: number };

type DefectActionRow = { parent_submission_id: string; form_item_id: string | null; title: string };

function chosenSeveritiesFrom(rows: DefectActionRow[]): PreTripChosenSeverity[] {
  return rows.flatMap((row) => {
    const severity = severityFromInspectionDefectTitle(row.title);

    return severity
      ? [{ submission_id: row.parent_submission_id, form_item_id: row.form_item_id, severity }]
      : [];
  });
}

/**
 * Catch a major defect whose corrective action arrived after its inspection.
 *
 * Submissions and their corrective actions sync as separate rows, so an offline
 * device can land the pre-trip first. If that happens the inspection is written
 * as minor and the unit reads valid. This upgrades it the moment the major
 * corrective action shows up. It only ever escalates: nothing here can put a
 * unit back on the road, because that decision belongs to a person.
 */
async function escalateLateMajorDefects(supabase: Client, tenantId: string): Promise<number> {
  const { data: candidates } = await supabase
    .from("dti_inspection")
    .select("id, submission_id, overall_result")
    .eq("tenant_id", tenantId)
    .eq("source", "form")
    .eq("out_of_service", false)
    .not("submission_id", "is", null)
    .returns<{ id: string; submission_id: string; overall_result: string }[]>();

  if (!candidates || candidates.length === 0) {
    return 0;
  }

  const { data: majors } = await supabase
    .from("follow_ups")
    .select("parent_submission_id, form_item_id, title")
    .eq("tenant_id", tenantId)
    .in(
      "parent_submission_id",
      candidates.map((row) => row.submission_id),
    )
    .like("title", "Major vehicle defect:%")
    .returns<DefectActionRow[]>();

  const majorSubmissions = new Set((majors ?? []).map((row) => row.parent_submission_id));
  let escalated = 0;

  for (const candidate of candidates) {
    if (!majorSubmissions.has(candidate.submission_id)) {
      continue;
    }

    const { error } = await supabase
      .from("dti_inspection")
      .update({ overall_result: "major", out_of_service: true })
      .eq("id", candidate.id)
      .eq("tenant_id", tenantId);

    if (!error) {
      escalated += 1;
    }
  }

  return escalated;
}

/**
 * Turn completed pre-trip submissions into inspections.
 *
 * Idempotent: submissions that already produced an inspection are excluded by
 * the unique (tenant_id, submission_id) index and by the filter below, so this
 * can run on every page load without duplicating the fleet board.
 */
export async function reconcilePreTripSubmissions(
  supabase: Client,
  input: { tenantId: string; fallbackProvince?: Province | null; limit?: number },
): Promise<ReconcileResult> {
  const { tenantId } = input;
  const limit = input.limit ?? 200;

  const { data: form } = await supabase
    .from("forms")
    .select("id, name, status")
    .eq("tenant_id", tenantId)
    .eq("code", PRE_TRIP_FORM_CODE)
    .maybeSingle<FormRow>();

  if (!form) {
    return { created: 0, skipped: 0, escalated: 0 };
  }

  const [{ data: formItems }, { data: linked }] = await Promise.all([
    supabase
      .from("form_items")
      .select("id, label, field_type, settings")
      .eq("tenant_id", tenantId)
      .eq("form_id", form.id)
      .returns<PreTripFormItemRow[]>(),
    supabase
      .from("dti_inspection")
      .select("submission_id")
      .eq("tenant_id", tenantId)
      .not("submission_id", "is", null)
      .returns<{ submission_id: string }[]>(),
  ]);

  const alreadyLinked = new Set((linked ?? []).map((row) => row.submission_id));

  // "submitted" is the terminal state for a submission; the only other value the
  // app writes is "draft". A draft is a pre-trip in progress and must not become
  // an inspection, or a half-walked truck would show valid on the fleet board.
  const { data: submissions } = await supabase
    .from("submissions")
    .select("id, submitted_by, submitted_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("form_id", form.id)
    .eq("status", "submitted")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(limit)
    .returns<{ id: string; submitted_by: string | null; submitted_at: string | null; created_at: string }[]>();

  const pending = (submissions ?? []).filter((submission) => !alreadyLinked.has(submission.id));

  if (pending.length === 0) {
    return { created: 0, skipped: 0, escalated: await escalateLateMajorDefects(supabase, tenantId) };
  }

  const pendingIds = pending.map((submission) => submission.id);
  const [{ data: values }, { data: defectActions }] = await Promise.all([
    supabase
      .from("submission_values")
      .select("submission_id, form_item_id, value")
      .eq("tenant_id", tenantId)
      .in("submission_id", pendingIds)
      .returns<{ submission_id: string; form_item_id: string; value: unknown }[]>(),
    supabase
      .from("follow_ups")
      .select("parent_submission_id, form_item_id, title")
      .eq("tenant_id", tenantId)
      .in("parent_submission_id", pendingIds)
      .returns<{ parent_submission_id: string; form_item_id: string | null; title: string }[]>(),
  ]);

  const { inspections, skipped } = derivePreTripInspections({
    formItems: formItems ?? [],
    submissions: pending,
    values: values ?? [],
    chosenSeverities: chosenSeveritiesFrom(defectActions ?? []),
    fallbackProvince: input.fallbackProvince ?? null,
  });

  let created = 0;

  for (const inspection of inspections) {
    const { data: inserted, error } = await supabase
      .from("dti_inspection")
      .insert({
        tenant_id: tenantId,
        submission_id: inspection.submissionId,
        equipment_id: inspection.equipmentId,
        driver_user_id: inspection.driverUserId,
        province: inspection.province,
        schedule_no: 1,
        inspection_type: inspection.inspectionType,
        odometer: inspection.odometer,
        overall_result: inspection.overallResult,
        out_of_service: inspection.outOfService,
        source: "form",
        completed_at: inspection.completedAt,
        valid_until: inspection.validUntil,
        created_by: inspection.driverUserId,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    // A duplicate is not an error here: two page loads can race, and the unique
    // index is what makes that safe. Anything else is worth surfacing, but not
    // at the cost of blocking the page, so the run simply stops counting.
    if (error || !inserted) {
      continue;
    }

    await supabase.from("dti_inspection_item").insert(
      inspection.items.map((item) => ({
        tenant_id: tenantId,
        inspection_id: inserted.id,
        item_no: item.item_no,
        item_label: item.item_label,
        status: item.status,
        note: item.note,
      })),
    );

    created += 1;
  }

  return { created, skipped: skipped.length, escalated: await escalateLateMajorDefects(supabase, tenantId) };
}
