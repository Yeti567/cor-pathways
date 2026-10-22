import { redirect } from "next/navigation";
import { Save, Scale, Trash2 } from "lucide-react";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { deleteApprovalRule, saveApprovalRule, savePurchasingSettings } from "@/app/admin/purchasing/actions";
import {
  Flash,
  PurchasingTabs,
  checkboxClass,
  dangerButtonClass,
  firstParam,
  inputClass,
  labelClass,
  labelTextClass,
  primaryButtonClass,
  sectionClass,
} from "@/app/admin/purchasing/_components/PurchasingChrome";
import {
  loadApprovalRules,
  loadPurchasingSettings,
  loadTenantUsers,
  type PurchaseApprovalRuleRow,
  type TenantUser,
} from "@/app/admin/purchasing/_lib/purchasing-data";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { formatMoney, isPurchasingAdmin, purchaseApprovalStyles } from "@/lib/purchasing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RulesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function RuleFields({
  approvers,
  locations,
  rule,
}: {
  approvers: TenantUser[];
  locations: { id: string; name: string }[];
  rule?: PurchaseApprovalRuleRow;
}) {
  const chosen = new Set(rule?.approver_user_ids ?? []);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          <span className={labelTextClass}>Name</span>
          <input className={inputClass} defaultValue={rule?.name ?? ""} name="name" placeholder="Over $5,000" required />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Starts at an order total of</span>
          <input
            className={inputClass}
            defaultValue={rule ? Number(rule.threshold) : ""}
            inputMode="decimal"
            name="threshold"
            placeholder="0"
            required
          />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Style</span>
          <select className={inputClass} defaultValue={rule?.style ?? "band"} name="style">
            {purchaseApprovalStyles.map((style) => (
              <option key={style.value} value={style.value}>
                {style.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Level (sequential only)</span>
          <input
            className={inputClass}
            defaultValue={rule?.level ?? ""}
            inputMode="numeric"
            min="1"
            name="level"
            placeholder="1"
            step="1"
            type="number"
          />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          <span className={labelTextClass}>Applies to</span>
          <select className={inputClass} defaultValue={rule?.location_id ?? ""} name="locationId">
            <option value="">Every location without rules of its own</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                Only {location.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Approvers</legend>
        {approvers.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">Nobody has admin panel access yet.</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {approvers.map((user) => (
              <label className="flex items-center gap-2 text-sm text-[var(--ink)]" key={user.id}>
                <input
                  className={checkboxClass}
                  defaultChecked={chosen.has(user.id)}
                  name="approverUserIds"
                  type="checkbox"
                  value={user.id}
                />
                {user.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {rule ? (
        <label className="flex items-center gap-2">
          <input className={checkboxClass} defaultChecked={!rule.active} name="inactive" type="checkbox" />
          <span className="text-sm text-[var(--ink)]">Switched off</span>
        </label>
      ) : null}
    </>
  );
}

export default async function PurchasingRulesPage({ searchParams }: RulesPageProps) {
  const query = await searchParams;
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.purchasing_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;
  const isAdmin = isPurchasingAdmin(context.appUser.power_level);

  const [rules, settings, users, { data: locations }] = await Promise.all([
    loadApprovalRules(supabase, tenantId),
    loadPurchasingSettings(supabase, tenantId),
    loadTenantUsers(supabase, tenantId),
    supabase
      .from("locations")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
  ]);

  const approvers = users.filter((user) => user.canApprove);
  const userName = new Map(users.map((user) => [user.id, user.name]));
  const locationName = new Map((locations ?? []).map((row) => [row.id, row.name]));
  const scopes = [...new Set(rules.map((rule) => rule.location_id ?? ""))].sort((a, b) =>
    a === "" ? -1 : b === "" ? 1 : (locationName.get(a) ?? "").localeCompare(locationName.get(b) ?? ""),
  );

  return (
    <AdminShell eyebrow="Purchasing" tenantName={context.tenant?.name ?? "Company profile"} title="Approval rules">
      <PurchasingTabs active="/admin/purchasing/rules" />
      <Flash error={firstParam(query.error)} notice={firstParam(query.notice)} />

      <section className={sectionClass}>
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <Scale className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          How approval works
        </h2>
        <ul className="mt-2 max-w-3xl list-disc space-y-1 pl-5 text-sm text-[var(--ink-muted)]">
          <li>The order total picks the rule. A rule catches orders at or above its starting amount.</li>
          {purchaseApprovalStyles.map((style) => (
            <li key={style.value}>
              <span className="font-semibold text-[var(--ink)]">{style.label}:</span> {style.detail}
            </li>
          ))}
          <li>Rules for a location replace the company-wide rules for orders at that location. Each place uses one style.</li>
          <li>Whoever raised an order never approves it. With no rules at all, any admin other than the requester approves.</li>
          <li>An emergency order can be placed first and approved after; the trail shows it.</li>
        </ul>
        {!isAdmin ? (
          <p className="mt-3 text-sm font-semibold text-[var(--ink)]">Only an admin can change these rules.</p>
        ) : null}
      </section>

      <section className={`mt-4 ${sectionClass}`}>
        <h2 className="text-base font-semibold text-[var(--ink)]">Settings</h2>
        <form action={savePurchasingSettings} className="mt-3 space-y-2">
          <label className="flex items-start gap-2">
            <input
              className={`${checkboxClass} mt-0.5`}
              defaultChecked={settings.autoApproveBelowLowest}
              disabled={!isAdmin}
              name="autoApproveBelowLowest"
              type="checkbox"
            />
            <span className="text-sm text-[var(--ink)]">
              Approve small orders automatically
              <span className="block text-xs text-[var(--ink-muted)]">
                An order below the lowest rule&apos;s starting amount approves itself when submitted. With no rules, every
                order would approve itself, so leave this off until the rules are in.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              className={`${checkboxClass} mt-0.5`}
              defaultChecked={settings.requireRejectReason}
              disabled={!isAdmin}
              name="requireRejectReason"
              type="checkbox"
            />
            <span className="text-sm text-[var(--ink)]">
              A rejection needs a reason
              <span className="block text-xs text-[var(--ink-muted)]">So the requester knows what to fix.</span>
            </span>
          </label>
          {isAdmin ? (
            <button className={primaryButtonClass} type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              Save settings
            </button>
          ) : null}
        </form>
      </section>

      <section className={`mt-4 ${sectionClass}`}>
        <h2 className="text-base font-semibold text-[var(--ink)]">Rules</h2>
        {rules.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            No rules yet, so any admin other than the requester approves every order.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {scopes.map((scope) => (
              <div key={scope || "company"}>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  {scope ? `Only ${locationName.get(scope) ?? "a removed location"}` : "Company-wide"}
                </h3>
                <ul className="mt-2 space-y-2">
                  {rules
                    .filter((rule) => (rule.location_id ?? "") === scope)
                    .sort((a, b) => a.level - b.level || Number(a.threshold) - Number(b.threshold))
                    .map((rule) => (
                      <li className="rounded-md border border-[var(--border)] bg-white p-3" key={rule.id}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-[var(--ink)]">
                            {rule.name}
                            {!rule.active ? (
                              <span className="ml-2 text-xs font-semibold text-[var(--ink-muted)]">Off</span>
                            ) : null}
                          </span>
                          <span className="text-sm text-[var(--ink-muted)]">
                            {rule.style === "sequential" ? `Level ${rule.level}, ` : "Band, "}from{" "}
                            {formatMoney(rule.threshold)}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--ink-muted)]">
                          {rule.approver_user_ids.map((id) => userName.get(id) ?? "a former user").join(", ") ||
                            "No approvers"}
                        </p>
                        {isAdmin ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-semibold text-[var(--primary)]">Edit</summary>
                            <form action={saveApprovalRule} className="mt-2 space-y-3">
                              <input name="ruleId" type="hidden" value={rule.id} />
                              <RuleFields approvers={approvers} locations={locations ?? []} rule={rule} />
                              <button className={primaryButtonClass} type="submit">
                                Save rule
                              </button>
                            </form>
                            <form action={deleteApprovalRule} className="mt-2">
                              <input name="ruleId" type="hidden" value={rule.id} />
                              <button className={dangerButtonClass} type="submit">
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                                Delete rule
                              </button>
                            </form>
                          </details>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {isAdmin ? (
          <form action={saveApprovalRule} className="mt-4 space-y-3 rounded-md border border-[var(--border)] bg-white p-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">Add a rule</h3>
            <RuleFields approvers={approvers} locations={locations ?? []} />
            <button className={primaryButtonClass} type="submit">
              Add rule
            </button>
          </form>
        ) : null}
      </section>
    </AdminShell>
  );
}
