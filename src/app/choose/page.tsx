import Link from "next/link";
import { Building2, LogOut, MonitorCog, Smartphone, UserRound } from "lucide-react";
import { signOut } from "@/app/actions";
import {
  canUseAdminPanel,
  canUseDesktopMonitor,
  canUseWebApp,
  formatAccessLevel,
  formatPowerLevel,
} from "@/lib/access-control";
import { requireCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

function ChoiceLink({
  href,
  icon,
  label,
  disabled,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span className="inline-flex h-12 items-center justify-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-4 text-sm font-bold uppercase text-[var(--ink-muted)] opacity-60">
        {icon}
        {label}
      </span>
    );
  }

  return (
    <Link
      className="inline-flex h-12 items-center justify-center gap-3 rounded-md bg-[var(--primary)] px-4 text-sm font-bold uppercase text-white shadow-sm transition hover:bg-[var(--primary-dark)]"
      href={href}
    >
      {icon}
      {label}
    </Link>
  );
}

export default async function ChoosePage() {
  const context = await requireCurrentUser();

  const isAppUser = context.status === "app_user";
  const isConsultant = context.status === "consultant";
  const displayEmail = context.authUser.email ?? "Signed-in user";
  const displayName = isAppUser ? context.appUser.full_name : isConsultant ? context.consultant.full_name : displayEmail;
  const tenantName = isAppUser ? context.tenant?.name ?? "Company profile" : "Cor Pathways";
  const canOpenAdmin = isConsultant || (isAppUser && canUseAdminPanel(context.appUser));
  const canOpenDesktop = canOpenAdmin || (isAppUser && canUseDesktopMonitor(context.appUser));
  const desktopHref = isAppUser && !canOpenAdmin && canUseDesktopMonitor(context.appUser) ? "/admin/monitor" : "/admin";
  const canOpenWeb = isAppUser && canUseWebApp(context.appUser);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-10">
      <section className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="space-y-2 px-6 py-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <UserRound className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-bold text-[var(--ink)]">{displayName}</h1>
          <p className="text-sm text-[var(--ink-muted)]">{displayEmail}</p>
          <p className="inline-flex items-center gap-2 rounded-md bg-[var(--surface-muted)] px-3 py-1 text-sm text-[var(--ink)]">
            <Building2 className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            {tenantName}
          </p>
        </div>

        {context.status === "profile_pending" ? (
          <div className="mx-6 mb-6 rounded-md border border-[var(--warning)] bg-orange-50 p-4 text-sm leading-6 text-[var(--ink)]">
            Your Auth account exists, but the app profile is still pending. New signups now create this automatically.
          </div>
        ) : (
          <div className="grid gap-3 px-6 pb-8">
            <ChoiceLink
              href={desktopHref}
              icon={<MonitorCog className="h-5 w-5" aria-hidden="true" />}
              label="Desktop App"
              disabled={!canOpenDesktop}
            />
            <ChoiceLink
              href="/web"
              icon={<Smartphone className="h-5 w-5" aria-hidden="true" />}
              label="Web App"
              disabled={!canOpenWeb}
            />
            {isAppUser ? (
              <p className="text-center text-sm text-[var(--ink-muted)]">
                {formatPowerLevel(context.appUser.power_level)} with {formatAccessLevel(context.appUser.app_access)}
              </p>
            ) : null}
          </div>
        )}

        <div className="border-t border-[var(--border)] px-6 py-4">
          <form action={signOut}>
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              type="submit"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Logout
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
