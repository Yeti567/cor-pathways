import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BadgeCheck,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FileSignature,
  FileSliders,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogOut,
  MapPin,
  Menu,
  Share2,
  ShieldCheck,
  Smartphone,
  Settings2,
  UserRound,
  UsersRound,
  GitBranch,
  IdCard,
  Package,
  Truck,
  Wrench,
} from "lucide-react";
import { signOut } from "@/app/actions";
import { getCurrentUserContext } from "@/lib/current-user";
import { coerceCountry } from "@/lib/region";

const TRANSPORT_NAV_HREF = "/admin/transport";
const COR_NAV_HREF = "/admin/cor";
const OSHA_NAV_HREF = "/admin/osha";
const CHANGE_ORDERS_NAV_HREF = "/admin/change-orders";
const DAILY_INSPECTION_NAV_HREF = "/admin/daily-inspection";
const TRADES_NAV_HREF = "/admin/trades";
const GC_NAV_HREF = "/admin/projects";
const INVENTORY_NAV_HREF = "/admin/inventory";
const EQUIPMENT_NAV_HREF = "/admin/equipment";

const navItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/monitor", label: "Monitor", icon: Activity },
  { href: "/admin/reports", label: "Reports", icon: FileText },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/incidents", label: "Incidents", icon: AlertTriangle },
  { href: "/admin/follow-ups", label: "Corrective Actions", icon: Wrench },
  { href: "/admin/equipment", label: "Equipment", icon: Truck },
  { href: TRANSPORT_NAV_HREF, label: "Transport", icon: Truck },
  { href: COR_NAV_HREF, label: "COR Audit", icon: BadgeCheck },
  { href: OSHA_NAV_HREF, label: "OSHA Safety", icon: ShieldCheck },
  { href: CHANGE_ORDERS_NAV_HREF, label: "Variations & COs", icon: FileSignature },
  { href: DAILY_INSPECTION_NAV_HREF, label: "Trip Inspections", icon: ClipboardCheck },
  { href: TRADES_NAV_HREF, label: "Trades", icon: Wrench },
  { href: GC_NAV_HREF, label: "Projects", icon: Building2 },
  { href: INVENTORY_NAV_HREF, label: "Inventory", icon: Package },
  { href: "/admin/workflows", label: "Workflow Station", icon: GitBranch },
  { href: "/admin/forms", label: "Forms", icon: ClipboardList },
  { href: "/admin/lists", label: "Managed Lists", icon: ListChecks },
  { href: "/admin/documents", label: "Documents", icon: FileText },
  { href: "/admin/auto-share", label: "Auto-Share", icon: Share2 },
  { href: "/admin/setup", label: "Setup", icon: Settings2 },
  { href: "/admin/locations", label: "Locations", icon: MapPin },
  { href: "/admin/workers", label: "Workers", icon: UsersRound },
  { href: "/admin/visitors", label: "Visitors", icon: UserRound },
  { href: "/admin/certification-types", label: "Certification Types", icon: BadgeCheck },
  { href: "/admin/worker-tickets", label: "Employee Tickets", icon: IdCard },
  { href: "/admin/access", label: "Access", icon: UsersRound },
  { href: "/admin/permission-profiles", label: "Permission Profiles", icon: FileSliders },
  { href: "/admin/consultant-access", label: "Consultant Access", icon: ShieldCheck },
  { href: "/web", label: "Web App", icon: Smartphone },
];

export async function AdminShell({
  children,
  eyebrow,
  monitorOnly = false,
  title,
  tenantName,
}: {
  children: React.ReactNode;
  eyebrow: string;
  monitorOnly?: boolean;
  title: string;
  tenantName: string;
}) {
  const context = await getCurrentUserContext();
  const transportEnabled = Boolean(context.tenant?.transport_enabled);
  const corEnabled = Boolean(context.tenant?.cor_enabled);
  const changeOrdersEnabled = Boolean(context.tenant?.change_orders_enabled);
  const dailyInspectionEnabled = Boolean(context.tenant?.daily_inspection_enabled);
  const tradesEnabled = Boolean(context.tenant?.trades_enabled);
  const gcEnabled = Boolean(context.tenant?.gc_enabled);
  const inventoryEnabled = Boolean(context.tenant?.inventory_enabled);
  // OSHA is the US equivalent of COR; it shows only for United States workspaces.
  const country = coerceCountry(context.tenant?.country);

  const visibleNavItems = (
    monitorOnly
      ? navItems.filter((item) =>
          ["/admin/monitor", "/admin/reports", "/admin/analytics", "/admin/incidents", "/admin/follow-ups"].includes(
            item.href,
          ),
        )
      : navItems
  )
    .filter((item) => item.href !== TRANSPORT_NAV_HREF || transportEnabled)
    .filter((item) => item.href !== COR_NAV_HREF || corEnabled)
    .filter((item) => item.href !== OSHA_NAV_HREF || country === "US")
    .filter((item) => item.href !== CHANGE_ORDERS_NAV_HREF || changeOrdersEnabled)
    .filter((item) => item.href !== DAILY_INSPECTION_NAV_HREF || dailyInspectionEnabled)
    .filter((item) => item.href !== TRADES_NAV_HREF || tradesEnabled)
    .filter((item) => item.href !== GC_NAV_HREF || gcEnabled)
    .filter((item) => item.href !== INVENTORY_NAV_HREF || inventoryEnabled)
    // When transport is on, the Vehicle Master inside Transport replaces the
    // general Equipment module, so hide the standalone Equipment nav entry to
    // avoid a confusing duplicate. The route still works for any deep links.
    .filter((item) => item.href !== EQUIPMENT_NAV_HREF || !transportEnabled);

  const navLinks = visibleNavItems.map((item) => {
    const Icon = item.icon;

    return (
      <Link
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
        href={item.href}
        key={item.href}
      >
        <Icon className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
        {item.label}
      </Link>
    );
  });

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] print:hidden">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--primary)]">{eyebrow}</p>
            <h1 className="mt-1 text-2xl font-bold text-[var(--ink)]">{title}</h1>
            <p className="mt-1 inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <Building2 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              {tenantName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/help"
            >
              <LifeBuoy className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              Help
            </Link>
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="/choose"
            >
              Switch Surface
            </Link>
            <form action={signOut}>
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                title="Sign out"
                type="submit"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_1fr] lg:px-8 print:block print:max-w-none print:px-0 print:py-0">
        <div className="lg:h-fit">
          {/* Mobile: collapse the nav into a Menu disclosure so it does not push
              page content down with the full list of links. */}
          <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm lg:hidden print:hidden">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-semibold text-[var(--ink)]">
              <Menu className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              Menu
            </summary>
            <nav className="grid gap-0.5 border-t border-[var(--border)] p-2">{navLinks}</nav>
          </details>
          {/* Desktop: persistent sidebar. */}
          <nav className="hidden h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm lg:block print:hidden">
            {navLinks}
          </nav>
        </div>

        <section>{children}</section>
      </div>
    </main>
  );
}
