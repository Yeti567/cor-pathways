import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { equipmentConditionBadge, equipmentConditionLabel } from "@/lib/trades";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type FlaggedRow = Pick<
  Database["public"]["Tables"]["trade_customer_equipment"]["Row"],
  "id" | "customer_id" | "equipment_type" | "make" | "model" | "serial" | "condition" | "follow_up_note" | "created_at"
>;

export default async function TradeFollowUpsPage() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const { data: flaggedRows } = await supabase
    .from("trade_customer_equipment")
    .select("id, customer_id, equipment_type, make, model, serial, condition, follow_up_note, created_at")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("needs_follow_up", true)
    .order("created_at", { ascending: false })
    .returns<FlaggedRow[]>();
  const flagged = flaggedRows ?? [];

  const customerIds = [...new Set(flagged.map((row) => row.customer_id))];
  const customerNameById = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: customerRows } = await supabase
      .from("trade_customer")
      .select("id, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("id", customerIds)
      .returns<{ id: string; name: string }[]>();
    for (const customer of customerRows ?? []) {
      customerNameById.set(customer.id, customer.name);
    }
  }

  return (
    <AdminShell eyebrow="Trades" tenantName={context.tenant?.name ?? "Company profile"} title="Equipment follow-ups">
      <Link
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
        href="/admin/trades"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Trades home
      </Link>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-[var(--danger)]" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-[var(--ink)]">Flagged by the crew</h2>
        </div>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Units the crew flagged on site for office follow-up, such as a recommended replacement quote. Each one is a
          sales opportunity from the field.
        </p>

        {flagged.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--border)] p-8 text-center">
            <AlertCircle className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
            <p className="text-sm text-[var(--ink-muted)]">No open follow-ups. Nothing flagged from the field right now.</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
            {flagged.map((item) => {
              const title = item.equipment_type || [item.make, item.model].filter(Boolean).join(" ") || "Equipment";
              const specs = [item.make, item.model].filter(Boolean).join(" ");
              return (
                <li className="p-4" key={item.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[var(--ink)]">{title}</span>
                    {item.condition ? (
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${equipmentConditionBadge(item.condition)}`}>
                        {equipmentConditionLabel(item.condition)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
                    <Link className="font-semibold text-[var(--primary)] hover:underline" href={`/admin/trades/customers/${item.customer_id}`}>
                      {customerNameById.get(item.customer_id) ?? "Customer"}
                    </Link>
                    {specs ? ` · ${specs}` : ""}
                    {item.serial ? ` · Serial ${item.serial}` : ""}
                  </p>
                  {item.follow_up_note ? (
                    <p className="mt-1 text-sm font-semibold text-[var(--danger)]">Follow-up: {item.follow_up_note}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
