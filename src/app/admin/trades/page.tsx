import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, CalendarClock, ClipboardList, DollarSign, FileText, ListChecks, Receipt, RefreshCw, Users, Wrench } from "lucide-react";
import { updateTradesLaborRate } from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { formatMoney } from "@/lib/trades";

export const dynamic = "force-dynamic";

// What the trades module will hold, built out over the next slices. Areas with an
// href are live; the rest are shown as a roadmap so an enabled tenant knows what
// is coming.
const upcomingAreas = [
  {
    description: "Customers, service addresses, and the equipment installed at each site, with full service history.",
    href: "/admin/trades/customers",
    icon: Users,
    title: "Customers & Equipment",
  },
  {
    description: "Work orders and service calls: schedule, assign a tech, capture work and photos in the field.",
    href: "/admin/trades/work-orders",
    icon: ClipboardList,
    title: "Work Orders",
  },
  {
    description: "Day board of work by technician, with an unscheduled backlog to assign and slot.",
    href: "/admin/trades/dispatch",
    icon: CalendarClock,
    title: "Dispatch",
  },
  {
    description: "Flat-rate price book with Good / Better / Best tiers. Add items to a work order to build a quote.",
    href: "/admin/trades/price-book",
    icon: Receipt,
    title: "Price Book",
  },
  {
    description: "Turn a work order's line items into an invoice with tax and totals, tracked from draft to paid.",
    href: "/admin/trades/invoices",
    icon: FileText,
    title: "Invoices",
  },
  {
    description: "Recurring maintenance plans and memberships: billing interval, visits, and next-visit dates.",
    href: "/admin/trades/agreements",
    icon: RefreshCw,
    title: "Service Agreements",
  },
  {
    description: "Reusable job checklists (PM and safety task lists). Apply one to a work order for the crew to tick off on site.",
    href: "/admin/trades/checklists",
    icon: ListChecks,
    title: "Checklists",
  },
  {
    description: "Equipment the crew flagged in the field for follow-up, such as a recommended replacement quote. Your sales pipeline from service calls.",
    href: "/admin/trades/follow-ups",
    icon: AlertCircle,
    title: "Follow-ups",
  },
] as const;

export default async function TradesPage() {
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  // The Trades module is gated by a tenant toggle. When off, the nav entry is
  // hidden, so send any direct hits to Setup where the toggle lives.
  if (!context.tenant?.trades_enabled) {
    redirect("/admin/setup");
  }

  const laborRate = Number(context.tenant?.default_labor_rate ?? 0);

  return (
    <AdminShell eyebrow="Operations" tenantName={context.tenant?.name ?? "Company profile"} title="Trades">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <Wrench className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Trades &amp; Field Service</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              Run your trade or service business from one place: customers and work orders, dispatch, a flat-rate price
              book, and service agreements. Built for HVAC, plumbing, and electrical first. Turn this module off under{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/setup">
                Setup
              </Link>{" "}
              if you do not run service calls.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <DollarSign className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-[var(--ink)]">Job costing</h3>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Set an hourly labour cost. Work orders then show labour cost from the time tracked, and the margin
              against the line-item total. Current rate:{" "}
              <span className="font-semibold text-[var(--ink)]">{formatMoney(laborRate)}/hr</span>
            </p>
            <form action={updateTradesLaborRate} className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Labour cost / hour</span>
                <input
                  className="h-10 w-40 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  defaultValue={laborRate}
                  inputMode="decimal"
                  min="0"
                  name="laborRate"
                  step="0.01"
                  type="number"
                />
              </label>
              <button
                className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                Save rate
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h3 className="text-base font-semibold text-[var(--ink)]">Module areas</h3>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Everything you need to run service work, end to end.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {upcomingAreas.map((area) => {
            const Icon = area.icon;

            return (
              <Link
                className="rounded-lg border border-[var(--border)] bg-white p-4 transition hover:border-[var(--primary)] hover:bg-[var(--surface-muted)]"
                href={area.href}
                key={area.title}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h4 className="mt-3 text-base font-semibold text-[var(--ink)]">{area.title}</h4>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">{area.description}</p>
              </Link>
            );
          })}
        </div>
      </section>
    </AdminShell>
  );
}
