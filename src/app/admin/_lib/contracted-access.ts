// Shared plumbing for the two contracted sections.
//
// Not a "use server" module on purpose: those may only export async functions, and the
// form parsers below are plain synchronous helpers that both action files need.

import { redirect } from "next/navigation";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export const CONTRACTED_EQUIPMENT_PATH = "/admin/contracted-equipment";
export const CONTRACTED_DRIVERS_PATH = "/admin/contracted-drivers";

/**
 * Module write gate: an admin-capable user in a tenant with the module switched on.
 *
 * Defence in depth behind the hidden nav entry and the page guard. Those two shape what
 * a person sees; this decides what the server will accept, which is the only part that
 * cannot be skipped by typing a URL.
 *
 * Gated on subcontractors_enabled rather than a flag of its own. Contracted units and
 * drivers hang off a carrier record, so there is nothing coherent to show when the
 * company layer is off, and a second flag would only create a state where half the
 * module works.
 */
export async function requireContractedManager() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.subcontractors_enabled) {
    redirect("/admin/setup");
  }

  return context;
}

export type ContractedManagerContext = Awaited<ReturnType<typeof requireContractedManager>>;

export async function auditContracted(
  context: ContractedManagerContext,
  input: { action: string; entityId: string; entityTable: string; metadata?: Record<string, unknown> },
) {
  await recordTenantAuditEvent({
    tenantId: context.appUser.tenant_id,
    actorRole: context.appUser.power_level,
    actorUserId: context.appUser.id,
    action: input.action,
    entityId: input.entityId,
    entityTable: input.entityTable,
    metadata: (input.metadata ?? {}) as Record<string, never>,
  });
}

/**
 * Confirm a carrier belongs to this tenant before anything is written against it.
 *
 * Row level security would refuse a cross-tenant write anyway, but it refuses by
 * matching nothing, which reads back as a successful update of zero rows. Checking first
 * turns that silence into a message that names the problem.
 */
export async function requireOwnedCarrier(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  subcontractorId: string,
): Promise<{ id: string; legal_name: string } | null> {
  if (!subcontractorId) {
    return null;
  }

  const { data } = await supabase
    .from("subcontractor")
    .select("id, legal_name")
    .eq("tenant_id", tenantId)
    .eq("id", subcontractorId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; legal_name: string }>();

  return data ?? null;
}

// --- Form helpers (mirrors the admin/actions.ts conventions) ------------------

export function stringValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export function optionalString(formData: FormData, key: string): string | null {
  const value = stringValue(formData, key);
  return value ? value : null;
}

/**
 * A date, or null.
 *
 * Null is a real answer throughout these two sections, unlike on the fleet tables: a
 * fire extinguisher tag with a serial and no printed date, a Common Safety Orientation
 * that never expires. Anything that is not an ISO date is null rather than a guess,
 * because inventing an expiry to satisfy a form puts a false renewal on the board.
 */
export function optionalDate(formData: FormData, key: string): string | null {
  const value = stringValue(formData, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function optionalInteger(formData: FormData, key: string): number | null {
  const value = stringValue(formData, key);

  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) ? parsed : null;
}

export function choiceValue<T extends string>(
  formData: FormData,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = stringValue(formData, key);
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function backTo(path: string, message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

export function readableContractedWriteError(message: string, code?: string): string {
  if (code === "23505" && message.includes("contracted_equipment_tenant_unit_number_key")) {
    return "A contracted unit with that unit number already exists.";
  }

  if (code === "23505" && message.includes("contracted_driver_company_name_key")) {
    return "That carrier already has a driver with that name.";
  }

  if (code === "23503") {
    return "That carrier or unit no longer exists. Refresh the page and try again.";
  }

  return message;
}
