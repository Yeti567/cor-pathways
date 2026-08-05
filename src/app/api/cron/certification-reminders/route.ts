import { NextResponse } from "next/server";
import { sendCertificationExpiryNotifications } from "@/lib/certification-reminders";
import { sendDailyInspectionNotifications } from "@/lib/daily-inspection-reminders";
import { sendDocumentReviewNotifications } from "@/lib/document-reminders";
import { sendSubcontractorExpiryNotifications } from "@/lib/subcontractor-reminders";
import { sendTransportExpiryNotifications } from "@/lib/transport-reminders";
import { sendHosViolationNotifications } from "@/lib/hos-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type TenantRow = Pick<
  Database["public"]["Tables"]["tenants"]["Row"],
  "id" | "name" | "transport_enabled" | "daily_inspection_enabled" | "subcontractors_enabled"
>;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role key is not configured." }, { status: 500 });
  }

  const { data: tenants, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name, transport_enabled, daily_inspection_enabled, subcontractors_enabled")
    .order("name", { ascending: true })
    .returns<TenantRow[]>();

  if (tenantError) {
    return NextResponse.json({ error: tenantError.message }, { status: 500 });
  }

  const now = new Date();
  const results = [];

  for (const tenant of tenants ?? []) {
    const result = await sendCertificationExpiryNotifications(tenant.id, now, supabase, {
      auditClient: supabase,
      auditSource: "cron",
    });

    if (result.created > 0) {
      await recordTenantAuditEvent(
        {
          action: "certification_reminders.send",
          actorRole: "system",
          entityTable: "notifications",
          metadata: {
            notification_count: result.created,
            skipped_count: result.skipped,
            tenant_name: tenant.name,
          },
          tenantId: tenant.id,
        },
        supabase,
      );
    }

    results.push({
      ...result,
      tenantId: tenant.id,
      tenantName: tenant.name,
    });

    const documentReviewResult = await sendDocumentReviewNotifications(tenant.id, now, supabase, {
      auditClient: supabase,
      auditSource: "cron",
    });

    if (documentReviewResult.created > 0) {
      await recordTenantAuditEvent(
        {
          action: "document_review_reminders.send",
          actorRole: "system",
          entityTable: "notifications",
          metadata: {
            notification_count: documentReviewResult.created,
            skipped_count: documentReviewResult.skipped,
            tenant_name: tenant.name,
          },
          tenantId: tenant.id,
        },
        supabase,
      );
    }

    results.push({
      ...documentReviewResult,
      tenantId: tenant.id,
      tenantName: tenant.name,
    });

    if (tenant.transport_enabled) {
      const transportResult = await sendTransportExpiryNotifications(tenant.id, now, supabase, {
        auditClient: supabase,
        auditSource: "cron",
      });

      if (transportResult.created > 0) {
        await recordTenantAuditEvent(
          {
            action: "transport_reminders.send",
            actorRole: "system",
            entityTable: "notifications",
            metadata: {
              notification_count: transportResult.created,
              skipped_count: transportResult.skipped,
              tenant_name: tenant.name,
            },
            tenantId: tenant.id,
          },
          supabase,
        );
      }

      results.push({
        ...transportResult,
        tenantId: tenant.id,
        tenantName: tenant.name,
      });

      const hosResult = await sendHosViolationNotifications(tenant.id, now, supabase, {
        auditClient: supabase,
        auditSource: "cron",
      });

      if (hosResult.created > 0) {
        await recordTenantAuditEvent(
          {
            action: "hos_reminders.send",
            actorRole: "system",
            entityTable: "notifications",
            metadata: {
              notification_count: hosResult.created,
              skipped_count: hosResult.skipped,
              tenant_name: tenant.name,
            },
            tenantId: tenant.id,
          },
          supabase,
        );
      }

      results.push({
        ...hosResult,
        tenantId: tenant.id,
        tenantName: tenant.name,
      });
    }

    if (tenant.subcontractors_enabled) {
      const subcontractorResult = await sendSubcontractorExpiryNotifications(tenant.id, now, supabase, {
        auditClient: supabase,
        auditSource: "cron",
      });

      if (subcontractorResult.created > 0) {
        await recordTenantAuditEvent(
          {
            action: "subcontractor_reminders.send",
            actorRole: "system",
            entityTable: "notifications",
            metadata: {
              notification_count: subcontractorResult.created,
              skipped_count: subcontractorResult.skipped,
              tenant_name: tenant.name,
            },
            tenantId: tenant.id,
          },
          supabase,
        );
      }

      results.push({
        ...subcontractorResult,
        tenantId: tenant.id,
        tenantName: tenant.name,
      });
    }

    if (tenant.daily_inspection_enabled) {
      const dailyInspectionResult = await sendDailyInspectionNotifications(tenant.id, now, supabase, {
        auditClient: supabase,
        auditSource: "cron",
      });

      if (dailyInspectionResult.created > 0) {
        await recordTenantAuditEvent(
          {
            action: "daily_inspection_reminders.send",
            actorRole: "system",
            entityTable: "notifications",
            metadata: {
              notification_count: dailyInspectionResult.created,
              skipped_count: dailyInspectionResult.skipped,
              tenant_name: tenant.name,
            },
            tenantId: tenant.id,
          },
          supabase,
        );
      }

      results.push({
        ...dailyInspectionResult,
        tenantId: tenant.id,
        tenantName: tenant.name,
      });
    }
  }

  const created = results.reduce((total, result) => total + result.created, 0);
  const skipped = results.reduce((total, result) => total + result.skipped, 0);
  const errors = results.filter((result) => result.error || result.auditError);

  return NextResponse.json({
    ok: errors.length === 0,
    created,
    errors,
    skipped,
    tenants: results.length,
  });
}
