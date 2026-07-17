import type { CompanySettingsRow, PrintSettingsRow } from "@/lib/company-settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { VisitorRosterLocation, VisitorRosterVisitor, VisitorRosterWorker } from "@/lib/visitor-roster";
import type { Database } from "@/types/database";

type LocationRow = Pick<
  Database["public"]["Tables"]["locations"]["Row"],
  "code" | "id" | "name" | "visibility_rule"
>;
type WorkerTimeCardRow = Pick<
  Database["public"]["Tables"]["worker_time_cards"]["Row"],
  "clocked_in_at" | "clocked_out_at" | "id" | "location_id" | "note" | "worker_user_id"
>;
type WorkerUserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "full_name" | "id">;

export async function loadVisitorRosterData(tenantId: string) {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const [{ data: locations }, { data: visitors }, { data: workerTimeCards }, { data: companySettings }, { data: printSettings }] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, code, visibility_rule")
      .eq("tenant_id", tenantId)
      .order("name")
      .returns<LocationRow[]>(),
    supabase
      .from("visitors")
      .select("id, location_id, full_name, organization, visit_reason, signed_in_at, signed_out_at")
      .eq("tenant_id", tenantId)
      .is("signed_out_at", null)
      .order("signed_in_at", { ascending: true })
      .returns<VisitorRosterVisitor[]>(),
    supabase
      .from("worker_time_cards")
      .select("id, location_id, worker_user_id, note, clocked_in_at, clocked_out_at")
      .eq("tenant_id", tenantId)
      .is("clocked_out_at", null)
      .order("clocked_in_at", { ascending: true })
      .returns<WorkerTimeCardRow[]>(),
    supabase.from("company_settings").select("*").eq("tenant_id", tenantId).maybeSingle<CompanySettingsRow>(),
    supabase.from("print_settings").select("*").eq("tenant_id", tenantId).maybeSingle<PrintSettingsRow>(),
  ]);
  const workerUserIds = Array.from(new Set((workerTimeCards ?? []).map((timeCard) => timeCard.worker_user_id)));
  const { data: workerUsers } =
    workerUserIds.length > 0
      ? await supabase
          .from("users")
          .select("id, full_name, email")
          .eq("tenant_id", tenantId)
          .in("id", workerUserIds)
          .returns<WorkerUserRow[]>()
      : { data: [] as WorkerUserRow[] };
  const workerById = new Map((workerUsers ?? []).map((worker) => [worker.id, worker]));

  const logoUrl = companySettings?.logo_path
    ? (await supabase.storage.from("tenant-documents").createSignedUrl(companySettings.logo_path, 10 * 60)).data
        ?.signedUrl ?? null
    : null;

  return {
    companySettings: companySettings ?? null,
    locations: (locations ?? []) satisfies VisitorRosterLocation[],
    logoUrl,
    now,
    printSettings: printSettings ?? null,
    visitors: visitors ?? [],
    workers: (workerTimeCards ?? []).map((timeCard) => {
      const worker = workerById.get(timeCard.worker_user_id);

      return {
        id: timeCard.id,
        location_id: timeCard.location_id,
        note: timeCard.note,
        signed_in_at: timeCard.clocked_in_at,
        signed_out_at: timeCard.clocked_out_at,
        worker_email: worker?.email ?? null,
        worker_full_name: worker?.full_name ?? "Unknown worker",
        worker_user_id: timeCard.worker_user_id,
      } satisfies VisitorRosterWorker;
    }),
  };
}
