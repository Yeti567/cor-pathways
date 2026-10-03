// Gathers the counts behind the Getting Started checklist. Counts only; buildGettingStarted
// decides what they mean.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildGettingStarted, SEEDED_FORM_CODES, type GettingStartedStep } from "@/lib/getting-started";
import { selectAllRows } from "@/lib/supabase/select-all";
import { loadUnitFinishes } from "@/lib/unit-finish-data";
import type { Database } from "@/types/database";

export async function loadGettingStarted(supabase: SupabaseClient<Database>, tenantId: string): Promise<GettingStartedStep[]> {
  const [users, profiles, workerTickets, drivers, driverTickets, forms, finishes] = await Promise.all([
    selectAllRows<{ id: string }>((from, to) =>
      supabase.from("users").select("id").eq("tenant_id", tenantId).eq("active", true).order("id").range(from, to).returns<{ id: string }[]>(),
    ),
    selectAllRows<{ id: string; user_id: string }>((from, to) =>
      supabase.from("worker_profiles").select("id, user_id").eq("tenant_id", tenantId).order("id").range(from, to).returns<{ id: string; user_id: string }[]>(),
    ),
    selectAllRows<{ worker_profile_id: string }>((from, to) =>
      supabase
        .from("certifications")
        .select("worker_profile_id")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to)
        .returns<{ worker_profile_id: string }[]>(),
    ),
    // A company without the hired-carrier module simply has none of these.
    selectAllRows<{ id: string }>((from, to) =>
      supabase.from("contracted_driver").select("id").eq("tenant_id", tenantId).is("deleted_at", null).order("id").range(from, to).returns<{ id: string }[]>(),
    ).catch(() => [] as { id: string }[]),
    selectAllRows<{ contracted_driver_id: string }>((from, to) =>
      supabase
        .from("contracted_driver_certification")
        .select("contracted_driver_id")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to)
        .returns<{ contracted_driver_id: string }[]>(),
    ).catch(() => [] as { contracted_driver_id: string }[]),
    supabase.from("forms").select("code").eq("tenant_id", tenantId).returns<{ code: string | null }[]>(),
    loadUnitFinishes(supabase, tenantId),
  ]);

  const activeUsers = new Set(users.map((user) => user.id));
  const profilesWithTicket = new Set(workerTickets.map((ticket) => ticket.worker_profile_id));
  const workersWithTicket = profiles.filter((profile) => activeUsers.has(profile.user_id) && profilesWithTicket.has(profile.id)).length;
  const liveDrivers = new Set(drivers.map((driver) => driver.id));
  const driversWithTicket = new Set(driverTickets.map((ticket) => ticket.contracted_driver_id).filter((id) => liveDrivers.has(id))).size;
  const ownForms = (forms.data ?? []).filter((form) => !SEEDED_FORM_CODES.has((form.code ?? "").toUpperCase())).length;

  return buildGettingStarted({
    ownForms,
    people: activeUsers.size,
    tickets: { people: activeUsers.size + liveDrivers.size, withTicket: workersWithTicket + driversWithTicket },
    units: { finished: finishes.filter((entry) => entry.open === 0).length, total: finishes.length },
  });
}
