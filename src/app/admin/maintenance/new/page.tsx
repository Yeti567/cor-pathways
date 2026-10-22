import { redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { createWorkOrder } from "@/app/admin/maintenance/actions";
import {
  Flash,
  firstParam,
  inputClass,
  labelClass,
  labelTextClass,
  primaryButtonClass,
  sectionClass,
  textareaClass,
} from "@/app/admin/maintenance/_components/MaintenanceChrome";
import { equipmentLabel, loadEquipmentOptions, loadPeople } from "@/app/admin/maintenance/_lib/maintenance-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { maintenancePriorities, maintenanceTypes } from "@/lib/maintenance";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type NewWorkOrderPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewWorkOrderPage({ searchParams }: NewWorkOrderPageProps) {
  const query = await searchParams;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.maintenance_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const presetAsset = firstParam(query.asset) ?? "";

  const [equipment, people, { data: locations }] = await Promise.all([
    loadEquipmentOptions(supabase, tenantId),
    loadPeople(supabase, tenantId),
    supabase
      .from("locations")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
  ]);

  return (
    <AdminShell eyebrow="Maintenance" tenantName={context.tenant?.name ?? "Company profile"} title="New work order">
      <Flash error={firstParam(query.error)} notice={firstParam(query.notice)} />

      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-[var(--ink)]">Raise a work order</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
          It starts as requested. Approve and assign it on the next screen, or choose who it is for now and assign it there.
          You are recorded as the requester.
        </p>

        <form action={createWorkOrder} className="mt-4 space-y-4">
          <label className={labelClass}>
            <span className={labelTextClass}>Title</span>
            <input className={inputClass} name="title" placeholder="Replace the hydraulic hose on the loader" required />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={labelTextClass}>Asset</span>
              <select className={inputClass} defaultValue={presetAsset} name="equipmentId">
                <option value="">No asset (work on a place)</option>
                {equipment.map((row) => (
                  <option key={row.id} value={row.id}>
                    {equipmentLabel(row)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Location</span>
              <select className={inputClass} defaultValue="" name="locationId">
                <option value="">Not set</option>
                {(locations ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              <span className={labelTextClass}>Type</span>
              <select className={inputClass} defaultValue="corrective" name="type">
                {maintenanceTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Priority</span>
              <select className={inputClass} defaultValue="normal" name="priority">
                {maintenancePriorities.map((priority) => (
                  <option key={priority.value} value={priority.value}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>For (optional)</span>
              <select className={inputClass} defaultValue="" name="assigneeId">
                <option value="">Decide later</option>
                {people
                  .filter((person) => person.active)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={labelTextClass}>Start on (optional)</span>
              <input className={inputClass} name="scheduledStart" type="date" />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Due by (optional)</span>
              <input className={inputClass} name="dueDate" type="date" />
            </label>
          </div>

          <label className={labelClass}>
            <span className={labelTextClass}>What needs doing (optional)</span>
            <textarea className={textareaClass} name="description" />
          </label>

          <label className={labelClass}>
            <span className={labelTextClass}>Checklist (optional, one step per line)</span>
            <textarea className={textareaClass} name="tasks" placeholder={"Lock out the machine\nReplace the hose\nTest under load"} />
          </label>

          <button className={primaryButtonClass} type="submit">
            Raise work order
          </button>
        </form>
      </section>
    </AdminShell>
  );
}
