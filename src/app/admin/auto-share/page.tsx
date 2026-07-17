import { redirect } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Mail,
  MapPin,
  Phone,
  PlusCircle,
  Send,
  Share2,
  ToggleLeft,
  ToggleRight,
  UserRound,
} from "lucide-react";
import {
  createAutoShareRecipient,
  processQueuedAutoShareEmails,
  retryAutoShareEmailNotification,
  setAutoShareRecipientActive,
} from "@/app/admin/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  autoShareDeliveryStatusOptions,
  autoShareRecipientTypeOptions,
  canRetryAutoShareNotification,
  coerceAutoShareDeliveryStatusFilter,
  formatAutoShareDeliveryStatus,
  formatAutoShareRecipientType,
} from "@/lib/auto-share";
import { isIntegrationEnabled } from "@/lib/company-settings";
import { requireAppUser } from "@/lib/current-user";
import { emailDeliveryConfigured, getMissingEmailDeliveryEnv } from "@/lib/email-delivery";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type AutoSharePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type AutoShareRecipientRow = Database["public"]["Tables"]["auto_share_recipients"]["Row"];
type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
type CompanySettingsRow = Pick<Database["public"]["Tables"]["company_settings"]["Row"], "integrations">;
type LocationRow = Pick<Database["public"]["Tables"]["locations"]["Row"], "id" | "name" | "code">;
type UserRow = Pick<Database["public"]["Tables"]["users"]["Row"], "email" | "full_name" | "id">;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function normalizeComparable(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function findMatchedUser(recipient: AutoShareRecipientRow, users: UserRow[]) {
  const recipientEmail = normalizeComparable(recipient.email);
  const recipientName = normalizeComparable(recipient.name);

  return users.find((user) => {
    return normalizeComparable(user.email) === recipientEmail || normalizeComparable(user.full_name) === recipientName;
  });
}

function contactLabel(recipient: AutoShareRecipientRow) {
  if (recipient.email) {
    return recipient.email;
  }

  if (recipient.phone) {
    return recipient.phone;
  }

  return "In-app match by name";
}

function formatDeliveryStatus(status: string) {
  return formatAutoShareDeliveryStatus(status);
}

function deliveryStatusClass(status: string) {
  switch (status) {
    case "queued":
      return "bg-amber-50 text-[var(--warning)]";
    case "delivered":
      return "bg-emerald-50 text-[var(--success)]";
    case "failed":
      return "bg-red-50 text-[var(--danger)]";
    case "skipped":
      return "bg-slate-100 text-[var(--ink-muted)]";
    default:
      return "bg-[var(--surface-muted)] text-[var(--ink-muted)]";
  }
}

function autoShareDeliveryHref(status: string) {
  return status === "all" ? "/admin/auto-share" : `/admin/auto-share?deliveryStatus=${status}`;
}

export default async function AutoSharePage({ searchParams }: AutoSharePageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const deliveryStatusFilter = coerceAutoShareDeliveryStatusFilter(firstParam(params.deliveryStatus));
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  let notificationsQuery = supabase
    .from("notifications")
    .select("*")
    .eq("tenant_id", context.appUser.tenant_id)
    .ilike("title", "Auto-share:%")
    .order("created_at", { ascending: false })
    .limit(50);

  if (deliveryStatusFilter !== "all") {
    notificationsQuery = notificationsQuery.eq("delivery_status", deliveryStatusFilter);
  }

  const [
    { data: recipients },
    { data: locations },
    { data: users },
    { data: companySettings },
    { data: notifications },
    { count: notificationCount },
    { count: queuedDeliveryCount },
    { count: queuedEmailDeliveryCount },
    { count: failedEmailDeliveryCount },
    { count: deliveredDeliveryCount },
    { count: failedDeliveryCount },
    { count: skippedDeliveryCount },
  ] = await Promise.all([
      supabase
        .from("auto_share_recipients")
        .select("*")
        .eq("tenant_id", context.appUser.tenant_id)
        .order("active", { ascending: false })
        .order("created_at", { ascending: false })
        .returns<AutoShareRecipientRow[]>(),
      supabase
        .from("locations")
        .select("id, name, code")
        .eq("tenant_id", context.appUser.tenant_id)
        .order("name")
        .returns<LocationRow[]>(),
      supabase
        .from("users")
        .select("id, full_name, email")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("active", true)
        .order("full_name")
        .returns<UserRow[]>(),
      supabase
        .from("company_settings")
        .select("integrations")
        .eq("tenant_id", context.appUser.tenant_id)
        .maybeSingle<CompanySettingsRow>(),
      notificationsQuery.returns<NotificationRow[]>(),
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", context.appUser.tenant_id)
        .ilike("title", "Auto-share:%"),
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", context.appUser.tenant_id)
        .ilike("title", "Auto-share:%")
        .eq("delivery_status", "queued"),
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", context.appUser.tenant_id)
        .ilike("title", "Auto-share:%")
        .eq("channel", "email")
        .eq("delivery_status", "queued"),
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", context.appUser.tenant_id)
        .ilike("title", "Auto-share:%")
        .eq("channel", "email")
        .eq("delivery_status", "failed"),
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", context.appUser.tenant_id)
        .ilike("title", "Auto-share:%")
        .eq("delivery_status", "delivered"),
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", context.appUser.tenant_id)
        .ilike("title", "Auto-share:%")
        .eq("delivery_status", "failed"),
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", context.appUser.tenant_id)
        .ilike("title", "Auto-share:%")
        .eq("delivery_status", "skipped"),
    ]);

  const recipientRows = recipients ?? [];
  const locationRows = locations ?? [];
  const userRows = users ?? [];
  const locationById = new Map(locationRows.map((location) => [location.id, location]));
  const activeCount = recipientRows.filter((recipient) => recipient.active).length;
  const allLocationsCount = recipientRows.filter((recipient) => recipient.active && !recipient.location_id).length;
  const locationSpecificCount = recipientRows.filter((recipient) => recipient.active && recipient.location_id).length;
  const emailIntegrationEnabled = isIntegrationEnabled(companySettings?.integrations ?? {}, "email_delivery");
  const missingEmailDeliveryEnv = getMissingEmailDeliveryEnv();
  const emailDeliveryConfigReady = emailDeliveryConfigured();
  const emailDeliveryReady = emailIntegrationEnabled && emailDeliveryConfigReady;
  const queuedEmails = queuedEmailDeliveryCount ?? 0;
  const failedEmails = failedEmailDeliveryCount ?? 0;
  const deliveryStatusCounts = new Map<string, number>([
    ["all", notificationCount ?? 0],
    ["queued", queuedDeliveryCount ?? 0],
    ["delivered", deliveredDeliveryCount ?? 0],
    ["failed", failedDeliveryCount ?? 0],
    ["skipped", skippedDeliveryCount ?? 0],
  ]);

  return (
    <AdminShell
      eyebrow="Distribution"
      tenantName={context.tenant?.name ?? "Company profile"}
      title="Auto-Share"
    >
      {notice ? (
        <p className="mb-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <Share2 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Active recipients</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <Send className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">All locations</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{allLocationsCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <MapPin className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Location-specific</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{locationSpecificCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <Clock3 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Queued</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{queuedDeliveryCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <CheckCircle2 className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Delivered</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{deliveredDeliveryCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <AlertTriangle className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Failed</p>
          <p className="mt-1 text-2xl font-bold text-[var(--danger)]">{failedDeliveryCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <AlertTriangle className="h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Skipped</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{skippedDeliveryCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm md:col-span-3 xl:col-span-1">
          <Bell className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Notifications recorded</p>
          <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{notificationCount ?? 0}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Sending</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Completed forms notify all-location recipients plus recipients tied to the submission location.
              </p>
            </div>
            <a
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              href="#add-recipient"
            >
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
              Add Recipient
            </a>
          </div>

          {recipientRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[var(--border)] text-left text-sm">
                <thead className="bg-white text-xs uppercase text-[var(--ink-muted)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Scope</th>
                    <th className="px-4 py-3 font-semibold">Delivery</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {recipientRows.map((recipient) => {
                    const location = recipient.location_id ? locationById.get(recipient.location_id) : null;
                    const matchedUser = findMatchedUser(recipient, userRows);

                    return (
                      <tr className="align-top" key={recipient.id}>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
                              recipient.active ? "bg-emerald-50 text-[var(--success)]" : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                            }`}
                          >
                            {recipient.active ? (
                              <ToggleRight className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <ToggleLeft className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {recipient.active ? "Active" : "Paused"}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <p className="font-semibold text-[var(--ink)]">{recipient.name}</p>
                          {matchedUser ? (
                            <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)]">
                              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                              In-app recipient
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 text-[var(--ink-muted)]">{formatAutoShareRecipientType(recipient.recipient_type)}</td>
                        <td className="px-4 py-4 text-[var(--ink-muted)]">
                          {location ? `${location.name}${location.code ? ` (${location.code})` : ""}` : "All Locations"}
                        </td>
                        <td className="px-4 py-4">
                          <p className="flex items-center gap-2 text-[var(--ink-muted)]">
                            {recipient.email ? (
                              <Mail className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                            ) : recipient.phone ? (
                              <Phone className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                            ) : (
                              <Bell className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                            )}
                            {contactLabel(recipient)}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <form action={setAutoShareRecipientActive}>
                            <input name="recipientId" type="hidden" value={recipient.id} />
                            <input name="active" type="hidden" value={recipient.active ? "false" : "true"} />
                            <button
                              className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              type="submit"
                            >
                              {recipient.active ? "Pause" : "Enable"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-[var(--ink-muted)]">
              No recipients configured yet.
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <form
            action={createAutoShareRecipient}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
            id="add-recipient"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <PlusCircle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Add Recipient</h2>
                <p className="text-sm text-[var(--ink-muted)]">Use a user name or email to create in-app notices.</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Name</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="name"
                  placeholder="Nora Super"
                  required
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Type</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="recipientType"
                >
                  {autoShareRecipientTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Scope</span>
                <select
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="locationId"
                >
                  <option value="">All Locations</option>
                  {locationRows.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Email</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="email"
                  placeholder="person@example.com"
                  type="email"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">Phone</span>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  name="phone"
                  placeholder="555-0101"
                  type="tel"
                />
                <span className="block text-xs leading-5 text-[var(--ink-muted)]">
                  Phone is stored as a secondary contact only. Add an email address or leave phone blank for in-app matching.
                </span>
              </label>
              <button
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                type="submit"
              >
                <PlusCircle className="h-4 w-4" aria-hidden="true" />
                Add Recipient
              </button>
            </div>
          </form>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Email Delivery</h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {queuedEmails} queued, {failedEmails} failed email records
                </p>
              </div>
              <Mail className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--ink-muted)]">Company setting</span>
                <span
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    emailIntegrationEnabled ? "bg-emerald-50 text-[var(--success)]" : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                  }`}
                >
                  {emailIntegrationEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--ink-muted)]">Webhook credentials</span>
                <span
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    emailDeliveryConfigReady ? "bg-emerald-50 text-[var(--success)]" : "bg-amber-50 text-[var(--warning)]"
                  }`}
                >
                  {emailDeliveryConfigReady ? "Configured" : "Missing"}
                </span>
              </div>
              <p className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--ink-muted)]">
                Email delivery needs the Company Settings integration and the{" "}
                <code className="break-all font-semibold">EMAIL_DELIVERY_WEBHOOK_URL</code>,{" "}
                <code className="break-all font-semibold">EMAIL_DELIVERY_FROM</code>, and{" "}
                <code className="break-all font-semibold">EMAIL_DELIVERY_WEBHOOK_SECRET</code> environment variables.
                {missingEmailDeliveryEnv.length > 0 ? ` Missing: ${missingEmailDeliveryEnv.join(", ")}.` : ""}{" "}
                SMS delivery is not configured, so phone-only recipients are blocked.
              </p>
            </div>

            <form action={processQueuedAutoShareEmails} className="mt-4">
              <button
                className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 ${
                  emailDeliveryReady && queuedEmails > 0
                    ? "bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)]"
                    : "cursor-not-allowed bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                }`}
                disabled={!emailDeliveryReady || queuedEmails === 0}
                type="submit"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Send Queued Email
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Recent Notifications</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  {notifications?.length ?? 0} {deliveryStatusFilter === "all" ? "recent" : formatDeliveryStatus(deliveryStatusFilter)} records
                </p>
              </div>
              <Bell className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {autoShareDeliveryStatusOptions.map((option) => {
                const active = deliveryStatusFilter === option.value;

                return (
                  <a
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex h-8 items-center justify-center rounded-md border px-2.5 text-xs font-semibold transition ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                        : "border-[var(--border)] bg-white text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
                    }`}
                    href={autoShareDeliveryHref(option.value)}
                    key={option.value}
                  >
                    {option.label}
                    <span className={`ml-1 ${active ? "text-white/80" : "text-[var(--ink-muted)]"}`}>
                      {deliveryStatusCounts.get(option.value) ?? 0}
                    </span>
                  </a>
                );
              })}
            </div>
            {notifications && notifications.length > 0 ? (
              <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                {notifications.map((notification) => {
                  const retryable = canRetryAutoShareNotification(notification);

                  return (
                    <article className="p-3" key={notification.id}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold text-[var(--ink)]">{notification.title}</p>
                        <div className="flex flex-wrap justify-end gap-2">
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${deliveryStatusClass(notification.delivery_status)}`}>
                            {formatDeliveryStatus(notification.delivery_status)}
                          </span>
                          <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                            {notification.channel}
                          </span>
                        </div>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{notification.body}</p>
                      {notification.recipient_name || notification.recipient_contact ? (
                        <p className="mt-2 text-xs text-[var(--ink-muted)]">
                          Recipient: {notification.recipient_name ?? "Unknown"}
                          {notification.recipient_contact ? ` (${notification.recipient_contact})` : ""}
                          {notification.recipient_type ? ` - ${formatAutoShareRecipientType(notification.recipient_type)}` : ""}
                        </p>
                      ) : null}
                      {notification.delivery_error ? (
                        <p
                          className={`mt-2 rounded-md px-2 py-1 text-xs font-semibold ${
                            notification.delivery_status === "skipped"
                              ? "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                              : "bg-red-50 text-[var(--danger)]"
                          }`}
                        >
                          Last error: {notification.delivery_error}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
                        <span>Created {formatDateTime(notification.created_at)}</span>
                        {notification.delivery_attempts > 0 ? <span>{notification.delivery_attempts} delivery attempt(s)</span> : null}
                        {notification.last_delivery_attempt_at ? (
                          <span>Last attempt {formatDateTime(notification.last_delivery_attempt_at)}</span>
                        ) : null}
                        {notification.failed_at ? <span>Failed {formatDateTime(notification.failed_at)}</span> : null}
                        {notification.delivered_at ? <span>Delivered {formatDateTime(notification.delivered_at)}</span> : null}
                      </div>
                      {retryable ? (
                        <form action={retryAutoShareEmailNotification} className="mt-3">
                          <input name="notificationId" type="hidden" value={notification.id} />
                          <button
                            className={`inline-flex h-9 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 ${
                              emailDeliveryReady
                                ? "bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)]"
                                : "cursor-not-allowed bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                            }`}
                            disabled={!emailDeliveryReady}
                            type="submit"
                          >
                            <Send className="h-4 w-4" aria-hidden="true" />
                            {notification.delivery_status === "queued" ? "Send now" : "Retry email"}
                          </button>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
                No notifications have been recorded yet.
              </div>
            )}
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}
