import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

export type TenantAuditActorRole = Database["public"]["Enums"]["power_level"] | "system";
export type TenantAuditEventInsert = Database["public"]["Tables"]["tenant_audit_log"]["Insert"];
type ConsultantLoginRow = Pick<Database["public"]["Tables"]["consultants"]["Row"], "active" | "email" | "full_name" | "id">;
type ConsultantLoginTenantRow = Pick<Database["public"]["Tables"]["tenants"]["Row"], "consultant_access_revoked" | "id">;
type ConsultantLoginAccessRow = Pick<
  Database["public"]["Tables"]["consultant_access"]["Row"],
  "allowed" | "override_condition" | "override_expires_at" | "tenant_id"
>;

export type TenantAuditEventInput = {
  tenantId: string;
  action: string;
  actorUserId?: string | null;
  actorRole?: TenantAuditActorRole | string | null;
  entityTable?: string | null;
  entityId?: string | null;
  metadata?: Json | Record<string, Json | undefined> | null;
};

type TenantAuditClient = Pick<SupabaseClient<Database>, "from">;
const overrideConditions = new Set(["court_order", "ministry_order", "ninety_day_dormancy"]);

function optionalString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function compactMetadata(metadata: TenantAuditEventInput["metadata"]): Json {
  if (!metadata) {
    return {};
  }

  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata;
  }

  const compacted: Record<string, Json> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      compacted[key] = value;
    }
  }

  return compacted;
}

export function buildTenantAuditEvent(input: TenantAuditEventInput): TenantAuditEventInsert {
  const tenantId = optionalString(input.tenantId);
  const action = optionalString(input.action);

  if (!tenantId) {
    throw new Error("A tenant id is required to record an audit event.");
  }

  if (!action) {
    throw new Error("An audit action is required.");
  }

  return {
    tenant_id: tenantId,
    action,
    actor_role: optionalString(input.actorRole),
    actor_user_id: optionalString(input.actorUserId),
    entity_id: optionalString(input.entityId),
    entity_table: optionalString(input.entityTable),
    metadata: compactMetadata(input.metadata),
  };
}

export async function recordTenantAuditEvent(
  input: TenantAuditEventInput,
  supabase: TenantAuditClient | null = createSupabaseAdminClient(),
) {
  // Audit logging is best-effort: it must never break the user action that
  // triggered it. A missing service-role client (e.g. SUPABASE_SERVICE_ROLE_KEY
  // unset) or an insert failure is logged for operators, not thrown.
  if (!supabase) {
    console.error(
      "[tenant-audit] Skipped audit event; service-role client unavailable (SUPABASE_SERVICE_ROLE_KEY not configured).",
      { action: input.action, tenantId: input.tenantId },
    );
    return;
  }

  try {
    const payload = buildTenantAuditEvent(input);
    const { error } = await supabase.from("tenant_audit_log").insert(payload);

    if (error) {
      console.error("[tenant-audit] Failed to record tenant audit event.", {
        action: input.action,
        tenantId: input.tenantId,
        error: error.message ?? error,
      });
    }
  } catch (error) {
    console.error("[tenant-audit] Unexpected error recording tenant audit event.", {
      action: input.action,
      tenantId: input.tenantId,
      error,
    });
  }
}

export function resolveConsultantLoginTenantIds(input: {
  accessRows: ConsultantLoginAccessRow[];
  now?: Date;
  tenants: ConsultantLoginTenantRow[];
}) {
  const now = input.now ?? new Date();
  const tenantIds = new Set<string>();

  for (const tenant of input.tenants) {
    if (!tenant.consultant_access_revoked) {
      tenantIds.add(tenant.id);
    }
  }

  for (const accessRow of input.accessRows) {
    const expiresAt = accessRow.override_expires_at ? new Date(accessRow.override_expires_at) : null;
    const isExpired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;

    if (
      accessRow.allowed &&
      accessRow.override_condition &&
      overrideConditions.has(accessRow.override_condition) &&
      !isExpired
    ) {
      tenantIds.add(accessRow.tenant_id);
    }
  }

  return Array.from(tenantIds).sort();
}

export async function recordConsultantLoginAuditEvents(
  input: {
    consultantId: string | null | undefined;
    method: "password" | "sso";
    nextPath?: string | null;
  },
  supabase: TenantAuditClient | null = createSupabaseAdminClient(),
) {
  const consultantId = optionalString(input.consultantId);

  if (!consultantId) {
    return 0;
  }

  if (!supabase) {
    console.error(
      "[tenant-audit] Skipped consultant login audit; service-role client unavailable (SUPABASE_SERVICE_ROLE_KEY not configured).",
    );
    return 0;
  }

  const { data: consultant, error: consultantError } = await supabase
    .from("consultants")
    .select("active, email, full_name, id")
    .eq("id", consultantId)
    .maybeSingle<ConsultantLoginRow>();

  if (consultantError) {
    throw consultantError;
  }

  if (!consultant?.active) {
    return 0;
  }

  const [{ data: tenants, error: tenantsError }, { data: accessRows, error: accessError }] = await Promise.all([
    supabase
      .from("tenants")
      .select("consultant_access_revoked, id")
      .returns<ConsultantLoginTenantRow[]>(),
    supabase
      .from("consultant_access")
      .select("allowed, override_condition, override_expires_at, tenant_id")
      .eq("consultant_id", consultant.id)
      .returns<ConsultantLoginAccessRow[]>(),
  ]);

  if (tenantsError) {
    throw tenantsError;
  }

  if (accessError) {
    throw accessError;
  }

  const tenantIds = resolveConsultantLoginTenantIds({
    accessRows: accessRows ?? [],
    tenants: tenants ?? [],
  });

  if (tenantIds.length === 0) {
    return 0;
  }

  const payloads = tenantIds.map((tenantId) =>
    buildTenantAuditEvent({
      action: "consultant.login",
      actorRole: "consultant",
      actorUserId: consultant.id,
      entityId: consultant.id,
      entityTable: "consultants",
      metadata: {
        email: consultant.email,
        full_name: consultant.full_name,
        method: input.method,
        next_path: optionalString(input.nextPath),
      },
      tenantId,
    }),
  );

  const { error } = await supabase.from("tenant_audit_log").insert(payloads);

  if (error) {
    throw error;
  }

  return payloads.length;
}

export async function recordConsultantLoginAuditEventsForSession(
  input: {
    consultantId: string | null | undefined;
    method: "password" | "sso";
    nextPath?: string | null;
  },
  sessionSupabase: TenantAuditClient,
) {
  const consultantId = optionalString(input.consultantId);

  if (!consultantId) {
    return 0;
  }

  const { data: consultant, error } = await sessionSupabase
    .from("consultants")
    .select("id")
    .eq("id", consultantId)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw error;
  }

  if (!consultant) {
    return 0;
  }

  return recordConsultantLoginAuditEvents(input);
}
