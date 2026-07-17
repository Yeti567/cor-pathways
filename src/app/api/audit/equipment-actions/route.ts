import { NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database, Json } from "@/types/database";

export const dynamic = "force-dynamic";

type EquipmentAuditIds = {
  documentIds: string[];
  equipmentIds: string[];
  maintenanceLogIds: string[];
  meterLogIds: string[];
  scheduledServiceIds: string[];
  submissionLinkIds: string[];
};
type DeletedSubmissionLinkAudit = {
  equipmentId: string;
  id: string | null;
  submissionId: string;
};

type EquipmentAuditRow = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "action_metadata" | "assigned_to" | "id" | "location_id" | "status" | "unit_number"
>;
type MeterLogAuditRow = Pick<
  Database["public"]["Tables"]["equipment_meter_log"]["Row"],
  "action_metadata" | "equipment_id" | "id" | "recorded_at" | "recorded_by" | "source" | "source_submission_id" | "value"
>;
type MaintenanceAuditRow = Pick<
  Database["public"]["Tables"]["equipment_maintenance_log"]["Row"],
  "action_metadata" | "attachment_ids" | "equipment_id" | "id" | "meter_at_service" | "performed_at" | "performed_by" | "title" | "type"
>;
type ScheduledServiceAuditRow = Pick<
  Database["public"]["Tables"]["equipment_scheduled_service"]["Row"],
  | "action_metadata"
  | "due_date"
  | "due_meter"
  | "equipment_id"
  | "id"
  | "interval_mode"
  | "is_active"
  | "last_completed_at"
  | "last_completed_meter"
  | "service_type"
  | "title"
>;
type SubmissionLinkAuditRow = Pick<
  Database["public"]["Tables"]["equipment_submission_link"]["Row"],
  "action_metadata" | "equipment_id" | "form_type" | "id" | "linked_at" | "link_source" | "submission_id"
>;
type EquipmentDocumentAuditRow = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  "action_metadata" | "attachment_ids" | "doc_type" | "equipment_id" | "expiry_date" | "id" | "issued_date" | "title"
>;

const auditIdKeys = [
  "documentIds",
  "equipmentIds",
  "maintenanceLogIds",
  "meterLogIds",
  "scheduledServiceIds",
  "submissionLinkIds",
] as const;

function uniqueStringIds(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return Array.from(new Set(ids)).slice(0, 100);
}

function deletedSubmissionLinksFromBody(value: unknown) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const links: DeletedSubmissionLinkAudit[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const record = item as Record<string, unknown>;
    const equipmentId = typeof record.equipmentId === "string" ? record.equipmentId.trim() : "";
    const submissionId = typeof record.submissionId === "string" ? record.submissionId.trim() : "";
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;

    if (!equipmentId || !submissionId) {
      return null;
    }

    links.push({ equipmentId, id, submissionId });
  }

  return links.slice(0, 100);
}

function auditPayloadFromBody(body: unknown): { deletedSubmissionLinks: DeletedSubmissionLinkAudit[]; ids: EquipmentAuditIds } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const ids = {} as EquipmentAuditIds;

  for (const key of auditIdKeys) {
    if (!(key in record)) {
      ids[key] = [];
      continue;
    }

    const values = uniqueStringIds(record[key]);

    if (!values) {
      return null;
    }

    ids[key] = values;
  }

  const deletedSubmissionLinks = deletedSubmissionLinksFromBody(record.deletedSubmissionLinks);

  if (!deletedSubmissionLinks) {
    return null;
  }

  return { deletedSubmissionLinks, ids };
}

function totalAuditTargets(input: { deletedSubmissionLinks: DeletedSubmissionLinkAudit[]; ids: EquipmentAuditIds }) {
  return auditIdKeys.reduce((count, key) => count + input.ids[key].length, input.deletedSubmissionLinks.length);
}

function metadataRecord(value: Json): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function actionFromMetadata(value: Json, fallback: string) {
  const action = metadataRecord(value).action;
  return typeof action === "string" && action.trim() ? action.trim() : fallback;
}

function metadataWithExtras(actionMetadata: Json, extras: Record<string, Json | undefined>) {
  return {
    ...metadataRecord(actionMetadata),
    sync_source: "offline_sync",
    ...extras,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Equipment audit was not recorded.";
}

export async function POST(request: Request) {
  const context = await getCurrentUserContext();

  if (context.status === "signed_out") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (context.status !== "app_user") {
    return NextResponse.json({ error: "App user access is required." }, { status: 403 });
  }

  const { appUser } = context;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auditPayload = auditPayloadFromBody(body);

  if (!auditPayload) {
    return NextResponse.json({ error: "Equipment audit IDs must be arrays." }, { status: 400 });
  }

  if (totalAuditTargets(auditPayload) === 0) {
    return NextResponse.json({ recorded: 0 });
  }

  const supabase = await createSupabaseServerClient();
  let recorded = 0;

  async function record(input: {
    action: string;
    entityId: string;
    entityTable: string;
    metadata: Record<string, Json | undefined>;
  }) {
    await recordTenantAuditEvent({
      action: input.action,
      actorRole: appUser.power_level,
      actorUserId: appUser.id,
      entityId: input.entityId,
      entityTable: input.entityTable,
      metadata: input.metadata,
      tenantId: appUser.tenant_id,
    });
    recorded += 1;
  }

  try {
    if (auditPayload.ids.equipmentIds.length > 0) {
      const { data: equipmentRows, error } = await supabase
        .from("equipment")
        .select("action_metadata, assigned_to, id, location_id, status, unit_number")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", auditPayload.ids.equipmentIds)
        .returns<EquipmentAuditRow[]>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if ((equipmentRows ?? []).length !== auditPayload.ids.equipmentIds.length) {
        return NextResponse.json({ error: "One or more equipment records were not found." }, { status: 404 });
      }

      const rowById = new Map((equipmentRows ?? []).map((row) => [row.id, row]));

      for (const id of auditPayload.ids.equipmentIds) {
        const row = rowById.get(id);

        if (!row) {
          continue;
        }

        await record({
          action: actionFromMetadata(row.action_metadata, "equipment.update"),
          entityId: row.id,
          entityTable: "equipment",
          metadata: metadataWithExtras(row.action_metadata, {
            assigned_to: row.assigned_to,
            location_id: row.location_id,
            status: row.status,
            unit_number: row.unit_number,
          }),
        });
      }
    }

    if (auditPayload.ids.meterLogIds.length > 0) {
      const { data: meterLogs, error } = await supabase
        .from("equipment_meter_log")
        .select("action_metadata, equipment_id, id, recorded_at, recorded_by, source, source_submission_id, value")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", auditPayload.ids.meterLogIds)
        .returns<MeterLogAuditRow[]>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if ((meterLogs ?? []).length !== auditPayload.ids.meterLogIds.length) {
        return NextResponse.json({ error: "One or more equipment meter logs were not found." }, { status: 404 });
      }

      const rowById = new Map((meterLogs ?? []).map((row) => [row.id, row]));

      for (const id of auditPayload.ids.meterLogIds) {
        const row = rowById.get(id);

        if (!row) {
          continue;
        }

        await record({
          action: actionFromMetadata(row.action_metadata, "equipment.meter.create"),
          entityId: row.id,
          entityTable: "equipment_meter_log",
          metadata: metadataWithExtras(row.action_metadata, {
            equipment_id: row.equipment_id,
            recorded_at: row.recorded_at,
            recorded_by: row.recorded_by,
            source_submission_id: row.source_submission_id,
            meter_source: row.source,
            value: row.value,
          }),
        });
      }
    }

    if (auditPayload.ids.maintenanceLogIds.length > 0) {
      const { data: maintenanceLogs, error } = await supabase
        .from("equipment_maintenance_log")
        .select("action_metadata, attachment_ids, equipment_id, id, meter_at_service, performed_at, performed_by, title, type")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", auditPayload.ids.maintenanceLogIds)
        .returns<MaintenanceAuditRow[]>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if ((maintenanceLogs ?? []).length !== auditPayload.ids.maintenanceLogIds.length) {
        return NextResponse.json({ error: "One or more equipment maintenance logs were not found." }, { status: 404 });
      }

      const rowById = new Map((maintenanceLogs ?? []).map((row) => [row.id, row]));

      for (const id of auditPayload.ids.maintenanceLogIds) {
        const row = rowById.get(id);

        if (!row) {
          continue;
        }

        await record({
          action: actionFromMetadata(row.action_metadata, "equipment.maintenance.create"),
          entityId: row.id,
          entityTable: "equipment_maintenance_log",
          metadata: metadataWithExtras(row.action_metadata, {
            attachment_count: row.attachment_ids.length,
            equipment_id: row.equipment_id,
            meter_at_service: row.meter_at_service,
            performed_at: row.performed_at,
            performed_by: row.performed_by,
            title: row.title,
            type: row.type,
          }),
        });
      }
    }

    if (auditPayload.ids.scheduledServiceIds.length > 0) {
      const { data: scheduledServices, error } = await supabase
        .from("equipment_scheduled_service")
        .select(
          "action_metadata, due_date, due_meter, equipment_id, id, interval_mode, is_active, last_completed_at, last_completed_meter, service_type, title",
        )
        .eq("tenant_id", appUser.tenant_id)
        .in("id", auditPayload.ids.scheduledServiceIds)
        .returns<ScheduledServiceAuditRow[]>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if ((scheduledServices ?? []).length !== auditPayload.ids.scheduledServiceIds.length) {
        return NextResponse.json({ error: "One or more equipment scheduled services were not found." }, { status: 404 });
      }

      const rowById = new Map((scheduledServices ?? []).map((row) => [row.id, row]));

      for (const id of auditPayload.ids.scheduledServiceIds) {
        const row = rowById.get(id);

        if (!row) {
          continue;
        }

        await record({
          action: actionFromMetadata(row.action_metadata, "equipment.service.create"),
          entityId: row.id,
          entityTable: "equipment_scheduled_service",
          metadata: metadataWithExtras(row.action_metadata, {
            due_date: row.due_date,
            due_meter: row.due_meter,
            equipment_id: row.equipment_id,
            interval_mode: row.interval_mode,
            is_active: row.is_active,
            last_completed_at: row.last_completed_at,
            last_completed_meter: row.last_completed_meter,
            service_type: row.service_type,
            title: row.title,
          }),
        });
      }
    }

    if (auditPayload.ids.documentIds.length > 0) {
      const { data: documents, error } = await supabase
        .from("equipment_document")
        .select("action_metadata, attachment_ids, doc_type, equipment_id, expiry_date, id, issued_date, title")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", auditPayload.ids.documentIds)
        .returns<EquipmentDocumentAuditRow[]>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if ((documents ?? []).length !== auditPayload.ids.documentIds.length) {
        return NextResponse.json({ error: "One or more equipment documents were not found." }, { status: 404 });
      }

      const rowById = new Map((documents ?? []).map((row) => [row.id, row]));

      for (const id of auditPayload.ids.documentIds) {
        const row = rowById.get(id);

        if (!row) {
          continue;
        }

        await record({
          action: actionFromMetadata(row.action_metadata, "equipment.document.create"),
          entityId: row.id,
          entityTable: "equipment_document",
          metadata: metadataWithExtras(row.action_metadata, {
            attachment_count: row.attachment_ids.length,
            doc_type: row.doc_type,
            equipment_id: row.equipment_id,
            expiry_date: row.expiry_date,
            issued_date: row.issued_date,
            title: row.title,
          }),
        });
      }
    }

    if (auditPayload.ids.submissionLinkIds.length > 0) {
      const { data: submissionLinks, error } = await supabase
        .from("equipment_submission_link")
        .select("action_metadata, equipment_id, form_type, id, linked_at, link_source, submission_id")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", auditPayload.ids.submissionLinkIds)
        .returns<SubmissionLinkAuditRow[]>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if ((submissionLinks ?? []).length !== auditPayload.ids.submissionLinkIds.length) {
        return NextResponse.json({ error: "One or more equipment submission links were not found." }, { status: 404 });
      }

      const rowById = new Map((submissionLinks ?? []).map((row) => [row.id, row]));

      for (const id of auditPayload.ids.submissionLinkIds) {
        const row = rowById.get(id);

        if (!row) {
          continue;
        }

        await record({
          action: actionFromMetadata(row.action_metadata, "equipment.submission_link.create"),
          entityId: row.id,
          entityTable: "equipment_submission_link",
          metadata: metadataWithExtras(row.action_metadata, {
            equipment_id: row.equipment_id,
            form_type: row.form_type,
            linked_at: row.linked_at,
            link_source: row.link_source,
            submission_id: row.submission_id,
          }),
        });
      }
    }

    if (auditPayload.deletedSubmissionLinks.length > 0) {
      const equipmentIds = Array.from(new Set(auditPayload.deletedSubmissionLinks.map((link) => link.equipmentId)));
      const submissionIds = Array.from(new Set(auditPayload.deletedSubmissionLinks.map((link) => link.submissionId)));
      const [{ data: equipmentRows, error: equipmentError }, { data: submissionRows, error: submissionError }] =
        await Promise.all([
          supabase
            .from("equipment")
            .select("id, unit_number")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", equipmentIds)
            .returns<Pick<EquipmentAuditRow, "id" | "unit_number">[]>(),
          supabase
            .from("submissions")
            .select("id, form_id")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", submissionIds)
            .returns<Pick<Database["public"]["Tables"]["submissions"]["Row"], "form_id" | "id">[]>(),
        ]);

      if (equipmentError) {
        return NextResponse.json({ error: equipmentError.message }, { status: 500 });
      }

      if (submissionError) {
        return NextResponse.json({ error: submissionError.message }, { status: 500 });
      }

      if ((equipmentRows ?? []).length !== equipmentIds.length || (submissionRows ?? []).length !== submissionIds.length) {
        return NextResponse.json({ error: "One or more deleted equipment submission links were not found." }, { status: 404 });
      }

      const equipmentById = new Map((equipmentRows ?? []).map((row) => [row.id, row]));
      const submissionById = new Map((submissionRows ?? []).map((row) => [row.id, row]));

      for (const link of auditPayload.deletedSubmissionLinks) {
        await record({
          action: "equipment.submission_link.delete",
          entityId: link.id ?? `${link.equipmentId}:${link.submissionId}`,
          entityTable: "equipment_submission_link",
          metadata: {
            equipment_id: link.equipmentId,
            form_id: submissionById.get(link.submissionId)?.form_id,
            submission_id: link.submissionId,
            sync_source: "offline_sync",
            unit_number: equipmentById.get(link.equipmentId)?.unit_number,
          },
        });
      }
    }
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ recorded });
}
