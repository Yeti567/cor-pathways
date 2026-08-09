"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  appAccessOptions,
  canManageAccess,
  canManageMedicalVault,
  canManagePowerLevel,
  canUseAdminPanel,
  canUseDesktopMonitor,
  isPowerAtLeast,
  offlineSyncOptions,
  powerLevelOptions,
  reachOptions,
  type AppAccessLevel,
  type PowerLevel,
  type ReachType,
} from "@/lib/access-control";
import {
  autoShareRecipientContactError,
  buildAutoShareDeliveryAttemptUpdate,
  coerceAutoShareRecipientType,
} from "@/lib/auto-share";
import {
  coerceLogoPlacement,
  coercePrintHeaderOption,
  integrationsFromFormKeys,
  isIntegrationEnabled,
  normalizePreparedByLabel,
  normalizeCompanyId,
  normalizePrintFooterNote,
} from "@/lib/company-settings";
import { buildTimeRecordEvents } from "@/lib/hos-rules";
import {
  coerceDocumentType,
  coerceResourceMoveDirection,
  buildDocumentControlNumberSettings,
  buildResourceSearchText,
  createDocumentControlNumber,
  getResourceReorderUpdates,
  nextResourceSortOrder,
  normalizeDcnSequencePadding,
  normalizeDcnSegment,
  parseDetectedTextToFields,
  type BuilderField,
  type DetectedFormField,
  sanitizeStorageFilename,
} from "@/lib/document-control";
import {
  buildEquipmentActionMetadata,
  buildCompletedScheduledServiceUpdate,
  coerceEquipmentCategory,
  coerceEquipmentDocumentType,
  coerceEquipmentIntervalMode,
  coerceEquipmentMaintenanceType,
  coerceEquipmentServiceType,
  coerceEquipmentStatus,
  coerceEquipmentTrackingMode,
  equipmentLocationForStatus,
  normalizeEquipmentUnitNumber,
  numericEquipmentValue,
  parseEquipmentAttachmentIds,
} from "@/lib/equipment";
import { requireAppUser, requireCurrentUser } from "@/lib/current-user";
import { type CorCanonicalElement, COR_FRAMEWORKS, elementNumberForCanonical, isCanonicalElement } from "@/lib/cor-frameworks";
import { type Country, coerceCountry } from "@/lib/region";
import type { WorkOrderStatus, WorkType } from "@/lib/trades";
import { isDemoTenant } from "@/lib/demo";
import { inviteWorkerByEmail } from "@/lib/worker-invite";
import { TRANSPORT_REQUIREMENTS } from "@/lib/transport-registry";
import { isEldProvider, isEldProviderConfigured } from "@/lib/eld/providers";
import { syncMotiveConnection } from "@/lib/eld/motive-sync";
import {
  deliverEmailNotification,
  emailDeliveryConfigured,
  getMissingEmailDeliveryEnv,
  type EmailNotificationRow,
} from "@/lib/email-delivery";
import {
  buildFormItemLabelSettings,
  coerceFormBuilderMoveDirection,
  coerceFormFieldType,
  coerceFormStatus,
  buildFormItemSettings,
  duplicateFormBuilderName,
  getFormBuilderReorderUpdates,
  nextFormBuilderSortOrder,
  resolveFormCode,
  type FormFieldType,
} from "@/lib/form-templates";
import { coerceFollowUpStatus, isClosedFollowUpStatus } from "@/lib/follow-ups";
import { virtualInventoryLocations } from "@/lib/inventory-locations";
import {
  coerceLocationStatus,
  coerceLocationVisibilityRule,
  locationIsActive,
  normalizeLocationCode,
} from "@/lib/locations";
import {
  buildManualChoiceSettings,
  getManagedListIdFromSettings,
  getManualOptionLabels,
  normalizeManagedListItemLabel,
  normalizeManagedListName,
  resolveManagedListSettings,
} from "@/lib/managed-lists";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordTenantAuditEvent, type TenantAuditEventInput } from "@/lib/tenant-audit";
import {
  coerceRecurrenceRule,
  coerceWorkflowAssigneeType,
  coerceWorkflowComparator,
  computeNextDueAt,
  isCompletedWorkflowRunStep,
  parseWorkflowExpectedValue,
} from "@/lib/workflow-station";
import { addMonths, dateInputValue as toDateInputValue } from "@/lib/document-reminders";
import { createOverdueWorkflowStepReminderNotification } from "@/lib/workflow-reminders";
import { parseWorkerImportCsv, type WorkerImportRow } from "@/lib/worker-import";
import { buildEmergencyContacts, normalizePhone } from "@/lib/workers";
import type { Database, Json } from "@/types/database";

const appAccessValues = new Set(appAccessOptions.map((item) => item.value));
const powerLevelValues = new Set(powerLevelOptions.map((item) => item.value));
const reachValues = new Set(reachOptions.map((item) => item.value));
const syncDayValues = new Set<number>(offlineSyncOptions.map((item) => item.value));
const overrideConditions = new Set(["court_order", "ministry_order", "ninety_day_dormancy"]);
const logoMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const certificationAttachmentMimeTypes = new Set([
  "application/pdf",
  "image/heic",
  "image/heif",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const equipmentAttachmentMimeTypes = new Set([
  "application/pdf",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const equipmentPhotoMimeTypes = new Set(["image/heic", "image/heif", "image/jpeg", "image/png", "image/webp"]);
const csvMimeTypes = new Set(["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"]);
const defaultFormSectionTitle = "New Section";

type ManagedListRow = Pick<Database["public"]["Tables"]["lists"]["Row"], "id" | "include_other" | "name">;
type ManagedListItemRow = Pick<Database["public"]["Tables"]["list_items"]["Row"], "active" | "label" | "sort_order">;
type FormItemSettingsRow = Pick<Database["public"]["Tables"]["form_items"]["Row"], "id" | "settings">;
type FormItemLabelSettingsRow = Pick<Database["public"]["Tables"]["form_items"]["Row"], "id" | "settings">;
type FormBuilderOrderRow = { id: string; sort_order: number | null };
type FormBuilderSortRow = { sort_order: number | null };
type DuplicateFormSectionRow = Pick<
  Database["public"]["Tables"]["form_sections"]["Row"],
  "collapsible" | "repeatable" | "sort_order" | "title"
>;
type FormSectionLookupRow = Pick<Database["public"]["Tables"]["form_sections"]["Row"], "id">;
type FormSectionAuditRow = Pick<
  Database["public"]["Tables"]["form_sections"]["Row"],
  "collapsible" | "id" | "repeatable" | "sort_order" | "title"
>;
type FormItemSectionRow = Pick<Database["public"]["Tables"]["form_items"]["Row"], "id" | "section_id">;
type DuplicateFormItemRow = Pick<
  Database["public"]["Tables"]["form_items"]["Row"],
  "field_type" | "flaggable" | "helper_text" | "label" | "required" | "section_id" | "settings" | "sort_order"
>;
type FormItemAuditRow = Pick<
  Database["public"]["Tables"]["form_items"]["Row"],
  "field_type" | "flaggable" | "helper_text" | "id" | "label" | "required" | "section_id" | "settings" | "sort_order"
>;
type FormItemInsertRow = Database["public"]["Tables"]["form_items"]["Insert"];
type DocumentControlRow = Database["public"]["Tables"]["document_control_register"]["Row"];
type DocumentControlSettingsRow = Pick<
  Database["public"]["Tables"]["company_settings"]["Row"],
  "company_id" | "dcn_company_prefix" | "dcn_include_revision" | "dcn_include_source_code" | "dcn_include_year" | "dcn_sequence_padding"
>;
type ResourceOrderRow = Pick<
  Database["public"]["Tables"]["resources"]["Row"],
  "id" | "name" | "section_id" | "sort_order" | "updated_at"
>;
type ResourceSectionOrderRow = Pick<Database["public"]["Tables"]["resource_sections"]["Row"], "id" | "name" | "sort_order">;
type DocumentApproverRow = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "id" | "power_level"
>;
type DocumentApprovalNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "body" | "created_at" | "delivery_status" | "id" | "recipient_type" | "title" | "user_id"
>;
type ReminderNotificationInsert = Database["public"]["Tables"]["notifications"]["Insert"];
type ReminderNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "body" | "created_at" | "delivery_status" | "id" | "recipient_name" | "recipient_type" | "submission_id" | "title" | "user_id"
>;
type OverdueScheduledTaskRow = Pick<
  Database["public"]["Tables"]["scheduled_tasks"]["Row"],
  "assigned_to" | "due_at" | "id" | "schedule_id" | "status"
>;
type OverdueFollowUpRow = Pick<
  Database["public"]["Tables"]["follow_ups"]["Row"],
  "assigned_to" | "due_at" | "id" | "parent_submission_id" | "status" | "title"
>;
type FollowUpAuditRow = Pick<Database["public"]["Tables"]["follow_ups"]["Row"], "id" | "parent_submission_id" | "title">;
type OverdueWorkflowRunStepRow = Pick<
  Database["public"]["Tables"]["workflow_run_steps"]["Row"],
  "assigned_to" | "completed_at" | "due_at" | "id" | "status" | "workflow_run_id" | "workflow_step_id"
>;
type ReminderScheduleRow = Pick<Database["public"]["Tables"]["schedules"]["Row"], "form_id" | "id" | "location_id" | "name">;
type ReminderWorkflowStepRow = Pick<Database["public"]["Tables"]["workflow_steps"]["Row"], "form_id" | "id" | "workflow_id">;
type ReminderWorkflowRunRow = Pick<Database["public"]["Tables"]["workflow_runs"]["Row"], "completed_at" | "id" | "location_id" | "status" | "workflow_id">;
type ReminderWorkflowRow = Pick<Database["public"]["Tables"]["workflows"]["Row"], "id" | "name">;
type ReminderFormRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name">;
type ReminderLocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "id" | "name">;
type ReminderUserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "full_name" | "id">;
type CompanyIntegrationSettingsRow = Pick<Database["public"]["Tables"]["company_settings"]["Row"], "integrations">;
type AutoShareRetryNotificationRow = EmailNotificationRow &
  Pick<Database["public"]["Tables"]["notifications"]["Row"], "channel" | "delivery_attempts" | "delivery_status">;
type AutoShareRecipientAuditRow = Pick<
  Database["public"]["Tables"]["auto_share_recipients"]["Row"],
  "active" | "email" | "id" | "location_id" | "name" | "phone" | "recipient_type"
>;
type VisitorAuditRow = Pick<
  Database["public"]["Tables"]["visitors"]["Row"],
  "full_name" | "id" | "location_id" | "organization" | "signed_in_at" | "visit_reason"
>;
type CertificationTypeAuditRow = Pick<Database["public"]["Tables"]["certification_types"]["Row"], "expires" | "id" | "name">;
type CertificationAuditRow = Pick<
  Database["public"]["Tables"]["certifications"]["Row"],
  "attachment_path" | "certification_type_id" | "expires_on" | "id" | "issued_on" | "name" | "worker_profile_id"
>;
type AuditActorRow = Pick<Database["public"]["Tables"]["users"]["Row"], "id" | "power_level" | "tenant_id">;
type EquipmentActionRow = Pick<Database["public"]["Tables"]["equipment"]["Row"], "id" | "photo_ids" | "tenant_id" | "tracking_mode" | "current_meter">;
type EquipmentSubmissionActionRow = Pick<Database["public"]["Tables"]["submissions"]["Row"], "form_id" | "id">;
type EquipmentFormActionRow = Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id">;
type ScheduledServiceActionRow = Pick<
  Database["public"]["Tables"]["equipment_scheduled_service"]["Row"],
  | "due_date"
  | "due_meter"
  | "window_start_meter"
  | "warn_meter"
  | "equipment_id"
  | "id"
  | "interval_mode"
  | "recurrence_unit"
  | "recurrence_value"
  | "service_type"
  | "title"
>;

function emailDeliveryConfigurationError() {
  const missingEnv = getMissingEmailDeliveryEnv();

  return missingEnv.length > 0
    ? `Email delivery is missing required configuration: ${missingEnv.join(", ")}.`
    : "Email delivery is not configured.";
}

function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function requireAccessManager() {
  const context = await requireAppUser();

  if (!canManageAccess(context.appUser)) {
    redirect("/admin");
  }

  return context;
}

async function requireFormManager() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  return context;
}

async function requireDocumentManager() {
  return requireFormManager();
}

async function requireAutoShareManager() {
  return requireFormManager();
}

async function requireTransportManager() {
  return requireFormManager();
}

async function requireMedicalVaultManager() {
  const context = await requireAppUser();

  if (!canManageMedicalVault(context.appUser, context.permissionProfile?.capabilities)) {
    redirect("/admin/transport");
  }

  return context;
}

async function requireFollowUpManager() {
  const context = await requireAppUser();

  if (!canUseDesktopMonitor(context.appUser)) {
    redirect("/choose");
  }

  return context;
}

async function requireWorkflowManager() {
  return requireFormManager();
}

async function requireSettingsManager() {
  return requireFormManager();
}

async function requireWorkerManager() {
  return requireFormManager();
}

async function requireLocationManager() {
  return requireFormManager();
}

async function requireVisitorManager() {
  return requireFormManager();
}

async function requireEquipmentManager() {
  return requireFormManager();
}

async function recordAppUserAuditEvent(
  actor: AuditActorRow,
  input: Omit<TenantAuditEventInput, "actorRole" | "actorUserId" | "tenantId">,
) {
  await recordAdminTenantAuditEvent({
    ...input,
    actorRole: actor.power_level,
    actorUserId: actor.id,
    tenantId: actor.tenant_id,
  });
}

function isMissingTenantAuditClientError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("SUPABASE_SERVICE_ROLE_KEY") &&
    error.message.includes("tenant audit")
  );
}

async function recordAdminTenantAuditEvent(input: TenantAuditEventInput) {
  try {
    await recordTenantAuditEvent(input);
  } catch (error) {
    if (isMissingTenantAuditClientError(error)) {
      console.warn(`Tenant audit event skipped because SUPABASE_SERVICE_ROLE_KEY is not configured: ${input.action}`);
      return;
    }

    throw error;
  }
}

/**
 * Applies a patch to the caller's own tenant row, and fails loudly when it does not land.
 *
 * Row-level security allows only a super admin to update a tenant row, while the settings
 * actions below admit any form manager. A lesser role therefore matches no row: PostgREST
 * reports no error and changes nothing, so a caller told "module enabled" would be
 * reading a lie and would go looking for the bug somewhere else entirely. Asking for the
 * affected rows back turns that silence into an honest message.
 *
 * Redirects on failure, so it either returns having written or does not return at all.
 */
async function applyTenantSettingsPatch(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  patch: Database["public"]["Tables"]["tenants"]["Update"],
  errorRedirectPath = "/admin/setup",
) {
  const { data, error } = await supabase.from("tenants").update(patch).eq("id", tenantId).select("id");

  if (error) {
    redirect(`${errorRedirectPath}?error=${encodeURIComponent(error.message)}`);
  }

  if (!data || data.length === 0) {
    redirect(
      `${errorRedirectPath}?error=${encodeURIComponent(
        "Only a Super Admin can change company settings. Ask yours to make this change.",
      )}`,
    );
  }
}

async function recordEquipmentAuditEvent(input: {
  action: string;
  actor: AuditActorRow;
  entityId: string;
  entityTable: string;
  metadata?: Json | Record<string, Json | undefined>;
}) {
  await recordAppUserAuditEvent(input.actor, {
    action: input.action,
    entityId: input.entityId,
    entityTable: input.entityTable,
    metadata: input.metadata,
  });
}

function boolValue(formData: FormData, key: string) {
  return formData.has(key);
}

function numberValue(formData: FormData, key: string, fallback: number) {
  const parsed = Number(stringValue(formData, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumberValue(formData: FormData, key: string) {
  return numericEquipmentValue(stringValue(formData, key));
}

function optionalIntegerValue(formData: FormData, key: string) {
  const parsed = Number.parseInt(stringValue(formData, key), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateInputValue(formData: FormData, key: string) {
  const value = stringValue(formData, key);

  if (!value) {
    return null;
  }

  const date = new Date(`${value}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateOnlyValue(formData: FormData, key: string) {
  const value = stringValue(formData, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function dateTimeInputValue(formData: FormData, key: string) {
  const value = stringValue(formData, key);

  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Parse the COR audit element (1..10) from a form field, or null when unset.
// The element picker posts the canonical (cross-partner) element key. The legacy
// integer cor_element column is kept in sync using the stable AMTA numbering, so
// it stays meaningful regardless of which partner did the tagging.
function corElementKeyFromData(formData: FormData): CorCanonicalElement | null {
  const raw = stringValue(formData, "corElementKey");
  return isCanonicalElement(raw) ? raw : null;
}

function corElementLegacyNumber(key: CorCanonicalElement | null): number | null {
  return key ? elementNumberForCanonical("amta", key) : null;
}

// Parse a document's review schedule. An explicit review date wins; otherwise a
// review cycle (months) sets the next review to that many months from today, so
// "Every 3 years" for an SDS just works.
function resourceReviewFromData(formData: FormData): {
  review_date: string | null;
  review_interval_months: number | null;
  reminder_lead_days: number;
} {
  const explicit = stringValue(formData, "reviewDate");
  const intervalRaw = Number(stringValue(formData, "reviewIntervalMonths"));
  const interval = Number.isInteger(intervalRaw) && intervalRaw >= 1 && intervalRaw <= 120 ? intervalRaw : null;
  const leadRaw = Number(stringValue(formData, "reminderLeadDays"));
  const reminderLeadDays = Number.isInteger(leadRaw) && leadRaw >= 0 && leadRaw <= 365 ? leadRaw : 30;

  let reviewDate: string | null = explicit ? explicit.slice(0, 10) : null;
  if (!reviewDate && interval) {
    reviewDate = toDateInputValue(addMonths(new Date(), interval));
  }

  return { review_date: reviewDate, review_interval_months: interval, reminder_lead_days: reminderLeadDays };
}

function formSettingsFromData(formData: FormData) {
  return {
    allow_duplicates: boolValue(formData, "allowDuplicates"),
    app_menu_visible: boolValue(formData, "appMenuVisible"),
    is_private: boolValue(formData, "isPrivate"),
    use_item_data_in_analytics: boolValue(formData, "useItemDataInAnalytics"),
    cor_element_key: corElementKeyFromData(formData),
    cor_element: corElementLegacyNumber(corElementKeyFromData(formData)),
    cor_tracked: boolValue(formData, "corTracked"),
  };
}

async function itemSettingsFromData(formData: FormData, tenantId: string): Promise<{ error?: string; settings: Json }> {
  const manualOptions = getManualOptionLabels(stringValue(formData, "options"));
  const listId = stringValue(formData, "listId");
  const advancedSettings = {
    equipmentPickerScope: stringValue(formData, "equipmentPickerScope"),
    sourceLabel: stringValue(formData, "sourceLabel"),
    sourceUrl: stringValue(formData, "sourceUrl"),
    visibility: stringValue(formData, "fieldVisibility"),
    workerPickerScope: stringValue(formData, "workerPickerScope"),
  };

  if (!listId) {
    return { settings: buildFormItemSettings(buildManualChoiceSettings(manualOptions), advancedSettings) };
  }

  const supabase = await createSupabaseServerClient();
  const { data: list, error: listError } = await supabase
    .from("lists")
    .select("id, include_other, name")
    .eq("id", listId)
    .eq("tenant_id", tenantId)
    .maybeSingle<ManagedListRow>();

  if (listError) {
    return { error: listError.message, settings: buildFormItemSettings(buildManualChoiceSettings(manualOptions), advancedSettings) };
  }

  if (!list) {
    return { error: "Choose a valid managed list.", settings: buildFormItemSettings(buildManualChoiceSettings(manualOptions), advancedSettings) };
  }

  const { data: listItems, error: itemError } = await supabase
    .from("list_items")
    .select("active, label, sort_order")
    .eq("list_id", list.id)
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true })
    .returns<ManagedListItemRow[]>();

  if (itemError) {
    return { error: itemError.message, settings: buildFormItemSettings(buildManualChoiceSettings(manualOptions), advancedSettings) };
  }

  return {
    settings: buildFormItemSettings(resolveManagedListSettings(buildManualChoiceSettings(manualOptions), list, listItems ?? []), advancedSettings),
  };
}

async function ensureTenantForm(formId: string, tenantId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: form } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string }>();

  return Boolean(form);
}

async function ensureTenantList(listId: string, tenantId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: list } = await supabase
    .from("lists")
    .select("id")
    .eq("id", listId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string }>();

  return Boolean(list);
}

async function setSingleFormLabelItem(input: {
  formId: string;
  itemId: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  tenantId: string;
}) {
  const { data: formItems, error } = await input.supabase
    .from("form_items")
    .select("id, settings")
    .eq("form_id", input.formId)
    .eq("tenant_id", input.tenantId)
    .returns<FormItemLabelSettingsRow[]>();

  if (error) {
    throw error;
  }

  const updates = await Promise.all(
    (formItems ?? []).map((item) =>
      input.supabase
        .from("form_items")
        .update({ settings: buildFormItemLabelSettings(item.settings, item.id === input.itemId) })
        .eq("id", item.id)
        .eq("tenant_id", input.tenantId),
    ),
  );
  const updateError = updates.find((result) => result.error)?.error;

  if (updateError) {
    throw updateError;
  }
}

async function clearFormItemLabelSetting(input: {
  itemId: string;
  settings: Json;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  tenantId: string;
}) {
  const { error } = await input.supabase
    .from("form_items")
    .update({ settings: buildFormItemLabelSettings(input.settings, false) })
    .eq("id", input.itemId)
    .eq("tenant_id", input.tenantId);

  if (error) {
    throw error;
  }
}

function revalidateManagedListPaths() {
  revalidatePath("/admin/lists");
  revalidatePath("/admin/forms");
  revalidatePath("/web");
}

function getUploadFile(formData: FormData, key = "file") {
  const value = formData.get(key);

  if (value instanceof File && value.size > 0) {
    return value;
  }

  return null;
}

function getUploadFiles(formData: FormData, key: string) {
  return formData.getAll(key).filter((value): value is File => value instanceof File && value.size > 0);
}

async function nextDocumentControlNumber(input: {
  documentType: string;
  revision?: string | null;
  sourceCode?: string | null;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  tenantId: string;
  tenantSlug: string;
}) {
  const { count } = await input.supabase
    .from("document_control_register")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .eq("document_type", input.documentType);
  const { data: companySettings } = await input.supabase
    .from("company_settings")
    .select("company_id, dcn_company_prefix, dcn_include_revision, dcn_include_source_code, dcn_include_year, dcn_sequence_padding")
    .eq("tenant_id", input.tenantId)
    .maybeSingle<DocumentControlSettingsRow>();
  const numberingSettings = buildDocumentControlNumberSettings({
    companyId: companySettings?.company_id,
    dcnCompanyPrefix: companySettings?.dcn_company_prefix,
    dcnIncludeRevision: companySettings?.dcn_include_revision,
    dcnIncludeSourceCode: companySettings?.dcn_include_source_code,
    dcnIncludeYear: companySettings?.dcn_include_year,
    dcnSequencePadding: companySettings?.dcn_sequence_padding,
    tenantSlug: input.tenantSlug,
  });

  return createDocumentControlNumber({
    companyPrefix: numberingSettings.companyPrefix,
    documentType: input.documentType,
    includeRevision: numberingSettings.includeRevision,
    includeSourceCode: numberingSettings.includeSourceCode,
    includeYear: numberingSettings.includeYear,
    revision: input.revision,
    sequence: (count ?? 0) + 1,
    sequencePadding: numberingSettings.sequencePadding,
    sourceCode: input.sourceCode,
  });
}

async function notifyDocumentApprovers(input: {
  actorRole: string;
  actorUserId: string;
  body: string;
  dcn: string;
  documentControlRegisterId: string;
  documentType: string;
  sourceId: string;
  sourceTable: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  tenantId: string;
  title: string;
  version: string;
}) {
  const { data: users } = await input.supabase
    .from("users")
    .select("active, app_access, id, power_level")
    .eq("tenant_id", input.tenantId)
    .eq("active", true)
    .returns<DocumentApproverRow[]>();
  const recipients = (users ?? []).filter(
    (user) =>
      user.id !== input.actorUserId &&
      (isPowerAtLeast(user.power_level, "manager") ||
        user.app_access === "admin_access" ||
        user.app_access === "super_admin_access"),
  );
  const fallbackRecipient = (users ?? []).find((user) => user.id === input.actorUserId);
  const targets = recipients.length > 0 ? recipients : fallbackRecipient ? [fallbackRecipient] : [];

  if (targets.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  const { data: insertedNotifications, error } = await input.supabase
    .from("notifications")
    .insert(
      targets.map((user) => ({
        body: input.body,
        channel: "in_app",
        created_at: now,
        delivered_at: now,
        delivery_status: "delivered",
        recipient_type: "document_approver",
        title: input.title,
        tenant_id: input.tenantId,
        user_id: user.id,
      })),
    )
    .select("body, created_at, delivery_status, id, recipient_type, title, user_id")
    .returns<DocumentApprovalNotificationAuditRow[]>();

  if (error) {
    return;
  }

  for (const notification of insertedNotifications ?? []) {
    await recordAdminTenantAuditEvent({
      action: "document_control.approval_notification.sent",
      actorRole: input.actorRole,
      actorUserId: input.actorUserId,
      entityId: notification.id,
      entityTable: "notifications",
      metadata: {
        body: notification.body,
        created_at: notification.created_at,
        dcn: input.dcn,
        delivery_status: notification.delivery_status,
        document_control_register_id: input.documentControlRegisterId,
        document_type: input.documentType,
        recipient_type: notification.recipient_type,
        source_id: input.sourceId,
        source_table: input.sourceTable,
        title: notification.title,
        user_id: notification.user_id,
        version: input.version,
      },
      tenantId: input.tenantId,
    });
  }
}

async function createDocumentControlEntry(input: {
  actorRole: string;
  actorUserId: string;
  dcn: string;
  documentType: string;
  revisionNotes: string | null;
  revisionOfId?: string | null;
  sourceId: string;
  sourceTable: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  tenantId: string;
  title: string;
  version: string;
}) {
  const { data: register, error } = await input.supabase
    .from("document_control_register")
    .insert({
      active: true,
      approval_status: "pending",
      dcn: input.dcn,
      document_type: input.documentType,
      revision_notes: input.revisionNotes,
      revision_of_id: input.revisionOfId ?? null,
      source_id: input.sourceId,
      source_table: input.sourceTable,
      tenant_id: input.tenantId,
      version: input.version,
    })
    .select("*")
    .single<DocumentControlRow>();

  if (error || !register) {
    throw new Error(error?.message ?? "Document control register entry was not created.");
  }

  if (input.revisionOfId) {
    await input.supabase
      .from("document_control_register")
      .update({ active: false })
      .eq("id", input.revisionOfId)
      .eq("tenant_id", input.tenantId);
  }

  await notifyDocumentApprovers({
    actorRole: input.actorRole,
    actorUserId: input.actorUserId,
    body: `${input.title} was registered as ${input.dcn} v${input.version} and is waiting for approval.`,
    dcn: input.dcn,
    documentControlRegisterId: register.id,
    documentType: input.documentType,
    sourceId: input.sourceId,
    sourceTable: input.sourceTable,
    supabase: input.supabase,
    tenantId: input.tenantId,
    title: "Document approval required",
    version: input.version,
  });

  await recordAdminTenantAuditEvent({
    action: "document_control.register",
    actorRole: input.actorRole,
    actorUserId: input.actorUserId,
    entityId: register.id,
    entityTable: "document_control_register",
    metadata: {
      dcn: input.dcn,
      document_type: input.documentType,
      revision_of_id: input.revisionOfId ?? null,
      source_id: input.sourceId,
      source_table: input.sourceTable,
      version: input.version,
    },
    tenantId: input.tenantId,
  });

  return register;
}

export async function createFormTemplate(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");
  const code = resolveFormCode(stringValue(formData, "code"), name);
  const description = stringValue(formData, "description") || null;
  const status = coerceFormStatus(stringValue(formData, "status"));
  const settings = formSettingsFromData(formData);

  if (!name || !code) {
    redirect("/admin/forms?error=Enter%20a%20form%20name%20and%20code.");
  }

  const { data: form, error } = await supabase
    .from("forms")
    .insert({
      ...settings,
      code,
      created_by: context.appUser.id,
      description,
      name,
      status,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !form) {
    redirect(`/admin/forms?error=${encodeURIComponent(error?.message ?? "Form template was not created.")}`);
  }

  const { data: defaultSection, error: defaultSectionError } = await supabase
    .from("form_sections")
    .insert({
      form_id: form.id,
      sort_order: nextFormBuilderSortOrder([]),
      tenant_id: context.appUser.tenant_id,
      title: defaultFormSectionTitle,
    })
    .select("id")
    .single<{ id: string }>();

  if (defaultSectionError || !defaultSection) {
    redirect(`/admin/forms?error=${encodeURIComponent(defaultSectionError?.message ?? "Default form section was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_template.create",
    entityId: form.id,
    entityTable: "forms",
    metadata: {
      code,
      default_section_id: defaultSection.id,
      description,
      name,
      status,
      ...settings,
    },
  });

  let documentControlNumber: string | null = null;

  if (context.tenant?.document_control_enabled) {
    try {
      const dcn = await nextDocumentControlNumber({
        documentType: "form",
        revision: "1.0",
        sourceCode: code,
        supabase,
        tenantId: context.appUser.tenant_id,
        tenantSlug: context.tenant?.slug ?? "tenant",
      });

      await createDocumentControlEntry({
        actorRole: context.appUser.power_level,
        actorUserId: context.appUser.id,
        dcn,
        documentType: "form",
        revisionNotes: "Initial form template.",
        sourceId: form.id,
        sourceTable: "forms",
        supabase,
        tenantId: context.appUser.tenant_id,
        title: name,
        version: "1.0",
      });
      documentControlNumber = dcn;
    } catch (registerError) {
      redirect(
        `/admin/forms?error=${encodeURIComponent(registerError instanceof Error ? registerError.message : "Document control register entry was not created.")}`,
      );
    }
  }

  revalidatePath("/admin/forms");
  revalidatePath("/admin/documents");
  revalidatePath("/web");
  const notice = documentControlNumber ? `Form template created. DCN ${documentControlNumber} registered.` : "Form template created.";
  redirect(`/admin/forms?notice=${encodeURIComponent(notice)}`);
}

export async function updateFormTemplateSettings(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const status = coerceFormStatus(stringValue(formData, "status"));
  const settings = formSettingsFromData(formData);

  if (!formId) {
    redirect("/admin/forms?error=Choose%20a%20form%20to%20update.");
  }

  const { error } = await supabase
    .from("forms")
    .update({
      ...settings,
      status,
    })
    .eq("id", formId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/forms?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_template.settings_update",
    entityId: formId,
    entityTable: "forms",
    metadata: {
      status,
      ...settings,
    },
  });

  revalidatePath("/admin/forms");
  revalidatePath("/web");
  redirect("/admin/forms?notice=Form%20settings%20saved.");
}

export async function deleteFormTemplate(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");

  if (!formId || !(await ensureTenantForm(formId, context.appUser.tenant_id))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20to%20delete.");
  }

  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("code, id, name, status")
    .eq("id", formId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<Pick<Database["public"]["Tables"]["forms"]["Row"], "code" | "id" | "name" | "status">>();

  if (formError || !form) {
    redirect(`/admin/forms?error=${encodeURIComponent(formError?.message ?? "Choose a valid form to delete.")}`);
  }

  const [
    { count: submissionCount, error: submissionCountError },
    { count: workflowStepCount, error: workflowStepCountError },
    { count: workflowConditionCount, error: workflowConditionCountError },
    { count: sectionCount, error: sectionCountError },
    { count: itemCount, error: itemCountError },
  ] = await Promise.all([
    supabase
      .from("submissions")
      .select("*", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("workflow_steps")
      .select("*", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("workflow_conditions")
      .select("*", { count: "exact", head: true })
      .eq("source_form_id", formId)
      .eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("form_sections")
      .select("*", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("tenant_id", context.appUser.tenant_id),
    supabase
      .from("form_items")
      .select("*", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("tenant_id", context.appUser.tenant_id),
  ]);

  for (const { error } of [
    { error: submissionCountError },
    { error: workflowStepCountError },
    { error: workflowConditionCountError },
    { error: sectionCountError },
    { error: itemCountError },
  ]) {
    if (error) {
      redirect(`/admin/forms?error=${encodeURIComponent(error.message)}`);
    }
  }

  if ((submissionCount ?? 0) > 0) {
    redirect(
      `/admin/forms?error=${encodeURIComponent(
        `${form.name} has ${submissionCount} submitted record${submissionCount === 1 ? "" : "s"}. Set the status to Archived instead to preserve history.`,
      )}`,
    );
  }

  if ((workflowStepCount ?? 0) > 0 || (workflowConditionCount ?? 0) > 0) {
    redirect(
      `/admin/forms?error=${encodeURIComponent(
        `${form.name} is referenced by an active workflow. Remove the workflow step or condition first.`,
      )}`,
    );
  }

  await supabase
    .from("document_control_register")
    .delete()
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("source_table", "forms")
    .eq("source_id", formId);

  const { error: deleteError } = await supabase
    .from("forms")
    .delete()
    .eq("id", formId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (deleteError) {
    redirect(`/admin/forms?error=${encodeURIComponent(deleteError.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_template.delete",
    entityId: formId,
    entityTable: "forms",
    metadata: {
      code: form.code,
      item_count: itemCount ?? 0,
      name: form.name,
      section_count: sectionCount ?? 0,
      status: form.status,
    },
  });

  revalidatePath("/admin/forms");
  revalidatePath("/admin/documents");
  revalidatePath("/web");
  redirect(`/admin/forms?notice=${encodeURIComponent(`${form.name} deleted.`)}`);
}

export async function createManagedList(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const name = normalizeManagedListName(stringValue(formData, "name"));
  const includeOther = boolValue(formData, "includeOther");

  if (!name) {
    redirect("/admin/lists?error=Enter%20a%20list%20name.");
  }

  const { data: list, error } = await supabase
    .from("lists")
    .insert({
      include_other: includeOther,
      name,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !list) {
    redirect(`/admin/lists?error=${encodeURIComponent(error?.message ?? "Managed list was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "managed_list.create",
    entityId: list.id,
    entityTable: "lists",
    metadata: {
      include_other: includeOther,
      name,
    },
  });

  revalidateManagedListPaths();
  redirect(`/admin/lists?listId=${list.id}&notice=Managed%20list%20created.`);
}

export async function updateManagedList(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const listId = stringValue(formData, "listId");
  const name = normalizeManagedListName(stringValue(formData, "name"));
  const includeOther = boolValue(formData, "includeOther");

  if (!listId || !name) {
    redirect("/admin/lists?error=Choose%20a%20valid%20list%20and%20enter%20a%20name.");
  }

  const { data: list, error } = await supabase
    .from("lists")
    .update({
      include_other: includeOther,
      name,
    })
    .eq("id", listId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !list) {
    redirect(`/admin/lists?listId=${listId}&error=${encodeURIComponent(error?.message ?? "Choose a valid managed list.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "managed_list.update",
    entityId: listId,
    entityTable: "lists",
    metadata: {
      include_other: includeOther,
      name,
    },
  });

  revalidateManagedListPaths();
  redirect(`/admin/lists?listId=${listId}&notice=Managed%20list%20saved.`);
}

export async function deleteManagedList(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const listId = stringValue(formData, "listId");

  if (!listId || !(await ensureTenantList(listId, context.appUser.tenant_id))) {
    redirect("/admin/lists?error=Choose%20a%20valid%20managed%20list.");
  }

  const [{ data: list, error: listError }, { data: formItems, error: itemError }] = await Promise.all([
    supabase
      .from("lists")
      .select("id, include_other, name")
      .eq("id", listId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<ManagedListRow>(),
    supabase
      .from("form_items")
      .select("id, settings")
      .eq("tenant_id", context.appUser.tenant_id)
      .returns<FormItemSettingsRow[]>(),
  ]);

  if (listError) {
    redirect(`/admin/lists?listId=${listId}&error=${encodeURIComponent(listError.message)}`);
  }

  if (itemError) {
    redirect(`/admin/lists?listId=${listId}&error=${encodeURIComponent(itemError.message)}`);
  }

  if (!list) {
    redirect("/admin/lists?error=Choose%20a%20valid%20managed%20list.");
  }

  const usedInForms = (formItems ?? []).some((item) => getManagedListIdFromSettings(item.settings) === listId);

  if (usedInForms) {
    redirect(`/admin/lists?listId=${listId}&error=Remove%20this%20list%20from%20form%20fields%20before%20deleting%20it.`);
  }

  const { error } = await supabase
    .from("lists")
    .delete()
    .eq("id", listId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/lists?listId=${listId}&error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "managed_list.delete",
    entityId: listId,
    entityTable: "lists",
    metadata: {
      include_other: list.include_other,
      name: list.name,
      used_in_form_count: 0,
    },
  });

  revalidateManagedListPaths();
  redirect("/admin/lists?notice=Managed%20list%20deleted.");
}

export async function createManagedListItem(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const listId = stringValue(formData, "listId");
  const label = normalizeManagedListItemLabel(stringValue(formData, "label"));
  const sortOrder = numberValue(formData, "sortOrder", 0);

  if (!listId || !label || !(await ensureTenantList(listId, context.appUser.tenant_id))) {
    redirect("/admin/lists?error=Choose%20a%20valid%20list%20and%20enter%20an%20item%20label.");
  }

  const { data: item, error } = await supabase
    .from("list_items")
    .insert({
      label,
      list_id: listId,
      sort_order: sortOrder,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !item) {
    redirect(`/admin/lists?listId=${listId}&error=${encodeURIComponent(error?.message ?? "List item was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "managed_list_item.create",
    entityId: item.id,
    entityTable: "list_items",
    metadata: {
      label,
      list_id: listId,
      sort_order: sortOrder,
    },
  });

  revalidateManagedListPaths();
  redirect(`/admin/lists?listId=${listId}&notice=List%20item%20added.`);
}

export async function updateManagedListItem(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const itemId = stringValue(formData, "itemId");
  const listId = stringValue(formData, "listId");
  const label = normalizeManagedListItemLabel(stringValue(formData, "label"));
  const active = boolValue(formData, "active");
  const sortOrder = numberValue(formData, "sortOrder", 0);

  if (!itemId || !listId || !label) {
    redirect("/admin/lists?error=Choose%20a%20valid%20item%20and%20enter%20a%20label.");
  }

  const { data: item, error } = await supabase
    .from("list_items")
    .update({
      active,
      label,
      sort_order: sortOrder,
    })
    .eq("id", itemId)
    .eq("list_id", listId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !item) {
    redirect(`/admin/lists?listId=${listId}&error=${encodeURIComponent(error?.message ?? "Choose a valid list item.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "managed_list_item.update",
    entityId: itemId,
    entityTable: "list_items",
    metadata: {
      active,
      label,
      list_id: listId,
      sort_order: sortOrder,
    },
  });

  revalidateManagedListPaths();
  redirect(`/admin/lists?listId=${listId}&notice=List%20item%20saved.`);
}

export async function deleteManagedListItem(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const itemId = stringValue(formData, "itemId");
  const listId = stringValue(formData, "listId");

  if (!itemId || !listId) {
    redirect("/admin/lists?error=Choose%20a%20valid%20item.");
  }

  const { data: item, error: itemLookupError } = await supabase
    .from("list_items")
    .select("active, label, sort_order")
    .eq("id", itemId)
    .eq("list_id", listId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<ManagedListItemRow>();

  if (itemLookupError) {
    redirect(`/admin/lists?listId=${listId}&error=${encodeURIComponent(itemLookupError.message)}`);
  }

  if (!item) {
    redirect("/admin/lists?error=Choose%20a%20valid%20item.");
  }

  const { error } = await supabase
    .from("list_items")
    .delete()
    .eq("id", itemId)
    .eq("list_id", listId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/lists?listId=${listId}&error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "managed_list_item.delete",
    entityId: itemId,
    entityTable: "list_items",
    metadata: {
      active: item.active,
      label: item.label,
      list_id: listId,
      sort_order: item.sort_order,
    },
  });

  revalidateManagedListPaths();
  redirect(`/admin/lists?listId=${listId}&notice=List%20item%20deleted.`);
}

export async function createFormSection(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const title = stringValue(formData, "title");
  const collapsible = boolValue(formData, "collapsible");
  const repeatable = boolValue(formData, "repeatable");
  const sortOrder = numberValue(formData, "sortOrder", 0);

  if (!formId || !title || !(await ensureTenantForm(formId, context.appUser.tenant_id))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20before%20adding%20a%20section.");
  }

  const { data: section, error } = await supabase
    .from("form_sections")
    .insert({
      collapsible,
      form_id: formId,
      repeatable,
      sort_order: sortOrder,
      tenant_id: context.appUser.tenant_id,
      title,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !section) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error?.message ?? "Section was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_section.create",
    entityId: section.id,
    entityTable: "form_sections",
    metadata: {
      collapsible,
      form_id: formId,
      repeatable,
      sort_order: sortOrder,
      title,
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  redirect(`/admin/forms/${formId}?notice=Section%20added.`);
}

export async function createFormItem(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  let sectionId = stringValue(formData, "sectionId");
  const label = stringValue(formData, "label");
  const helperText = stringValue(formData, "helperText") || null;
  const fieldType = coerceFormFieldType(stringValue(formData, "fieldType"));
  const flaggable = boolValue(formData, "flaggable");
  const required = boolValue(formData, "required");
  const sortOrder = numberValue(formData, "sortOrder", 0);
  const useAsLabel = boolValue(formData, "useAsLabel");
  let autoCreatedSectionId: string | null = null;

  if (!formId || !label || !(await ensureTenantForm(formId, context.appUser.tenant_id))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20before%20adding%20a%20field.");
  }

  if (!sectionId) {
    const { data: firstSection, error: firstSectionError } = await supabase
      .from("form_sections")
      .select("id")
      .eq("form_id", formId)
      .eq("tenant_id", context.appUser.tenant_id)
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true })
      .limit(1)
      .maybeSingle<FormSectionLookupRow>();

    if (firstSectionError) {
      redirect(`/admin/forms/${formId}?error=${encodeURIComponent(firstSectionError.message)}`);
    }

    if (firstSection) {
      sectionId = firstSection.id;
    } else {
      const { data: createdSection, error: createdSectionError } = await supabase
        .from("form_sections")
        .insert({
          form_id: formId,
          sort_order: nextFormBuilderSortOrder([]),
          tenant_id: context.appUser.tenant_id,
          title: defaultFormSectionTitle,
        })
        .select("id")
        .single<FormSectionLookupRow>();

      if (createdSectionError || !createdSection) {
        redirect(`/admin/forms/${formId}?error=${encodeURIComponent(createdSectionError?.message ?? "Default form section was not created.")}`);
      }

      sectionId = createdSection.id;
      autoCreatedSectionId = createdSection.id;
    }
  }

  const { data: section } = await supabase
    .from("form_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("form_id", formId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string }>();

  if (!section) {
    redirect(`/admin/forms/${formId}?error=Choose%20a%20valid%20section%20before%20adding%20a%20field.`);
  }

  const itemSettings = await itemSettingsFromData(formData, context.appUser.tenant_id);

  if (itemSettings.error) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(itemSettings.error)}`);
  }

  const { data: item, error } = await supabase
    .from("form_items")
    .insert({
      field_type: fieldType,
      flaggable,
      form_id: formId,
      helper_text: helperText,
      label,
      required,
      section_id: sectionId,
      settings: itemSettings.settings,
      sort_order: sortOrder,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !item) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error?.message ?? "Field was not created.")}`);
  }

  if (useAsLabel) {
    try {
      await setSingleFormLabelItem({
        formId,
        itemId: item.id,
        supabase,
        tenantId: context.appUser.tenant_id,
      });
    } catch (labelError) {
      redirect(
        `/admin/forms/${formId}?error=${encodeURIComponent(labelError instanceof Error ? labelError.message : "Field was created, but the form label was not updated.")}`,
      );
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_item.create",
    entityId: item.id,
    entityTable: "form_items",
    metadata: {
      auto_created_section_id: autoCreatedSectionId,
      field_type: fieldType,
      flaggable,
      form_id: formId,
      helper_text: helperText,
      label,
      required,
      section_id: sectionId,
      settings: itemSettings.settings,
      sort_order: sortOrder,
      use_as_label: useAsLabel,
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  redirect(`/admin/forms/${formId}?notice=Field%20added.`);
}

export async function duplicateFormSection(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const sectionId = stringValue(formData, "sectionId");
  const tenantId = context.appUser.tenant_id;

  if (!formId || !sectionId || !(await ensureTenantForm(formId, tenantId))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20section.");
  }

  const { data: section, error: sectionError } = await supabase
    .from("form_sections")
    .select("collapsible, repeatable, sort_order, title")
    .eq("id", sectionId)
    .eq("form_id", formId)
    .eq("tenant_id", tenantId)
    .maybeSingle<DuplicateFormSectionRow>();

  if (sectionError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(sectionError.message)}`);
  }

  if (!section) {
    redirect(`/admin/forms/${formId}?error=Choose%20a%20valid%20section%20before%20duplicating.`);
  }

  const [{ data: sectionSortRows, error: sortError }, { data: originalItems, error: itemsError }] = await Promise.all([
    supabase.from("form_sections").select("sort_order").eq("form_id", formId).eq("tenant_id", tenantId).returns<FormBuilderSortRow[]>(),
    supabase
      .from("form_items")
      .select("field_type, flaggable, helper_text, label, required, section_id, settings, sort_order")
      .eq("section_id", sectionId)
      .eq("form_id", formId)
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true })
      .returns<DuplicateFormItemRow[]>(),
  ]);

  if (sortError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(sortError.message)}`);
  }

  if (itemsError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(itemsError.message)}`);
  }

  const copiedSectionTitle = duplicateFormBuilderName(section.title);
  const copiedSectionSortOrder = nextFormBuilderSortOrder(sectionSortRows ?? []);
  const { data: copiedSection, error: insertSectionError } = await supabase
    .from("form_sections")
    .insert({
      collapsible: section.collapsible,
      form_id: formId,
      repeatable: section.repeatable,
      sort_order: copiedSectionSortOrder,
      tenant_id: tenantId,
      title: copiedSectionTitle,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertSectionError || !copiedSection) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(insertSectionError?.message ?? "Section could not be duplicated.")}`);
  }

  const itemCopies: FormItemInsertRow[] = (originalItems ?? []).map((item) => ({
    field_type: item.field_type,
    flaggable: item.flaggable,
    form_id: formId,
    helper_text: item.helper_text,
    label: item.label,
    required: item.required,
    section_id: copiedSection.id,
    settings: item.settings,
    sort_order: item.sort_order,
    tenant_id: tenantId,
  }));

  if (itemCopies.length > 0) {
    const { error: insertItemsError } = await supabase.from("form_items").insert(itemCopies);

    if (insertItemsError) {
      redirect(`/admin/forms/${formId}?error=${encodeURIComponent(insertItemsError.message)}`);
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_section.duplicate",
    entityId: copiedSection.id,
    entityTable: "form_sections",
    metadata: {
      copied_item_count: itemCopies.length,
      form_id: formId,
      sort_order: copiedSectionSortOrder,
      source_section_id: sectionId,
      title: copiedSectionTitle,
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/web");
  redirect(`/admin/forms/${formId}?notice=Section%20duplicated.`);
}

export async function duplicateFormItem(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const itemId = stringValue(formData, "itemId");
  const tenantId = context.appUser.tenant_id;

  if (!formId || !itemId || !(await ensureTenantForm(formId, tenantId))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20field.");
  }

  const { data: item, error: itemError } = await supabase
    .from("form_items")
    .select("field_type, flaggable, helper_text, label, required, section_id, settings, sort_order")
    .eq("id", itemId)
    .eq("form_id", formId)
    .eq("tenant_id", tenantId)
    .maybeSingle<DuplicateFormItemRow>();

  if (itemError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(itemError.message)}`);
  }

  if (!item) {
    redirect(`/admin/forms/${formId}?error=Choose%20a%20valid%20field%20before%20duplicating.`);
  }

  const { data: itemSortRows, error: sortError } = await supabase
    .from("form_items")
    .select("sort_order")
    .eq("section_id", item.section_id)
    .eq("form_id", formId)
    .eq("tenant_id", tenantId)
    .returns<FormBuilderSortRow[]>();

  if (sortError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(sortError.message)}`);
  }

  const copiedItemLabel = duplicateFormBuilderName(item.label);
  const copiedItemSortOrder = nextFormBuilderSortOrder(itemSortRows ?? []);
  const { data: copiedItem, error } = await supabase
    .from("form_items")
    .insert({
      field_type: item.field_type,
      flaggable: item.flaggable,
      form_id: formId,
      helper_text: item.helper_text,
      label: copiedItemLabel,
      required: item.required,
      section_id: item.section_id,
      settings: item.settings,
      sort_order: copiedItemSortOrder,
      tenant_id: tenantId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !copiedItem) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error?.message ?? "Field could not be duplicated.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_item.duplicate",
    entityId: copiedItem.id,
    entityTable: "form_items",
    metadata: {
      field_type: item.field_type,
      form_id: formId,
      label: copiedItemLabel,
      section_id: item.section_id,
      sort_order: copiedItemSortOrder,
      source_item_id: itemId,
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/web");
  redirect(`/admin/forms/${formId}?notice=Field%20duplicated.`);
}

export async function moveFormSection(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const sectionId = stringValue(formData, "sectionId");
  const direction = coerceFormBuilderMoveDirection(stringValue(formData, "direction"));
  const tenantId = context.appUser.tenant_id;

  if (!formId || !sectionId || !direction || !(await ensureTenantForm(formId, tenantId))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20section%20and%20move%20direction.");
  }

  const { data: sectionRows, error: sectionError } = await supabase
    .from("form_sections")
    .select("id, sort_order")
    .eq("form_id", formId)
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true })
    .returns<FormBuilderOrderRow[]>();

  if (sectionError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(sectionError.message)}`);
  }

  const orderUpdates = getFormBuilderReorderUpdates(sectionRows ?? [], sectionId, direction);

  if (orderUpdates.length === 0) {
    redirect(`/admin/forms/${formId}?notice=Section%20order%20unchanged.`);
  }

  for (const update of orderUpdates) {
    const { error } = await supabase
      .from("form_sections")
      .update({ sort_order: update.sort_order })
      .eq("id", update.id)
      .eq("form_id", formId)
      .eq("tenant_id", tenantId);

    if (error) {
      redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error.message)}`);
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_section.reorder",
    entityId: sectionId,
    entityTable: "form_sections",
    metadata: {
      direction,
      form_id: formId,
      ordered_section_ids: orderUpdates.map((update) => update.id),
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/web");
  redirect(`/admin/forms/${formId}?notice=Section%20moved.`);
}

export async function moveFormItem(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const itemId = stringValue(formData, "itemId");
  const direction = coerceFormBuilderMoveDirection(stringValue(formData, "direction"));
  const tenantId = context.appUser.tenant_id;

  if (!formId || !itemId || !direction || !(await ensureTenantForm(formId, tenantId))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20field%20and%20move%20direction.");
  }

  const { data: item, error: itemError } = await supabase
    .from("form_items")
    .select("id, section_id")
    .eq("id", itemId)
    .eq("form_id", formId)
    .eq("tenant_id", tenantId)
    .maybeSingle<FormItemSectionRow>();

  if (itemError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(itemError.message)}`);
  }

  if (!item) {
    redirect(`/admin/forms/${formId}?error=Choose%20a%20valid%20field%20before%20moving.`);
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from("form_items")
    .select("id, sort_order")
    .eq("section_id", item.section_id)
    .eq("form_id", formId)
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true })
    .returns<FormBuilderOrderRow[]>();

  if (itemsError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(itemsError.message)}`);
  }

  const orderUpdates = getFormBuilderReorderUpdates(itemRows ?? [], itemId, direction);

  if (orderUpdates.length === 0) {
    redirect(`/admin/forms/${formId}?notice=Field%20order%20unchanged.`);
  }

  for (const update of orderUpdates) {
    const { error } = await supabase
      .from("form_items")
      .update({ sort_order: update.sort_order })
      .eq("id", update.id)
      .eq("section_id", item.section_id)
      .eq("form_id", formId)
      .eq("tenant_id", tenantId);

    if (error) {
      redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error.message)}`);
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_item.reorder",
    entityId: itemId,
    entityTable: "form_items",
    metadata: {
      direction,
      form_id: formId,
      ordered_item_ids: orderUpdates.map((update) => update.id),
      section_id: item.section_id,
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/web");
  redirect(`/admin/forms/${formId}?notice=Field%20moved.`);
}

export async function updateFormSection(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const sectionId = stringValue(formData, "sectionId");
  const title = stringValue(formData, "title");
  const collapsible = boolValue(formData, "collapsible");
  const repeatable = boolValue(formData, "repeatable");
  const sortOrder = numberValue(formData, "sortOrder", 0);

  if (!formId || !sectionId || !title || !(await ensureTenantForm(formId, context.appUser.tenant_id))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20section.");
  }

  const { data: section, error } = await supabase
    .from("form_sections")
    .update({
      collapsible,
      repeatable,
      sort_order: sortOrder,
      title,
    })
    .eq("id", sectionId)
    .eq("form_id", formId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !section) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error?.message ?? "Choose a valid form section.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_section.update",
    entityId: section.id,
    entityTable: "form_sections",
    metadata: {
      collapsible,
      form_id: formId,
      repeatable,
      sort_order: sortOrder,
      title,
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/web");
  redirect(`/admin/forms/${formId}?notice=Section%20saved.`);
}

export async function deleteFormSection(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const sectionId = stringValue(formData, "sectionId");

  if (!formId || !sectionId || !(await ensureTenantForm(formId, context.appUser.tenant_id))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20section.");
  }

  const [{ data: section, error: sectionError }, { count: itemCount, error: itemCountError }] = await Promise.all([
    supabase
      .from("form_sections")
      .select("collapsible, id, repeatable, sort_order, title")
      .eq("id", sectionId)
      .eq("form_id", formId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<FormSectionAuditRow>(),
    supabase
      .from("form_items")
      .select("*", { count: "exact", head: true })
      .eq("section_id", sectionId)
      .eq("form_id", formId)
      .eq("tenant_id", context.appUser.tenant_id),
  ]);

  if (sectionError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(sectionError.message)}`);
  }

  if (itemCountError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(itemCountError.message)}`);
  }

  if (!section) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20section.");
  }

  const { error } = await supabase
    .from("form_sections")
    .delete()
    .eq("id", sectionId)
    .eq("form_id", formId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_section.delete",
    entityId: sectionId,
    entityTable: "form_sections",
    metadata: {
      collapsible: section.collapsible,
      form_id: formId,
      item_count: itemCount ?? 0,
      repeatable: section.repeatable,
      sort_order: section.sort_order,
      title: section.title,
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/web");
  redirect(`/admin/forms/${formId}?notice=Section%20deleted.`);
}

export async function updateFormItem(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const itemId = stringValue(formData, "itemId");
  const sectionId = stringValue(formData, "sectionId");
  const label = stringValue(formData, "label");
  const fieldType = coerceFormFieldType(stringValue(formData, "fieldType"));
  const flaggable = boolValue(formData, "flaggable");
  const helperText = stringValue(formData, "helperText") || null;
  const required = boolValue(formData, "required");
  const sortOrder = numberValue(formData, "sortOrder", 0);

  if (!formId || !itemId || !sectionId || !label || !(await ensureTenantForm(formId, context.appUser.tenant_id))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20field.");
  }

  const { data: section } = await supabase
    .from("form_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("form_id", formId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string }>();

  if (!section) {
    redirect(`/admin/forms/${formId}?error=Choose%20a%20valid%20section%20before%20saving%20the%20field.`);
  }

  const itemSettings = await itemSettingsFromData(formData, context.appUser.tenant_id);

  if (itemSettings.error) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(itemSettings.error)}`);
  }

  const { data: item, error } = await supabase
    .from("form_items")
    .update({
      field_type: fieldType,
      flaggable,
      helper_text: helperText,
      label,
      required,
      section_id: sectionId,
      settings: itemSettings.settings,
      sort_order: sortOrder,
    })
    .eq("id", itemId)
    .eq("form_id", formId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !item) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error?.message ?? "Choose a valid form field.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_item.update",
    entityId: item.id,
    entityTable: "form_items",
    metadata: {
      field_type: fieldType,
      flaggable,
      form_id: formId,
      helper_text: helperText,
      label,
      required,
      section_id: sectionId,
      settings: itemSettings.settings,
      sort_order: sortOrder,
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/web");
  redirect(`/admin/forms/${formId}?notice=Field%20saved.`);
}

export async function updateFormItemLabelSetting(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const itemId = stringValue(formData, "itemId");
  const useAsLabel = stringValue(formData, "useAsLabel") === "true";

  if (!formId || !(await ensureTenantForm(formId, context.appUser.tenant_id))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form.");
  }

  if (!itemId) {
    try {
      await setSingleFormLabelItem({
        formId,
        itemId: "",
        supabase,
        tenantId: context.appUser.tenant_id,
      });
    } catch (error) {
      redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Form label setting was not saved.")}`);
    }

    await recordAppUserAuditEvent(context.appUser, {
      action: "form_item.label_setting_update",
      entityId: formId,
      entityTable: "forms",
      metadata: {
        form_id: formId,
        label: null,
        use_as_label: false,
      },
    });

    revalidatePath(`/admin/forms/${formId}`);
    revalidatePath("/web");
    redirect(`/admin/forms/${formId}?notice=Form%20label%20setting%20saved.`);
  }

  const { data: item, error: itemError } = await supabase
    .from("form_items")
    .select("field_type, flaggable, helper_text, id, label, required, section_id, settings, sort_order")
    .eq("id", itemId)
    .eq("form_id", formId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<FormItemAuditRow>();

  if (itemError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(itemError.message)}`);
  }

  if (!item) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20field.");
  }

  try {
    if (useAsLabel) {
      await setSingleFormLabelItem({
        formId,
        itemId,
        supabase,
        tenantId: context.appUser.tenant_id,
      });
    } else {
      await clearFormItemLabelSetting({
        itemId,
        settings: item.settings,
        supabase,
        tenantId: context.appUser.tenant_id,
      });
    }
  } catch (error) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Form label setting was not saved.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_item.label_setting_update",
    entityId: itemId,
    entityTable: "form_items",
    metadata: {
      field_type: item.field_type,
      form_id: formId,
      label: item.label,
      use_as_label: useAsLabel,
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/web");
  redirect(`/admin/forms/${formId}?notice=Form%20label%20setting%20saved.`);
}

export async function deleteFormItem(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const formId = stringValue(formData, "formId");
  const itemId = stringValue(formData, "itemId");

  if (!formId || !itemId || !(await ensureTenantForm(formId, context.appUser.tenant_id))) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20field.");
  }

  const { data: item, error: itemError } = await supabase
    .from("form_items")
    .select("field_type, flaggable, helper_text, id, label, required, section_id, settings, sort_order")
    .eq("id", itemId)
    .eq("form_id", formId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<FormItemAuditRow>();

  if (itemError) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(itemError.message)}`);
  }

  if (!item) {
    redirect("/admin/forms?error=Choose%20a%20valid%20form%20field.");
  }

  const { error } = await supabase
    .from("form_items")
    .delete()
    .eq("id", itemId)
    .eq("form_id", formId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/forms/${formId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "form_item.delete",
    entityId: itemId,
    entityTable: "form_items",
    metadata: {
      field_type: item.field_type,
      flaggable: item.flaggable,
      form_id: formId,
      helper_text: item.helper_text,
      label: item.label,
      required: item.required,
      section_id: item.section_id,
      settings: item.settings,
      sort_order: item.sort_order,
    },
  });

  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/web");
  redirect(`/admin/forms/${formId}?notice=Field%20deleted.`);
}

export async function updateDocumentControlSetting(formData: FormData) {
  const context = await requireDocumentManager();
  const enabled = stringValue(formData, "enabled") === "true";
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { document_control_enabled: enabled }, "/admin/documents");

  await recordAppUserAuditEvent(context.appUser, {
    action: "document_control.setting.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      document_control_enabled: enabled,
    },
  });

  revalidatePath("/admin/documents");
  redirect(`/admin/documents?notice=Document%20control%20${enabled ? "enabled" : "disabled"}.`);
}

export async function updateTransportSetting(formData: FormData) {
  const context = await requireTransportManager();
  const enabled = stringValue(formData, "enabled") === "true";
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { transport_enabled: enabled }, "/admin/transport");

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.setting.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      transport_enabled: enabled,
    },
  });

  revalidatePath("/admin/transport");
  revalidatePath("/admin", "layout");
  redirect(`/admin/transport?notice=Transport%20module%20${enabled ? "enabled" : "disabled"}.`);
}

export async function updateMaintenanceContact(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const rawUserId = stringValue(formData, "maintenance_contact_user_id");
  let maintenanceContactUserId: string | null = rawUserId ? rawUserId : null;

  // Only accept an active user in this tenant; otherwise clear the contact so a
  // bad id can never silently misroute vehicle-defect corrective actions.
  if (maintenanceContactUserId) {
    const { data: candidate } = await supabase
      .from("users")
      .select("id")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("id", maintenanceContactUserId)
      .eq("active", true)
      .maybeSingle<{ id: string }>();
    maintenanceContactUserId = candidate?.id ?? null;
  }

  const { error } = await supabase
    .from("company_settings")
    .update({ maintenance_contact_user_id: maintenanceContactUserId })
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/setup?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.maintenance_contact.update",
    entityId: context.appUser.tenant_id,
    entityTable: "company_settings",
    metadata: {
      maintenance_contact_user_id: maintenanceContactUserId,
    },
  });

  revalidatePath("/admin/setup");
  revalidatePath("/web");
  redirect("/admin/setup?notice=Maintenance%20contact%20saved.");
}

export async function updateCorSetting(formData: FormData) {
  const context = await requireFormManager();
  const enabled = stringValue(formData, "enabled") === "true";
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { cor_enabled: enabled });

  await recordAppUserAuditEvent(context.appUser, {
    action: "cor.setting.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      cor_enabled: enabled,
    },
  });

  revalidatePath("/admin/cor");
  revalidatePath("/admin", "layout");
  redirect(`/admin/setup?notice=COR%20module%20${enabled ? "enabled" : "disabled"}.`);
}

// The tenant's chosen COR certifying partner. Only partners with a defined audit
// framework are accepted; the element views render through the selected partner.
export async function updateCorCertifyingPartner(formData: FormData) {
  const context = await requireFormManager();
  const partner = stringValue(formData, "certifyingPartner");

  if (!COR_FRAMEWORKS[partner]) {
    redirect("/admin/cor?error=Choose%20a%20supported%20certifying%20partner.");
  }

  const supabase = await createSupabaseServerClient();
  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { cor_certifying_partner: partner }, "/admin/cor");

  await recordAppUserAuditEvent(context.appUser, {
    action: "cor.certifying_partner.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: { cor_certifying_partner: partner },
  });

  revalidatePath("/admin/cor");
  redirect("/admin/cor?notice=Certifying%20partner%20updated.");
}

export async function updateChangeOrdersSetting(formData: FormData) {
  const context = await requireFormManager();
  const enabled = stringValue(formData, "enabled") === "true";
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { change_orders_enabled: enabled });

  await recordAppUserAuditEvent(context.appUser, {
    action: "change_orders.setting.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      change_orders_enabled: enabled,
    },
  });

  revalidatePath("/admin/change-orders");
  revalidatePath("/admin", "layout");
  redirect(`/admin/setup?notice=Variations%20%26%20Change%20Orders%20module%20${enabled ? "enabled" : "disabled"}.`);
}

export async function updateDailyInspectionSetting(formData: FormData) {
  const context = await requireFormManager();
  const enabled = stringValue(formData, "enabled") === "true";
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { daily_inspection_enabled: enabled });

  await recordAppUserAuditEvent(context.appUser, {
    action: "daily_inspection.setting.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      daily_inspection_enabled: enabled,
    },
  });

  revalidatePath("/admin/daily-inspection");
  revalidatePath("/admin", "layout");
  redirect(`/admin/setup?notice=Daily%20Trip%20Inspection%20module%20${enabled ? "enabled" : "disabled"}.`);
}

export async function updateTradesSetting(formData: FormData) {
  const context = await requireFormManager();
  const enabled = stringValue(formData, "enabled") === "true";
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { trades_enabled: enabled });

  await recordAppUserAuditEvent(context.appUser, {
    action: "trades.setting.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      trades_enabled: enabled,
    },
  });

  revalidatePath("/admin/trades");
  revalidatePath("/admin", "layout");
  redirect(`/admin/setup?notice=Trades%20module%20${enabled ? "enabled" : "disabled"}.`);
}

export async function updateTradesLaborRate(formData: FormData) {
  const context = await requireFormManager();
  const rate = numberValue(formData, "laborRate", 0);
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { default_labor_rate: rate < 0 ? 0 : rate }, "/admin/trades");

  await recordAppUserAuditEvent(context.appUser, {
    action: "trades.labor_rate.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: { default_labor_rate: rate },
  });

  revalidatePath("/admin/trades");
  redirect("/admin/trades?notice=Labor%20rate%20updated.");
}

const TRADE_BILLING_INTERVALS = new Set(["monthly", "quarterly", "annual"]);
const TRADE_AGREEMENT_STATUSES = new Set(["active", "paused", "cancelled"]);
type TradeBillingInterval = "monthly" | "quarterly" | "annual";
type TradeAgreementStatus = "active" | "paused" | "cancelled";

export async function createServiceAgreement(formData: FormData) {
  const context = await requireFormManager();
  const customerId = stringValue(formData, "customerId");
  const name = stringValue(formData, "name");

  if (!customerId) {
    redirect("/admin/trades/agreements?error=Choose%20a%20customer.");
  }
  if (!name) {
    redirect("/admin/trades/agreements?error=Enter%20a%20plan%20name.");
  }

  const billingInterval: TradeBillingInterval = TRADE_BILLING_INTERVALS.has(stringValue(formData, "billingInterval"))
    ? (stringValue(formData, "billingInterval") as TradeBillingInterval)
    : "monthly";

  const supabase = await createSupabaseServerClient();
  const { data: agreement, error } = await supabase
    .from("trade_service_agreement")
    .insert({
      tenant_id: context.appUser.tenant_id,
      customer_id: customerId,
      service_address_id: stringValue(formData, "serviceAddressId") || null,
      name,
      billing_amount: numberValue(formData, "billingAmount", 0),
      billing_interval: billingInterval,
      visits_per_year: optionalIntegerValue(formData, "visitsPerYear") ?? 0,
      start_on: stringValue(formData, "startOn") || null,
      next_visit_on: stringValue(formData, "nextVisitOn") || null,
      notes: stringValue(formData, "notes") || null,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !agreement) {
    redirect(`/admin/trades/agreements?error=${encodeURIComponent(error?.message ?? "Agreement was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_service_agreement.create",
    entityId: agreement.id,
    entityTable: "trade_service_agreement",
    metadata: { customer_id: customerId, name },
  });

  revalidatePath("/admin/trades/agreements");
  redirect(`/admin/trades/agreements/${agreement.id}?notice=Agreement%20created.`);
}

export async function updateServiceAgreement(formData: FormData) {
  const context = await requireFormManager();
  const agreementId = stringValue(formData, "agreementId");

  if (!agreementId) {
    redirect("/admin/trades/agreements?error=Choose%20an%20agreement.");
  }

  const statusInput = stringValue(formData, "status");
  if (!TRADE_AGREEMENT_STATUSES.has(statusInput)) {
    redirect(`/admin/trades/agreements/${agreementId}?error=Choose%20a%20valid%20status.`);
  }
  const status = statusInput as TradeAgreementStatus;

  const billingInterval: TradeBillingInterval = TRADE_BILLING_INTERVALS.has(stringValue(formData, "billingInterval"))
    ? (stringValue(formData, "billingInterval") as TradeBillingInterval)
    : "monthly";

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trade_service_agreement")
    .update({
      status,
      billing_amount: numberValue(formData, "billingAmount", 0),
      billing_interval: billingInterval,
      visits_per_year: optionalIntegerValue(formData, "visitsPerYear") ?? 0,
      next_visit_on: stringValue(formData, "nextVisitOn") || null,
      notes: stringValue(formData, "notes") || null,
    })
    .eq("id", agreementId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/trades/agreements/${agreementId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_service_agreement.update",
    entityId: agreementId,
    entityTable: "trade_service_agreement",
    metadata: { status },
  });

  revalidatePath("/admin/trades/agreements");
  revalidatePath(`/admin/trades/agreements/${agreementId}`);
  redirect(`/admin/trades/agreements/${agreementId}?notice=Agreement%20updated.`);
}

export async function updateGcSetting(formData: FormData) {
  const context = await requireFormManager();
  const enabled = stringValue(formData, "enabled") === "true";
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { gc_enabled: enabled });

  await recordAppUserAuditEvent(context.appUser, {
    action: "gc.setting.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      gc_enabled: enabled,
    },
  });

  revalidatePath("/admin/projects");
  revalidatePath("/admin", "layout");
  redirect(`/admin/setup?notice=Construction%20Projects%20module%20${enabled ? "enabled" : "disabled"}.`);
}

export async function updateSubcontractorsSetting(formData: FormData) {
  const context = await requireFormManager();
  const enabled = stringValue(formData, "enabled") === "true";
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { subcontractors_enabled: enabled });

  await recordAppUserAuditEvent(context.appUser, {
    action: "subcontractors.setting.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      subcontractors_enabled: enabled,
    },
  });

  revalidatePath("/admin/subcontractors");
  revalidatePath("/admin", "layout");
  redirect(`/admin/setup?notice=Subcontractor%20module%20${enabled ? "enabled" : "disabled"}.`);
}

export async function updateInventorySetting(formData: FormData) {
  const context = await requireFormManager();
  const enabled = stringValue(formData, "enabled") === "true";
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { inventory_enabled: enabled });

  // The ledger cannot be honest without somewhere to put stock in flight and stock that
  // was lost, so both are created the moment the module is switched on rather than at
  // signup: a tenant with inventory off should carry none of its furniture. Seeding is
  // idempotent through a unique index on (tenant_id, kind), so re-enabling later adds
  // nothing and, importantly, does not orphan the balances already hanging off them.
  if (enabled) {
    // Insert only what is missing, rather than upserting. The uniqueness of the virtual
    // pair is enforced by a PARTIAL index (where kind in ('transit','loss')), and Postgres
    // cannot match ON CONFLICT against a partial index without repeating its predicate,
    // which PostgREST has no way to express. An upsert here fails outright.
    const { data: existing, error: readError } = await supabase
      .from("inventory_location")
      .select("kind")
      .eq("tenant_id", context.appUser.tenant_id)
      .in(
        "kind",
        virtualInventoryLocations.map((place) => place.kind),
      );

    if (readError) {
      redirect(`/admin/setup?error=${encodeURIComponent(readError.message)}`);
    }

    const present = new Set((existing ?? []).map((row) => row.kind));
    const missing = virtualInventoryLocations.filter((place) => !present.has(place.kind));

    if (missing.length > 0) {
      const { error: seedError } = await supabase.from("inventory_location").insert(
        missing.map((place) => ({
          kind: place.kind,
          name: place.name,
          tenant_id: context.appUser.tenant_id,
        })),
      );

      // A duplicate here means something else seeded them between the read and the write,
      // which is the end state we wanted anyway. Anything else must be surfaced: a module
      // switched on without somewhere to put stock in flight is not usable, and failing
      // quietly would leave that impossible to diagnose.
      if (seedError && seedError.code !== "23505") {
        redirect(`/admin/setup?error=${encodeURIComponent(seedError.message)}`);
      }
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "inventory.setting.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      inventory_enabled: enabled,
    },
  });

  revalidatePath("/admin/inventory");
  revalidatePath("/admin", "layout");
  redirect(`/admin/setup?notice=Inventory%20module%20${enabled ? "enabled" : "disabled"}.`);
}

export async function createGcProject(formData: FormData) {
  const context = await requireFormManager();
  const name = stringValue(formData, "name");

  if (!name) {
    redirect("/admin/projects?error=Enter%20a%20project%20name.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: project, error } = await supabase
    .from("co_project")
    .insert({
      tenant_id: context.appUser.tenant_id,
      name,
      client_name: stringValue(formData, "clientName") || null,
      contract_number: stringValue(formData, "contractNumber") || null,
      original_contract_value: numberValue(formData, "originalContractValue", 0),
      notes: stringValue(formData, "notes") || null,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !project) {
    redirect(`/admin/projects?error=${encodeURIComponent(error?.message ?? "Project was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "gc_project.create",
    entityId: project.id,
    entityTable: "co_project",
    metadata: { name },
  });

  revalidatePath("/admin/projects");
  redirect(`/admin/projects/${project.id}?notice=Project%20created.`);
}

const GC_RFI_STATUSES = new Set(["open", "answered", "closed"]);
type GcRfiStatus = "open" | "answered" | "closed";

export async function createRfi(formData: FormData) {
  const context = await requireFormManager();
  const projectId = stringValue(formData, "projectId");
  const subject = stringValue(formData, "subject");

  if (!projectId) {
    redirect("/admin/projects?error=Choose%20a%20project.");
  }
  if (!subject) {
    redirect(`/admin/projects/${projectId}?error=Enter%20an%20RFI%20subject.`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("co_project")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  if (!project) {
    redirect("/admin/projects?error=Project%20not%20found.");
  }

  // Sequential RFI number per project; the unique index is the backstop.
  const { count } = await supabase
    .from("gc_rfi")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("project_id", projectId);

  const { data: rfi, error } = await supabase
    .from("gc_rfi")
    .insert({
      tenant_id: context.appUser.tenant_id,
      project_id: projectId,
      number: (count ?? 0) + 1,
      subject,
      question: stringValue(formData, "question") || null,
      due_on: stringValue(formData, "dueOn") || null,
      created_by: context.appUser.id,
    })
    .select("id, number")
    .single<{ id: string; number: number }>();

  if (error || !rfi) {
    redirect(`/admin/projects/${projectId}?error=${encodeURIComponent(error?.message ?? "RFI was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "gc_rfi.create",
    entityId: rfi.id,
    entityTable: "gc_rfi",
    metadata: { project_id: projectId, number: rfi.number, subject },
  });

  revalidatePath(`/admin/projects/${projectId}`);
  redirect(`/admin/projects/${projectId}/rfis/${rfi.id}?notice=RFI%20created.`);
}

export async function updateRfi(formData: FormData) {
  const context = await requireFormManager();
  const rfiId = stringValue(formData, "rfiId");
  const projectId = stringValue(formData, "projectId");

  if (!rfiId || !projectId) {
    redirect("/admin/projects?error=Choose%20an%20RFI.");
  }

  const statusInput = stringValue(formData, "status");
  if (!GC_RFI_STATUSES.has(statusInput)) {
    redirect(`/admin/projects/${projectId}/rfis/${rfiId}?error=Choose%20a%20valid%20status.`);
  }
  const status = statusInput as GcRfiStatus;
  const answer = stringValue(formData, "answer") || null;
  const answered = status === "answered" || status === "closed";
  const now = new Date().toISOString();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("gc_rfi")
    .update({
      status,
      answer,
      answered_by: answered ? context.appUser.id : null,
      answered_at: answered ? now : null,
    })
    .eq("id", rfiId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/projects/${projectId}/rfis/${rfiId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "gc_rfi.update",
    entityId: rfiId,
    entityTable: "gc_rfi",
    metadata: { status },
  });

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/rfis/${rfiId}`);
  redirect(`/admin/projects/${projectId}/rfis/${rfiId}?notice=RFI%20updated.`);
}

export async function updateCountrySetting(formData: FormData) {
  const context = await requireFormManager();
  const country: Country = coerceCountry(stringValue(formData, "country"));
  const supabase = await createSupabaseServerClient();

  // COR is a Canadian concept. Switching a workspace to the United States also
  // turns COR off so it never lingers in the nav or evidence surfaces; the COR
  // module card is hidden for US tenants, so they could not turn it off otherwise.
  const updatePayload = country === "US" ? { country, cor_enabled: false } : { country };

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, updatePayload);

  await recordAppUserAuditEvent(context.appUser, {
    action: "tenant.country.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: { country },
  });

  revalidatePath("/admin", "layout");
  redirect(`/admin/setup?notice=Region%20set%20to%20${country === "US" ? "United%20States" : "Canada"}.`);
}

export async function updateEmrSetting(formData: FormData) {
  const context = await requireFormManager();
  const emrRate = optionalNumberValue(formData, "emrRate");
  const emrYear = optionalIntegerValue(formData, "emrYear");
  const supabase = await createSupabaseServerClient();

  await applyTenantSettingsPatch(supabase, context.appUser.tenant_id, { emr_rate: emrRate, emr_year: emrYear }, "/admin/osha");

  await recordAppUserAuditEvent(context.appUser, {
    action: "tenant.emr.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: { emr_rate: emrRate, emr_year: emrYear },
  });

  revalidatePath("/admin/osha");
  redirect("/admin/osha?notice=EMR%20updated.");
}

export async function createTradeCustomer(formData: FormData) {
  const context = await requireFormManager();
  const name = stringValue(formData, "name");

  if (!name) {
    redirect("/admin/trades/customers?error=Enter%20a%20customer%20name.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: customer, error } = await supabase
    .from("trade_customer")
    .insert({
      tenant_id: context.appUser.tenant_id,
      name,
      contact_name: stringValue(formData, "contactName") || null,
      email: stringValue(formData, "email") || null,
      phone: stringValue(formData, "phone") || null,
      billing_address: stringValue(formData, "billingAddress") || null,
      notes: stringValue(formData, "notes") || null,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !customer) {
    redirect(`/admin/trades/customers?error=${encodeURIComponent(error?.message ?? "Customer was not created.")}`);
  }

  // An optional first service address, created only when a street line is given.
  const line1 = stringValue(formData, "line1");
  if (line1) {
    const { error: addressError } = await supabase.from("trade_service_address").insert({
      tenant_id: context.appUser.tenant_id,
      customer_id: customer.id,
      label: stringValue(formData, "addressLabel") || null,
      line1,
      line2: stringValue(formData, "line2") || null,
      city: stringValue(formData, "city") || null,
      region: stringValue(formData, "region") || null,
      postal_code: stringValue(formData, "postalCode") || null,
      is_primary: true,
    });

    if (addressError) {
      redirect(`/admin/trades/customers/${customer.id}?error=${encodeURIComponent(addressError.message)}`);
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_customer.create",
    entityId: customer.id,
    entityTable: "trade_customer",
    metadata: { name },
  });

  revalidatePath("/admin/trades/customers");
  redirect(`/admin/trades/customers/${customer.id}?notice=Customer%20created.`);
}

export async function addTradeServiceAddress(formData: FormData) {
  const context = await requireFormManager();
  const customerId = stringValue(formData, "customerId");
  const line1 = stringValue(formData, "line1");

  if (!customerId) {
    redirect("/admin/trades/customers?error=Choose%20a%20customer.");
  }
  if (!line1) {
    redirect(`/admin/trades/customers/${customerId}?error=Enter%20a%20street%20address.`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("trade_service_address").insert({
    tenant_id: context.appUser.tenant_id,
    customer_id: customerId,
    label: stringValue(formData, "addressLabel") || null,
    line1,
    line2: stringValue(formData, "line2") || null,
    city: stringValue(formData, "city") || null,
    region: stringValue(formData, "region") || null,
    postal_code: stringValue(formData, "postalCode") || null,
    is_primary: boolValue(formData, "isPrimary"),
  });

  if (error) {
    redirect(`/admin/trades/customers/${customerId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_service_address.create",
    entityId: customerId,
    entityTable: "trade_service_address",
    metadata: { customer_id: customerId },
  });

  revalidatePath(`/admin/trades/customers/${customerId}`);
  redirect(`/admin/trades/customers/${customerId}?notice=Service%20address%20added.`);
}

const TRADE_WORK_TYPES = new Set(["service_call", "project"]);
const TRADE_WORK_STATUSES = new Set(["open", "scheduled", "in_progress", "completed", "cancelled"]);

export async function createTradeWorkOrder(formData: FormData) {
  const context = await requireFormManager();
  const customerId = stringValue(formData, "customerId");
  const title = stringValue(formData, "title");

  if (!customerId) {
    redirect("/admin/trades/customers?error=Choose%20a%20customer.");
  }
  if (!title) {
    redirect(`/admin/trades/customers/${customerId}?error=Enter%20a%20work%20order%20title.`);
  }

  const workType: WorkType = TRADE_WORK_TYPES.has(stringValue(formData, "workType"))
    ? (stringValue(formData, "workType") as WorkType)
    : "service_call";

  const supabase = await createSupabaseServerClient();
  const { data: workOrder, error } = await supabase
    .from("trade_work_order")
    .insert({
      tenant_id: context.appUser.tenant_id,
      customer_id: customerId,
      service_address_id: stringValue(formData, "serviceAddressId") || null,
      title,
      work_type: workType,
      assigned_user_id: stringValue(formData, "assignedUserId") || null,
      scheduled_start: stringValue(formData, "scheduledStart") || null,
      scheduled_end: stringValue(formData, "scheduledEnd") || null,
      description: stringValue(formData, "description") || null,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !workOrder) {
    redirect(
      `/admin/trades/customers/${customerId}?error=${encodeURIComponent(error?.message ?? "Work order was not created.")}`,
    );
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_work_order.create",
    entityId: workOrder.id,
    entityTable: "trade_work_order",
    metadata: { customer_id: customerId, title },
  });

  revalidatePath("/admin/trades/work-orders");
  revalidatePath(`/admin/trades/customers/${customerId}`);
  redirect(`/admin/trades/work-orders/${workOrder.id}?notice=Work%20order%20created.`);
}

export async function updateTradeWorkOrder(formData: FormData) {
  const context = await requireFormManager();
  const workOrderId = stringValue(formData, "workOrderId");

  if (!workOrderId) {
    redirect("/admin/trades/work-orders?error=Choose%20a%20work%20order.");
  }

  const statusInput = stringValue(formData, "status");
  if (!TRADE_WORK_STATUSES.has(statusInput)) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=Choose%20a%20valid%20status.`);
  }
  const status = statusInput as WorkOrderStatus;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trade_work_order")
    .update({
      status,
      assigned_user_id: stringValue(formData, "assignedUserId") || null,
      scheduled_start: stringValue(formData, "scheduledStart") || null,
      scheduled_end: stringValue(formData, "scheduledEnd") || null,
    })
    .eq("id", workOrderId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_work_order.update",
    entityId: workOrderId,
    entityTable: "trade_work_order",
    metadata: { status },
  });

  revalidatePath("/admin/trades/work-orders");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect(`/admin/trades/work-orders/${workOrderId}?notice=Work%20order%20updated.`);
}

const TRADE_PRICE_TIERS = new Set(["good", "better", "best", "standard"]);
type TradePriceTier = "good" | "better" | "best" | "standard";

export async function createPriceBookItem(formData: FormData) {
  const context = await requireFormManager();
  const name = stringValue(formData, "name");

  if (!name) {
    redirect("/admin/trades/price-book?error=Enter%20an%20item%20name.");
  }

  const tier: TradePriceTier = TRADE_PRICE_TIERS.has(stringValue(formData, "tier"))
    ? (stringValue(formData, "tier") as TradePriceTier)
    : "standard";

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("trade_price_book_item").insert({
    tenant_id: context.appUser.tenant_id,
    code: stringValue(formData, "code") || null,
    name,
    description: stringValue(formData, "description") || null,
    category: stringValue(formData, "category") || null,
    tier,
    unit: stringValue(formData, "unit") || null,
    unit_price: numberValue(formData, "unitPrice", 0),
    created_by: context.appUser.id,
  });

  if (error) {
    redirect(`/admin/trades/price-book?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_price_book_item.create",
    entityId: context.appUser.tenant_id,
    entityTable: "trade_price_book_item",
    metadata: { name, tier },
  });

  revalidatePath("/admin/trades/price-book");
  redirect("/admin/trades/price-book?notice=Price%20book%20item%20added.");
}

export async function addTradeWorkOrderLine(formData: FormData) {
  const context = await requireFormManager();
  const workOrderId = stringValue(formData, "workOrderId");
  const priceBookItemId = stringValue(formData, "priceBookItemId");

  if (!workOrderId) {
    redirect("/admin/trades/work-orders?error=Choose%20a%20work%20order.");
  }

  const supabase = await createSupabaseServerClient();
  const quantity = numberValue(formData, "quantity", 1);

  // Snapshot name + price from the catalog when a price book item is chosen, so a
  // later price change does not rewrite this work order's history.
  let name = stringValue(formData, "name");
  let unitPrice = numberValue(formData, "unitPrice", 0);

  if (priceBookItemId) {
    const { data: item } = await supabase
      .from("trade_price_book_item")
      .select("name, unit_price")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("id", priceBookItemId)
      .maybeSingle<{ name: string; unit_price: number }>();

    if (!item) {
      redirect(`/admin/trades/work-orders/${workOrderId}?error=Price%20book%20item%20not%20found.`);
    }
    name = item.name;
    unitPrice = item.unit_price;
  }

  if (!name) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=Enter%20a%20line%20description%20or%20pick%20an%20item.`);
  }

  const { error } = await supabase.from("trade_work_order_line").insert({
    tenant_id: context.appUser.tenant_id,
    work_order_id: workOrderId,
    price_book_item_id: priceBookItemId || null,
    name,
    quantity,
    unit_price: unitPrice,
    created_by: context.appUser.id,
  });

  if (error) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_work_order_line.create",
    entityId: workOrderId,
    entityTable: "trade_work_order_line",
    metadata: { name, quantity, unit_price: unitPrice },
  });

  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect(`/admin/trades/work-orders/${workOrderId}?notice=Line%20added.`);
}

export async function removeTradeWorkOrderLine(formData: FormData) {
  const context = await requireFormManager();
  const workOrderId = stringValue(formData, "workOrderId");
  const lineId = stringValue(formData, "lineId");

  if (!workOrderId || !lineId) {
    redirect("/admin/trades/work-orders?error=Choose%20a%20line%20to%20remove.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trade_work_order_line")
    .delete()
    .eq("id", lineId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_work_order_line.delete",
    entityId: lineId,
    entityTable: "trade_work_order_line",
    metadata: { work_order_id: workOrderId },
  });

  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect(`/admin/trades/work-orders/${workOrderId}?notice=Line%20removed.`);
}

// Job checklists (slice 22). Templates are reusable named checklists; the office
// applies one to a work order, which copies its items into tasks the field worker
// ticks off on site.

export async function createChecklistTemplate(formData: FormData) {
  const context = await requireFormManager();
  const name = stringValue(formData, "name");

  if (!name) {
    redirect("/admin/trades/checklists?error=Enter%20a%20checklist%20name.");
  }

  const workTypeRaw = stringValue(formData, "workType");
  const workType = workTypeRaw === "service_call" || workTypeRaw === "project" ? workTypeRaw : null;

  const supabase = await createSupabaseServerClient();
  const { data: template, error } = await supabase
    .from("trade_checklist_template")
    .insert({
      tenant_id: context.appUser.tenant_id,
      name,
      work_type: workType,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !template) {
    redirect(`/admin/trades/checklists?error=${encodeURIComponent(error?.message ?? "Checklist was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_checklist_template.create",
    entityId: template.id,
    entityTable: "trade_checklist_template",
    metadata: { name, work_type: workType },
  });

  revalidatePath("/admin/trades/checklists");
  redirect(`/admin/trades/checklists/${template.id}?notice=Checklist%20created.`);
}

export async function addChecklistTemplateItem(formData: FormData) {
  const context = await requireFormManager();
  const templateId = stringValue(formData, "templateId");
  const label = stringValue(formData, "label");

  if (!templateId) {
    redirect("/admin/trades/checklists?error=Choose%20a%20checklist.");
  }
  if (!label) {
    redirect(`/admin/trades/checklists/${templateId}?error=Enter%20a%20task.`);
  }

  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("trade_checklist_template_item")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("template_id", templateId);

  const { error } = await supabase.from("trade_checklist_template_item").insert({
    tenant_id: context.appUser.tenant_id,
    template_id: templateId,
    label,
    position: count ?? 0,
  });

  if (error) {
    redirect(`/admin/trades/checklists/${templateId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_checklist_template_item.create",
    entityId: templateId,
    entityTable: "trade_checklist_template_item",
    metadata: { label },
  });

  revalidatePath(`/admin/trades/checklists/${templateId}`);
  redirect(`/admin/trades/checklists/${templateId}?notice=Task%20added.`);
}

export async function removeChecklistTemplateItem(formData: FormData) {
  const context = await requireFormManager();
  const templateId = stringValue(formData, "templateId");
  const itemId = stringValue(formData, "itemId");

  if (!templateId || !itemId) {
    redirect("/admin/trades/checklists?error=Choose%20a%20task%20to%20remove.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trade_checklist_template_item")
    .delete()
    .eq("id", itemId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/trades/checklists/${templateId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_checklist_template_item.delete",
    entityId: itemId,
    entityTable: "trade_checklist_template_item",
    metadata: { template_id: templateId },
  });

  revalidatePath(`/admin/trades/checklists/${templateId}`);
  redirect(`/admin/trades/checklists/${templateId}?notice=Task%20removed.`);
}

export async function applyChecklistTemplateToWorkOrder(formData: FormData) {
  const context = await requireFormManager();
  const workOrderId = stringValue(formData, "workOrderId");
  const templateId = stringValue(formData, "templateId");

  if (!workOrderId) {
    redirect("/admin/trades/work-orders?error=Choose%20a%20work%20order.");
  }
  if (!templateId) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=Choose%20a%20checklist%20to%20apply.`);
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: workOrder }, { data: itemRows }, { count: existingCount }] = await Promise.all([
    supabase
      .from("trade_work_order")
      .select("id")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("id", workOrderId)
      .maybeSingle<{ id: string }>(),
    supabase
      .from("trade_checklist_template_item")
      .select("label, position")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("template_id", templateId)
      .order("position", { ascending: true })
      .returns<{ label: string; position: number }[]>(),
    supabase
      .from("trade_work_order_task")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("work_order_id", workOrderId),
  ]);

  if (!workOrder) {
    redirect("/admin/trades/work-orders?error=Work%20order%20not%20found.");
  }

  const items = itemRows ?? [];
  if (items.length === 0) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=That%20checklist%20has%20no%20tasks%20yet.`);
  }

  const base = existingCount ?? 0;
  const { error } = await supabase.from("trade_work_order_task").insert(
    items.map((item, index) => ({
      tenant_id: context.appUser.tenant_id,
      work_order_id: workOrderId,
      source_template_id: templateId,
      label: item.label,
      position: base + index,
      created_by: context.appUser.id,
    })),
  );

  if (error) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_work_order_task.apply_template",
    entityId: workOrderId,
    entityTable: "trade_work_order_task",
    metadata: { template_id: templateId, count: items.length },
  });

  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect(`/admin/trades/work-orders/${workOrderId}?notice=Checklist%20applied.`);
}

export async function addWorkOrderTask(formData: FormData) {
  const context = await requireFormManager();
  const workOrderId = stringValue(formData, "workOrderId");
  const label = stringValue(formData, "label");

  if (!workOrderId) {
    redirect("/admin/trades/work-orders?error=Choose%20a%20work%20order.");
  }
  if (!label) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=Enter%20a%20task.`);
  }

  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("trade_work_order_task")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("work_order_id", workOrderId);

  const { error } = await supabase.from("trade_work_order_task").insert({
    tenant_id: context.appUser.tenant_id,
    work_order_id: workOrderId,
    label,
    position: count ?? 0,
    created_by: context.appUser.id,
  });

  if (error) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_work_order_task.create",
    entityId: workOrderId,
    entityTable: "trade_work_order_task",
    metadata: { label },
  });

  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect(`/admin/trades/work-orders/${workOrderId}?notice=Task%20added.`);
}

export async function removeWorkOrderTask(formData: FormData) {
  const context = await requireFormManager();
  const workOrderId = stringValue(formData, "workOrderId");
  const taskId = stringValue(formData, "taskId");

  if (!workOrderId || !taskId) {
    redirect("/admin/trades/work-orders?error=Choose%20a%20task%20to%20remove.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trade_work_order_task")
    .delete()
    .eq("id", taskId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_work_order_task.delete",
    entityId: taskId,
    entityTable: "trade_work_order_task",
    metadata: { work_order_id: workOrderId },
  });

  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect(`/admin/trades/work-orders/${workOrderId}?notice=Task%20removed.`);
}

const TRADE_INVOICE_STATUSES = new Set(["draft", "sent", "paid", "void"]);
type TradeInvoiceStatus = "draft" | "sent" | "paid" | "void";

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export async function createInvoiceFromWorkOrder(formData: FormData) {
  const context = await requireFormManager();
  const workOrderId = stringValue(formData, "workOrderId");

  if (!workOrderId) {
    redirect("/admin/trades/work-orders?error=Choose%20a%20work%20order.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: workOrder } = await supabase
    .from("trade_work_order")
    .select("id, customer_id")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", workOrderId)
    .maybeSingle<{ id: string; customer_id: string }>();

  if (!workOrder) {
    redirect("/admin/trades/work-orders?error=Work%20order%20not%20found.");
  }

  const { data: lineRows } = await supabase
    .from("trade_work_order_line")
    .select("name, quantity, unit_price, line_total")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("work_order_id", workOrderId)
    .order("created_at", { ascending: true })
    .returns<{ name: string; quantity: number; unit_price: number; line_total: number }[]>();
  const lines = lineRows ?? [];

  if (lines.length === 0) {
    redirect(`/admin/trades/work-orders/${workOrderId}?error=Add%20line%20items%20before%20invoicing.`);
  }

  const subtotal = roundMoney(lines.reduce((sum, line) => sum + Number(line.line_total ?? 0), 0));

  // Sequential per-tenant invoice number. Racy under heavy concurrency, but the
  // unique index on (tenant_id, invoice_number) is the backstop.
  const { count } = await supabase
    .from("trade_invoice")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", context.appUser.tenant_id);
  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, "0")}`;
  const issuedOn = new Date().toISOString().slice(0, 10);

  const { data: invoice, error } = await supabase
    .from("trade_invoice")
    .insert({
      tenant_id: context.appUser.tenant_id,
      customer_id: workOrder.customer_id,
      work_order_id: workOrderId,
      invoice_number: invoiceNumber,
      status: "draft",
      subtotal,
      tax_rate: 0,
      tax_amount: 0,
      total: subtotal,
      issued_on: issuedOn,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !invoice) {
    redirect(
      `/admin/trades/work-orders/${workOrderId}?error=${encodeURIComponent(error?.message ?? "Invoice was not created.")}`,
    );
  }

  const { error: lineError } = await supabase.from("trade_invoice_line").insert(
    lines.map((line) => ({
      tenant_id: context.appUser.tenant_id,
      invoice_id: invoice.id,
      name: line.name,
      quantity: line.quantity,
      unit_price: line.unit_price,
    })),
  );

  if (lineError) {
    redirect(`/admin/trades/invoices/${invoice.id}?error=${encodeURIComponent(lineError.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_invoice.create",
    entityId: invoice.id,
    entityTable: "trade_invoice",
    metadata: { invoice_number: invoiceNumber, work_order_id: workOrderId, subtotal },
  });

  revalidatePath("/admin/trades/invoices");
  revalidatePath(`/admin/trades/work-orders/${workOrderId}`);
  redirect(`/admin/trades/invoices/${invoice.id}?notice=Invoice%20${invoiceNumber}%20created.`);
}

export async function updateTradeInvoice(formData: FormData) {
  const context = await requireFormManager();
  const invoiceId = stringValue(formData, "invoiceId");

  if (!invoiceId) {
    redirect("/admin/trades/invoices?error=Choose%20an%20invoice.");
  }

  const statusInput = stringValue(formData, "status");
  if (!TRADE_INVOICE_STATUSES.has(statusInput)) {
    redirect(`/admin/trades/invoices/${invoiceId}?error=Choose%20a%20valid%20status.`);
  }
  const status = statusInput as TradeInvoiceStatus;

  const supabase = await createSupabaseServerClient();
  const { data: invoice } = await supabase
    .from("trade_invoice")
    .select("subtotal")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", invoiceId)
    .maybeSingle<{ subtotal: number }>();

  if (!invoice) {
    redirect("/admin/trades/invoices?error=Invoice%20not%20found.");
  }

  const taxRate = numberValue(formData, "taxRate", 0);
  const subtotal = Number(invoice.subtotal ?? 0);
  const taxAmount = roundMoney((subtotal * taxRate) / 100);
  const total = roundMoney(subtotal + taxAmount);

  const { error } = await supabase
    .from("trade_invoice")
    .update({
      status,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      due_on: stringValue(formData, "dueOn") || null,
      notes: stringValue(formData, "notes") || null,
    })
    .eq("id", invoiceId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/trades/invoices/${invoiceId}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "trade_invoice.update",
    entityId: invoiceId,
    entityTable: "trade_invoice",
    metadata: { status, tax_rate: taxRate, total },
  });

  revalidatePath("/admin/trades/invoices");
  revalidatePath(`/admin/trades/invoices/${invoiceId}`);
  redirect(`/admin/trades/invoices/${invoiceId}?notice=Invoice%20updated.`);
}

export async function updateTransportSafetyFitness(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const certNumber = stringValue(formData, "certNumber") || null;
  const expiresOn = dateOnlyValue(formData, "expiresOn");

  await applyTenantSettingsPatch(
    supabase,
    context.appUser.tenant_id,
    {
      safety_fitness_cert_number: certNumber,
      safety_fitness_expires_on: expiresOn,
    },
    "/admin/transport",
  );

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.safety_fitness.update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      safety_fitness_cert_number: certNumber,
      safety_fitness_expires_on: expiresOn,
    },
  });

  revalidatePath("/admin/transport");
  redirect("/admin/transport?notice=Safety%20Fitness%20Certificate%20saved.");
}

async function ensureTenantDriver(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  driverId: string,
  tenantId: string,
) {
  const { data } = await supabase
    .from("transport_driver")
    .select("id, full_name")
    .eq("id", driverId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; full_name: string }>();

  return data ?? null;
}

export async function createTransportDriver(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const fullName = stringValue(formData, "fullName");

  if (!fullName) {
    redirect("/admin/transport/drivers?error=Enter%20the%20driver%20name.");
  }

  const { data: driver, error } = await supabase
    .from("transport_driver")
    .insert({
      tenant_id: context.appUser.tenant_id,
      full_name: fullName,
      license_number: stringValue(formData, "licenseNumber") || null,
      license_class: stringValue(formData, "licenseClass") || null,
      license_expiry: dateOnlyValue(formData, "licenseExpiry"),
      hired_on: dateOnlyValue(formData, "hiredOn"),
      user_id: stringValue(formData, "userId") || null,
      notes: stringValue(formData, "notes") || null,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !driver) {
    redirect(`/admin/transport/drivers?error=${encodeURIComponent(error?.message ?? "Driver was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.driver.create",
    entityId: driver.id,
    entityTable: "transport_driver",
    metadata: { full_name: fullName },
  });

  revalidatePath("/admin/transport/drivers");
  redirect(`/admin/transport/drivers/${driver.id}?notice=Driver%20added.`);
}

export async function uploadTransportDocument(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const driverId = stringValue(formData, "driverId");
  const registryKey = stringValue(formData, "registryKey");
  const slotKey = stringValue(formData, "slotKey");
  const file = getUploadFile(formData);
  const title = stringValue(formData, "title") || file?.name || "";
  const issuedDate = dateOnlyValue(formData, "issuedDate");
  const expiryDate = dateOnlyValue(formData, "expiryDate");

  if (!driverId) {
    redirect("/admin/transport/drivers?error=Choose%20a%20driver.");
  }

  const driverPath = `/admin/transport/drivers/${driverId}`;

  if (!file || !title) {
    redirect(`${driverPath}?error=Choose%20a%20file%20and%20enter%20a%20title.`);
  }

  // Only accept slots the Alberta catalogue defines for a driver.
  const requirement = TRANSPORT_REQUIREMENTS.find(
    (item) => item.registryKey === registryKey && item.slotKey === slotKey && item.scope === "driver",
  );

  if (!requirement) {
    redirect(`${driverPath}?error=Choose%20a%20valid%20document%20slot.`);
  }

  const driver = await ensureTenantDriver(supabase, driverId, context.appUser.tenant_id);

  if (!driver) {
    redirect("/admin/transport/drivers?error=Choose%20a%20valid%20driver.");
  }

  const storagePath = [
    context.appUser.tenant_id,
    "transport",
    registryKey,
    slotKey,
    `${Date.now()}-${sanitizeStorageFilename(file.name)}`,
  ].join("/");

  const { error: uploadError } = await supabase.storage.from("tenant-documents").upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    redirect(`${driverPath}?error=${encodeURIComponent(uploadError.message)}`);
  }

  const { data: document, error } = await supabase
    .from("transport_document")
    .insert({
      tenant_id: context.appUser.tenant_id,
      registry_key: registryKey,
      slot_key: slotKey,
      scope: "driver",
      subject_id: driverId,
      title,
      storage_path: storagePath,
      issued_date: issuedDate,
      expiry_date: expiryDate,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !document) {
    redirect(`${driverPath}?error=${encodeURIComponent(error?.message ?? "Document was not saved.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.document.upload",
    entityId: document.id,
    entityTable: "transport_document",
    metadata: {
      driver_id: driverId,
      registry_key: registryKey,
      slot_key: slotKey,
      expiry_date: expiryDate,
    },
  });

  revalidatePath(driverPath);
  revalidatePath("/admin/transport/drivers");
  redirect(`${driverPath}?notice=Document%20uploaded.`);
}

export async function uploadTransportCompanyDocument(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const registryKey = stringValue(formData, "registryKey");
  const slotKey = stringValue(formData, "slotKey");
  const file = getUploadFile(formData);
  const title = stringValue(formData, "title") || file?.name || "";
  const issuedDate = dateOnlyValue(formData, "issuedDate");
  const expiryDate = dateOnlyValue(formData, "expiryDate");
  const programPath = "/admin/transport/program";

  if (!file || !title) {
    redirect(`${programPath}?error=Choose%20a%20file%20and%20enter%20a%20title.`);
  }

  // Only accept company-scope slots from the Alberta catalogue.
  const requirement = TRANSPORT_REQUIREMENTS.find(
    (item) => item.registryKey === registryKey && item.slotKey === slotKey && item.scope === "company",
  );

  if (!requirement) {
    redirect(`${programPath}?error=Choose%20a%20valid%20program%20element.`);
  }

  const storagePath = [
    context.appUser.tenant_id,
    "transport",
    registryKey,
    slotKey,
    `${Date.now()}-${sanitizeStorageFilename(file.name)}`,
  ].join("/");

  const { error: uploadError } = await supabase.storage.from("tenant-documents").upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    redirect(`${programPath}?error=${encodeURIComponent(uploadError.message)}`);
  }

  const { data: document, error } = await supabase
    .from("transport_document")
    .insert({
      tenant_id: context.appUser.tenant_id,
      registry_key: registryKey,
      slot_key: slotKey,
      scope: "company",
      subject_id: null,
      title,
      storage_path: storagePath,
      issued_date: issuedDate,
      expiry_date: expiryDate,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !document) {
    redirect(`${programPath}?error=${encodeURIComponent(error?.message ?? "Document was not saved.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.company_document.upload",
    entityId: document.id,
    entityTable: "transport_document",
    metadata: { registry_key: registryKey, slot_key: slotKey },
  });

  revalidatePath(programPath);
  revalidatePath("/admin/transport");
  redirect(`${programPath}?notice=Document%20uploaded.`);
}

export async function archiveTransportDocument(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const documentId = stringValue(formData, "documentId");
  const driverId = stringValue(formData, "driverId");
  const returnTo = stringValue(formData, "returnTo");
  // Only allow returning to an in-module path; otherwise fall back to the driver.
  const safeReturnTo = returnTo.startsWith("/admin/transport") ? returnTo : null;
  const driverPath =
    safeReturnTo ?? (driverId ? `/admin/transport/drivers/${driverId}` : "/admin/transport/drivers");

  if (!documentId) {
    redirect(`${driverPath}?error=Choose%20a%20document.`);
  }

  const { error } = await supabase
    .from("transport_document")
    .update({ status: "archived" })
    .eq("id", documentId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`${driverPath}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.document.archive",
    entityId: documentId,
    entityTable: "transport_document",
    metadata: { driver_id: driverId || null },
  });

  revalidatePath(driverPath);
  revalidatePath("/admin/transport/drivers");
  redirect(`${driverPath}?notice=Document%20archived.`);
}

const dutyStatuses = new Set(["off_duty", "sleeper_berth", "driving", "on_duty"]);

export async function addDutyStatusEvent(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const driverId = stringValue(formData, "driverId");
  const statusRaw = stringValue(formData, "status");
  const startedAtRaw = stringValue(formData, "startedAt");
  const location = stringValue(formData, "location") || null;
  const remark = stringValue(formData, "remark") || null;

  if (!driverId) {
    redirect("/admin/transport/drivers?error=Choose%20a%20driver.");
  }

  const driverPath = `/admin/transport/drivers/${driverId}`;

  if (!dutyStatuses.has(statusRaw)) {
    redirect(`${driverPath}?error=Choose%20a%20duty%20status.`);
  }

  const parsedStart = startedAtRaw ? new Date(startedAtRaw) : null;

  if (!parsedStart || Number.isNaN(parsedStart.getTime())) {
    redirect(`${driverPath}?error=Enter%20a%20valid%20start%20time.`);
  }

  const status = statusRaw as Database["public"]["Tables"]["transport_duty_status_event"]["Row"]["status"];

  const { error } = await supabase.from("transport_duty_status_event").insert({
    tenant_id: context.appUser.tenant_id,
    driver_id: driverId,
    status,
    started_at: parsedStart.toISOString(),
    source: "manual",
    location,
    remark,
    created_by: context.appUser.id,
  });

  if (error) {
    redirect(`${driverPath}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.duty_status.create",
    entityTable: "transport_duty_status_event",
    metadata: { driver_id: driverId, status, started_at: parsedStart.toISOString() },
  });

  revalidatePath(driverPath);
  redirect(`${driverPath}?notice=Duty%20status%20logged.`);
}

export async function addDailyTimeRecord(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const driverId = stringValue(formData, "driverId");
  const reportRaw = stringValue(formData, "reportAt");
  const releaseRaw = stringValue(formData, "releaseAt");
  const startLocation = stringValue(formData, "startLocation") || null;
  const endLocation = stringValue(formData, "endLocation") || null;

  if (!driverId) {
    redirect("/admin/transport/drivers?error=Choose%20a%20driver.");
  }

  const driverPath = `/admin/transport/drivers/${driverId}`;
  const built = buildTimeRecordEvents({ reportAt: reportRaw, releaseAt: releaseRaw, startLocation, endLocation });

  if (!built) {
    redirect(`${driverPath}?error=${encodeURIComponent("Enter a report time and a later release time.")}`);
  }

  const rows = built.events.map((event) => ({
    tenant_id: context.appUser.tenant_id,
    driver_id: driverId,
    status: event.status,
    started_at: event.startedAt,
    source: "time_record" as const,
    location: event.location,
    created_by: context.appUser.id,
  }));

  const { error } = await supabase.from("transport_duty_status_event").insert(rows);

  if (error) {
    redirect(`${driverPath}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.time_record.create",
    entityTable: "transport_duty_status_event",
    metadata: { driver_id: driverId, report_at: rows[0].started_at, release_at: rows[1].started_at, on_duty_hours: built.onDutyHours },
  });

  revalidatePath(driverPath);
  redirect(`${driverPath}?notice=Local%20day%20logged.`);
}

export async function saveDutyLogSegments(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const driverId = stringValue(formData, "driverId");

  if (!driverId) {
    redirect("/admin/transport/drivers?error=Choose%20a%20driver.");
  }

  const driverPath = `/admin/transport/drivers/${driverId}`;
  const dutyStatusValues = new Set(["off_duty", "sleeper_berth", "driving", "on_duty"]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stringValue(formData, "segments") || "[]");
  } catch {
    parsed = [];
  }

  const rows = (Array.isArray(parsed) ? parsed : [])
    .map((segment) => (segment && typeof segment === "object" ? (segment as Record<string, unknown>) : {}))
    .filter(
      (segment) =>
        typeof segment.status === "string" &&
        dutyStatusValues.has(segment.status) &&
        typeof segment.startedAt === "string" &&
        !Number.isNaN(Date.parse(segment.startedAt)),
    )
    .map((segment) => ({
      tenant_id: context.appUser.tenant_id,
      driver_id: driverId,
      status: segment.status as Database["public"]["Tables"]["transport_duty_status_event"]["Row"]["status"],
      started_at: new Date(Date.parse(segment.startedAt as string)).toISOString(),
      source: "ocr" as const,
      created_by: context.appUser.id,
    }));

  if (rows.length === 0) {
    redirect(`${driverPath}?error=${encodeURIComponent("No valid duty-status entries to save.")}`);
  }

  const { error } = await supabase.from("transport_duty_status_event").insert(rows);

  if (error) {
    redirect(`${driverPath}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.duty_status.ocr_import",
    entityTable: "transport_duty_status_event",
    metadata: { driver_id: driverId, count: rows.length },
  });

  revalidatePath(driverPath);
  redirect(`${driverPath}?notice=${encodeURIComponent(`${rows.length} duty entries saved from the log.`)}`);
}

export async function updateDriverHosCycle(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const driverId = stringValue(formData, "driverId");
  const cycleRaw = stringValue(formData, "cycle");

  if (!driverId) {
    redirect("/admin/transport/drivers?error=Choose%20a%20driver.");
  }

  const driverPath = `/admin/transport/drivers/${driverId}`;
  const cycle = cycleRaw === "cycle_2" ? "cycle_2" : "cycle_1";

  const { error } = await supabase
    .from("transport_driver")
    .update({ hos_cycle: cycle })
    .eq("id", driverId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`${driverPath}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.driver.hos_cycle",
    entityId: driverId,
    entityTable: "transport_driver",
    metadata: { hos_cycle: cycle },
  });

  revalidatePath(driverPath);
  redirect(`${driverPath}?notice=HOS%20cycle%20updated.`);
}

export async function updateDriverHosRegime(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const driverId = stringValue(formData, "driverId");
  const regimeRaw = stringValue(formData, "regime");

  if (!driverId) {
    redirect("/admin/transport/drivers?error=Choose%20a%20driver.");
  }

  const driverPath = `/admin/transport/drivers/${driverId}`;
  const regime = regimeRaw === "provincial_ab" ? "provincial_ab" : "federal";

  const { error } = await supabase
    .from("transport_driver")
    .update({ hos_regime: regime })
    .eq("id", driverId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`${driverPath}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.driver.hos_regime",
    entityId: driverId,
    entityTable: "transport_driver",
    metadata: { hos_regime: regime },
  });

  revalidatePath(driverPath);
  redirect(`${driverPath}?notice=HOS%20regime%20updated.`);
}

export async function deleteDutyStatusEvent(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const eventId = stringValue(formData, "eventId");
  const driverId = stringValue(formData, "driverId");
  const driverPath = driverId ? `/admin/transport/drivers/${driverId}` : "/admin/transport/drivers";

  if (!eventId) {
    redirect(`${driverPath}?error=Choose%20a%20log%20entry.`);
  }

  const { error } = await supabase
    .from("transport_duty_status_event")
    .delete()
    .eq("id", eventId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`${driverPath}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.duty_status.delete",
    entityId: eventId,
    entityTable: "transport_duty_status_event",
    metadata: { driver_id: driverId || null },
  });

  revalidatePath(driverPath);
  redirect(`${driverPath}?notice=Log%20entry%20removed.`);
}

const ELD_CONNECTIONS_PATH = "/admin/transport/connections";

export async function connectEldProvider(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const providerRaw = stringValue(formData, "provider");

  if (!isEldProvider(providerRaw)) {
    redirect(`${ELD_CONNECTIONS_PATH}?error=Choose%20a%20provider.`);
  }

  // Record the chosen provider. Live authorization (OAuth / session / API key)
  // activates once the provider's credentials are configured; until then the
  // connection sits in needs_setup so the operator can see it is pending.
  const configured = isEldProviderConfigured(providerRaw);

  const { error } = await supabase.from("eld_connection").upsert(
    {
      tenant_id: context.appUser.tenant_id,
      provider: providerRaw,
      status: "needs_setup",
      last_error: configured ? null : "Provider credentials are not configured in this environment yet.",
      created_by: context.appUser.id,
    },
    { onConflict: "tenant_id,provider" },
  );

  if (error) {
    redirect(`${ELD_CONNECTIONS_PATH}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.eld.connect",
    entityTable: "eld_connection",
    metadata: { provider: providerRaw },
  });

  revalidatePath(ELD_CONNECTIONS_PATH);
  redirect(`${ELD_CONNECTIONS_PATH}?notice=${encodeURIComponent(`${providerRaw} added.`)}`);
}

export async function disconnectEldProvider(formData: FormData) {
  const context = await requireTransportManager();
  const supabase = await createSupabaseServerClient();
  const providerRaw = stringValue(formData, "provider");

  if (!isEldProvider(providerRaw)) {
    redirect(`${ELD_CONNECTIONS_PATH}?error=Choose%20a%20provider.`);
  }

  const { error } = await supabase
    .from("eld_connection")
    .delete()
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("provider", providerRaw);

  if (error) {
    redirect(`${ELD_CONNECTIONS_PATH}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.eld.disconnect",
    entityTable: "eld_connection",
    metadata: { provider: providerRaw },
  });

  revalidatePath(ELD_CONNECTIONS_PATH);
  redirect(`${ELD_CONNECTIONS_PATH}?notice=Disconnected.`);
}

export async function syncMotiveNow(_formData: FormData) {
  const context = await requireTransportManager();
  const result = await syncMotiveConnection(context.appUser.tenant_id);

  revalidatePath(ELD_CONNECTIONS_PATH);

  if (!result.ok) {
    redirect(`${ELD_CONNECTIONS_PATH}?error=${encodeURIComponent(result.error)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.eld.sync",
    entityTable: "eld_connection",
    metadata: { provider: "motive", created: result.created, skipped_unmatched: result.skippedUnmatched },
  });

  redirect(
    `${ELD_CONNECTIONS_PATH}?notice=${encodeURIComponent(
      `Motive synced: ${result.created} new entr${result.created === 1 ? "y" : "ies"}, ${result.skippedUnmatched} unmatched driver event${result.skippedUnmatched === 1 ? "" : "s"}.`,
    )}`,
  );
}

const medicalRecordTypes = new Set(["injury", "medical", "wcb", "first_aid", "other"]);

export async function uploadMedicalVaultRecord(formData: FormData) {
  const context = await requireMedicalVaultManager();
  const supabase = await createSupabaseServerClient();
  const driverId = stringValue(formData, "driverId");
  const recordTypeRaw = stringValue(formData, "recordType");
  const recordType = (
    medicalRecordTypes.has(recordTypeRaw) ? recordTypeRaw : "other"
  ) as Database["public"]["Tables"]["transport_medical_record"]["Row"]["record_type"];
  const file = getUploadFile(formData);
  const title = stringValue(formData, "title") || file?.name || "";
  const occurredOn = dateOnlyValue(formData, "occurredOn");
  const notes = stringValue(formData, "notes") || null;

  if (!driverId) {
    redirect("/admin/transport/drivers?error=Choose%20a%20driver.");
  }

  const driverPath = `/admin/transport/drivers/${driverId}`;

  if (!file || !title) {
    redirect(`${driverPath}?error=Choose%20a%20file%20and%20enter%20a%20title.`);
  }

  const driver = await ensureTenantDriver(supabase, driverId, context.appUser.tenant_id);

  if (!driver) {
    redirect("/admin/transport/drivers?error=Choose%20a%20valid%20driver.");
  }

  // Stored in the private medical-vault bucket under {tenant}/{driver}/...; the
  // storage policy enforces vault access on read and write.
  const storagePath = [
    context.appUser.tenant_id,
    driverId,
    `${Date.now()}-${sanitizeStorageFilename(file.name)}`,
  ].join("/");

  const { error: uploadError } = await supabase.storage.from("medical-vault").upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    redirect(`${driverPath}?error=${encodeURIComponent(uploadError.message)}`);
  }

  const { data: record, error } = await supabase
    .from("transport_medical_record")
    .insert({
      tenant_id: context.appUser.tenant_id,
      driver_id: driverId,
      record_type: recordType,
      title,
      storage_path: storagePath,
      occurred_on: occurredOn,
      notes,
      created_by: context.appUser.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !record) {
    redirect(`${driverPath}?error=${encodeURIComponent(error?.message ?? "Record was not saved.")}`);
  }

  // Deliberately omit the title/notes from the audit log to avoid copying
  // sensitive medical content into the general audit trail.
  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.medical_record.upload",
    entityId: record.id,
    entityTable: "transport_medical_record",
    metadata: { driver_id: driverId, record_type: recordType },
  });

  revalidatePath(driverPath);
  redirect(`${driverPath}?notice=Medical%20record%20saved.`);
}

export async function archiveMedicalVaultRecord(formData: FormData) {
  const context = await requireMedicalVaultManager();
  const supabase = await createSupabaseServerClient();
  const recordId = stringValue(formData, "recordId");
  const driverId = stringValue(formData, "driverId");
  const driverPath = driverId ? `/admin/transport/drivers/${driverId}` : "/admin/transport/drivers";

  if (!recordId) {
    redirect(`${driverPath}?error=Choose%20a%20record.`);
  }

  const { error } = await supabase
    .from("transport_medical_record")
    .update({ status: "archived" })
    .eq("id", recordId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`${driverPath}?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "transport.medical_record.archive",
    entityId: recordId,
    entityTable: "transport_medical_record",
    metadata: { driver_id: driverId || null },
  });

  revalidatePath(driverPath);
  redirect(`${driverPath}?notice=Medical%20record%20archived.`);
}

export async function updateDocumentControlNumberingSettings(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const prefix = normalizeDcnSegment(stringValue(formData, "companyPrefix"));
  const includeSourceCode = stringValue(formData, "includeSourceCode") === "true";
  const includeRevision = stringValue(formData, "includeRevision") === "true";
  const includeYear = stringValue(formData, "includeYear") === "true";
  const sequencePadding = normalizeDcnSequencePadding(numberValue(formData, "sequencePadding", 4));
  const { data: existingCompanySettings } = await supabase
    .from("company_settings")
    .select("company_name")
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<Pick<Database["public"]["Tables"]["company_settings"]["Row"], "company_name">>();

  const { data: companySettings, error } = await supabase
    .from("company_settings")
    .upsert(
      {
        company_name: existingCompanySettings?.company_name ?? context.tenant?.name ?? "Company",
        dcn_company_prefix: prefix || null,
        dcn_include_revision: includeRevision,
        dcn_include_source_code: includeSourceCode,
        dcn_include_year: includeYear,
        dcn_sequence_padding: sequencePadding,
        tenant_id: context.appUser.tenant_id,
      },
      {
        onConflict: "tenant_id",
      },
    )
    .select("id")
    .single<{ id: string }>();

  if (error || !companySettings) {
    redirect(`/admin/documents?error=${encodeURIComponent(error?.message ?? "Document control numbering was not saved.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "document_control.numbering.update",
    entityId: companySettings.id,
    entityTable: "company_settings",
    metadata: {
      company_prefix: prefix || null,
      include_revision: includeRevision,
      include_source_code: includeSourceCode,
      include_year: includeYear,
      sequence_padding: sequencePadding,
    },
  });

  revalidatePath("/admin/documents");
  redirect("/admin/documents?notice=Document%20control%20numbering%20saved.");
}

export async function createResourceSection(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");
  const sortOrder = numberValue(formData, "sortOrder", 0);

  if (!name) {
    redirect("/admin/documents?error=Enter%20a%20resource%20section%20name.");
  }

  const { data: section, error } = await supabase
    .from("resource_sections")
    .insert({
      name,
      sort_order: sortOrder,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !section) {
    redirect(`/admin/documents?error=${encodeURIComponent(error?.message ?? "Resource section was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "resource_section.create",
    entityId: section.id,
    entityTable: "resource_sections",
    metadata: {
      name,
      sort_order: sortOrder,
    },
  });

  revalidatePath("/admin/documents");
  revalidatePath("/web");
  redirect("/admin/documents?notice=Resource%20section%20created.");
}

export async function updateResourceSection(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const sectionId = stringValue(formData, "sectionId");
  const name = stringValue(formData, "name");
  const sortOrder = numberValue(formData, "sortOrder", 0);

  if (!sectionId || !name) {
    redirect("/admin/documents?error=Choose%20a%20resource%20section%20and%20enter%20a%20name.");
  }

  const { data: section, error } = await supabase
    .from("resource_sections")
    .update({
      name,
      sort_order: sortOrder,
    })
    .eq("id", sectionId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !section) {
    redirect(`/admin/documents?error=${encodeURIComponent(error?.message ?? "Choose a valid resource section.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "resource_section.update",
    entityId: section.id,
    entityTable: "resource_sections",
    metadata: {
      name,
      sort_order: sortOrder,
    },
  });

  revalidatePath("/admin/documents");
  revalidatePath("/web");
  redirect("/admin/documents?notice=Resource%20section%20saved.");
}

export async function moveResourceSection(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const sectionId = stringValue(formData, "sectionId");
  const direction = coerceResourceMoveDirection(stringValue(formData, "direction"));
  const tenantId = context.appUser.tenant_id;

  if (!sectionId || !direction) {
    redirect("/admin/documents?error=Choose%20a%20resource%20section%20and%20move%20direction.");
  }

  const { data: sectionRows, error: sectionError } = await supabase
    .from("resource_sections")
    .select("id, name, sort_order")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<ResourceSectionOrderRow[]>();

  if (sectionError) {
    redirect(`/admin/documents?error=${encodeURIComponent(sectionError.message)}`);
  }

  const orderUpdates = getResourceReorderUpdates(sectionRows ?? [], sectionId, direction);

  if (orderUpdates.length === 0) {
    redirect("/admin/documents?notice=Resource%20section%20order%20unchanged.");
  }

  for (const update of orderUpdates) {
    const { error } = await supabase
      .from("resource_sections")
      .update({ sort_order: update.sort_order })
      .eq("id", update.id)
      .eq("tenant_id", tenantId);

    if (error) {
      redirect(`/admin/documents?error=${encodeURIComponent(error.message)}`);
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "resource_section.reorder",
    entityId: sectionId,
    entityTable: "resource_sections",
    metadata: {
      direction,
      ordered_section_ids: orderUpdates.map((update) => update.id),
    },
  });

  revalidatePath("/admin/documents");
  revalidatePath("/web");
  redirect("/admin/documents?notice=Resource%20section%20moved.");
}

export async function moveResource(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const resourceId = stringValue(formData, "resourceId");
  const direction = coerceResourceMoveDirection(stringValue(formData, "direction"));
  const tenantId = context.appUser.tenant_id;

  if (!resourceId || !direction) {
    redirect("/admin/documents?error=Choose%20a%20resource%20and%20move%20direction.");
  }

  const { data: resource, error: resourceError } = await supabase
    .from("resources")
    .select("id, name, section_id, sort_order, updated_at")
    .eq("id", resourceId)
    .eq("tenant_id", tenantId)
    .maybeSingle<ResourceOrderRow>();

  if (resourceError || !resource) {
    redirect(`/admin/documents?error=${encodeURIComponent(resourceError?.message ?? "Choose a valid resource.")}`);
  }

  const siblingResourceQuery = supabase
    .from("resources")
    .select("id, name, section_id, sort_order, updated_at")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .order("updated_at", { ascending: false });
  const { data: resourceRows, error: resourcesError } = resource.section_id
    ? await siblingResourceQuery.eq("section_id", resource.section_id).returns<ResourceOrderRow[]>()
    : await siblingResourceQuery.is("section_id", null).returns<ResourceOrderRow[]>();

  if (resourcesError) {
    redirect(`/admin/documents?error=${encodeURIComponent(resourcesError.message)}`);
  }

  const orderUpdates = getResourceReorderUpdates(resourceRows ?? [], resourceId, direction);

  if (orderUpdates.length === 0) {
    redirect("/admin/documents?notice=Resource%20order%20unchanged.");
  }

  for (const update of orderUpdates) {
    const updateQuery = supabase
      .from("resources")
      .update({ sort_order: update.sort_order })
      .eq("id", update.id)
      .eq("tenant_id", tenantId);
    const { error } = resource.section_id
      ? await updateQuery.eq("section_id", resource.section_id)
      : await updateQuery.is("section_id", null);

    if (error) {
      redirect(`/admin/documents?error=${encodeURIComponent(error.message)}`);
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "document_resource.reorder",
    entityId: resourceId,
    entityTable: "resources",
    metadata: {
      direction,
      ordered_resource_ids: orderUpdates.map((update) => update.id),
      section_id: resource.section_id,
    },
  });

  revalidatePath("/admin/documents");
  revalidatePath("/web");
  redirect("/admin/documents?notice=Resource%20moved.");
}

export async function assignResourceSection(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const resourceId = stringValue(formData, "resourceId");
  const sectionId = stringValue(formData, "sectionId") || null;
  const name = stringValue(formData, "name");
  const sortOrder = numberValue(formData, "sortOrder", 0);

  if (!resourceId) {
    redirect("/admin/documents?error=Choose%20a%20resource%20to%20assign.");
  }

  if (sectionId) {
    const { data: section } = await supabase
      .from("resource_sections")
      .select("id")
      .eq("id", sectionId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string }>();

    if (!section) {
      redirect("/admin/documents?error=Choose%20a%20valid%20resource%20section.");
    }
  }

  const { data: existingResource, error: resourceLookupError } = await supabase
    .from("resources")
    .select("id, name, dcn, storage_path")
    .eq("id", resourceId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<Pick<Database["public"]["Tables"]["resources"]["Row"], "dcn" | "id" | "name" | "storage_path">>();

  if (resourceLookupError || !existingResource) {
    redirect(`/admin/documents?error=${encodeURIComponent(resourceLookupError?.message ?? "Choose a valid resource.")}`);
  }

  const nextName = name || existingResource.name;
  const fileName = existingResource.storage_path.split("/").at(-1);
  const { error } = await supabase
    .from("resources")
    .update({
      name: nextName,
      search_text: buildResourceSearchText({
        dcn: existingResource.dcn,
        fileName,
        name: nextName,
      }),
      section_id: sectionId,
      sort_order: sortOrder,
    })
    .eq("id", resourceId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/documents?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "document_resource.assignment_update",
    entityId: resourceId,
    entityTable: "resources",
    metadata: {
      dcn: existingResource.dcn,
      name: nextName,
      section_id: sectionId,
      sort_order: sortOrder,
    },
  });

  revalidatePath("/admin/documents");
  revalidatePath("/web");
  redirect("/admin/documents?notice=Resource%20saved.");
}

export async function updateResourceCorSettings(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const resourceId = stringValue(formData, "resourceId");

  if (!resourceId) {
    redirect("/admin/documents?error=Choose%20a%20document.");
  }

  const update = {
    cor_element_key: corElementKeyFromData(formData),
    cor_element: corElementLegacyNumber(corElementKeyFromData(formData)),
    cor_tracked: boolValue(formData, "corTracked"),
    ...resourceReviewFromData(formData),
  };

  const { error } = await supabase
    .from("resources")
    .update(update)
    .eq("id", resourceId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/documents?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "document_resource.cor_settings_update",
    entityId: resourceId,
    entityTable: "resources",
    metadata: update,
  });

  revalidatePath("/admin/documents");
  revalidatePath("/admin/cor");
  redirect("/admin/documents?notice=Document%20COR%20settings%20saved.");
}

export async function markResourceReviewed(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const resourceId = stringValue(formData, "resourceId");

  if (!resourceId) {
    redirect("/admin/documents?error=Choose%20a%20document.");
  }

  const { data: resource } = await supabase
    .from("resources")
    .select("review_interval_months")
    .eq("id", resourceId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ review_interval_months: number | null }>();

  // Reset the clock: if the document has a cycle, the next review is that many
  // months out; otherwise clear the date since the review is done with no cadence.
  const nextReviewDate = resource?.review_interval_months
    ? toDateInputValue(addMonths(new Date(), resource.review_interval_months))
    : null;

  const { error } = await supabase
    .from("resources")
    .update({ review_date: nextReviewDate })
    .eq("id", resourceId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/documents?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "document_resource.marked_reviewed",
    entityId: resourceId,
    entityTable: "resources",
    metadata: { next_review_date: nextReviewDate },
  });

  revalidatePath("/admin/documents");
  redirect("/admin/documents?notice=Document%20marked%20reviewed.");
}

export async function uploadControlledDocument(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const file = getUploadFile(formData);
  let documentType = coerceDocumentType(stringValue(formData, "documentType"));
  const title = stringValue(formData, "name") || file?.name || "";
  const version = stringValue(formData, "version") || "1.0";
  const revisionNotes = stringValue(formData, "revisionNotes") || null;
  const revisionOfId = stringValue(formData, "revisionOfId") || null;
  const sectionId = stringValue(formData, "sectionId") || null;
  const sourceCode = stringValue(formData, "sourceCode");
  const documentControlEnabled = Boolean(context.tenant?.document_control_enabled);

  if (!file || !title) {
    redirect("/admin/documents?error=Choose%20a%20file%20and%20enter%20a%20document%20name.");
  }

  if (sectionId) {
    const { data: section } = await supabase
      .from("resource_sections")
      .select("id")
      .eq("id", sectionId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string }>();

    if (!section) {
      redirect("/admin/documents?error=Choose%20a%20valid%20resource%20section.");
    }
  }

  let revisionOf: DocumentControlRow | null = null;

  if (documentControlEnabled && revisionOfId) {
    const { data: existingDocument, error: revisionError } = await supabase
      .from("document_control_register")
      .select("*")
      .eq("id", revisionOfId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<DocumentControlRow>();

    if (revisionError || !existingDocument) {
      redirect(`/admin/documents?error=${encodeURIComponent(revisionError?.message ?? "Choose a valid document to revise.")}`);
    }

    revisionOf = existingDocument;
    documentType = coerceDocumentType(existingDocument.document_type);
  }

  const dcn = documentControlEnabled
    ? revisionOf?.dcn ||
      stringValue(formData, "dcn") ||
      (await nextDocumentControlNumber({
        documentType,
        revision: version,
        sourceCode: sourceCode || title,
        supabase,
        tenantId: context.appUser.tenant_id,
        tenantSlug: context.tenant?.slug ?? "tenant",
      }))
    : null;
  const peerResourceQuery = supabase
    .from("resources")
    .select("name, sort_order, updated_at")
    .eq("tenant_id", context.appUser.tenant_id);
  const { data: peerResources } = sectionId
    ? await peerResourceQuery.eq("section_id", sectionId)
    : await peerResourceQuery.is("section_id", null);
  const sortOrder = numberValue(
    formData,
    "sortOrder",
    nextResourceSortOrder(peerResources ?? []),
  );
  const storagePath = [
    context.appUser.tenant_id,
    documentType,
    `${Date.now()}-${sanitizeStorageFilename(file.name)}`,
  ].join("/");

  const { error: uploadError } = await supabase.storage.from("tenant-documents").upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    redirect(`/admin/documents?error=${encodeURIComponent(uploadError.message)}`);
  }

  const { extractDocumentOutline } = await import("@/lib/document-outline");
  const bodyText = (await extractDocumentOutline(file).catch(() => "")) || null;

  const { data: resource, error: resourceError } = await supabase
    .from("resources")
    .insert({
      body_text: bodyText,
      cor_element_key: corElementKeyFromData(formData),
    cor_element: corElementLegacyNumber(corElementKeyFromData(formData)),
      cor_tracked: boolValue(formData, "corTracked"),
      ...resourceReviewFromData(formData),
      dcn,
      mime_type: file.type || null,
      name: title,
      section_id: sectionId,
      search_text: buildResourceSearchText({
        bodyText,
        dcn,
        documentType,
        fileName: file.name,
        name: title,
        revisionNotes,
      }),
      sort_order: sortOrder,
      storage_path: storagePath,
      tenant_id: context.appUser.tenant_id,
      uploaded_by: context.appUser.id,
      version,
    })
    .select("id")
    .single<{ id: string }>();

  if (resourceError || !resource) {
    redirect(`/admin/documents?error=${encodeURIComponent(resourceError?.message ?? "Document upload was not saved.")}`);
  }

  let register: DocumentControlRow | null = null;

  if (documentControlEnabled && dcn) {
    try {
      register = await createDocumentControlEntry({
        actorRole: context.appUser.power_level,
        actorUserId: context.appUser.id,
        dcn,
        documentType,
        revisionNotes,
        revisionOfId: revisionOf?.id ?? null,
        sourceId: resource.id,
        sourceTable: "resources",
        supabase,
        tenantId: context.appUser.tenant_id,
        title,
        version,
      });
    } catch (registerError) {
      redirect(
        `/admin/documents?error=${encodeURIComponent(registerError instanceof Error ? registerError.message : "Document upload was not registered.")}`,
      );
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "document_resource.upload",
    entityId: resource.id,
    entityTable: "resources",
    metadata: {
      controlled: documentControlEnabled,
      dcn,
      document_type: documentType,
      register_id: register?.id,
      revision_of_id: revisionOf?.id ?? null,
      section_id: sectionId,
      version,
    },
  });

  revalidatePath("/admin/documents");
  revalidatePath("/web");
  redirect(
    documentControlEnabled
      ? "/admin/documents?notice=Document%20uploaded%2C%20registered%2C%20and%20sent%20for%20approval."
      : "/admin/documents?notice=Document%20uploaded.",
  );
}

export async function approveControlledDocument(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const documentId = stringValue(formData, "documentId");

  if (!documentId) {
    redirect("/admin/documents?error=Choose%20a%20document%20to%20approve.");
  }

  const { data: document, error } = await supabase
    .from("document_control_register")
    .update({
      approval_status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: context.appUser.id,
    })
    .eq("id", documentId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id, dcn, version, source_id, source_table")
    .maybeSingle<Pick<DocumentControlRow, "dcn" | "id" | "source_id" | "source_table" | "version">>();

  if (error || !document) {
    redirect(`/admin/documents?error=${encodeURIComponent(error?.message ?? "Choose a valid document to approve.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "document_control.approve",
    entityId: document.id,
    entityTable: "document_control_register",
    metadata: {
      dcn: document.dcn,
      source_id: document.source_id,
      source_table: document.source_table,
      version: document.version,
    },
  });

  revalidatePath("/admin/documents");
  revalidatePath("/web");
  redirect("/admin/documents?notice=Document%20approved.");
}

export async function requestControlledDocumentRevision(formData: FormData) {
  const context = await requireDocumentManager();
  const supabase = await createSupabaseServerClient();
  const documentId = stringValue(formData, "documentId");

  if (!documentId) {
    redirect("/admin/documents?error=Choose%20a%20document%20to%20mark%20for%20revision.");
  }

  const { data: document, error } = await supabase
    .from("document_control_register")
    .update({
      approval_status: "rejected",
      approved_at: new Date().toISOString(),
      approved_by: context.appUser.id,
    })
    .eq("id", documentId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id, dcn, version, source_id, source_table")
    .maybeSingle<Pick<DocumentControlRow, "dcn" | "id" | "source_id" | "source_table" | "version">>();

  if (error || !document) {
    redirect(`/admin/documents?error=${encodeURIComponent(error?.message ?? "Choose a valid document to mark for revision.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "document_control.revision_request",
    entityId: document.id,
    entityTable: "document_control_register",
    metadata: {
      dcn: document.dcn,
      source_id: document.source_id,
      source_table: document.source_table,
      version: document.version,
    },
  });

  revalidatePath("/admin/documents");
  revalidatePath("/web");
  redirect("/admin/documents?notice=Document%20marked%20for%20revision.");
}

function safeImportReturnPath(value: string, fallback: "/admin/documents" | "/admin/forms") {
  return value === "/admin/forms" || value === "/admin/documents" ? value : fallback;
}

function redirectImportError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function formImportErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (/DOMMatrix|pdfjs|pdf\.mjs|canvas/i.test(message)) {
    return "The PDF could not be scanned in this server runtime. Re-deploy the latest build, then retry. If the PDF is image only, paste the field labels into the Detected text box instead.";
  }

  if (/OCR language data not found/i.test(message)) {
    return "OCR language data is missing from this deployment. Ensure public/tessdata/eng.traineddata.gz is checked in and deployed, then retry.";
  }

  return message || "The uploaded form could not be scanned.";
}

export type FormImportActionState = {
  message: string;
  status: "idle" | "error";
};

class FormImportActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormImportActionError";
  }
}

function formImportActionError(error: unknown): FormImportActionState {
  return {
    message: formImportErrorMessage(error),
    status: "error",
  };
}

function importedFieldSettings(
  field: DetectedFormField | BuilderField,
  availableLists?: Map<string, string>,
): Json {
  const settings: Record<string, Json | undefined> = {};
  const options = field.options?.map((option) => option.trim()).filter(Boolean) ?? [];

  if (field.listId) {
    settings.list_id = field.listId;
    const listName = availableLists?.get(field.listId);
    if (listName) {
      settings.list_name = listName;
    }
  } else if (options.length > 0) {
    settings.options = options;
    settings.optionRows = options.map((option, index) => ({
      id: `import-option-${index + 1}`,
      label: option,
      markedAsFail: option.toLowerCase() === "fail",
      value: option,
    }));
  }

  if (field.placeholder) {
    settings.placeholder = field.placeholder;
  }

  return settings;
}

function importedFieldsJson(fields: Array<DetectedFormField | BuilderField>): Json {
  return fields.map((field, index) => ({
    fieldType: field.fieldType,
    id: "id" in field ? field.id : `import-${index + 1}`,
    label: field.label,
    options: field.options ?? [],
    placeholder: field.placeholder ?? null,
    required: Boolean(field.required),
  }));
}

async function createDraftFormFromImport(input: {
  code: string;
  context: Awaited<ReturnType<typeof requireFormManager>>;
  detectedText: string;
  fields?: Array<DetectedFormField | BuilderField>;
  importProviderLabel?: string;
  name: string;
  sourceFileName?: string | null;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}): Promise<{ formId: string; notice: string }> {
  const fields = input.fields ?? [];

  if (!input.name || !input.code || fields.length === 0) {
    throw new FormImportActionError("Enter a form name and upload a readable form or paste detected field text.");
  }

  const importSource = input.importProviderLabel ?? "OCR review";
  const description = input.sourceFileName
    ? `Imported from ${importSource} of ${input.sourceFileName}.`
    : `Imported from ${importSource}.`;

  const referencedListIds = Array.from(
    new Set(fields.map((field) => field.listId).filter((id): id is string => Boolean(id))),
  );
  const availableLists = new Map<string, string>();

  if (referencedListIds.length > 0) {
    const { data: listRows } = await input.supabase
      .from("lists")
      .select("id, name")
      .eq("tenant_id", input.context.appUser.tenant_id)
      .in("id", referencedListIds)
      .returns<{ id: string; name: string }[]>();

    for (const list of listRows ?? []) {
      availableLists.set(list.id, list.name);
    }
  }

  // Strip any list_id that doesn't belong to this tenant before we persist it.
  const safeFields = fields.map((field) =>
    field.listId && !availableLists.has(field.listId) ? { ...field, listId: null } : field,
  );

  const { data: form, error: formError } = await input.supabase
    .from("forms")
    .insert({
      allow_duplicates: true,
      app_menu_visible: false,
      code: input.code,
      created_by: input.context.appUser.id,
      description,
      import_detected_fields: importedFieldsJson(fields),
      import_detected_text: input.detectedText || null,
      is_private: true,
      name: input.name,
      status: "draft",
      tenant_id: input.context.appUser.tenant_id,
      use_item_data_in_analytics: false,
    })
    .select("id")
    .single<{ id: string }>();

  if (formError || !form) {
    throw new FormImportActionError(formError?.message ?? "Form draft was not created.");
  }

  const { data: section, error: sectionError } = await input.supabase
    .from("form_sections")
    .insert({
      form_id: form.id,
      sort_order: 0,
      tenant_id: input.context.appUser.tenant_id,
      title: "Imported Fields",
    })
    .select("id")
    .single<{ id: string }>();

  if (sectionError || !section) {
    await input.supabase.from("forms").delete().eq("id", form.id).eq("tenant_id", input.context.appUser.tenant_id);
    throw new FormImportActionError(sectionError?.message ?? "Import section was not created.");
  }

  const { error: itemError } = await input.supabase.from("form_items").insert(
    safeFields.map((field, index) => ({
      field_type: field.fieldType,
      flaggable: true,
      form_id: form.id,
      label: field.label,
      required: Boolean(field.required),
      section_id: section.id,
      settings: importedFieldSettings(field, availableLists),
      sort_order: index * 100,
      tenant_id: input.context.appUser.tenant_id,
    })),
  );

  if (itemError) {
    await input.supabase.from("forms").delete().eq("id", form.id).eq("tenant_id", input.context.appUser.tenant_id);
    throw new FormImportActionError(itemError.message);
  }

  await recordAppUserAuditEvent(input.context.appUser, {
    action: "form_template.import",
    entityId: form.id,
    entityTable: "forms",
    metadata: {
      code: input.code,
      detected_text_length: input.detectedText.length,
      field_count: fields.length,
      import_provider: importSource,
      name: input.name,
      section_id: section.id,
      source_file_name: input.sourceFileName ?? null,
      status: "draft",
    },
  });

  let documentControlNumber: string | null = null;
  let documentControlWarning = "";

  if (input.context.tenant?.document_control_enabled) {
    try {
      const dcn = await nextDocumentControlNumber({
        documentType: "form",
        revision: "1.0",
        sourceCode: input.code,
        supabase: input.supabase,
        tenantId: input.context.appUser.tenant_id,
        tenantSlug: input.context.tenant?.slug ?? "tenant",
      });

      await createDocumentControlEntry({
        actorRole: input.context.appUser.power_level,
        actorUserId: input.context.appUser.id,
        dcn,
        documentType: "form",
        revisionNotes: input.sourceFileName ? `Imported from ${input.sourceFileName} using ${importSource}.` : `Imported using ${importSource}.`,
        sourceId: form.id,
        sourceTable: "forms",
        supabase: input.supabase,
        tenantId: input.context.appUser.tenant_id,
        title: input.name,
        version: "1.0",
      });
      documentControlNumber = dcn;
    } catch (registerError) {
      documentControlWarning = ` Document control registration needs attention: ${
        registerError instanceof Error ? registerError.message : "registration failed"
      }.`;
    }
  }

  revalidatePath("/admin/forms");
  revalidatePath("/admin/documents");
  revalidatePath(`/admin/forms/${form.id}`);
  const notice = documentControlNumber
    ? `${importSource} draft created for review. DCN ${documentControlNumber} registered.`
    : `${importSource} draft created for review.${documentControlWarning}`;

  return {
    formId: form.id,
    notice,
  };
}

export async function createFormFromDetectedText(formData: FormData) {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");
  const code = resolveFormCode(stringValue(formData, "code"), name);
  const detectedText = stringValue(formData, "detectedText");
  const errorPath = safeImportReturnPath(stringValue(formData, "returnPath"), "/admin/documents");
  const fields = parseDetectedTextToFields(detectedText);

  try {
    const draft = await createDraftFormFromImport({
      code,
      context,
      detectedText,
      fields,
      importProviderLabel: "Manual detected text",
      name,
      supabase,
    });

    redirect(`/admin/forms/${draft.formId}/builder?notice=${encodeURIComponent(draft.notice)}`);
  } catch (error) {
    redirectImportError(errorPath, formImportErrorMessage(error));
  }
}

export async function createFormFromUploadedForm(
  _previousState: FormImportActionState,
  formData: FormData,
): Promise<FormImportActionState> {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const file = getUploadFile(formData, "formFile");
  const name = stringValue(formData, "name") || file?.name.replace(/\.[^.]+$/, "") || "";
  const code = resolveFormCode(stringValue(formData, "code"), name);
  const manualDetectedText = stringValue(formData, "detectedText");

  if (!file && !manualDetectedText) {
    return {
      message: "Upload a form file or paste detected field text.",
      status: "error",
    };
  }

  let extractedText = "";
  let extractedFields: Array<DetectedFormField | BuilderField> = [];
  let importProviderLabel = manualDetectedText ? "Manual detected text" : "Local OCR fallback";
  let draft: { formId: string; notice: string };

  try {
    if (file) {
      const { extractFormFieldsFromImportFile, isSupportedFormImportFile } = await import("@/lib/form-import");

      if (!isSupportedFormImportFile(file)) {
        throw new FormImportActionError("Upload a PDF, image, CSV, or text file.");
      }

      const result = await extractFormFieldsFromImportFile(file);
      extractedText = result.detectedText;
      extractedFields = result.fields;
      importProviderLabel = result.providerLabel;
    }

    const manualFields = manualDetectedText ? parseDetectedTextToFields(manualDetectedText) : [];

    draft = await createDraftFormFromImport({
      code,
      context,
      detectedText: [extractedText, manualDetectedText].filter(Boolean).join("\n"),
      fields: [...extractedFields, ...manualFields],
      importProviderLabel,
      name,
      sourceFileName: file?.name ?? null,
      supabase,
    });
  } catch (error) {
    return formImportActionError(error);
  }

  redirect(`/admin/forms/${draft.formId}/builder?notice=${encodeURIComponent(draft.notice)}`);
}

export type FormImportReviewField = {
  label: string;
  fieldType: FormFieldType;
  required: boolean;
  options: string[];
  placeholder: string;
  listId: string | null;
};

export type FormImportReviewState =
  | { status: "idle"; message: string }
  | { status: "error"; message: string }
  | {
      status: "ready";
      message: string;
      code: string;
      detectedText: string;
      fields: FormImportReviewField[];
      name: string;
      providerLabel: string;
      sourceFileName: string | null;
    };

function toReviewField(field: DetectedFormField | BuilderField): FormImportReviewField {
  return {
    fieldType: coerceFormFieldType(field.fieldType),
    label: field.label,
    listId: field.listId ?? null,
    options: (field.options ?? []).map((option) => option.trim()).filter(Boolean),
    placeholder: field.placeholder ?? "",
    required: Boolean(field.required),
  };
}

function parseReviewFieldsPayload(raw: string): FormImportReviewField[] {
  if (!raw) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FormImportActionError("Reviewed field data was not readable. Scan the form again.");
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const seenLabels = new Set<string>();
  const fields: FormImportReviewField[] = [];

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";

    if (!label) {
      continue;
    }

    const dedupeKey = label.toLowerCase();

    if (seenLabels.has(dedupeKey)) {
      continue;
    }

    seenLabels.add(dedupeKey);

    const rawOptions = Array.isArray(candidate.options) ? candidate.options : [];

    fields.push({
      fieldType: coerceFormFieldType(typeof candidate.fieldType === "string" ? candidate.fieldType : "short_text"),
      label,
      listId: typeof candidate.listId === "string" && candidate.listId.length > 0 ? candidate.listId : null,
      options: rawOptions
        .map((option) => (typeof option === "string" ? option.trim() : ""))
        .filter((option): option is string => option.length > 0),
      placeholder: typeof candidate.placeholder === "string" ? candidate.placeholder : "",
      required: Boolean(candidate.required),
    });
  }

  return fields;
}

export async function scanUploadedFormForReview(
  _previousState: FormImportReviewState,
  formData: FormData,
): Promise<FormImportReviewState> {
  await requireFormManager();
  const file = getUploadFile(formData, "formFile");
  const requestedName = stringValue(formData, "name");
  const requestedCode = stringValue(formData, "code");
  const manualDetectedText = stringValue(formData, "detectedText");

  if (!file && !manualDetectedText) {
    return {
      message: "Upload a form file or paste detected field text to scan.",
      status: "error",
    };
  }

  let extractedText = "";
  let extractedFields: Array<DetectedFormField | BuilderField> = [];
  let providerLabel = manualDetectedText ? "Manual detected text" : "Local OCR fallback";

  try {
    if (file) {
      const { extractFormFieldsFromImportFile, isSupportedFormImportFile } = await import("@/lib/form-import");

      if (!isSupportedFormImportFile(file)) {
        throw new FormImportActionError("Upload a PDF, image, CSV, or text file.");
      }

      const result = await extractFormFieldsFromImportFile(file);
      extractedText = result.detectedText;
      extractedFields = result.fields;
      providerLabel = result.providerLabel;
    }

    const manualFields = manualDetectedText ? parseDetectedTextToFields(manualDetectedText) : [];
    const combinedFields = [...extractedFields, ...manualFields].map(toReviewField);

    if (combinedFields.length === 0) {
      return {
        message: "No fields were detected. Try a clearer scan or paste detected field text.",
        status: "error",
      };
    }

    const name = requestedName || file?.name.replace(/\.[^.]+$/, "") || "";
    const code = resolveFormCode(requestedCode, name);
    const detectedText = [extractedText, manualDetectedText].filter(Boolean).join("\n");

    return {
      code,
      detectedText,
      fields: combinedFields,
      message: `${providerLabel} found ${combinedFields.length} field${combinedFields.length === 1 ? "" : "s"}. Review before saving.`,
      name,
      providerLabel,
      sourceFileName: file?.name ?? null,
      status: "ready",
    };
  } catch (error) {
    return {
      message: formImportErrorMessage(error),
      status: "error",
    };
  }
}

export async function createFormFromReviewedFields(
  _previousState: FormImportActionState,
  formData: FormData,
): Promise<FormImportActionState> {
  const context = await requireFormManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");
  const code = resolveFormCode(stringValue(formData, "code"), name);
  const detectedText = stringValue(formData, "detectedText");
  const providerLabel = stringValue(formData, "providerLabel") || "OCR review";
  const sourceFileNameValue = stringValue(formData, "sourceFileName");
  const sourceFileName = sourceFileNameValue ? sourceFileNameValue : null;
  const fieldsPayload = stringValue(formData, "fields");
  let draft: { formId: string; notice: string };

  try {
    const fields = parseReviewFieldsPayload(fieldsPayload);

    if (fields.length === 0) {
      throw new FormImportActionError("Add at least one field before saving the form.");
    }

    if (!name) {
      throw new FormImportActionError("Enter a form name.");
    }

    draft = await createDraftFormFromImport({
      code,
      context,
      detectedText,
      fields,
      importProviderLabel: providerLabel,
      name,
      sourceFileName,
      supabase,
    });
  } catch (error) {
    return formImportActionError(error);
  }

  redirect(`/admin/forms/${draft.formId}/builder?notice=${encodeURIComponent(draft.notice)}`);
}

export async function updateUserAccess(formData: FormData) {
  const context = await requireAccessManager();
  const supabase = await createSupabaseServerClient();
  const userId = stringValue(formData, "userId");
  const permissionProfileId = stringValue(formData, "permissionProfileId") || null;
  const appAccess = stringValue(formData, "appAccess") as AppAccessLevel;
  const powerLevel = stringValue(formData, "powerLevel") as PowerLevel;
  const reachType = stringValue(formData, "reachType") as ReachType;
  const offlineSyncDays = Number(stringValue(formData, "offlineSyncDays"));

  if (
    !userId ||
    !appAccessValues.has(appAccess) ||
    !powerLevelValues.has(powerLevel) ||
    !reachValues.has(reachType) ||
    !syncDayValues.has(offlineSyncDays)
  ) {
    redirect("/admin/access?error=Invalid%20access%20settings.");
  }

  const { data: targetUser } = await supabase
    .from("users")
    .select("id, power_level")
    .eq("id", userId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string; power_level: PowerLevel }>();

  if (!targetUser || !canManagePowerLevel(context.appUser.power_level, targetUser.power_level)) {
    redirect("/admin/access?error=You%20cannot%20change%20that%20user.");
  }

  if (!canManagePowerLevel(context.appUser.power_level, powerLevel)) {
    redirect("/admin/access?error=You%20cannot%20assign%20that%20power%20level.");
  }

  const { error } = await supabase
    .from("users")
    .update({
      app_access: appAccess,
      offline_sync_days: offlineSyncDays,
      permission_profile_id: permissionProfileId,
      power_level: powerLevel,
      reach_type: reachType,
    })
    .eq("id", userId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/access?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "user.access_update",
    entityId: userId,
    entityTable: "users",
    metadata: {
      app_access: appAccess,
      offline_sync_days: offlineSyncDays,
      permission_profile_id: permissionProfileId,
      power_level: powerLevel,
      reach_type: reachType,
    },
  });

  revalidatePath("/admin/access");
  redirect("/admin/access?notice=Access%20settings%20saved.");
}

export async function createPermissionProfile(formData: FormData) {
  const context = await requireAccessManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");
  const powerCeiling = stringValue(formData, "powerCeiling") as PowerLevel;

  if (!name || !powerLevelValues.has(powerCeiling) || powerCeiling === "consultant") {
    redirect("/admin/permission-profiles?error=Enter%20a%20valid%20profile.");
  }

  const capabilities = {
    assigned_forms: formData.has("assignedForms"),
    forms: formData.has("forms"),
    follow_ups: formData.has("followUps"),
    locations: formData.has("locations"),
    medical_vault_access: formData.has("medicalVaultAccess"),
    settings: formData.has("settings"),
    team_forms: formData.has("teamForms"),
    workers: formData.has("workers"),
  };

  const { data: permissionProfile, error } = await supabase
    .from("permission_profiles")
    .insert({
      capabilities,
      is_default: false,
      name,
      power_ceiling: powerCeiling,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !permissionProfile) {
    redirect(`/admin/permission-profiles?error=${encodeURIComponent(error?.message ?? "Permission profile was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "permission_profile.create",
    entityId: permissionProfile.id,
    entityTable: "permission_profiles",
    metadata: {
      capabilities,
      name,
      power_ceiling: powerCeiling,
    },
  });

  revalidatePath("/admin/permission-profiles");
  redirect("/admin/permission-profiles?notice=Permission%20profile%20created.");
}

export async function updateFollowUp(formData: FormData) {
  const context = await requireFollowUpManager();
  const supabase = await createSupabaseServerClient();
  const followUpId = stringValue(formData, "followUpId");
  const assignedTo = stringValue(formData, "assignedTo") || null;
  const dueAt = dateInputValue(formData, "dueAt");
  const status = coerceFollowUpStatus(stringValue(formData, "status"));
  const returnStatus = stringValue(formData, "returnStatus") || "open";

  if (!followUpId) {
    redirect("/admin/follow-ups?error=Choose%20a%20corrective%20action%20to%20update.");
  }

  if (assignedTo) {
    const { data: assignedUser } = await supabase
      .from("users")
      .select("id")
      .eq("id", assignedTo)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string }>();

    if (!assignedUser) {
      redirect("/admin/follow-ups?error=Choose%20a%20valid%20assignee.");
    }
  }

  const now = new Date().toISOString();
  const isCompleted = status === "completed" || status === "signed_off";
  const { data: followUp, error } = await supabase
    .from("follow_ups")
    .update({
      assigned_to: assignedTo,
      completed_at: isCompleted ? now : null,
      due_at: dueAt,
      signoff_at: status === "signed_off" ? now : null,
      signoff_by: status === "signed_off" ? context.appUser.id : null,
      status,
      updated_at: now,
    })
    .eq("id", followUpId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id, parent_submission_id, title")
    .maybeSingle<FollowUpAuditRow>();

  if (error || !followUp) {
    redirect(`/admin/follow-ups?error=${encodeURIComponent(error?.message ?? "Choose a valid corrective action.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "follow_up.update",
    entityId: followUp.id,
    entityTable: "follow_ups",
    metadata: {
      assigned_to: assignedTo,
      completed_at: isCompleted ? now : null,
      due_at: dueAt,
      parent_submission_id: followUp.parent_submission_id,
      signoff_at: status === "signed_off" ? now : null,
      signoff_by: status === "signed_off" ? context.appUser.id : null,
      status,
      title: followUp.title,
    },
  });

  revalidatePath("/admin/follow-ups");
  revalidatePath("/admin/monitor");
  redirect(`/admin/follow-ups?status=${encodeURIComponent(returnStatus)}&notice=Corrective%20action%20updated.`);
}

export async function createWorkflow(formData: FormData) {
  const context = await requireWorkflowManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");

  if (!name) {
    redirect("/admin/workflows?error=Enter%20a%20workflow%20name.");
  }

  const enabled = boolValue(formData, "enabled");
  const { data: workflow, error } = await supabase
    .from("workflows")
    .insert({
      enabled,
      name,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !workflow) {
    redirect(`/admin/workflows?error=${encodeURIComponent(error?.message ?? "Workflow was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "workflow.create",
    entityId: workflow.id,
    entityTable: "workflows",
    metadata: {
      enabled,
      name,
    },
  });

  revalidatePath("/admin/workflows");
  redirect("/admin/workflows?notice=Workflow%20created.");
}

export async function updateWorkflowEnabled(formData: FormData) {
  const context = await requireWorkflowManager();
  const supabase = await createSupabaseServerClient();
  const workflowId = stringValue(formData, "workflowId");
  const enabled = stringValue(formData, "enabled") === "true";

  if (!workflowId) {
    redirect("/admin/workflows?error=Choose%20a%20workflow%20to%20update.");
  }

  const { data: workflow, error } = await supabase
    .from("workflows")
    .update({ enabled })
    .eq("id", workflowId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id, name")
    .maybeSingle<{ id: string; name: string }>();

  if (error || !workflow) {
    redirect(`/admin/workflows?error=${encodeURIComponent(error?.message ?? "Choose a valid workflow to update.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "workflow.enabled_update",
    entityId: workflow.id,
    entityTable: "workflows",
    metadata: {
      enabled,
      name: workflow.name,
    },
  });

  revalidatePath("/admin/workflows");
  redirect(`/admin/workflows?notice=Workflow%20${enabled ? "enabled" : "paused"}.`);
}

export async function createWorkflowStep(formData: FormData) {
  const context = await requireWorkflowManager();
  const supabase = await createSupabaseServerClient();
  const workflowId = stringValue(formData, "workflowId");
  const formId = stringValue(formData, "formId") || null;
  const assigneeType = coerceWorkflowAssigneeType(stringValue(formData, "assigneeType"));
  const assigneeUserId = stringValue(formData, "assigneeUserId") || null;

  if (!workflowId || !formId) {
    redirect("/admin/workflows?error=Choose%20a%20workflow%20and%20form%20before%20adding%20a%20step.");
  }

  const [{ data: workflow }, { data: form }, { count }] = await Promise.all([
    supabase
      .from("workflows")
      .select("id, name")
      .eq("id", workflowId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string; name: string }>(),
    supabase
      .from("forms")
      .select("id")
      .eq("id", formId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string }>(),
    supabase
      .from("workflow_steps")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("workflow_id", workflowId),
  ]);

  if (!workflow || !form) {
    redirect("/admin/workflows?error=Choose%20a%20valid%20workflow%20and%20form.");
  }

  const sortOrder = (count ?? 0) * 100 + 100;

  if (assigneeUserId) {
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("id", assigneeUserId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string }>();

    if (!user) {
      redirect("/admin/workflows?error=Choose%20a%20valid%20assignee.");
    }
  }

  const { data: step, error } = await supabase
    .from("workflow_steps")
    .insert({
      assignee_type: assigneeType,
      assignee_user_id: assigneeUserId,
      form_id: formId,
      sort_order: sortOrder,
      tenant_id: context.appUser.tenant_id,
      workflow_id: workflowId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !step) {
    redirect(`/admin/workflows?error=${encodeURIComponent(error?.message ?? "Workflow step was not added.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "workflow.step.create",
    entityId: step.id,
    entityTable: "workflow_steps",
    metadata: {
      assignee_type: assigneeType,
      assignee_user_id: assigneeUserId,
      form_id: formId,
      sort_order: sortOrder,
      workflow_id: workflowId,
      workflow_name: workflow.name,
    },
  });

  revalidatePath("/admin/workflows");
  redirect("/admin/workflows?notice=Workflow%20step%20added.");
}

export async function createWorkflowCondition(formData: FormData) {
  const context = await requireWorkflowManager();
  const supabase = await createSupabaseServerClient();
  const workflowStepId = stringValue(formData, "workflowStepId");
  const sourceFormId = stringValue(formData, "sourceFormId") || null;
  const sourceItemId = stringValue(formData, "sourceItemId") || null;
  const nextStepId = stringValue(formData, "nextStepId") || null;
  const comparator = coerceWorkflowComparator(stringValue(formData, "comparator"));
  const expectedValue = parseWorkflowExpectedValue(stringValue(formData, "expectedValue"));

  if (!workflowStepId || !sourceFormId || !sourceItemId) {
    redirect("/admin/workflows?error=Choose%20a%20completed%20step,%20source%20form,%20and%20field.");
  }

  const { data: step } = await supabase
    .from("workflow_steps")
    .select("id, workflow_id")
    .eq("id", workflowStepId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string; workflow_id: string }>();

  if (!step) {
    redirect("/admin/workflows?error=Choose%20a%20valid%20workflow%20step.");
  }

  const [{ data: form }, { data: item }] = await Promise.all([
    supabase
      .from("forms")
      .select("id")
      .eq("id", sourceFormId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string }>(),
    supabase
      .from("form_items")
      .select("id, form_id")
      .eq("id", sourceItemId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string; form_id: string }>(),
  ]);

  if (!form || !item || item.form_id !== sourceFormId) {
    redirect("/admin/workflows?error=Choose%20a%20valid%20source%20field.");
  }

  if (nextStepId) {
    const { data: nextStep } = await supabase
      .from("workflow_steps")
      .select("id")
      .eq("id", nextStepId)
      .eq("workflow_id", step.workflow_id)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string }>();

    if (!nextStep) {
      redirect("/admin/workflows?error=Choose%20a%20valid%20next%20step.");
    }
  }

  const { data: condition, error } = await supabase
    .from("workflow_conditions")
    .insert({
      comparator,
      expected_value: expectedValue,
      next_step_id: nextStepId,
      source_form_id: sourceFormId,
      source_item_id: sourceItemId,
      tenant_id: context.appUser.tenant_id,
      workflow_step_id: workflowStepId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !condition) {
    redirect(`/admin/workflows?error=${encodeURIComponent(error?.message ?? "Workflow condition was not added.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "workflow.condition.create",
    entityId: condition.id,
    entityTable: "workflow_conditions",
    metadata: {
      comparator,
      expected_value: expectedValue,
      next_step_id: nextStepId,
      source_form_id: sourceFormId,
      source_item_id: sourceItemId,
      workflow_id: step.workflow_id,
      workflow_step_id: workflowStepId,
    },
  });

  revalidatePath("/admin/workflows");
  redirect("/admin/workflows?notice=Workflow%20condition%20added.");
}

export async function createSchedule(formData: FormData) {
  const context = await requireWorkflowManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");
  const formId = stringValue(formData, "formId") || null;
  const locationId = stringValue(formData, "locationId") || null;
  const assigneeId = stringValue(formData, "assigneeId") || null;
  const recurrenceRule = coerceRecurrenceRule(stringValue(formData, "recurrenceRule"));
  const dueAt = dateTimeInputValue(formData, "dueAt");

  if (!name || !formId || !assigneeId || !dueAt) {
    redirect("/admin/workflows?error=Enter%20a%20schedule%20name,%20form,%20assignee,%20and%20first%20due%20date.");
  }

  const [{ data: form }, { data: user }, { data: location }] = await Promise.all([
    supabase
      .from("forms")
      .select("id, name")
      .eq("id", formId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string; name: string }>(),
    supabase
      .from("users")
      .select("id")
      .eq("id", assigneeId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string }>(),
    locationId
      ? supabase
          .from("locations")
          .select("id")
          .eq("id", locationId)
          .eq("tenant_id", context.appUser.tenant_id)
          .maybeSingle<{ id: string }>()
      : Promise.resolve({ data: null }),
  ]);

  if (!form || !user || (locationId && !location)) {
    redirect("/admin/workflows?error=Choose%20valid%20schedule%20records.");
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from("schedules")
    .insert({
      active: true,
      assignee_id: assigneeId,
      form_id: formId,
      location_id: locationId,
      name,
      next_due_at: dueAt,
      recurrence_rule: recurrenceRule,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (scheduleError || !schedule) {
    redirect(`/admin/workflows?error=${encodeURIComponent(scheduleError?.message ?? "Schedule was not created.")}`);
  }

  const { data: task, error: taskError } = await supabase
    .from("scheduled_tasks")
    .insert({
      assigned_to: assigneeId,
      due_at: dueAt,
      schedule_id: schedule.id,
      status: "due",
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (taskError || !task) {
    redirect(`/admin/workflows?error=${encodeURIComponent(taskError?.message ?? "First scheduled task was not created.")}`);
  }

  const notificationCreatedAt = new Date().toISOString();
  const { data: notification, error: notificationError } = await supabase
    .from("notifications")
    .insert({
      body: `${form.name} is due from ${name}.`,
      channel: "in_app",
      created_at: notificationCreatedAt,
      delivered_at: notificationCreatedAt,
      delivery_status: "delivered",
      recipient_type: "schedule_assignee",
      title: `Scheduled task: ${name}`,
      tenant_id: context.appUser.tenant_id,
      user_id: assigneeId,
    })
    .select("body, created_at, delivery_status, id, recipient_name, recipient_type, submission_id, title, user_id")
    .single<ReminderNotificationAuditRow>();

  if (!notificationError && notification) {
    await recordAppUserAuditEvent(context.appUser, {
      action: "workflow.scheduled_task.notification.sent",
      entityId: notification.id,
      entityTable: "notifications",
      metadata: {
        body: notification.body,
        created_at: notification.created_at,
        delivery_status: notification.delivery_status,
        due_at: dueAt,
        form_id: formId,
        recipient_name: notification.recipient_name,
        recipient_type: notification.recipient_type,
        schedule_id: schedule.id,
        source: "schedule_create",
        task_id: task.id,
        title: notification.title,
        user_id: notification.user_id,
      },
    });
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "workflow.schedule.create",
    entityId: schedule.id,
    entityTable: "schedules",
    metadata: {
      assignee_id: assigneeId,
      first_task_id: task.id,
      form_id: formId,
      location_id: locationId,
      name,
      next_due_at: dueAt,
      recurrence_rule: recurrenceRule,
    },
  });

  revalidatePath("/admin/workflows");
  revalidatePath("/web");
  redirect("/admin/workflows?notice=Schedule%20created%20and%20first%20task%20assigned.");
}

export async function updateScheduledTaskStatus(formData: FormData) {
  const context = await requireWorkflowManager();
  const supabase = await createSupabaseServerClient();
  const taskId = stringValue(formData, "taskId");
  const status = stringValue(formData, "status") === "done" ? "done" : "due";

  if (!taskId) {
    redirect("/admin/workflows?error=Choose%20a%20scheduled%20task%20to%20update.");
  }

  const { data: task } = await supabase
    .from("scheduled_tasks")
    .select("id, schedule_id, assigned_to, due_at")
    .eq("id", taskId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ assigned_to: string | null; due_at: string; id: string; schedule_id: string }>();

  if (!task) {
    redirect("/admin/workflows?error=Choose%20a%20valid%20scheduled%20task.");
  }

  const { error } = await supabase
    .from("scheduled_tasks")
    .update({ status })
    .eq("id", taskId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/workflows?error=${encodeURIComponent(error.message)}`);
  }

  let nextTaskId: string | null = null;
  let nextDueAt: string | null = null;

  if (status === "done") {
    const { data: schedule } = await supabase
      .from("schedules")
      .select("id, name, recurrence_rule, active, assignee_id")
      .eq("id", task.schedule_id)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ active: boolean; assignee_id: string | null; id: string; name: string; recurrence_rule: string }>();

    if (schedule?.active) {
      nextDueAt = computeNextDueAt(task.due_at, schedule.recurrence_rule);
      const nextAssignee = schedule.assignee_id ?? task.assigned_to;

      const { data: nextTask, error: nextTaskError } = await supabase
        .from("scheduled_tasks")
        .insert({
          assigned_to: nextAssignee,
          due_at: nextDueAt,
          schedule_id: schedule.id,
          status: "due",
          tenant_id: context.appUser.tenant_id,
        })
        .select("id")
        .single<{ id: string }>();

      if (nextTaskError || !nextTask) {
        redirect(`/admin/workflows?error=${encodeURIComponent(nextTaskError?.message ?? "Next scheduled task was not created.")}`);
      }

      nextTaskId = nextTask.id;

      await supabase
        .from("schedules")
        .update({ next_due_at: nextDueAt })
        .eq("id", schedule.id)
        .eq("tenant_id", context.appUser.tenant_id);

      if (nextAssignee) {
        const recurrenceNotificationCreatedAt = new Date().toISOString();
        const { data: notification, error: notificationError } = await supabase
          .from("notifications")
          .insert({
            body: `${schedule.name} is due again on ${new Date(nextDueAt).toLocaleDateString("en")}.`,
            channel: "in_app",
            created_at: recurrenceNotificationCreatedAt,
            delivered_at: recurrenceNotificationCreatedAt,
            delivery_status: "delivered",
            recipient_type: "schedule_assignee",
            title: `Scheduled task: ${schedule.name}`,
            tenant_id: context.appUser.tenant_id,
            user_id: nextAssignee,
          })
          .select("body, created_at, delivery_status, id, recipient_name, recipient_type, submission_id, title, user_id")
          .single<ReminderNotificationAuditRow>();

        if (!notificationError && notification) {
          await recordAppUserAuditEvent(context.appUser, {
            action: "workflow.scheduled_task.notification.sent",
            entityId: notification.id,
            entityTable: "notifications",
            metadata: {
              body: notification.body,
              created_at: notification.created_at,
              delivery_status: notification.delivery_status,
              due_at: nextDueAt,
              recipient_name: notification.recipient_name,
              recipient_type: notification.recipient_type,
              schedule_id: schedule.id,
              source: "recurrence",
              task_id: nextTask.id,
              title: notification.title,
              user_id: notification.user_id,
            },
          });
        }
      }
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "workflow.scheduled_task.status_update",
    entityId: task.id,
    entityTable: "scheduled_tasks",
    metadata: {
      next_due_at: nextDueAt,
      next_task_id: nextTaskId,
      schedule_id: task.schedule_id,
      status,
    },
  });

  revalidatePath("/admin/workflows");
  revalidatePath("/web");
  redirect("/admin/workflows?notice=Scheduled%20task%20updated.");
}

export async function sendOverdueWorkReminders() {
  const context = await requireWorkflowManager();
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [{ data: scheduledTasks }, { data: followUps }, { data: workflowRunSteps }] = await Promise.all([
    supabase
      .from("scheduled_tasks")
      .select("id, schedule_id, assigned_to, due_at, status")
      .eq("tenant_id", context.appUser.tenant_id)
      .lt("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(200)
      .returns<OverdueScheduledTaskRow[]>(),
    supabase
      .from("follow_ups")
      .select("id, title, assigned_to, due_at, status, parent_submission_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .lt("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(200)
      .returns<OverdueFollowUpRow[]>(),
    supabase
      .from("workflow_run_steps")
      .select("id, workflow_run_id, workflow_step_id, assigned_to, due_at, status, completed_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .lt("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(200)
      .returns<OverdueWorkflowRunStepRow[]>(),
  ]);

  const overdueTasks = (scheduledTasks ?? []).filter(
    (task) => task.assigned_to && task.status !== "done" && task.status !== "completed",
  );
  const overdueFollowUps = (followUps ?? []).filter(
    (followUp) => followUp.assigned_to && followUp.due_at && !isClosedFollowUpStatus(followUp.status),
  );
  const overdueWorkflowRunSteps = (workflowRunSteps ?? []).filter(
    (step) => step.assigned_to && step.due_at && !isCompletedWorkflowRunStep(step),
  );
  const scheduleIds = Array.from(new Set(overdueTasks.map((task) => task.schedule_id)));
  const workflowStepIds = Array.from(new Set(overdueWorkflowRunSteps.map((step) => step.workflow_step_id)));
  const workflowRunIds = Array.from(new Set(overdueWorkflowRunSteps.map((step) => step.workflow_run_id)));
  const userIds = Array.from(
    new Set([
      ...overdueTasks.map((task) => task.assigned_to).filter((userId): userId is string => Boolean(userId)),
      ...overdueFollowUps.map((followUp) => followUp.assigned_to).filter((userId): userId is string => Boolean(userId)),
      ...overdueWorkflowRunSteps.map((step) => step.assigned_to).filter((userId): userId is string => Boolean(userId)),
    ]),
  );

  if (userIds.length === 0) {
    redirect("/admin/workflows?notice=No%20overdue%20assigned%20work%20needs%20a%20reminder.");
  }

  const [{ data: schedules }, { data: workflowSteps }, { data: workflowRuns }, { data: users }] = await Promise.all([
    scheduleIds.length > 0
      ? supabase
          .from("schedules")
          .select("id, name, form_id, location_id")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", scheduleIds)
          .returns<ReminderScheduleRow[]>()
      : Promise.resolve({
          data: [] as ReminderScheduleRow[],
        }),
    workflowStepIds.length > 0
      ? supabase
          .from("workflow_steps")
          .select("id, workflow_id, form_id")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", workflowStepIds)
          .returns<ReminderWorkflowStepRow[]>()
      : Promise.resolve({ data: [] as ReminderWorkflowStepRow[] }),
    workflowRunIds.length > 0
      ? supabase
          .from("workflow_runs")
          .select("id, workflow_id, location_id, status, completed_at")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", workflowRunIds)
          .returns<ReminderWorkflowRunRow[]>()
      : Promise.resolve({ data: [] as ReminderWorkflowRunRow[] }),
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("id", userIds)
      .returns<ReminderUserRow[]>(),
  ]);

  const scheduleRows = schedules ?? [];
  const workflowStepRows = workflowSteps ?? [];
  const workflowRunRows = workflowRuns ?? [];
  const workflowIds = Array.from(
    new Set([
      ...workflowStepRows.map((step) => step.workflow_id),
      ...workflowRunRows.map((run) => run.workflow_id),
    ]),
  );
  const formIds = Array.from(
    new Set([
      ...scheduleRows.map((schedule) => schedule.form_id).filter((id): id is string => Boolean(id)),
      ...workflowStepRows.map((step) => step.form_id).filter((id): id is string => Boolean(id)),
    ]),
  );
  const locationIds = Array.from(
    new Set([
      ...scheduleRows.map((schedule) => schedule.location_id).filter((id): id is string => Boolean(id)),
      ...workflowRunRows.map((run) => run.location_id).filter((id): id is string => Boolean(id)),
    ]),
  );
  const [{ data: forms }, { data: locations }, { data: workflows }] = await Promise.all([
    formIds.length > 0
      ? supabase
          .from("forms")
          .select("id, name, code")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", formIds)
          .returns<ReminderFormRow[]>()
      : Promise.resolve({ data: [] as ReminderFormRow[] }),
    locationIds.length > 0
      ? supabase
          .from("locations")
          .select("id, name")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", locationIds)
          .returns<ReminderLocationRow[]>()
      : Promise.resolve({ data: [] as ReminderLocationRow[] }),
    workflowIds.length > 0
      ? supabase
          .from("workflows")
          .select("id, name")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", workflowIds)
          .returns<ReminderWorkflowRow[]>()
      : Promise.resolve({ data: [] as ReminderWorkflowRow[] }),
  ]);

  const scheduleById = new Map(scheduleRows.map((schedule) => [schedule.id, schedule]));
  const workflowStepById = new Map(workflowStepRows.map((step) => [step.id, step]));
  const workflowRunById = new Map(workflowRunRows.map((run) => [run.id, run]));
  const workflowById = new Map((workflows ?? []).map((workflow) => [workflow.id, workflow]));
  const formById = new Map((forms ?? []).map((form) => [form.id, form]));
  const locationById = new Map((locations ?? []).map((location) => [location.id, location]));
  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const notificationPayloads: ReminderNotificationInsert[] = [];

  for (const task of overdueTasks) {
    const assignee = task.assigned_to ? userById.get(task.assigned_to) : null;
    const schedule = scheduleById.get(task.schedule_id);
    const form = schedule?.form_id ? formById.get(schedule.form_id) : null;
    const location = schedule?.location_id ? locationById.get(schedule.location_id) : null;

    if (!assignee) {
      continue;
    }

    notificationPayloads.push({
      body: `${schedule?.name ?? "Scheduled task"} was due ${new Date(task.due_at).toLocaleDateString("en")}${
        form ? ` for ${form.name}` : ""
      }${location ? ` at ${location.name}` : ""}.`,
      channel: "in_app",
      created_at: nowIso,
      delivered_at: nowIso,
      delivery_status: "delivered",
      recipient_contact: assignee.email,
      recipient_name: assignee.full_name,
      recipient_type: "workflow_assignee",
      tenant_id: context.appUser.tenant_id,
      title: `Overdue scheduled task: ${schedule?.name ?? "Scheduled task"}`,
      user_id: assignee.id,
    });
  }

  for (const followUp of overdueFollowUps) {
    const assignee = followUp.assigned_to ? userById.get(followUp.assigned_to) : null;

    if (!assignee || !followUp.due_at) {
      continue;
    }

    notificationPayloads.push({
      body: `${followUp.title} was due ${new Date(followUp.due_at).toLocaleDateString("en")}.`,
      channel: "in_app",
      created_at: nowIso,
      delivered_at: nowIso,
      delivery_status: "delivered",
      recipient_contact: assignee.email,
      recipient_name: assignee.full_name,
      recipient_type: "follow_up_assignee",
      submission_id: followUp.parent_submission_id,
      tenant_id: context.appUser.tenant_id,
      title: `Overdue corrective action: ${followUp.title}`,
      user_id: assignee.id,
    });
  }

  for (const runStep of overdueWorkflowRunSteps) {
    const assignee = runStep.assigned_to ? userById.get(runStep.assigned_to) : null;
    const step = workflowStepById.get(runStep.workflow_step_id);
    const run = workflowRunById.get(runStep.workflow_run_id);
    const workflow = (run ? workflowById.get(run.workflow_id) : null) ?? (step ? workflowById.get(step.workflow_id) : null);
    const form = step?.form_id ? formById.get(step.form_id) : null;
    const location = run?.location_id ? locationById.get(run.location_id) : null;

    if (!assignee || !runStep.due_at || (run && isCompletedWorkflowRunStep(run))) {
      continue;
    }

    notificationPayloads.push(
      createOverdueWorkflowStepReminderNotification({
        assigneeEmail: assignee.email,
        assigneeName: assignee.full_name,
        createdAt: nowIso,
        dueAt: runStep.due_at,
        formName: form?.name ?? null,
        locationName: location?.name ?? null,
        tenantId: context.appUser.tenant_id,
        userId: assignee.id,
        workflowName: workflow?.name ?? "Workflow",
      }),
    );
  }

  if (notificationPayloads.length === 0) {
    redirect("/admin/workflows?notice=No%20overdue%20assigned%20work%20needs%20a%20reminder.");
  }

  const titles = Array.from(new Set(notificationPayloads.map((notification) => notification.title ?? ""))).filter(Boolean);
  const { data: existingNotifications } =
    titles.length > 0
      ? await supabase
          .from("notifications")
          .select("body, title, user_id")
          .eq("tenant_id", context.appUser.tenant_id)
          .gte("created_at", todayStart.toISOString())
          .in("title", titles)
          .returns<Pick<Database["public"]["Tables"]["notifications"]["Row"], "body" | "title" | "user_id">[]>()
      : { data: [] as Pick<Database["public"]["Tables"]["notifications"]["Row"], "body" | "title" | "user_id">[] };
  const existingKeys = new Set(
    (existingNotifications ?? []).map((notification) => `${notification.user_id ?? ""}|${notification.title}|${notification.body}`),
  );
  const newNotifications = notificationPayloads.filter(
    (notification) => !existingKeys.has(`${notification.user_id ?? ""}|${notification.title}|${notification.body}`),
  );

  if (newNotifications.length === 0) {
    redirect("/admin/workflows?notice=Overdue%20reminders%20were%20already%20sent%20today.");
  }

  const { data: insertedNotifications, error } = await supabase
    .from("notifications")
    .insert(newNotifications)
    .select("body, created_at, delivery_status, id, recipient_name, recipient_type, submission_id, title, user_id")
    .returns<ReminderNotificationAuditRow[]>();

  if (error) {
    redirect(`/admin/workflows?error=${encodeURIComponent(error.message)}`);
  }

  for (const notification of insertedNotifications ?? []) {
    await recordAppUserAuditEvent(context.appUser, {
      action: "workflow.overdue_reminder.notification.sent",
      entityId: notification.id,
      entityTable: "notifications",
      metadata: {
        created_at: notification.created_at,
        delivery_status: notification.delivery_status,
        recipient_name: notification.recipient_name,
        recipient_type: notification.recipient_type,
        source: "admin_overdue_reminders",
        submission_id: notification.submission_id,
        title: notification.title,
        user_id: notification.user_id,
      },
    });
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "workflow.overdue_reminders.send",
    entityTable: "notifications",
    metadata: {
      follow_up_count: overdueFollowUps.length,
      notification_count: newNotifications.length,
      scheduled_task_count: overdueTasks.length,
      workflow_run_step_count: overdueWorkflowRunSteps.length,
    },
  });

  revalidatePath("/admin/workflows");
  revalidatePath("/admin/follow-ups");
  revalidatePath("/web");
  redirect(`/admin/workflows?notice=${encodeURIComponent(`Sent ${newNotifications.length} overdue reminder(s).`)}`);
}

export async function createAutoShareRecipient(formData: FormData) {
  const context = await requireAutoShareManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");
  const recipientType = coerceAutoShareRecipientType(stringValue(formData, "recipientType"));
  const email = stringValue(formData, "email") || null;
  const phone = stringValue(formData, "phone") || null;
  const locationId = stringValue(formData, "locationId") || null;

  if (!name) {
    redirect("/admin/auto-share?error=Enter%20a%20recipient%20name.");
  }

  const contactError = autoShareRecipientContactError({ email, phone });

  if (contactError) {
    redirect(`/admin/auto-share?error=${encodeURIComponent(contactError)}`);
  }

  if (locationId) {
    const { data: location } = await supabase
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string }>();

    if (!location) {
      redirect("/admin/auto-share?error=Choose%20a%20valid%20location.");
    }
  }

  const { data: recipient, error } = await supabase
    .from("auto_share_recipients")
    .insert({
      active: true,
      email,
      location_id: locationId,
      name,
      phone,
      recipient_type: recipientType,
      tenant_id: context.appUser.tenant_id,
    })
    .select("active, email, id, location_id, name, phone, recipient_type")
    .single<AutoShareRecipientAuditRow>();

  if (error || !recipient) {
    redirect(`/admin/auto-share?error=${encodeURIComponent(error?.message ?? "Auto-share recipient was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "auto_share.recipient.create",
    entityId: recipient.id,
    entityTable: "auto_share_recipients",
    metadata: {
      channel: email ? "email" : phone ? "sms" : "in_app",
      email: recipient.email,
      location_id: recipient.location_id,
      name: recipient.name,
      phone: recipient.phone,
      recipient_type: recipient.recipient_type,
    },
  });

  revalidatePath("/admin/auto-share");
  redirect("/admin/auto-share?notice=Auto-share%20recipient%20added.");
}

export async function setAutoShareRecipientActive(formData: FormData) {
  const context = await requireAutoShareManager();
  const supabase = await createSupabaseServerClient();
  const recipientId = stringValue(formData, "recipientId");
  const active = stringValue(formData, "active") === "true";

  if (!recipientId) {
    redirect("/admin/auto-share?error=Choose%20a%20recipient%20to%20update.");
  }

  const { data: recipient, error } = await supabase
    .from("auto_share_recipients")
    .update({ active })
    .eq("id", recipientId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("active, email, id, location_id, name, phone, recipient_type")
    .maybeSingle<AutoShareRecipientAuditRow>();

  if (error || !recipient) {
    redirect(`/admin/auto-share?error=${encodeURIComponent(error?.message ?? "Choose a valid recipient to update.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "auto_share.recipient.active_update",
    entityId: recipient.id,
    entityTable: "auto_share_recipients",
    metadata: {
      active: recipient.active,
      channel: recipient.email ? "email" : recipient.phone ? "sms" : "in_app",
      location_id: recipient.location_id,
      name: recipient.name,
      recipient_type: recipient.recipient_type,
    },
  });

  revalidatePath("/admin/auto-share");
  redirect(`/admin/auto-share?notice=Recipient%20${active ? "enabled" : "paused"}.`);
}

export async function processQueuedAutoShareEmails() {
  const context = await requireAutoShareManager();
  const supabase = await createSupabaseServerClient();

  if (await isDemoTenant(supabase, context.appUser.tenant_id)) {
    redirect("/admin/auto-share?notice=Email%20delivery%20is%20disabled%20in%20the%20demo.");
  }

  if (!emailDeliveryConfigured()) {
    redirect(`/admin/auto-share?error=${encodeURIComponent(emailDeliveryConfigurationError())}`);
  }

  const { data: settings, error: settingsError } = await supabase
    .from("company_settings")
    .select("integrations")
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<CompanyIntegrationSettingsRow>();

  if (settingsError) {
    redirect(`/admin/auto-share?error=${encodeURIComponent(settingsError.message)}`);
  }

  if (!isIntegrationEnabled(settings?.integrations ?? {}, "email_delivery")) {
    redirect("/admin/auto-share?error=Enable%20Email%20Delivery%20in%20Company%20Settings%20first.");
  }

  const { data: notifications, error: notificationError } = await supabase
    .from("notifications")
    .select("id, tenant_id, submission_id, title, body, recipient_name, recipient_contact, recipient_type, created_at, delivery_attempts")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("channel", "email")
    .eq("delivery_status", "queued")
    .ilike("title", "Auto-share:%")
    .order("created_at", { ascending: true })
    .limit(25)
    .returns<EmailNotificationRow[]>();

  if (notificationError) {
    redirect(`/admin/auto-share?error=${encodeURIComponent(notificationError.message)}`);
  }

  const queuedNotifications = notifications ?? [];

  if (queuedNotifications.length === 0) {
    redirect("/admin/auto-share?notice=No%20queued%20Auto-share%20emails%20are%20waiting.");
  }

  let deliveredCount = 0;
  let failedCount = 0;

  for (const notification of queuedNotifications) {
    const result = await deliverEmailNotification(notification);
    const nowIso = new Date().toISOString();
    const deliveryUpdate = buildAutoShareDeliveryAttemptUpdate({
      attemptedAt: nowIso,
      notification,
      result,
    });

    if (result.ok) {
      const { error } = await supabase
        .from("notifications")
        .update(deliveryUpdate)
        .eq("id", notification.id)
        .eq("tenant_id", context.appUser.tenant_id);

      if (error) {
        failedCount += 1;
      } else {
        deliveredCount += 1;
        await recordAppUserAuditEvent(context.appUser, {
          action: "auto_share.email.process.delivered",
          entityId: notification.id,
          entityTable: "notifications",
          metadata: {
            recipient_contact: notification.recipient_contact,
            recipient_name: notification.recipient_name,
            recipient_type: notification.recipient_type,
            submission_id: notification.submission_id,
            delivery_attempts: deliveryUpdate.delivery_attempts,
            title: notification.title,
          },
        });
      }

      continue;
    }

    failedCount += 1;

    const { error: updateError } = await supabase
      .from("notifications")
      .update(deliveryUpdate)
      .eq("id", notification.id)
      .eq("tenant_id", context.appUser.tenant_id);

    await recordAppUserAuditEvent(context.appUser, {
      action: "auto_share.email.process.failed",
      entityId: notification.id,
      entityTable: "notifications",
      metadata: {
        delivery_error: result.error,
        recipient_contact: notification.recipient_contact,
        recipient_name: notification.recipient_name,
        recipient_type: notification.recipient_type,
        submission_id: notification.submission_id,
        delivery_attempts: deliveryUpdate.delivery_attempts,
        title: notification.title,
        update_error: updateError?.message,
      },
    });
  }

  revalidatePath("/admin/auto-share");

  if (failedCount > 0) {
    redirect(
      `/admin/auto-share?error=${encodeURIComponent(
        `Processed ${queuedNotifications.length} email(s): ${deliveredCount} delivered, ${failedCount} failed.`,
      )}`,
    );
  }

  redirect(`/admin/auto-share?notice=${encodeURIComponent(`Delivered ${deliveredCount} queued Auto-share email(s).`)}`);
}

export async function retryAutoShareEmailNotification(formData: FormData) {
  const context = await requireAutoShareManager();
  const supabase = await createSupabaseServerClient();
  const notificationId = stringValue(formData, "notificationId");

  if (await isDemoTenant(supabase, context.appUser.tenant_id)) {
    redirect("/admin/auto-share?notice=Email%20delivery%20is%20disabled%20in%20the%20demo.");
  }

  if (!notificationId) {
    redirect("/admin/auto-share?error=Choose%20a%20notification%20to%20retry.");
  }

  if (!emailDeliveryConfigured()) {
    redirect(`/admin/auto-share?error=${encodeURIComponent(emailDeliveryConfigurationError())}`);
  }

  const { data: settings, error: settingsError } = await supabase
    .from("company_settings")
    .select("integrations")
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<CompanyIntegrationSettingsRow>();

  if (settingsError) {
    redirect(`/admin/auto-share?error=${encodeURIComponent(settingsError.message)}`);
  }

  if (!isIntegrationEnabled(settings?.integrations ?? {}, "email_delivery")) {
    redirect("/admin/auto-share?error=Enable%20Email%20Delivery%20in%20Company%20Settings%20first.");
  }

  const { data: notification, error: notificationError } = await supabase
    .from("notifications")
    .select(
      "id, tenant_id, submission_id, title, body, recipient_name, recipient_contact, recipient_type, created_at, channel, delivery_attempts, delivery_status",
    )
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", notificationId)
    .ilike("title", "Auto-share:%")
    .maybeSingle<AutoShareRetryNotificationRow>();

  if (notificationError) {
    redirect(`/admin/auto-share?error=${encodeURIComponent(notificationError.message)}`);
  }

  if (!notification) {
    redirect("/admin/auto-share?error=Auto-share%20notification%20was%20not%20found.");
  }

  if (notification.channel !== "email" || !["queued", "failed"].includes(notification.delivery_status)) {
    redirect("/admin/auto-share?error=Only%20queued%20or%20failed%20email%20notifications%20can%20be%20retried.");
  }

  const result = await deliverEmailNotification(notification);
  const nowIso = new Date().toISOString();
  const deliveryUpdate = buildAutoShareDeliveryAttemptUpdate({
    attemptedAt: nowIso,
    notification,
    result,
  });

  if (result.ok) {
    const { error } = await supabase
      .from("notifications")
      .update(deliveryUpdate)
      .eq("id", notification.id)
      .eq("tenant_id", context.appUser.tenant_id);

    if (error) {
      redirect(`/admin/auto-share?error=${encodeURIComponent(error.message)}`);
    }

    await recordAppUserAuditEvent(context.appUser, {
      action: "auto_share.email.retry.delivered",
      entityId: notification.id,
      entityTable: "notifications",
      metadata: {
        previous_delivery_status: notification.delivery_status,
        delivery_attempts: deliveryUpdate.delivery_attempts,
        recipient_contact: notification.recipient_contact,
        recipient_name: notification.recipient_name,
        recipient_type: notification.recipient_type,
        submission_id: notification.submission_id,
        title: notification.title,
      },
    });

    revalidatePath("/admin/auto-share");
    redirect("/admin/auto-share?notice=Auto-share%20email%20delivered.");
  }

  const { error: updateError } = await supabase
    .from("notifications")
    .update(deliveryUpdate)
    .eq("id", notification.id)
    .eq("tenant_id", context.appUser.tenant_id);

  await recordAppUserAuditEvent(context.appUser, {
    action: "auto_share.email.retry.failed",
    entityId: notification.id,
    entityTable: "notifications",
    metadata: {
      delivery_error: result.error,
      delivery_attempts: deliveryUpdate.delivery_attempts,
      previous_delivery_status: notification.delivery_status,
      recipient_contact: notification.recipient_contact,
      recipient_name: notification.recipient_name,
      recipient_type: notification.recipient_type,
      submission_id: notification.submission_id,
      title: notification.title,
      update_error: updateError?.message,
    },
  });

  revalidatePath("/admin/auto-share");
  redirect(`/admin/auto-share?error=${encodeURIComponent(result.error)}`);
}

export async function updateConsultantRevocation(formData: FormData) {
  const context = await requireAccessManager();
  const supabase = await createSupabaseServerClient();
  const revoked = stringValue(formData, "revoked") === "true";

  if (context.appUser.power_level !== "super_admin") {
    redirect("/admin/consultant-access?error=Only%20a%20Super%20Admin%20can%20change%20consultant%20access.");
  }

  const { error } = await supabase
    .from("tenants")
    .update({ consultant_access_revoked: revoked })
    .eq("id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/consultant-access?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "consultant_access.revocation_update",
    entityId: context.appUser.tenant_id,
    entityTable: "tenants",
    metadata: {
      consultant_access_revoked: revoked,
    },
  });

  revalidatePath("/admin/consultant-access");
  redirect("/admin/consultant-access?notice=Consultant%20access%20updated.");
}

export async function requestConsultantOverride(formData: FormData) {
  const context = await requireCurrentUser();

  if (context.status !== "consultant") {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = stringValue(formData, "tenantId");
  const condition = stringValue(formData, "condition");
  const reason = stringValue(formData, "reason");

  if (!tenantId || !overrideConditions.has(condition) || !reason) {
    redirect("/admin/consultant-access?error=Enter%20an%20override%20condition%20and%20reason.");
  }

  const { data: accessRow, error: accessError } = await supabase
    .from("consultant_access")
    .insert({
      allowed: true,
      consultant_id: context.consultant.id,
      override_condition: condition as "court_order" | "ministry_order" | "ninety_day_dormancy",
      override_expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      override_reason: reason,
      tenant_id: tenantId,
    })
    .select("id")
    .single<{ id: string }>();

  if (accessError) {
    redirect(`/admin/consultant-access?error=${encodeURIComponent(accessError.message)}`);
  }

  await supabase.from("consultant_audit_log").insert({
    action: "consultant_override_requested",
    consultant_id: context.consultant.id,
    metadata: { condition, reason },
    tenant_id: tenantId,
  });

  await recordAdminTenantAuditEvent({
    action: "consultant_access.override_requested",
    actorRole: "consultant",
    actorUserId: context.consultant.id,
    entityId: accessRow?.id ?? null,
    entityTable: "consultant_access",
    metadata: { condition, reason },
    tenantId,
  });

  revalidatePath("/admin/consultant-access");
  redirect("/admin/consultant-access?notice=Override%20recorded.");
}

export async function updateCompanySettings(formData: FormData) {
  const context = await requireSettingsManager();
  const supabase = await createSupabaseServerClient();
  const companyName = stringValue(formData, "companyName");
  const address = stringValue(formData, "address") || null;
  const phone = stringValue(formData, "phone") || null;
  const timezone = stringValue(formData, "timezone") || "America/Vancouver";
  const companyId = normalizeCompanyId(stringValue(formData, "companyId"));
  const logo = getUploadFile(formData, "logo");
  const integrationKeys = formData
    .getAll("integrations")
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean);

  if (!companyName) {
    redirect("/admin/settings?error=Enter%20a%20company%20name.");
  }

  let logoPath: string | null | undefined;

  if (logo) {
    if (!logoMimeTypes.has(logo.type)) {
      redirect("/admin/settings?error=Choose%20a%20PNG,%20JPEG,%20or%20WebP%20image%20for%20the%20logo.");
    }

    logoPath = [
      context.appUser.tenant_id,
      "company-logo",
      `${Date.now()}-${sanitizeStorageFilename(logo.name)}`,
    ].join("/");

    const { error: uploadError } = await supabase.storage.from("tenant-documents").upload(logoPath, logo, {
      contentType: logo.type,
      upsert: false,
    });

    if (uploadError) {
      redirect(`/admin/settings?error=${encodeURIComponent(uploadError.message)}`);
    }
  }

  const updatePayload = {
    address,
    company_id: companyId || null,
    company_name: companyName,
    integrations: integrationsFromFormKeys(integrationKeys),
    phone,
    tenant_id: context.appUser.tenant_id,
    timezone,
    ...(logoPath ? { logo_path: logoPath } : {}),
  };

  const { data: companySettings, error } = await supabase
    .from("company_settings")
    .upsert(updatePayload, {
      onConflict: "tenant_id",
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !companySettings) {
    redirect(`/admin/settings?error=${encodeURIComponent(error?.message ?? "Company settings were not saved.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "company_settings.update",
    entityId: companySettings.id,
    entityTable: "company_settings",
    metadata: {
      company_id: companyId || null,
      company_name: companyName,
      integration_keys: integrationKeys,
      logo_uploaded: Boolean(logoPath),
      phone,
      timezone,
    },
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/monitor");
  redirect("/admin/settings?notice=Company%20settings%20saved.");
}

export async function updatePrintSettings(formData: FormData) {
  const context = await requireSettingsManager();
  const supabase = await createSupabaseServerClient();
  const headerOption = coercePrintHeaderOption(stringValue(formData, "headerOption"));
  const logoPlacement = coerceLogoPlacement(stringValue(formData, "logoPlacement"));
  const footerNote = normalizePrintFooterNote(stringValue(formData, "footerNote"));
  const preparedByLabel = normalizePreparedByLabel(stringValue(formData, "preparedByLabel"));
  const showPrintedAt = formData.has("showPrintedAt");

  const { data: printSettings, error } = await supabase
    .from("print_settings")
    .upsert(
      {
        footer_note: footerNote,
        header_option: headerOption,
        logo_placement: logoPlacement,
        prepared_by_label: preparedByLabel,
        show_printed_at: showPrintedAt,
        tenant_id: context.appUser.tenant_id,
      },
      {
        onConflict: "tenant_id",
      },
    )
    .select("id")
    .single<{ id: string }>();

  if (error || !printSettings) {
    redirect(`/admin/settings?error=${encodeURIComponent(error?.message ?? "Print settings were not saved.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "print_settings.update",
    entityId: printSettings.id,
    entityTable: "print_settings",
    metadata: {
      footer_note: footerNote,
      header_option: headerOption,
      logo_placement: logoPlacement,
      prepared_by_label: preparedByLabel,
      show_printed_at: showPrintedAt,
    },
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/monitor");
  redirect("/admin/settings?notice=Print%20settings%20saved.");
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function equipmentDetailPath(equipmentId: string, tab = "overview") {
  return `/admin/equipment/${equipmentId}?tab=${tab}`;
}

function redirectEquipmentError(equipmentId: string, tab: string, message: string): never {
  redirect(`${equipmentDetailPath(equipmentId, tab)}&error=${encodeURIComponent(message)}`);
}

function revalidateEquipmentPaths(equipmentId?: string | null) {
  revalidatePath("/admin/equipment");

  if (equipmentId) {
    revalidatePath(`/admin/equipment/${equipmentId}`);
  }

  revalidatePath("/web");
}

async function ensureTenantEquipment(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  equipmentId: string,
  tenantId: string,
) {
  const { data: equipment } = await supabase
    .from("equipment")
    .select("id, photo_ids, tenant_id, tracking_mode, current_meter")
    .eq("id", equipmentId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle<EquipmentActionRow>();

  return equipment;
}

async function ensureTenantSubmission(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  submissionId: string,
  tenantId: string,
) {
  const { data: submission } = await supabase
    .from("submissions")
    .select("id, form_id")
    .eq("id", submissionId)
    .eq("tenant_id", tenantId)
    .maybeSingle<EquipmentSubmissionActionRow>();

  return submission;
}

async function uploadEquipmentAttachmentFiles(input: {
  equipmentId: string;
  files: File[];
  folder: "documents" | "maintenance";
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  tenantId: string;
}) {
  const paths: string[] = [];

  for (const [index, file] of input.files.entries()) {
    if (!equipmentAttachmentMimeTypes.has(file.type)) {
      throw new Error("Choose PDF, PNG, JPEG, WebP, HEIC, or HEIF attachments.");
    }

    const storagePath = [
      input.tenantId,
      "equipment",
      input.equipmentId,
      input.folder,
      `${Date.now()}-${index}-${sanitizeStorageFilename(file.name)}`,
    ].join("/");

    const { error: uploadError } = await input.supabase.storage.from("tenant-documents").upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    paths.push(storagePath);
  }

  return paths;
}

async function uploadEquipmentPhotoFiles(input: {
  equipmentId: string;
  files: File[];
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  tenantId: string;
}) {
  const paths: string[] = [];

  for (const [index, file] of input.files.entries()) {
    if (!equipmentPhotoMimeTypes.has(file.type)) {
      throw new Error("Choose PNG, JPEG, WebP, HEIC, or HEIF photos.");
    }

    const storagePath = [
      input.tenantId,
      "equipment",
      input.equipmentId,
      "photos",
      `${Date.now()}-${index}-${sanitizeStorageFilename(file.name)}`,
    ].join("/");

    const { error: uploadError } = await input.supabase.storage.from("tenant-documents").upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    paths.push(storagePath);
  }

  return paths;
}

export async function createEquipment(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const unitNumber = normalizeEquipmentUnitNumber(stringValue(formData, "unitNumber"));
  const category = coerceEquipmentCategory(stringValue(formData, "category"));
  const trackingMode = coerceEquipmentTrackingMode(stringValue(formData, "trackingMode"));
  const status = coerceEquipmentStatus(stringValue(formData, "status"));
  const locationId = equipmentLocationForStatus({
    locationId: stringValue(formData, "locationId") || null,
    status,
  });
  const assignedTo = stringValue(formData, "assignedTo") || null;
  const initialMeter = optionalNumberValue(formData, "currentMeter");
  const year = optionalIntegerValue(formData, "year");
  const isCommercial = boolValue(formData, "isCommercial");

  if (!unitNumber) {
    redirect("/admin/equipment?error=Enter%20a%20unit%20number.");
  }

  const { data: equipment, error } = await supabase
    .from("equipment")
    .insert({
      action_metadata: buildEquipmentActionMetadata({
        action: "equipment.create",
        actorId: context.appUser.id,
        details: {
          assigned_to: assignedTo,
          initial_meter: initialMeter,
          location_id: locationId,
          status,
        },
        source: "admin",
      }),
      assigned_to: assignedTo,
      category,
      created_by: context.appUser.id,
      is_commercial: isCommercial,
      license_plate: stringValue(formData, "licensePlate") || null,
      location_id: locationId,
      make: stringValue(formData, "make") || null,
      model: stringValue(formData, "model") || null,
      name: stringValue(formData, "name") || null,
      notes: stringValue(formData, "notes") || null,
      purchase_date: dateOnlyValue(formData, "purchaseDate"),
      status,
      tenant_id: context.appUser.tenant_id,
      tracking_mode: trackingMode,
      unit_number: unitNumber,
      vin_or_serial: stringValue(formData, "vinOrSerial") || null,
      year,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !equipment) {
    redirect(`/admin/equipment?error=${encodeURIComponent(error?.message ?? "Equipment was not created.")}`);
  }

  await recordEquipmentAuditEvent({
    action: "equipment.create",
    actor: context.appUser,
    entityId: equipment.id,
    entityTable: "equipment",
    metadata: {
      assigned_to: assignedTo,
      initial_meter: initialMeter,
      location_id: locationId,
      status,
      unit_number: unitNumber,
    },
  });

  if (initialMeter !== null) {
    const { data: meterLog, error: meterError } = await supabase
      .from("equipment_meter_log")
      .insert({
        action_metadata: buildEquipmentActionMetadata({
          action: "equipment.meter.initial",
          actorId: context.appUser.id,
          details: {
            source_equipment_action: "equipment.create",
            value: initialMeter,
          },
          source: "admin",
        }),
        equipment_id: equipment.id,
        recorded_by: context.appUser.id,
        source: "manual",
        tenant_id: context.appUser.tenant_id,
        value: initialMeter,
      })
      .select("id")
      .single<{ id: string }>();

    if (meterError || !meterLog) {
      redirect(
        `${equipmentDetailPath(equipment.id, "meter")}&error=${encodeURIComponent(
          meterError?.message ?? "Initial meter reading was not logged.",
        )}`,
      );
    }

    await recordEquipmentAuditEvent({
      action: "equipment.meter.initial",
      actor: context.appUser,
      entityId: meterLog.id,
      entityTable: "equipment_meter_log",
      metadata: {
        equipment_id: equipment.id,
        source_equipment_action: "equipment.create",
        value: initialMeter,
      },
    });
  }

  revalidateEquipmentPaths(equipment.id);
  redirect(`${equipmentDetailPath(equipment.id)}&notice=Equipment%20created.`);
}

export async function updateEquipment(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const equipmentId = stringValue(formData, "equipmentId");
  const unitNumber = normalizeEquipmentUnitNumber(stringValue(formData, "unitNumber"));
  const status = coerceEquipmentStatus(stringValue(formData, "status"));
  const category = coerceEquipmentCategory(stringValue(formData, "category"));
  const trackingMode = coerceEquipmentTrackingMode(stringValue(formData, "trackingMode"));
  const locationId = equipmentLocationForStatus({
    locationId: stringValue(formData, "locationId") || null,
    status,
  });
  const assignedTo = stringValue(formData, "assignedTo") || null;
  const year = optionalIntegerValue(formData, "year");
  const isCommercial = boolValue(formData, "isCommercial");

  if (!equipmentId || !unitNumber) {
    redirect("/admin/equipment?error=Choose%20equipment%20and%20enter%20a%20unit%20number.");
  }

  const equipment = await ensureTenantEquipment(supabase, equipmentId, context.appUser.tenant_id);

  if (!equipment) {
    redirect("/admin/equipment?error=Choose%20valid%20equipment.");
  }

  const { error } = await supabase
    .from("equipment")
    .update({
      action_metadata: buildEquipmentActionMetadata({
        action: "equipment.update",
        actorId: context.appUser.id,
        details: {
          assigned_to: assignedTo,
          location_id: locationId,
          status,
        },
        source: "admin",
      }),
      assigned_to: assignedTo,
      category,
      is_commercial: isCommercial,
      license_plate: stringValue(formData, "licensePlate") || null,
      location_id: locationId,
      make: stringValue(formData, "make") || null,
      model: stringValue(formData, "model") || null,
      name: stringValue(formData, "name") || null,
      notes: stringValue(formData, "notes") || null,
      purchase_date: dateOnlyValue(formData, "purchaseDate"),
      status,
      tracking_mode: trackingMode,
      unit_number: unitNumber,
      vin_or_serial: stringValue(formData, "vinOrSerial") || null,
      year,
    })
    .eq("id", equipmentId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirectEquipmentError(equipmentId, "overview", error.message);
  }

  await recordEquipmentAuditEvent({
    action: "equipment.update",
    actor: context.appUser,
    entityId: equipmentId,
    entityTable: "equipment",
    metadata: {
      assigned_to: assignedTo,
      location_id: locationId,
      status,
      unit_number: unitNumber,
    },
  });

  revalidateEquipmentPaths(equipmentId);
  redirect(`${equipmentDetailPath(equipmentId)}&notice=Equipment%20saved.`);
}

export async function uploadEquipmentPhotos(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const equipmentId = stringValue(formData, "equipmentId");
  const photoFiles = getUploadFiles(formData, "photos");

  if (!equipmentId) {
    redirect("/admin/equipment?error=Choose%20equipment%20before%20uploading%20photos.");
  }

  if (photoFiles.length === 0) {
    redirectEquipmentError(equipmentId, "overview", "Choose at least one equipment photo.");
  }

  const equipment = await ensureTenantEquipment(supabase, equipmentId, context.appUser.tenant_id);

  if (!equipment) {
    redirect("/admin/equipment?error=Choose%20valid%20equipment.");
  }

  let uploadedPhotoPaths: string[];

  try {
    uploadedPhotoPaths = await uploadEquipmentPhotoFiles({
      equipmentId,
      files: photoFiles,
      supabase,
      tenantId: context.appUser.tenant_id,
    });
  } catch (error) {
    redirectEquipmentError(equipmentId, "overview", error instanceof Error ? error.message : "Photos were not uploaded.");
  }

  const photoIds = Array.from(new Set([...(equipment.photo_ids ?? []), ...uploadedPhotoPaths]));
  const { error } = await supabase
    .from("equipment")
    .update({
      action_metadata: buildEquipmentActionMetadata({
        action: "equipment.photos.upload",
        actorId: context.appUser.id,
        details: {
          uploaded_count: uploadedPhotoPaths.length,
        },
        source: "admin",
      }),
      photo_ids: photoIds,
    })
    .eq("id", equipmentId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirectEquipmentError(equipmentId, "overview", error.message);
  }

  await recordEquipmentAuditEvent({
    action: "equipment.photos.upload",
    actor: context.appUser,
    entityId: equipmentId,
    entityTable: "equipment",
    metadata: {
      uploaded_count: uploadedPhotoPaths.length,
    },
  });

  revalidateEquipmentPaths(equipmentId);
  redirect(`${equipmentDetailPath(equipmentId)}&notice=Equipment%20photos%20uploaded.`);
}

export async function createEquipmentMeterReading(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const equipmentId = stringValue(formData, "equipmentId");
  const value = optionalNumberValue(formData, "value");

  if (!equipmentId || value === null) {
    redirect("/admin/equipment?error=Choose%20equipment%20and%20enter%20a%20meter%20reading.");
  }

  const equipment = await ensureTenantEquipment(supabase, equipmentId, context.appUser.tenant_id);

  if (!equipment) {
    redirect("/admin/equipment?error=Choose%20valid%20equipment.");
  }

  const { data: meterLog, error } = await supabase
    .from("equipment_meter_log")
    .insert({
      action_metadata: buildEquipmentActionMetadata({
        action: "equipment.meter.create",
        actorId: context.appUser.id,
        details: {
          value,
        },
        source: "admin",
      }),
      equipment_id: equipmentId,
      recorded_at: dateTimeInputValue(formData, "recordedAt") ?? new Date().toISOString(),
      recorded_by: context.appUser.id,
      source: "manual",
      tenant_id: context.appUser.tenant_id,
      value,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !meterLog) {
    redirectEquipmentError(equipmentId, "meter", error?.message ?? "Meter reading was not logged.");
  }

  await recordEquipmentAuditEvent({
    action: "equipment.meter.create",
    actor: context.appUser,
    entityId: meterLog.id,
    entityTable: "equipment_meter_log",
    metadata: {
      equipment_id: equipmentId,
      value,
    },
  });

  revalidateEquipmentPaths(equipmentId);
  redirect(`${equipmentDetailPath(equipmentId, "meter")}&notice=Meter%20reading%20logged.`);
}

export async function createEquipmentMaintenanceLog(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const equipmentId = stringValue(formData, "equipmentId");
  const title = stringValue(formData, "title");
  const performedAt = dateOnlyValue(formData, "performedAt") ?? todayDateOnly();
  const meterAtService = optionalNumberValue(formData, "meterAtService");
  const attachmentFiles = getUploadFiles(formData, "attachments");

  if (!equipmentId || !title) {
    redirect("/admin/equipment?error=Choose%20equipment%20and%20enter%20maintenance%20details.");
  }

  const equipment = await ensureTenantEquipment(supabase, equipmentId, context.appUser.tenant_id);

  if (!equipment) {
    redirect("/admin/equipment?error=Choose%20valid%20equipment.");
  }

  let uploadedAttachmentPaths: string[];

  try {
    uploadedAttachmentPaths = await uploadEquipmentAttachmentFiles({
      equipmentId,
      files: attachmentFiles,
      folder: "maintenance",
      supabase,
      tenantId: context.appUser.tenant_id,
    });
  } catch (error) {
    redirectEquipmentError(equipmentId, "maintenance", error instanceof Error ? error.message : "Attachments were not uploaded.");
  }

  const maintenanceType = coerceEquipmentMaintenanceType(stringValue(formData, "type"));
  const { data: maintenanceLog, error } = await supabase
    .from("equipment_maintenance_log")
    .insert({
      action_metadata: buildEquipmentActionMetadata({
        action: "equipment.maintenance.create",
        actorId: context.appUser.id,
        details: {
          attachment_count: uploadedAttachmentPaths.length,
          meter_at_service: meterAtService,
          type: maintenanceType,
        },
        source: "admin",
      }),
      attachment_ids: [...parseEquipmentAttachmentIds(stringValue(formData, "attachmentIds")), ...uploadedAttachmentPaths],
      cost: optionalNumberValue(formData, "cost"),
      created_by: context.appUser.id,
      description: stringValue(formData, "description") || null,
      equipment_id: equipmentId,
      meter_at_service: meterAtService,
      performed_at: performedAt,
      performed_by: context.appUser.id,
      tenant_id: context.appUser.tenant_id,
      title,
      type: maintenanceType,
      vendor: stringValue(formData, "vendor") || null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !maintenanceLog) {
    redirectEquipmentError(equipmentId, "maintenance", error?.message ?? "Maintenance log was not created.");
  }

  await recordEquipmentAuditEvent({
    action: "equipment.maintenance.create",
    actor: context.appUser,
    entityId: maintenanceLog.id,
    entityTable: "equipment_maintenance_log",
    metadata: {
      attachment_count: uploadedAttachmentPaths.length,
      equipment_id: equipmentId,
      meter_at_service: meterAtService,
      title,
      type: maintenanceType,
    },
  });

  if (meterAtService !== null) {
    const { data: meterLog, error: meterError } = await supabase
      .from("equipment_meter_log")
      .insert({
        action_metadata: buildEquipmentActionMetadata({
          action: "equipment.meter.from_maintenance",
          actorId: context.appUser.id,
          details: {
            source_equipment_action: "equipment.maintenance.create",
            value: meterAtService,
          },
          source: "admin",
        }),
        equipment_id: equipmentId,
        recorded_at: new Date(`${performedAt}T12:00:00`).toISOString(),
        recorded_by: context.appUser.id,
        source: "maintenance",
        tenant_id: context.appUser.tenant_id,
        value: meterAtService,
      })
      .select("id")
      .single<{ id: string }>();

    if (meterError || !meterLog) {
      redirectEquipmentError(equipmentId, "maintenance", meterError?.message ?? "Maintenance meter reading was not logged.");
    }

    await recordEquipmentAuditEvent({
      action: "equipment.meter.from_maintenance",
      actor: context.appUser,
      entityId: meterLog.id,
      entityTable: "equipment_meter_log",
      metadata: {
        equipment_id: equipmentId,
        source_equipment_action: "equipment.maintenance.create",
        value: meterAtService,
      },
    });
  }

  revalidateEquipmentPaths(equipmentId);
  redirect(`${equipmentDetailPath(equipmentId, "maintenance")}&notice=Maintenance%20logged.`);
}

export async function createEquipmentScheduledService(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const equipmentId = stringValue(formData, "equipmentId");
  const title = stringValue(formData, "title");
  const intervalMode = coerceEquipmentIntervalMode(stringValue(formData, "intervalMode"));
  const dueDate = dateOnlyValue(formData, "dueDate");
  // Optional "good from" date. When set with a due date, it makes a date window: the
  // service reads as due (not overdue) across the whole range, and only goes overdue
  // after the due date. We store it as the warn lead (days between from and due).
  const dueFromDate = dateOnlyValue(formData, "dueFromDate");
  const dueMeter = optionalNumberValue(formData, "dueMeter");
  const windowStartMeter = optionalNumberValue(formData, "windowStartMeter");
  const warnMeter = optionalNumberValue(formData, "warnMeter");
  const recurrenceValue = optionalIntegerValue(formData, "recurrenceValue");
  const recurrenceUnit = stringValue(formData, "recurrenceUnit") || null;
  const dateLeadDays = optionalIntegerValue(formData, "dateLeadDays");
  const meterLead = optionalNumberValue(formData, "meterLead");
  // Relative service interval (e.g. "every 5,000 km", or a "5,000 to 7,500 km" range).
  // When supplied, the due meter is derived from the unit's current reading below, so
  // the admin enters the cycle length instead of an absolute odometer target.
  const intervalMeter = optionalNumberValue(formData, "intervalMeter");
  const intervalMeterMax = optionalNumberValue(formData, "intervalMeterMax");
  // Allow the form to return to an in-module transport path (e.g. the fleet view)
  // instead of bouncing to the Equipment detail page.
  const returnTo = stringValue(formData, "returnTo");
  const safeReturnTo = returnTo.startsWith("/admin/transport") ? returnTo : null;
  const failService = (message: string): never =>
    redirect(
      safeReturnTo
        ? `${safeReturnTo}?error=${encodeURIComponent(message)}`
        : `${equipmentDetailPath(equipmentId, "service")}&error=${encodeURIComponent(message)}`,
    );

  if (!equipmentId || !title) {
    redirect(
      safeReturnTo
        ? `${safeReturnTo}?error=${encodeURIComponent("Choose a unit and enter service details.")}`
        : "/admin/equipment?error=Choose%20equipment%20and%20enter%20service%20details.",
    );
  }

  // A meter target can come from an explicit due meter or a relative interval.
  const hasMeterTarget = dueMeter !== null || intervalMeter !== null;

  if ((intervalMode === "by_date" && !dueDate) || (intervalMode === "by_meter" && !hasMeterTarget)) {
    failService("Enter the due value or service interval for the selected interval mode.");
  }

  if (intervalMode === "both" && !dueDate && !hasMeterTarget) {
    failService("Enter a due date, a service interval, or both.");
  }

  const equipment = await ensureTenantEquipment(supabase, equipmentId, context.appUser.tenant_id);

  if (!equipment) {
    failService("Choose a valid unit.");
  }

  const serviceType = coerceEquipmentServiceType(stringValue(formData, "serviceType"));
  const normalizedRecurrenceUnit =
    recurrenceUnit === "meter" || recurrenceUnit === "days" || recurrenceUnit === "months" ? recurrenceUnit : null;
  const normalizedRecurrenceValue = recurrenceValue && recurrenceValue > 0 ? recurrenceValue : null;

  // Resolve the effective meter targets. With a relative interval, derive the due
  // meter (and a "due from" window for a range) off the current reading, and repeat
  // on that interval unless the admin set an explicit recurrence.
  const currentMeter = numericEquipmentValue(equipment?.current_meter) ?? 0;
  const isMeterRange = intervalMeterMax !== null && intervalMeter !== null && intervalMeterMax > intervalMeter;
  let effectiveDueMeter = dueMeter;
  let effectiveWindowStartMeter = windowStartMeter;
  let effectiveWarnMeter = warnMeter;
  let effectiveRecurrenceUnit: "meter" | "days" | "months" | null = normalizedRecurrenceUnit;
  let effectiveRecurrenceValue = normalizedRecurrenceValue;

  if (intervalMeter !== null && dueMeter === null) {
    if (isMeterRange) {
      effectiveWindowStartMeter = windowStartMeter ?? currentMeter + intervalMeter;
      effectiveDueMeter = currentMeter + (intervalMeterMax as number);
    } else {
      effectiveDueMeter = currentMeter + intervalMeter;
    }

    effectiveRecurrenceUnit = effectiveRecurrenceUnit ?? "meter";
    effectiveRecurrenceValue = effectiveRecurrenceValue ?? (isMeterRange ? (intervalMeterMax as number) : intervalMeter);

    // For a range, escalate to a red "service now" the warn lead before the hard due,
    // provided it stays inside the window. Single intervals rely on meter_lead alone.
    if (warnMeter === null && meterLead !== null && effectiveDueMeter !== null) {
      const candidateWarn = effectiveDueMeter - meterLead;
      if (effectiveWindowStartMeter !== null && candidateWarn > effectiveWindowStartMeter) {
        effectiveWarnMeter = candidateWarn;
      }
    }
  }

  // A date range collapses to a warn lead = days between "good from" and the due date,
  // so the whole window reads as due and it only goes overdue after the due date.
  let effectiveDateLeadDays = dateLeadDays;
  if (dueFromDate && dueDate) {
    const fromTime = Date.parse(`${dueFromDate}T00:00:00Z`);
    const dueTime = Date.parse(`${dueDate}T00:00:00Z`);
    if (!Number.isNaN(fromTime) && !Number.isNaN(dueTime) && dueTime >= fromTime) {
      effectiveDateLeadDays = Math.round((dueTime - fromTime) / 86_400_000);
    }
  }

  // The maintenance window must stay ordered: window start <= warn <= due meter.
  if (
    (effectiveWindowStartMeter !== null && effectiveWarnMeter !== null && effectiveWindowStartMeter > effectiveWarnMeter) ||
    (effectiveWarnMeter !== null && effectiveDueMeter !== null && effectiveWarnMeter > effectiveDueMeter) ||
    (effectiveWindowStartMeter !== null && effectiveDueMeter !== null && effectiveWindowStartMeter > effectiveDueMeter)
  ) {
    failService("Maintenance window must be ordered: window start, then warn, then due meter.");
  }
  const { data: scheduledService, error } = await supabase
    .from("equipment_scheduled_service")
    .insert({
      action_metadata: buildEquipmentActionMetadata({
        action: "equipment.service.create",
        actorId: context.appUser.id,
        details: {
          due_date: dueDate,
          due_meter: effectiveDueMeter,
          window_start_meter: effectiveWindowStartMeter,
          warn_meter: effectiveWarnMeter,
          interval_mode: intervalMode,
          recurrence_unit: effectiveRecurrenceUnit,
          recurrence_value: effectiveRecurrenceValue,
        },
        source: "admin",
      }),
      created_by: context.appUser.id,
      due_date: dueDate,
      due_meter: effectiveDueMeter,
      window_start_meter: effectiveWindowStartMeter,
      warn_meter: effectiveWarnMeter,
      date_lead_days: effectiveDateLeadDays,
      meter_lead: meterLead,
      equipment_id: equipmentId,
      interval_mode: intervalMode,
      is_active: true,
      recurrence_unit: effectiveRecurrenceUnit,
      recurrence_value: effectiveRecurrenceValue,
      service_type: serviceType,
      tenant_id: context.appUser.tenant_id,
      title,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !scheduledService) {
    return failService(error?.message ?? "Scheduled service was not created.");
  }

  await recordEquipmentAuditEvent({
    action: "equipment.service.create",
    actor: context.appUser,
    entityId: scheduledService.id,
    entityTable: "equipment_scheduled_service",
    metadata: {
      due_date: dueDate,
      due_meter: effectiveDueMeter,
      equipment_id: equipmentId,
      interval_mode: intervalMode,
      recurrence_unit: effectiveRecurrenceUnit,
      recurrence_value: effectiveRecurrenceValue,
      service_type: serviceType,
      title,
    },
  });

  revalidateEquipmentPaths(equipmentId);

  if (safeReturnTo) {
    revalidatePath(safeReturnTo);
    redirect(`${safeReturnTo}?notice=Scheduled%20service%20added.`);
  }

  redirect(`${equipmentDetailPath(equipmentId, "service")}&notice=Scheduled%20service%20added.`);
}

export async function completeEquipmentScheduledService(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const equipmentId = stringValue(formData, "equipmentId");
  const serviceId = stringValue(formData, "serviceId");
  const completedAt = dateOnlyValue(formData, "completedAt") ?? todayDateOnly();
  const completedMeter = optionalNumberValue(formData, "completedMeter");

  if (!equipmentId || !serviceId) {
    redirect("/admin/equipment?error=Choose%20a%20scheduled%20service.");
  }

  const equipment = await ensureTenantEquipment(supabase, equipmentId, context.appUser.tenant_id);

  if (!equipment) {
    redirect("/admin/equipment?error=Choose%20valid%20equipment.");
  }

  const { data: service } = await supabase
    .from("equipment_scheduled_service")
    .select(
      "id, equipment_id, title, service_type, interval_mode, due_date, due_meter, window_start_meter, warn_meter, recurrence_value, recurrence_unit",
    )
    .eq("id", serviceId)
    .eq("equipment_id", equipmentId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<ScheduledServiceActionRow>();

  if (!service) {
    redirectEquipmentError(equipmentId, "service", "Choose a valid scheduled service.");
  }

  const update = buildCompletedScheduledServiceUpdate({
    completedAt,
    completedMeter,
    dueDate: service.due_date,
    dueMeter: numericEquipmentValue(service.due_meter),
    windowStartMeter: numericEquipmentValue(service.window_start_meter),
    warnMeter: numericEquipmentValue(service.warn_meter),
    recurrenceUnit: service.recurrence_unit,
    recurrenceValue: service.recurrence_value,
  });

  const { data: maintenanceLog, error: maintenanceError } = await supabase
    .from("equipment_maintenance_log")
    .insert({
      action_metadata: buildEquipmentActionMetadata({
        action: "equipment.service.complete.maintenance_log",
        actorId: context.appUser.id,
        details: {
          completed_meter: completedMeter,
          scheduled_service_id: serviceId,
        },
        source: "admin",
      }),
      created_by: context.appUser.id,
      description: `Completed scheduled service: ${service.title}`,
      equipment_id: equipmentId,
      meter_at_service: completedMeter,
      performed_at: completedAt,
      performed_by: context.appUser.id,
      tenant_id: context.appUser.tenant_id,
      title: service.title,
      type: "scheduled_service",
    })
    .select("id")
    .single<{ id: string }>();

  if (maintenanceError || !maintenanceLog) {
    redirectEquipmentError(equipmentId, "service", maintenanceError?.message ?? "Service completion log was not created.");
  }

  await recordEquipmentAuditEvent({
    action: "equipment.service.complete.maintenance_log",
    actor: context.appUser,
    entityId: maintenanceLog.id,
    entityTable: "equipment_maintenance_log",
    metadata: {
      completed_at: completedAt,
      completed_meter: completedMeter,
      equipment_id: equipmentId,
      scheduled_service_id: serviceId,
      title: service.title,
    },
  });

  if (completedMeter !== null) {
    const { data: meterLog, error: meterError } = await supabase
      .from("equipment_meter_log")
      .insert({
        action_metadata: buildEquipmentActionMetadata({
          action: "equipment.meter.from_service_completion",
          actorId: context.appUser.id,
          details: {
            scheduled_service_id: serviceId,
            value: completedMeter,
          },
          source: "admin",
        }),
        equipment_id: equipmentId,
        recorded_at: new Date(`${completedAt}T12:00:00`).toISOString(),
        recorded_by: context.appUser.id,
        source: "maintenance",
        tenant_id: context.appUser.tenant_id,
        value: completedMeter,
      })
      .select("id")
      .single<{ id: string }>();

    if (meterError || !meterLog) {
      redirectEquipmentError(equipmentId, "service", meterError?.message ?? "Service completion meter reading was not logged.");
    }

    await recordEquipmentAuditEvent({
      action: "equipment.meter.from_service_completion",
      actor: context.appUser,
      entityId: meterLog.id,
      entityTable: "equipment_meter_log",
      metadata: {
        equipment_id: equipmentId,
        scheduled_service_id: serviceId,
        value: completedMeter,
      },
    });
  }

  const { error } = await supabase
    .from("equipment_scheduled_service")
    .update({
      action_metadata: buildEquipmentActionMetadata({
        action: "equipment.service.complete",
        actorId: context.appUser.id,
        details: {
          completed_at: completedAt,
          completed_meter: completedMeter,
          next_due_date: update.dueDate,
          next_due_meter: update.dueMeter,
          next_window_start_meter: update.windowStartMeter,
          next_warn_meter: update.warnMeter,
        },
        source: "admin",
      }),
      due_date: update.dueDate,
      due_meter: update.dueMeter,
      window_start_meter: update.windowStartMeter,
      warn_meter: update.warnMeter,
      is_active: update.isActive,
      last_completed_at: update.lastCompletedAt,
      last_completed_meter: update.lastCompletedMeter,
    })
    .eq("id", serviceId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirectEquipmentError(equipmentId, "service", error.message);
  }

  await recordEquipmentAuditEvent({
    action: "equipment.service.complete",
    actor: context.appUser,
    entityId: serviceId,
    entityTable: "equipment_scheduled_service",
    metadata: {
      completed_at: completedAt,
      completed_meter: completedMeter,
      equipment_id: equipmentId,
      next_due_date: update.dueDate,
      next_due_meter: update.dueMeter,
    },
  });

  revalidateEquipmentPaths(equipmentId);
  redirect(`${equipmentDetailPath(equipmentId, "service")}&notice=Scheduled%20service%20completed.`);
}

export async function createEquipmentDocument(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const equipmentId = stringValue(formData, "equipmentId");
  const titleInput = stringValue(formData, "title");
  const expiryDate = dateOnlyValue(formData, "expiryDate");
  const attachmentFiles = getUploadFiles(formData, "attachments");
  const docType = coerceEquipmentDocumentType(stringValue(formData, "docType"));

  if (!equipmentId || !expiryDate) {
    redirect("/admin/equipment?error=Choose%20equipment%20and%20enter%20document%20details.");
  }

  const equipment = await ensureTenantEquipment(supabase, equipmentId, context.appUser.tenant_id);

  if (!equipment) {
    redirect("/admin/equipment?error=Choose%20valid%20equipment.");
  }

  // A certification document can name which certification it records, chosen from the
  // tenant's own equipment_certification_types list. Any other document type ignores it.
  const certificationTypeIdInput = stringValue(formData, "certificationTypeId");
  let certificationTypeId: string | null = null;
  let certificationTypeName: string | null = null;

  if (docType === "certification" && certificationTypeIdInput) {
    const { data: certificationType } = await supabase
      .from("equipment_certification_types")
      .select("id, name")
      .eq("id", certificationTypeIdInput)
      .eq("tenant_id", context.appUser.tenant_id)
      .maybeSingle<{ id: string; name: string }>();

    if (!certificationType) {
      redirectEquipmentError(equipmentId, "documents", "Choose a valid certification type.");
    }

    certificationTypeId = certificationType.id;
    certificationTypeName = certificationType.name;
  }

  // Title is optional when a certification type supplies the name, exactly like the
  // worker ticket flow. For every other document it is still required.
  const title = titleInput || certificationTypeName || "";

  if (!title) {
    redirectEquipmentError(equipmentId, "documents", "Enter a document title or choose a certification type.");
  }

  let uploadedAttachmentPaths: string[];

  try {
    uploadedAttachmentPaths = await uploadEquipmentAttachmentFiles({
      equipmentId,
      files: attachmentFiles,
      folder: "documents",
      supabase,
      tenantId: context.appUser.tenant_id,
    });
  } catch (error) {
    redirectEquipmentError(equipmentId, "documents", error instanceof Error ? error.message : "Attachments were not uploaded.");
  }

  const reminderLeadDays = Math.max(0, numberValue(formData, "reminderLeadDays", 30));
  const { data: equipmentDocument, error } = await supabase
    .from("equipment_document")
    .insert({
      action_metadata: buildEquipmentActionMetadata({
        action: "equipment.document.create",
        actorId: context.appUser.id,
        details: {
          attachment_count: uploadedAttachmentPaths.length,
          certification_type_id: certificationTypeId,
          doc_type: docType,
          expiry_date: expiryDate,
        },
        source: "admin",
      }),
      attachment_ids: [...parseEquipmentAttachmentIds(stringValue(formData, "attachmentIds")), ...uploadedAttachmentPaths],
      certification_type_id: certificationTypeId,
      created_by: context.appUser.id,
      doc_type: docType,
      equipment_id: equipmentId,
      expiry_date: expiryDate,
      is_active: true,
      issued_date: dateOnlyValue(formData, "issuedDate"),
      reminder_lead_days: reminderLeadDays,
      tenant_id: context.appUser.tenant_id,
      title,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !equipmentDocument) {
    redirectEquipmentError(equipmentId, "documents", error?.message ?? "Equipment document was not created.");
  }

  await recordEquipmentAuditEvent({
    action: "equipment.document.create",
    actor: context.appUser,
    entityId: equipmentDocument.id,
    entityTable: "equipment_document",
    metadata: {
      attachment_count: uploadedAttachmentPaths.length,
      certification_type_id: certificationTypeId,
      doc_type: docType,
      equipment_id: equipmentId,
      expiry_date: expiryDate,
      title,
    },
  });

  revalidateEquipmentPaths(equipmentId);
  redirect(`${equipmentDetailPath(equipmentId, "documents")}&notice=Equipment%20document%20added.`);
}

export async function createManualEquipmentSubmissionLink(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const equipmentId = stringValue(formData, "equipmentId");
  const submissionId = stringValue(formData, "submissionId");

  if (!equipmentId || !submissionId) {
    redirect("/admin/equipment?error=Choose%20equipment%20and%20a%20submitted%20form.");
  }

  const equipment = await ensureTenantEquipment(supabase, equipmentId, context.appUser.tenant_id);

  if (!equipment) {
    redirect("/admin/equipment?error=Choose%20valid%20equipment.");
  }

  const submission = await ensureTenantSubmission(supabase, submissionId, context.appUser.tenant_id);

  if (!submission) {
    redirectEquipmentError(equipmentId, "forms", "Choose a valid submitted form.");
  }

  const { data: existingLink } = await supabase
    .from("equipment_submission_link")
    .select("id")
    .eq("equipment_id", equipmentId)
    .eq("submission_id", submissionId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string }>();

  if (existingLink) {
    redirect(`${equipmentDetailPath(equipmentId, "forms")}&notice=Submitted%20form%20is%20already%20linked.`);
  }

  const { data: form } = await supabase
    .from("forms")
    .select("id, code")
    .eq("id", submission.form_id)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<EquipmentFormActionRow>();

  const { data: link, error } = await supabase
    .from("equipment_submission_link")
    .insert({
      action_metadata: buildEquipmentActionMetadata({
        action: "equipment.submission_link.create",
        actorId: context.appUser.id,
        details: {
          form_type: form?.code ?? null,
          link_source: "manual",
          submission_id: submissionId,
        },
        source: "admin",
      }),
      created_by: context.appUser.id,
      equipment_id: equipmentId,
      form_type: form?.code ?? null,
      link_source: "manual",
      linked_at: new Date().toISOString(),
      submission_id: submissionId,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !link) {
    redirectEquipmentError(equipmentId, "forms", error?.message ?? "Submitted form was not linked.");
  }

  await recordEquipmentAuditEvent({
    action: "equipment.submission_link.create",
    actor: context.appUser,
    entityId: link.id,
    entityTable: "equipment_submission_link",
    metadata: {
      equipment_id: equipmentId,
      form_type: form?.code ?? null,
      link_source: "manual",
      submission_id: submissionId,
    },
  });

  revalidateEquipmentPaths(equipmentId);
  redirect(`${equipmentDetailPath(equipmentId, "forms")}&notice=Submitted%20form%20linked.`);
}

export async function deleteEquipmentSubmissionLink(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const equipmentId = stringValue(formData, "equipmentId");
  const linkId = stringValue(formData, "linkId");

  if (!equipmentId || !linkId) {
    redirect("/admin/equipment?error=Choose%20a%20linked%20form.");
  }

  const equipment = await ensureTenantEquipment(supabase, equipmentId, context.appUser.tenant_id);

  if (!equipment) {
    redirect("/admin/equipment?error=Choose%20valid%20equipment.");
  }

  const { data: existingLink } = await supabase
    .from("equipment_submission_link")
    .select("id, form_type, link_source, submission_id")
    .eq("id", linkId)
    .eq("equipment_id", equipmentId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string; form_type: string | null; link_source: string; submission_id: string }>();

  if (!existingLink) {
    redirectEquipmentError(equipmentId, "forms", "Choose a valid linked form.");
  }

  const { error } = await supabase
    .from("equipment_submission_link")
    .delete()
    .eq("id", linkId)
    .eq("equipment_id", equipmentId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirectEquipmentError(equipmentId, "forms", error.message);
  }

  await recordEquipmentAuditEvent({
    action: "equipment.submission_link.delete",
    actor: context.appUser,
    entityId: linkId,
    entityTable: "equipment_submission_link",
    metadata: {
      equipment_id: equipmentId,
      form_type: existingLink.form_type,
      link_source: existingLink.link_source,
      submission_id: existingLink.submission_id,
    },
  });

  revalidateEquipmentPaths(equipmentId);
  redirect(`${equipmentDetailPath(equipmentId, "forms")}&notice=Submitted%20form%20unlinked.`);
}

export async function createLocation(formData: FormData) {
  const context = await requireLocationManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");
  const code = normalizeLocationCode(stringValue(formData, "code"), name);
  const status = coerceLocationStatus(stringValue(formData, "status"));
  const visibilityRule = coerceLocationVisibilityRule(stringValue(formData, "visibilityRule"));
  const storedVisibilityRule = status === "inactive" ? "inactive" : visibilityRule;
  const defaultForNewWorkers = boolValue(formData, "defaultForNewWorkers");
  const startDate = dateOnlyValue(formData, "startDate");

  if (!name || !code) {
    redirect("/admin/locations?error=Enter%20a%20location%20name%20and%20code.");
  }

  const { data: location, error } = await supabase
    .from("locations")
    .insert({
      code,
      default_for_new_workers: defaultForNewWorkers,
      name,
      start_date: startDate,
      tenant_id: context.appUser.tenant_id,
      visibility_rule: storedVisibilityRule,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !location) {
    redirect(`/admin/locations?error=${encodeURIComponent(error?.message ?? "Location was not created.")}`);
  }

  if (defaultForNewWorkers) {
    await supabase
      .from("locations")
      .update({ default_for_new_workers: false })
      .eq("tenant_id", context.appUser.tenant_id)
      .neq("id", location.id);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "location.create",
    entityId: location.id,
    entityTable: "locations",
    metadata: {
      code,
      default_for_new_workers: defaultForNewWorkers,
      name,
      start_date: startDate,
      status,
      visibility_rule: storedVisibilityRule,
    },
  });

  revalidatePath("/admin/locations");
  revalidatePath("/admin/workers");
  revalidatePath("/web");
  redirect("/admin/locations?notice=Location%20created.");
}

export async function updateLocation(formData: FormData) {
  const context = await requireLocationManager();
  const supabase = await createSupabaseServerClient();
  const locationId = stringValue(formData, "locationId");
  const name = stringValue(formData, "name");
  const code = normalizeLocationCode(stringValue(formData, "code"), name);
  const status = coerceLocationStatus(stringValue(formData, "status"));
  const visibilityRule = coerceLocationVisibilityRule(stringValue(formData, "visibilityRule"));
  const storedVisibilityRule = status === "inactive" ? "inactive" : visibilityRule;
  const defaultForNewWorkers = boolValue(formData, "defaultForNewWorkers");
  const startDate = dateOnlyValue(formData, "startDate");

  if (!locationId || !name || !code) {
    redirect("/admin/locations?error=Choose%20a%20location%20and%20enter%20a%20name%20and%20code.");
  }

  const { data: existingLocation } = await supabase
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string }>();

  if (!existingLocation) {
    redirect("/admin/locations?error=Choose%20a%20valid%20location.");
  }

  const { data: location, error } = await supabase
    .from("locations")
    .update({
      code,
      default_for_new_workers: defaultForNewWorkers,
      name,
      start_date: startDate,
      visibility_rule: storedVisibilityRule,
    })
    .eq("id", locationId)
    .eq("tenant_id", context.appUser.tenant_id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !location) {
    redirect(`/admin/locations?error=${encodeURIComponent(error?.message ?? "Choose a valid location.")}`);
  }

  if (defaultForNewWorkers && locationIsActive(storedVisibilityRule)) {
    await supabase
      .from("locations")
      .update({ default_for_new_workers: false })
      .eq("tenant_id", context.appUser.tenant_id)
      .neq("id", locationId);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "location.update",
    entityId: location.id,
    entityTable: "locations",
    metadata: {
      code,
      default_for_new_workers: defaultForNewWorkers,
      name,
      start_date: startDate,
      status,
      visibility_rule: storedVisibilityRule,
    },
  });

  revalidatePath("/admin/locations");
  revalidatePath("/admin/workers");
  revalidatePath("/web");
  redirect("/admin/locations?notice=Location%20saved.");
}

export async function createVisitor(formData: FormData) {
  const context = await requireVisitorManager();
  const supabase = await createSupabaseServerClient();
  const locationId = stringValue(formData, "locationId");
  const fullName = stringValue(formData, "fullName");
  const organization = stringValue(formData, "organization") || null;
  const visitReason = stringValue(formData, "visitReason");

  if (!locationId || !fullName || !visitReason) {
    redirect("/admin/visitors?error=Choose%20a%20location%20and%20enter%20visitor%20details.");
  }

  const { data: location } = await supabase
    .from("locations")
    .select("id, visibility_rule")
    .eq("id", locationId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string; visibility_rule: string }>();

  if (!location || !locationIsActive(location.visibility_rule)) {
    redirect("/admin/visitors?error=Choose%20an%20active%20location.");
  }

  const { data: visitor, error } = await supabase
    .from("visitors")
    .insert({
      full_name: fullName,
      location_id: locationId,
      organization,
      tenant_id: context.appUser.tenant_id,
      visit_reason: visitReason,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !visitor) {
    redirect(`/admin/visitors?error=${encodeURIComponent(error?.message ?? "Visitor was not signed in.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "visitor.sign_in",
    entityId: visitor.id,
    entityTable: "visitors",
    metadata: {
      full_name: fullName,
      location_id: locationId,
      organization,
      visit_reason: visitReason,
    },
  });

  revalidatePath("/admin/visitors");
  revalidatePath("/admin/visitors/roster");
  revalidatePath("/web");
  redirect("/admin/visitors?notice=Visitor%20signed%20in.");
}

export async function signOutVisitor(formData: FormData) {
  const context = await requireVisitorManager();
  const supabase = await createSupabaseServerClient();
  const visitorId = stringValue(formData, "visitorId");

  if (!visitorId) {
    redirect("/admin/visitors?error=Choose%20a%20visitor%20to%20sign%20out.");
  }

  const signedOutAt = new Date().toISOString();
  const { data: visitor, error } = await supabase
    .from("visitors")
    .update({ signed_out_at: signedOutAt })
    .eq("id", visitorId)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("signed_out_at", null)
    .select("full_name, id, location_id, organization, signed_in_at, visit_reason")
    .maybeSingle<VisitorAuditRow>();

  if (error || !visitor) {
    redirect(`/admin/visitors?error=${encodeURIComponent(error?.message ?? "Choose an active visitor to sign out.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "visitor.sign_out",
    entityId: visitor.id,
    entityTable: "visitors",
    metadata: {
      full_name: visitor.full_name,
      location_id: visitor.location_id,
      organization: visitor.organization,
      signed_in_at: visitor.signed_in_at,
      signed_out_at: signedOutAt,
      visit_reason: visitor.visit_reason,
    },
  });

  revalidatePath("/admin/visitors");
  revalidatePath("/admin/visitors/roster");
  revalidatePath("/web");
  redirect("/admin/visitors?notice=Visitor%20signed%20out.");
}

type WorkerImportPermissionProfileRow = Pick<
  Database["public"]["Tables"]["permission_profiles"]["Row"],
  "id" | "name" | "power_ceiling"
>;
type WorkerImportLocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "code" | "id" | "name">;
type WorkerImportExistingUserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "id">;

function importLookupValue(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function summarizeWorkerImportErrors(errors: string[]) {
  const preview = errors.slice(0, 3).join(" ");
  return errors.length > 3 ? `${preview} ${errors.length - 3} more errors.` : preview;
}

function isCsvUpload(file: File) {
  const type = file.type.split(";")[0]?.toLowerCase() ?? "";
  return !type || csvMimeTypes.has(type) || file.name.toLowerCase().endsWith(".csv");
}

function findImportPermissionProfile(key: string, profiles: WorkerImportPermissionProfileRow[]) {
  const trimmed = key.trim();
  const normalized = importLookupValue(trimmed);

  return profiles.find(
    (profile) => profile.id.toLowerCase() === trimmed.toLowerCase() || importLookupValue(profile.name) === normalized,
  );
}

function fallbackPermissionProfileId(powerLevel: PowerLevel, profiles: WorkerImportPermissionProfileRow[]) {
  return (
    profiles.find((profile) => profile.power_ceiling === powerLevel)?.id ??
    profiles.find((profile) => profile.power_ceiling === "worker")?.id ??
    profiles[0]?.id ??
    null
  );
}

function resolveImportPermissionProfileId(row: WorkerImportRow, profiles: WorkerImportPermissionProfileRow[]) {
  if (row.permissionProfile) {
    return findImportPermissionProfile(row.permissionProfile, profiles)?.id ?? null;
  }

  return fallbackPermissionProfileId(row.powerLevel, profiles);
}

function buildImportLocationMap(locations: WorkerImportLocationRow[]) {
  const locationMap = new Map<string, string>();

  for (const location of locations) {
    for (const key of [location.id, location.code, location.name]) {
      if (key) {
        const normalized = importLookupValue(key);

        if (normalized && !locationMap.has(normalized)) {
          locationMap.set(normalized, location.id);
        }
      }
    }
  }

  return locationMap;
}

function resolveImportLocationIds(row: WorkerImportRow, locationMap: Map<string, string>) {
  const ids = new Set<string>();

  for (const key of row.locationKeys) {
    const id = locationMap.get(importLookupValue(key));

    if (id) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

function validateWorkerImportReferences(
  rows: WorkerImportRow[],
  profiles: WorkerImportPermissionProfileRow[],
  locations: WorkerImportLocationRow[],
) {
  const errors: string[] = [];
  const locationMap = buildImportLocationMap(locations);

  for (const row of rows) {
    if (row.permissionProfile && !findImportPermissionProfile(row.permissionProfile, profiles)) {
      errors.push(`Row ${row.rowNumber} permission profile "${row.permissionProfile}" was not found.`);
    }

    for (const locationKey of row.locationKeys) {
      if (!locationMap.has(importLookupValue(locationKey))) {
        errors.push(`Row ${row.rowNumber} location "${locationKey}" was not found.`);
      }
    }
  }

  return errors;
}

export async function createWorker(formData: FormData) {
  const context = await requireWorkerManager();
  const adminSupabase = createSupabaseAdminClient();
  const email = stringValue(formData, "email").toLowerCase();
  const fullName = stringValue(formData, "fullName");
  const title = stringValue(formData, "title") || null;
  const phone = normalizePhone(stringValue(formData, "phone")) || null;
  const appAccess = stringValue(formData, "appAccess") as AppAccessLevel;
  const powerLevel = stringValue(formData, "powerLevel") as PowerLevel;
  const permissionProfileId = stringValue(formData, "permissionProfileId") || null;
  const offlineSyncDays = numberValue(formData, "offlineSyncDays", 30);

  if (!adminSupabase) {
    redirect("/admin/workers?error=SUPABASE_SERVICE_ROLE_KEY%20is%20required%20to%20invite%20new%20workers.");
  }

  if (!email || !fullName || !appAccessValues.has(appAccess) || !powerLevelValues.has(powerLevel)) {
    redirect("/admin/workers?error=Enter%20a%20worker%20name,%20email,%20access,%20and%20power%20level.");
  }

  if (!syncDayValues.has(offlineSyncDays)) {
    redirect("/admin/workers?error=Choose%20a%20valid%20offline%20sync%20duration.");
  }

  const invite = await inviteWorkerByEmail(adminSupabase, {
    companyName: context.tenant?.name ?? "Company profile",
    email,
    fullName,
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000"}/auth/confirm`,
    tenantId: context.appUser.tenant_id,
  });

  if (!invite.ok) {
    redirect(`/admin/workers?error=${encodeURIComponent(invite.error)}`);
  }

  const userId = invite.user.id;
  const inviteWarning = invite.emailWarning;
  const { data: bootstrapUser } = await adminSupabase
    .from("users")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle<{ tenant_id: string }>();

  const { error: userError } = await adminSupabase.from("users").upsert(
    {
      active: true,
      app_access: appAccess,
      email,
      full_name: fullName,
      id: userId,
      offline_sync_days: offlineSyncDays,
      permission_profile_id: permissionProfileId,
      power_level: powerLevel,
      reach_type: "specific_locations",
      tenant_id: context.appUser.tenant_id,
    },
    {
      onConflict: "id",
    },
  );

  if (userError) {
    redirect(`/admin/workers?error=${encodeURIComponent(userError.message)}`);
  }

  const { error: profileError } = await adminSupabase.from("worker_profiles").upsert(
    {
      phone,
      tenant_id: context.appUser.tenant_id,
      title,
      user_id: userId,
    },
    {
      onConflict: "tenant_id,user_id",
    },
  );

  if (profileError) {
    redirect(`/admin/workers?error=${encodeURIComponent(profileError.message)}`);
  }

  if (bootstrapUser?.tenant_id && bootstrapUser.tenant_id !== context.appUser.tenant_id) {
    await adminSupabase.from("tenants").delete().eq("id", bootstrapUser.tenant_id);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "worker.invite",
    entityId: userId,
    entityTable: "users",
    metadata: {
      app_access: appAccess,
      email,
      full_name: fullName,
      offline_sync_days: offlineSyncDays,
      permission_profile_id: permissionProfileId,
      power_level: powerLevel,
      title,
    },
  });

  revalidatePath("/admin/workers");
  revalidatePath("/admin/access");
  const successNotice = inviteWarning
    ? `Worker added, but the invite email could not be sent: ${inviteWarning}`
    : "Worker invited.";
  redirect(`/admin/workers?notice=${encodeURIComponent(successNotice)}`);
}

export async function importWorkersFromCsv(formData: FormData) {
  const context = await requireWorkerManager();
  const adminSupabase = createSupabaseAdminClient();
  const csv = getUploadFile(formData, "csv");

  if (!adminSupabase) {
    redirect("/admin/workers?error=SUPABASE_SERVICE_ROLE_KEY%20is%20required%20to%20invite%20new%20workers.");
  }

  if (!csv) {
    redirect("/admin/workers?error=Choose%20a%20CSV%20file.");
  }

  if (!isCsvUpload(csv)) {
    redirect("/admin/workers?error=Choose%20a%20CSV%20file%20for%20bulk%20worker%20import.");
  }

  const parsed = parseWorkerImportCsv(await csv.text());

  if (parsed.errors.length > 0) {
    redirect(`/admin/workers?error=${encodeURIComponent(summarizeWorkerImportErrors(parsed.errors))}`);
  }

  if (parsed.rows.length === 0) {
    redirect("/admin/workers?error=CSV%20import%20has%20no%20valid%20worker%20rows.");
  }

  const emails = Array.from(new Set(parsed.rows.map((row) => row.email)));
  const [{ data: permissionProfiles, error: profilesError }, { data: locations, error: locationsError }, { data: existingUsers, error: existingUsersError }] =
    await Promise.all([
      adminSupabase
        .from("permission_profiles")
        .select("id, name, power_ceiling")
        .eq("tenant_id", context.appUser.tenant_id)
        .order("name")
        .returns<WorkerImportPermissionProfileRow[]>(),
      adminSupabase
        .from("locations")
        .select("id, name, code")
        .eq("tenant_id", context.appUser.tenant_id)
        .returns<WorkerImportLocationRow[]>(),
      adminSupabase
        .from("users")
        .select("id, email")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("email", emails)
        .returns<WorkerImportExistingUserRow[]>(),
    ]);

  if (profilesError) {
    redirect(`/admin/workers?error=${encodeURIComponent(profilesError.message)}`);
  }

  if (locationsError) {
    redirect(`/admin/workers?error=${encodeURIComponent(locationsError.message)}`);
  }

  if (existingUsersError) {
    redirect(`/admin/workers?error=${encodeURIComponent(existingUsersError.message)}`);
  }

  const referenceErrors = validateWorkerImportReferences(parsed.rows, permissionProfiles ?? [], locations ?? []);

  if (referenceErrors.length > 0) {
    redirect(`/admin/workers?error=${encodeURIComponent(summarizeWorkerImportErrors(referenceErrors))}`);
  }

  const locationMap = buildImportLocationMap(locations ?? []);
  const existingUsersByEmail = new Map((existingUsers ?? []).map((user) => [user.email.toLowerCase(), user.id]));
  const failures: string[] = [];
  const emailWarnings: string[] = [];
  let invitedCount = 0;
  let updatedCount = 0;
  let assignedLocationCount = 0;

  for (const row of parsed.rows) {
    let userId = existingUsersByEmail.get(row.email);
    let createdInvite = false;
    let bootstrapTenantId: string | null = null;

    if (!userId) {
      const invite = await inviteWorkerByEmail(adminSupabase, {
        companyName: context.tenant?.name ?? "Company profile",
        email: row.email,
        fullName: row.fullName,
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000"}/auth/confirm`,
        tenantId: context.appUser.tenant_id,
      });

      if (!invite.ok) {
        failures.push(`Row ${row.rowNumber}: ${invite.error}`);
        continue;
      }

      userId = invite.user.id;
      createdInvite = true;
      existingUsersByEmail.set(row.email, userId);

      if (invite.emailWarning) {
        emailWarnings.push(`${row.email}: ${invite.emailWarning}`);
      }

      const { data: bootstrapUser } = await adminSupabase
        .from("users")
        .select("tenant_id")
        .eq("id", userId)
        .maybeSingle<{ tenant_id: string }>();

      bootstrapTenantId = bootstrapUser?.tenant_id ?? null;
    }

    const cleanupBootstrapTenant = async () => {
      if (bootstrapTenantId && bootstrapTenantId !== context.appUser.tenant_id) {
        await adminSupabase.from("tenants").delete().eq("id", bootstrapTenantId);
      }
    };
    const { error: userError } = await adminSupabase.from("users").upsert(
      {
        active: true,
        app_access: row.appAccess,
        email: row.email,
        full_name: row.fullName,
        id: userId,
        offline_sync_days: row.offlineSyncDays,
        permission_profile_id: resolveImportPermissionProfileId(row, permissionProfiles ?? []),
        power_level: row.powerLevel,
        reach_type: "specific_locations",
        tenant_id: context.appUser.tenant_id,
      },
      {
        onConflict: "id",
      },
    );

    if (userError) {
      await cleanupBootstrapTenant();
      failures.push(`Row ${row.rowNumber}: ${userError.message}`);
      continue;
    }

    const { error: profileError } = await adminSupabase.from("worker_profiles").upsert(
      {
        employee_number: row.employeeNumber,
        emergency_contacts: buildEmergencyContacts([
          {
            name: row.emergencyContactName,
            phone: row.emergencyContactPhone,
            relationship: row.emergencyContactRelationship,
          },
        ]),
        hired_on: row.hiredOn,
        phone: row.phone,
        tenant_id: context.appUser.tenant_id,
        title: row.title,
        user_id: userId,
      },
      {
        onConflict: "tenant_id,user_id",
      },
    );

    if (profileError) {
      await cleanupBootstrapTenant();
      failures.push(`Row ${row.rowNumber}: ${profileError.message}`);
      continue;
    }

    if (row.locationKeys.length > 0) {
      const locationIds = resolveImportLocationIds(row, locationMap);
      const { error: deleteError } = await adminSupabase
        .from("user_locations")
        .delete()
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("user_id", userId);

      if (deleteError) {
        await cleanupBootstrapTenant();
        failures.push(`Row ${row.rowNumber}: ${deleteError.message}`);
        continue;
      }

      if (locationIds.length > 0) {
        const { error: insertError } = await adminSupabase.from("user_locations").insert(
          locationIds.map((locationId) => ({
            location_id: locationId,
            tenant_id: context.appUser.tenant_id,
            user_id: userId,
          })),
        );

        if (insertError) {
          await cleanupBootstrapTenant();
          failures.push(`Row ${row.rowNumber}: ${insertError.message}`);
          continue;
        }

        assignedLocationCount += locationIds.length;
      }
    }

    await cleanupBootstrapTenant();

    if (createdInvite) {
      invitedCount += 1;
    } else {
      updatedCount += 1;
    }
  }

  revalidatePath("/admin/workers");
  revalidatePath("/admin/access");

  const completedCount = invitedCount + updatedCount;
  await recordAppUserAuditEvent(context.appUser, {
    action: "worker.import",
    entityTable: "users",
    metadata: {
      assigned_location_count: assignedLocationCount,
      failure_count: failures.length,
      failure_preview: failures.slice(0, 3),
      imported_count: completedCount,
      invited_count: invitedCount,
      row_count: parsed.rows.length,
      status: failures.length > 0 ? "partial" : "completed",
      updated_count: updatedCount,
    },
  });

  if (failures.length > 0) {
    redirect(
      `/admin/workers?error=${encodeURIComponent(`Imported ${completedCount} workers. ${summarizeWorkerImportErrors(failures)}`)}`,
    );
  }

  const locationNotice = assignedLocationCount > 0 ? ` ${assignedLocationCount} location assignments.` : "";
  const emailNotice =
    emailWarnings.length > 0
      ? ` ${emailWarnings.length} invite email${emailWarnings.length === 1 ? "" : "s"} could not be sent; those workers can be re-invited.`
      : "";
  redirect(
    `/admin/workers?notice=${encodeURIComponent(
      `Imported ${invitedCount} new workers and updated ${updatedCount} existing workers.${locationNotice}${emailNotice}`,
    )}`,
  );
}

export async function updateWorkerProfile(formData: FormData) {
  const context = await requireWorkerManager();
  const supabase = await createSupabaseServerClient();
  const userId = stringValue(formData, "userId");
  const fullName = stringValue(formData, "fullName");
  const title = stringValue(formData, "title") || null;
  const phone = normalizePhone(stringValue(formData, "phone")) || null;
  const employeeNumber = stringValue(formData, "employeeNumber") || null;
  const hiredOn = dateOnlyValue(formData, "hiredOn");
  const photo = getUploadFile(formData, "photo");
  const emergencyContacts = buildEmergencyContacts([
    {
      name: stringValue(formData, "emergencyContactName"),
      phone: stringValue(formData, "emergencyContactPhone"),
      relationship: stringValue(formData, "emergencyContactRelationship"),
    },
  ]);

  if (!userId || !fullName) {
    redirect("/admin/workers?error=Choose%20a%20worker%20and%20enter%20a%20name.");
  }

  const { data: targetUser } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string }>();

  if (!targetUser) {
    redirect("/admin/workers?error=Choose%20a%20valid%20worker.");
  }

  let photoPath: string | null | undefined;

  if (photo) {
    if (!logoMimeTypes.has(photo.type)) {
      redirect(`/admin/workers/${userId}?error=Choose%20a%20PNG,%20JPEG,%20or%20WebP%20photo.`);
    }

    photoPath = [
      context.appUser.tenant_id,
      "worker-photos",
      `${Date.now()}-${sanitizeStorageFilename(photo.name)}`,
    ].join("/");

    const { error: uploadError } = await supabase.storage.from("tenant-documents").upload(photoPath, photo, {
      contentType: photo.type,
      upsert: false,
    });

    if (uploadError) {
      redirect(`/admin/workers/${userId}?error=${encodeURIComponent(uploadError.message)}`);
    }
  }

  const { error: userError } = await supabase
    .from("users")
    .update({ full_name: fullName })
    .eq("id", userId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (userError) {
    redirect(`/admin/workers/${userId}?error=${encodeURIComponent(userError.message)}`);
  }

  const { data: workerProfile, error: profileError } = await supabase
    .from("worker_profiles")
    .upsert(
      {
        employee_number: employeeNumber,
        emergency_contacts: emergencyContacts,
        hired_on: hiredOn,
        phone,
        tenant_id: context.appUser.tenant_id,
        title,
        user_id: userId,
        ...(photoPath ? { photo_path: photoPath } : {}),
      },
      {
        onConflict: "tenant_id,user_id",
      },
    )
    .select("id")
    .single<{ id: string }>();

  if (profileError || !workerProfile) {
    redirect(`/admin/workers/${userId}?error=${encodeURIComponent(profileError?.message ?? "Worker profile was not saved.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "worker.profile_update",
    entityId: workerProfile.id,
    entityTable: "worker_profiles",
    metadata: {
      employee_number: employeeNumber,
      emergency_contact_count: emergencyContacts.length,
      full_name: fullName,
      hired_on: hiredOn,
      phone,
      photo_uploaded: Boolean(photoPath),
      title,
      user_id: userId,
    },
  });

  revalidatePath("/admin/workers");
  revalidatePath(`/admin/workers/${userId}`);
  redirect(`/admin/workers/${userId}?notice=Worker%20profile%20saved.`);
}

export async function updateWorkerAccess(formData: FormData) {
  const context = await requireAccessManager();
  const supabase = await createSupabaseServerClient();
  const userId = stringValue(formData, "userId");
  const permissionProfileId = stringValue(formData, "permissionProfileId") || null;
  const appAccess = stringValue(formData, "appAccess") as AppAccessLevel;
  const powerLevel = stringValue(formData, "powerLevel") as PowerLevel;
  const reachType = stringValue(formData, "reachType") as ReachType;
  const offlineSyncDays = numberValue(formData, "offlineSyncDays", 30);

  if (
    !userId ||
    !appAccessValues.has(appAccess) ||
    !powerLevelValues.has(powerLevel) ||
    !reachValues.has(reachType) ||
    !syncDayValues.has(offlineSyncDays)
  ) {
    redirect(`/admin/workers/${userId || ""}?tab=access&error=Invalid%20access%20settings.`);
  }

  const { data: targetUser } = await supabase
    .from("users")
    .select("id, power_level")
    .eq("id", userId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string; power_level: PowerLevel }>();

  if (!targetUser || !canManagePowerLevel(context.appUser.power_level, targetUser.power_level)) {
    redirect(`/admin/workers/${userId}?tab=access&error=You%20cannot%20change%20that%20worker.`);
  }

  if (!canManagePowerLevel(context.appUser.power_level, powerLevel)) {
    redirect(`/admin/workers/${userId}?tab=access&error=You%20cannot%20assign%20that%20power%20level.`);
  }

  const { error } = await supabase
    .from("users")
    .update({
      app_access: appAccess,
      offline_sync_days: offlineSyncDays,
      permission_profile_id: permissionProfileId,
      power_level: powerLevel,
      reach_type: reachType,
    })
    .eq("id", userId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/workers/${userId}?tab=access&error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "user.access_update",
    entityId: userId,
    entityTable: "users",
    metadata: {
      app_access: appAccess,
      offline_sync_days: offlineSyncDays,
      permission_profile_id: permissionProfileId,
      power_level: powerLevel,
      reach_type: reachType,
      source: "worker_detail",
    },
  });

  revalidatePath("/admin/workers");
  revalidatePath(`/admin/workers/${userId}`);
  redirect(`/admin/workers/${userId}?tab=access&notice=Worker%20access%20saved.`);
}

export async function updateWorkerLocations(formData: FormData) {
  const context = await requireAccessManager();
  const supabase = await createSupabaseServerClient();
  const userId = stringValue(formData, "userId");
  const locationIds = formData
    .getAll("locationIds")
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean);
  let assignedLocationIds: string[] = [];

  const { data: targetUser } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string }>();

  if (!targetUser) {
    redirect("/admin/workers?error=Choose%20a%20valid%20worker.");
  }

  const { error: deleteError } = await supabase
    .from("user_locations")
    .delete()
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", userId);

  if (deleteError) {
    redirect(`/admin/workers/${userId}?tab=locations&error=${encodeURIComponent(deleteError.message)}`);
  }

  if (locationIds.length > 0) {
    const { data: validLocations } = await supabase
      .from("locations")
      .select("id")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("id", locationIds)
      .returns<{ id: string }[]>();
    const validLocationIds = new Set((validLocations ?? []).map((location) => location.id));
    const payloads = locationIds
      .filter((locationId) => validLocationIds.has(locationId))
      .map((locationId) => ({
        location_id: locationId,
        tenant_id: context.appUser.tenant_id,
        user_id: userId,
      }));
    assignedLocationIds = payloads.map((payload) => payload.location_id);

    if (payloads.length > 0) {
      const { error: insertError } = await supabase.from("user_locations").insert(payloads);

      if (insertError) {
        redirect(`/admin/workers/${userId}?tab=locations&error=${encodeURIComponent(insertError.message)}`);
      }
    }
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "user.location_assignments_update",
    entityId: userId,
    entityTable: "user_locations",
    metadata: {
      assigned_location_count: assignedLocationIds.length,
      location_ids: assignedLocationIds,
    },
  });

  revalidatePath("/admin/workers");
  revalidatePath(`/admin/workers/${userId}`);
  redirect(`/admin/workers/${userId}?tab=locations&notice=Worker%20locations%20saved.`);
}

export async function createCertificationType(formData: FormData) {
  const context = await requireWorkerManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");
  const expires = boolValue(formData, "expires");

  if (!name) {
    redirect("/admin/certification-types?error=Enter%20a%20certification%20type%20name.");
  }

  const { data: certificationType, error } = await supabase
    .from("certification_types")
    .insert({
      expires,
      name,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !certificationType) {
    redirect(`/admin/certification-types?error=${encodeURIComponent(error?.message ?? "Certification type was not created.")}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "certification_type.create",
    entityId: certificationType.id,
    entityTable: "certification_types",
    metadata: {
      expires,
      name,
    },
  });

  revalidatePath("/admin/certification-types");
  revalidatePath("/admin/workers");
  redirect("/admin/certification-types?notice=Certification%20type%20created.");
}

export async function deleteCertificationType(formData: FormData) {
  const context = await requireWorkerManager();
  const supabase = await createSupabaseServerClient();
  const certificationTypeId = stringValue(formData, "certificationTypeId");

  if (!certificationTypeId) {
    redirect("/admin/certification-types?error=Choose%20a%20certification%20type.");
  }

  const { data: certificationType, error: lookupError } = await supabase
    .from("certification_types")
    .select("expires, id, name")
    .eq("id", certificationTypeId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<CertificationTypeAuditRow>();

  if (lookupError || !certificationType) {
    redirect(
      `/admin/certification-types?error=${encodeURIComponent(
        lookupError?.message ?? "Choose a valid certification type.",
      )}`,
    );
  }

  const { error } = await supabase
    .from("certification_types")
    .delete()
    .eq("id", certificationTypeId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/certification-types?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "certification_type.delete",
    entityId: certificationType.id,
    entityTable: "certification_types",
    metadata: {
      expires: certificationType.expires,
      name: certificationType.name,
    },
  });

  revalidatePath("/admin/certification-types");
  revalidatePath("/admin/workers");
  redirect("/admin/certification-types?notice=Certification%20type%20deleted.");
}

export async function createEquipmentCertificationType(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const name = stringValue(formData, "name");

  if (!name) {
    redirect("/admin/equipment/certification-types?error=Enter%20a%20certification%20type%20name.");
  }

  const { data: certificationType, error } = await supabase
    .from("equipment_certification_types")
    .insert({
      name,
      tenant_id: context.appUser.tenant_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !certificationType) {
    redirect(
      `/admin/equipment/certification-types?error=${encodeURIComponent(error?.message ?? "Certification type was not created.")}`,
    );
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "equipment_certification_type.create",
    entityId: certificationType.id,
    entityTable: "equipment_certification_types",
    metadata: {
      name,
    },
  });

  revalidatePath("/admin/equipment/certification-types");
  redirect("/admin/equipment/certification-types?notice=Certification%20type%20created.");
}

export async function deleteEquipmentCertificationType(formData: FormData) {
  const context = await requireEquipmentManager();
  const supabase = await createSupabaseServerClient();
  const certificationTypeId = stringValue(formData, "certificationTypeId");

  if (!certificationTypeId) {
    redirect("/admin/equipment/certification-types?error=Choose%20a%20certification%20type.");
  }

  const { data: certificationType, error: lookupError } = await supabase
    .from("equipment_certification_types")
    .select("id, name")
    .eq("id", certificationTypeId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string; name: string }>();

  if (lookupError || !certificationType) {
    redirect(
      `/admin/equipment/certification-types?error=${encodeURIComponent(
        lookupError?.message ?? "Choose a valid certification type.",
      )}`,
    );
  }

  // The FK is ON DELETE SET NULL, so units keep the certificates they have already
  // filed against this type. Their titles were captured at upload time, so the record
  // stays readable; it simply stops being one of the offered types.
  const { error } = await supabase
    .from("equipment_certification_types")
    .delete()
    .eq("id", certificationTypeId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(`/admin/equipment/certification-types?error=${encodeURIComponent(error.message)}`);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "equipment_certification_type.delete",
    entityId: certificationType.id,
    entityTable: "equipment_certification_types",
    metadata: {
      name: certificationType.name,
    },
  });

  revalidatePath("/admin/equipment/certification-types");
  redirect("/admin/equipment/certification-types?notice=Certification%20type%20deleted.");
}

export async function createWorkerCertification(formData: FormData) {
  const context = await requireWorkerManager();
  const supabase = await createSupabaseServerClient();
  const storageSupabase = createSupabaseAdminClient() ?? supabase;
  const userId = stringValue(formData, "userId");
  const certificationTypeId = stringValue(formData, "certificationTypeId") || null;
  const manualName = stringValue(formData, "name");
  const issuedOn = dateOnlyValue(formData, "issuedOn");
  const expiresOn = dateOnlyValue(formData, "expiresOn");
  const attachment = getUploadFile(formData, "attachment");
  const returnTo = stringValue(formData, "returnTo");
  const ticketRegisterReturnTo = ["/admin/certification-types", "/admin/worker-tickets"].includes(returnTo)
    ? returnTo
    : null;
  const requiresAttachment = Boolean(ticketRegisterReturnTo);
  const defaultRedirectBase = userId ? `/admin/workers/${userId}?tab=certifications` : "/admin/workers";
  const redirectBase = ticketRegisterReturnTo ?? defaultRedirectBase;
  const redirectToStatus = (key: "error" | "notice", message: string): never => {
    redirect(`${redirectBase}${redirectBase.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`);
  };

  const { data: targetUser } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<{ id: string }>();

  if (!targetUser) {
    redirectToStatus("error", "Choose a valid worker.");
  }

  const { data: certificationType } = certificationTypeId
    ? await supabase
        .from("certification_types")
        .select("id, name")
        .eq("id", certificationTypeId)
        .eq("tenant_id", context.appUser.tenant_id)
        .maybeSingle<{ id: string; name: string }>()
    : { data: null };
  const name = manualName || certificationType?.name || "";

  if (!name) {
    redirectToStatus("error", "Enter a certification name.");
  }

  if (requiresAttachment && !attachment) {
    redirectToStatus("error", "Choose a ticket image or PDF to upload.");
  }

  const { data: workerProfile, error: profileSelectError } = await supabase
    .from("worker_profiles")
    .select("id")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", userId)
    .maybeSingle<{ id: string }>();

  if (profileSelectError) {
    redirectToStatus("error", profileSelectError.message);
  }

  let workerProfileId = workerProfile?.id;

  if (!workerProfileId) {
    const { data: createdProfile, error: profileCreateError } = await supabase
      .from("worker_profiles")
      .insert({
        tenant_id: context.appUser.tenant_id,
        user_id: userId,
      })
      .select("id")
      .single<{ id: string }>();

    if (profileCreateError) {
      redirectToStatus("error", profileCreateError.message);
    }

    if (!createdProfile) {
      redirectToStatus("error", "Worker profile was not created.");
    }

    workerProfileId = createdProfile!.id;
  }

  let attachmentPath: string | null = null;

  if (attachment) {
    const allowedAttachment = certificationAttachmentMimeTypes.has(attachment.type);

    if (!allowedAttachment) {
      redirectToStatus("error", "Choose a PDF, PNG, JPEG, HEIC, or WebP attachment.");
    }

    attachmentPath = [
      context.appUser.tenant_id,
      "certifications",
      `${Date.now()}-${sanitizeStorageFilename(attachment.name)}`,
    ].join("/");

    const { error: uploadError } = await storageSupabase.storage.from("tenant-documents").upload(attachmentPath, attachment, {
      contentType: attachment.type || "application/octet-stream",
      upsert: false,
    });

    if (uploadError) {
      redirectToStatus("error", uploadError.message);
    }
  }

  const { data: certification, error } = await supabase
    .from("certifications")
    .insert({
      attachment_path: attachmentPath,
      certification_type_id: certificationTypeId,
      expires_on: expiresOn,
      issued_on: issuedOn,
      name,
      tenant_id: context.appUser.tenant_id,
      worker_profile_id: workerProfileId,
    })
    .select("id")
    .single<{ id: string }>();

  const certificationId = certification?.id;

  if (error || !certificationId) {
    if (attachmentPath) {
      await storageSupabase.storage.from("tenant-documents").remove([attachmentPath]);
    }

    redirectToStatus("error", error?.message ?? "Certification was not saved.");
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "certification.create",
    entityId: certificationId,
    entityTable: "certifications",
    metadata: {
      attachment_path: attachmentPath,
      certification_type_id: certificationTypeId,
      expires_on: expiresOn,
      issued_on: issuedOn,
      name,
      worker_profile_id: workerProfileId,
      worker_user_id: userId,
    },
  });

  revalidatePath("/admin/workers");
  revalidatePath(`/admin/workers/${userId}`);
  revalidatePath("/admin/certification-types");
  revalidatePath("/admin/worker-tickets");
  redirectToStatus("notice", "Certification added.");
}

export async function deleteWorkerCertification(formData: FormData) {
  const context = await requireWorkerManager();
  const supabase = await createSupabaseServerClient();
  const storageSupabase = createSupabaseAdminClient() ?? supabase;
  const certificationId = stringValue(formData, "certificationId");
  const returnTo = stringValue(formData, "returnTo");
  const workerUserId = stringValue(formData, "workerUserId");
  const allowedReturn = ["/admin/certification-types", "/admin/worker-tickets"].includes(returnTo)
    ? returnTo
    : workerUserId
      ? `/admin/workers/${workerUserId}?tab=certifications`
      : "/admin/certification-types";
  const buildRedirect = (key: "error" | "notice", message: string) =>
    `${allowedReturn}${allowedReturn.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

  if (!certificationId) {
    redirect(buildRedirect("error", "Choose a ticket to delete."));
  }

  const { data: certification, error: lookupError } = await supabase
    .from("certifications")
    .select("attachment_path, certification_type_id, expires_on, id, issued_on, name, worker_profile_id")
    .eq("id", certificationId)
    .eq("tenant_id", context.appUser.tenant_id)
    .maybeSingle<CertificationAuditRow>();

  if (lookupError || !certification) {
    redirect(buildRedirect("error", lookupError?.message ?? "Ticket was not found."));
  }

  const { error } = await supabase
    .from("certifications")
    .delete()
    .eq("id", certificationId)
    .eq("tenant_id", context.appUser.tenant_id);

  if (error) {
    redirect(buildRedirect("error", error.message));
  }

  if (certification.attachment_path) {
    await storageSupabase.storage.from("tenant-documents").remove([certification.attachment_path]);
  }

  await recordAppUserAuditEvent(context.appUser, {
    action: "certification.delete",
    entityId: certification.id,
    entityTable: "certifications",
    metadata: {
      attachment_path: certification.attachment_path,
      certification_type_id: certification.certification_type_id,
      expires_on: certification.expires_on,
      issued_on: certification.issued_on,
      name: certification.name,
      worker_profile_id: certification.worker_profile_id,
    },
  });

  revalidatePath("/admin/workers");
  revalidatePath("/admin/certification-types");
  revalidatePath("/admin/worker-tickets");
  if (workerUserId) {
    revalidatePath(`/admin/workers/${workerUserId}`);
  }
  redirect(buildRedirect("notice", "Employee ticket deleted."));
}
