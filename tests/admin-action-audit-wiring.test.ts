import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminActions = readFileSync(join(process.cwd(), "src/app/admin/actions.ts"), "utf8");
const appActions = readFileSync(join(process.cwd(), "src/app/actions.ts"), "utf8");
const autoSharePage = readFileSync(join(process.cwd(), "src/app/admin/auto-share/page.tsx"), "utf8");

function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("admin action audit wiring", () => {
  it("uses the tenant audit helper for consultant access changes", () => {
    expect(adminActions).toContain('from "@/lib/tenant-audit"');
    expect(adminActions).toContain('action: "consultant_access.revocation_update"');
    expect(adminActions).toContain('action: "consultant_access.override_requested"');
  });

  it("records tenant audit events for equipment action flows", () => {
    for (const action of [
      "equipment.create",
      "equipment.update",
      "equipment.photos.upload",
      "equipment.meter.initial",
      "equipment.meter.create",
      "equipment.maintenance.create",
      "equipment.meter.from_maintenance",
      "equipment.service.create",
      "equipment.service.complete.maintenance_log",
      "equipment.meter.from_service_completion",
      "equipment.service.complete",
      "equipment.document.create",
      "equipment.submission_link.create",
      "equipment.submission_link.delete",
    ]) {
      expect(adminActions).toMatch(new RegExp(`recordEquipmentAuditEvent\\(\\{[\\s\\S]*action: "${escapedRegExp(action)}"`));
    }
  });

  it("records tenant audit events for document control flows", () => {
    for (const action of [
      "document_control.setting.update",
      "document_control.numbering.update",
      "document_control.register",
      "document_resource.upload",
      "document_resource.assignment_update",
      "document_control.approve",
      "document_control.revision_request",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "document_control_register"');
    expect(adminActions).toContain('source_table: input.sourceTable');
  });

  it("records tenant audit events for resource library section changes", () => {
    for (const action of [
      "resource_section.create",
      "resource_section.update",
      "resource_section.reorder",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "resource_sections"');
    expect(adminActions).toContain("ordered_section_ids: orderUpdates.map");
  });

  it("records tenant audit events for auto-share delivery operations", () => {
    for (const action of [
      "auto_share.recipient.create",
      "auto_share.recipient.active_update",
      "auto_share.email.process.delivered",
      "auto_share.email.process.failed",
      "auto_share.email.retry.delivered",
      "auto_share.email.retry.failed",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "auto_share_recipients"');
    expect(adminActions).toContain('entityTable: "notifications"');
  });

  it("reports the exact missing email delivery configuration from process and retry actions", () => {
    expect(adminActions).toContain("getMissingEmailDeliveryEnv");
    expect(adminActions).toContain("emailDeliveryConfigurationError");
    expect(adminActions).toContain('Email delivery is missing required configuration: ${missingEnv.join(", ")}.');
    expect(adminActions).not.toContain("Email%20delivery%20webhook%20is%20not%20configured.");
  });

  it("shows production delivery guidance for auto-share configuration", () => {
    expect(autoSharePage).toContain("EMAIL_DELIVERY_WEBHOOK_URL");
    expect(autoSharePage).toContain("EMAIL_DELIVERY_FROM");
    expect(autoSharePage).toContain("EMAIL_DELIVERY_WEBHOOK_SECRET");
    expect(autoSharePage).toContain("Webhook credentials");
    expect(autoSharePage).toContain("phone-only recipients are blocked");
    expect(autoSharePage).toContain("delivery attempt(s)");
    expect(autoSharePage).toContain("Last error:");
  });

  it("blocks phone-only auto-share recipients while SMS delivery is unavailable", () => {
    expect(adminActions).toContain("autoShareRecipientContactError");
    expect(adminActions).toContain("contactError");
    expect(autoSharePage).toContain("Phone is stored as a secondary contact only");
    expect(autoSharePage).toContain("phone-only recipients are blocked");
  });

  it("records tenant audit events for workflow station changes and reminders", () => {
    for (const action of [
      "workflow.create",
      "workflow.enabled_update",
      "workflow.step.create",
      "workflow.condition.create",
      "workflow.schedule.create",
      "workflow.scheduled_task.status_update",
      "workflow.scheduled_task.notification.sent",
      "workflow.overdue_reminders.send",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "workflows"');
    expect(adminActions).toContain('entityTable: "workflow_steps"');
    expect(adminActions).toContain('entityTable: "workflow_conditions"');
    expect(adminActions).toContain('entityTable: "schedules"');
    expect(adminActions).toContain('entityTable: "scheduled_tasks"');
  });

  it("records tenant audit events for corrective-action follow-up changes", () => {
    expect(adminActions).toContain('action: "follow_up.update"');
    expect(appActions).toContain('action: "follow_up.worker_status_update"');
    expect(appActions).toContain('action: "follow_up.worker_signoff"');
    expect(adminActions).toContain('entityTable: "follow_ups"');
    expect(appActions).toContain('entityTable: "follow_ups"');
    expect(adminActions).toContain("assigned_to: assignedTo");
    expect(appActions).toContain("parent_submission_id: updatedFollowUp.parent_submission_id");
    expect(appActions).toContain("signoff_at: now");
  });

  it("records tenant audit events for certification ticket creation", () => {
    expect(adminActions).toContain('action: "certification.create"');
    expect(adminActions).toContain('entityTable: "certifications"');
    expect(adminActions).toContain("worker_user_id: userId");
    expect(appActions).toContain('action: "certification.worker_upload"');
    expect(appActions).toContain('entityTable: "certifications"');
    expect(appActions).toContain("worker_profile_id: workerProfileId");
  });

  it("records tenant audit events for worker time card presence", () => {
    expect(appActions).toContain('action: "worker_time_card.clock_in"');
    expect(appActions).toContain('action: "worker_time_card.clock_out"');
    expect(appActions).toContain('entityTable: "worker_time_cards"');
    expect(appActions).toContain('source: "worker_app"');
    expect(appActions).toContain('revalidatePath("/admin/visitors/roster")');
  });

  it("records tenant audit events for worker profile and certification type changes", () => {
    for (const action of [
      "worker.profile_update",
      "certification_type.create",
      "certification_type.delete",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "worker_profiles"');
    expect(adminActions).toContain('entityTable: "certification_types"');
    expect(adminActions).toContain("emergency_contact_count: emergencyContacts.length");
    expect(adminActions).toContain("photo_uploaded: Boolean(photoPath)");
    expect(adminActions).toContain("expires: certificationType.expires");
  });

  it("records tenant audit events for worker invite and CSV import actions", () => {
    expect(adminActions).toContain('action: "worker.invite"');
    expect(adminActions).toContain('action: "worker.import"');
    expect(adminActions).toContain('entityTable: "users"');
    expect(adminActions).toContain("invited_count: invitedCount");
    expect(adminActions).toContain("updated_count: updatedCount");
    expect(adminActions).toContain("failure_count: failures.length");
    expect(adminActions).toContain('status: failures.length > 0 ? "partial" : "completed"');
  });

  it("records tenant audit events for form template creation, imports, and settings changes", () => {
    for (const action of [
      "form_template.create",
      "form_template.import",
      "form_template.settings_update",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "forms"');
    expect(adminActions).toContain("detected_text_length: input.detectedText.length");
    expect(adminActions).toContain("field_count: fields.length");
    expect(adminActions).toContain("use_item_data_in_analytics");
  });

  it("keeps admin actions usable when tenant audit service-role configuration is missing", () => {
    expect(adminActions).toContain("async function recordAdminTenantAuditEvent");
    expect(adminActions).toContain("isMissingTenantAuditClientError(error)");
    expect(adminActions).toContain("Tenant audit event skipped because SUPABASE_SERVICE_ROLE_KEY is not configured");
    expect(adminActions).toContain("await recordAdminTenantAuditEvent({");
  });

  it("records tenant audit events for form builder section and field changes", () => {
    for (const action of [
      "form_section.create",
      "form_section.update",
      "form_section.delete",
      "form_section.duplicate",
      "form_section.reorder",
      "form_item.create",
      "form_item.update",
      "form_item.delete",
      "form_item.duplicate",
      "form_item.label_setting_update",
      "form_item.reorder",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "form_sections"');
    expect(adminActions).toContain('entityTable: "form_items"');
    expect(adminActions).toContain("source_section_id: sectionId");
    expect(adminActions).toContain("source_item_id: itemId");
    expect(adminActions).toContain("ordered_section_ids: orderUpdates.map");
    expect(adminActions).toContain("ordered_item_ids: orderUpdates.map");
  });

  it("records tenant audit events for managed list and item changes", () => {
    for (const action of [
      "managed_list.create",
      "managed_list.update",
      "managed_list.delete",
      "managed_list_item.create",
      "managed_list_item.update",
      "managed_list_item.delete",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "lists"');
    expect(adminActions).toContain('entityTable: "list_items"');
    expect(adminActions).toContain("include_other: includeOther");
    expect(adminActions).toContain("list_id: listId");
    expect(adminActions).toContain("sort_order: sortOrder");
  });

  it("records tenant audit events for company and print settings changes", () => {
    for (const action of [
      "company_settings.update",
      "print_settings.update",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "company_settings"');
    expect(adminActions).toContain('entityTable: "print_settings"');
    expect(adminActions).toContain("integration_keys: integrationKeys");
    expect(adminActions).toContain("logo_uploaded: Boolean(logoPath)");
    expect(adminActions).toContain("show_printed_at: showPrintedAt");
  });

  it("records tenant audit events for access-management changes", () => {
    for (const action of [
      "user.access_update",
      "permission_profile.create",
      "user.location_assignments_update",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "permission_profiles"');
    expect(adminActions).toContain('entityTable: "user_locations"');
    expect(adminActions).toContain("permission_profile_id: permissionProfileId");
    expect(adminActions).toContain("reach_type: reachType");
    expect(adminActions).toContain("assigned_location_count: assignedLocationIds.length");
  });

  it("records tenant audit events for locations and visitor roster changes", () => {
    for (const action of [
      "location.create",
      "location.update",
      "visitor.sign_in",
      "visitor.sign_out",
    ]) {
      expect(adminActions).toContain(`action: "${action}"`);
    }

    expect(adminActions).toContain('entityTable: "locations"');
    expect(adminActions).toContain('entityTable: "visitors"');
    expect(adminActions).toContain("visibility_rule: storedVisibilityRule");
    expect(adminActions).toContain("signed_out_at: signedOutAt");
    expect(adminActions).toContain('revalidatePath("/admin/visitors/roster")');
  });
});
