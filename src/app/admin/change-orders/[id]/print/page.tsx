import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintHeader } from "@/app/admin/_components/PrintHeader";
import { PrintReportButton } from "@/app/admin/monitor/PrintReportButton";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  CHANGE_ORDER_DECISION_LABELS,
  CHANGE_ORDER_LINE_CATEGORY_LABELS,
  CHANGE_ORDER_ORIGIN_LABELS,
  CHANGE_ORDER_STATUS_LABELS,
  computeChangeOrderTotals,
  formatCurrency,
  formatPercent,
  type ChangeOrderApprovalRow,
  type ChangeOrderLineRow,
  type ChangeOrderMarkupRow,
  type ChangeOrderRow,
  type CoProjectRow,
} from "@/lib/change-orders";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CompanySettingsRow = Database["public"]["Tables"]["company_settings"]["Row"];
type PrintSettingsRow = Database["public"]["Tables"]["print_settings"]["Row"];
type OrderRow = Pick<
  ChangeOrderRow,
  | "id"
  | "project_id"
  | "number"
  | "title"
  | "description"
  | "origin"
  | "status"
  | "schedule_impact_days"
  | "total_amount"
  | "approved_at"
  | "approved_signer_name"
  | "created_at"
>;
type ProjectRow = Pick<
  CoProjectRow,
  "id" | "name" | "client_name" | "contract_number" | "original_contract_value"
>;
type LineRow = Pick<
  ChangeOrderLineRow,
  "id" | "category" | "description" | "quantity" | "unit" | "unit_cost" | "amount"
>;
type MarkupRow = Pick<ChangeOrderMarkupRow, "id" | "label" | "percent" | "amount">;
type ApprovalRow = Pick<
  ChangeOrderApprovalRow,
  "id" | "decision" | "decided_by_name" | "signer_name" | "note" | "created_at"
>;
type AttachmentRow = { id: string; file_name: string };

type PrintPageProps = {
  params: Promise<{ id: string }>;
};

function printRow(label: string, value: string) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 print:border-gray-300 print:bg-white">
      <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">{label}</p>
      <p className="mt-1 font-semibold text-[var(--ink)] print:text-black">{value}</p>
    </div>
  );
}

export default async function ChangeOrderPrintPage({ params }: PrintPageProps) {
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.change_orders_enabled) {
    redirect("/admin/setup");
  }

  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const tenantId = context.appUser.tenant_id;

  const { data: order } = await supabase
    .from("change_order")
    .select(
      "id, project_id, number, title, description, origin, status, schedule_impact_days, total_amount, approved_at, approved_signer_name, created_at",
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle<OrderRow>();

  if (!order) {
    notFound();
  }

  const [
    { data: project },
    { data: lineRows },
    { data: markupRows },
    { data: approvalRows },
    { data: attachmentRows },
    { data: companySettings },
    { data: printSettings },
  ] = await Promise.all([
    supabase
      .from("co_project")
      .select("id, name, client_name, contract_number, original_contract_value")
      .eq("id", order.project_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<ProjectRow>(),
    supabase
      .from("change_order_line")
      .select("id, category, description, quantity, unit, unit_cost, amount")
      .eq("change_order_id", order.id)
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true })
      .returns<LineRow[]>(),
    supabase
      .from("change_order_markup")
      .select("id, label, percent, amount")
      .eq("change_order_id", order.id)
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true })
      .returns<MarkupRow[]>(),
    supabase
      .from("change_order_approval")
      .select("id, decision, decided_by_name, signer_name, note, created_at")
      .eq("change_order_id", order.id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .returns<ApprovalRow[]>(),
    supabase
      .from("change_order_attachment")
      .select("id, file_name")
      .eq("change_order_id", order.id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .returns<AttachmentRow[]>(),
    supabase.from("company_settings").select("*").eq("tenant_id", tenantId).maybeSingle<CompanySettingsRow>(),
    supabase.from("print_settings").select("*").eq("tenant_id", tenantId).maybeSingle<PrintSettingsRow>(),
  ]);

  const lines = lineRows ?? [];
  const markups = markupRows ?? [];
  const approvals = approvalRows ?? [];
  const attachments = attachmentRows ?? [];
  const totals = computeChangeOrderTotals(lines, markups);
  const tenantName = context.tenant?.name ?? "Company profile";

  const logoUrl = companySettings?.logo_path
    ? (await supabase.storage.from("tenant-documents").createSignedUrl(companySettings.logo_path, 10 * 60)).data
        ?.signedUrl ?? null
    : null;

  const revised = Number(project?.original_contract_value ?? 0) + (order.status === "approved" ? totals.total : 0);

  return (
    <main className="mx-auto max-w-4xl px-4 py-5 text-[var(--ink)] print:max-w-none print:px-0 print:py-0 print:text-black">
      <div className="mb-5 flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm print:hidden sm:flex-row sm:items-center sm:justify-between">
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href={`/admin/change-orders/${order.id}`}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to change order
        </Link>
        <PrintReportButton label="Print / Save PDF" />
      </div>

      <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <PrintHeader
          className="mb-5"
          companySettings={companySettings ?? null}
          logoUrl={logoUrl}
          mode="always"
          printSettings={printSettings ?? null}
          tenantName={tenantName}
        />

        <header className="border-b border-[var(--border)] pb-5 print:border-gray-300">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">
                Change order
              </p>
              <h1 className="mt-1 text-2xl font-bold text-[var(--ink)] print:text-black">
                CO #{order.number}: {order.title}
              </h1>
              {project ? (
                <p className="mt-1 text-sm text-[var(--ink-muted)] print:text-gray-700">
                  {project.name}
                  {project.client_name ? ` · ${project.client_name}` : ""}
                  {project.contract_number ? ` · ${project.contract_number}` : ""}
                </p>
              ) : null}
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm print:border-gray-300 print:bg-white">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">Status</p>
              <p className="mt-1 font-bold text-[var(--ink)] print:text-black">
                {CHANGE_ORDER_STATUS_LABELS[order.status]}
              </p>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {printRow("Origin", CHANGE_ORDER_ORIGIN_LABELS[order.origin])}
          {printRow("Schedule impact", `${order.schedule_impact_days} day${order.schedule_impact_days === 1 ? "" : "s"}`)}
          {printRow("Value", formatCurrency(order.total_amount))}
          {printRow(
            "Created",
            order.created_at?.slice(0, 10) ?? "—",
          )}
        </section>

        {order.description ? (
          <section className="mt-5">
            <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">Description</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--ink)] print:text-black">{order.description}</p>
          </section>
        ) : null}

        <section className="mt-5">
          <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">Pricing</h2>
          <table className="mt-2 w-full border border-[var(--border)] text-left text-sm print:border-gray-300">
            <thead className="border-b border-[var(--border)] print:border-gray-300">
              <tr>
                <th className="px-3 py-2 font-semibold">Category</th>
                <th className="px-3 py-2 font-semibold">Description</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold">Unit cost</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td className="px-3 py-2 text-[var(--ink-muted)]" colSpan={5}>
                    No line items.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr className="border-b border-[var(--border)] print:border-gray-200" key={line.id}>
                    <td className="px-3 py-2">{CHANGE_ORDER_LINE_CATEGORY_LABELS[line.category]}</td>
                    <td className="px-3 py-2">
                      {line.description}
                      {line.unit ? <span className="text-[var(--ink-muted)]"> ({line.unit})</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">{line.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(line.unit_cost)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatCurrency(line.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="mt-3 ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--ink-muted)] print:text-gray-700">Subtotal</span>
              <span className="font-semibold">{formatCurrency(totals.subtotal)}</span>
            </div>
            {markups.map((markup, index) => (
              <div className="flex justify-between" key={markup.id}>
                <span className="text-[var(--ink-muted)] print:text-gray-700">
                  {markup.label}
                  {markup.percent != null ? ` (${formatPercent(markup.percent)})` : ""}
                </span>
                <span className="font-semibold">{formatCurrency(totals.resolvedMarkups[index])}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-[var(--border)] pt-1 print:border-gray-300">
              <span className="font-semibold">Total</span>
              <span className="font-bold">{formatCurrency(totals.total)}</span>
            </div>
          </div>
        </section>

        {project ? (
          <section className="mt-5 grid gap-3 sm:grid-cols-3">
            {printRow("Original contract", formatCurrency(project.original_contract_value))}
            {printRow("This change order", formatCurrency(order.total_amount))}
            {printRow("Revised contract", formatCurrency(revised))}
          </section>
        ) : null}

        <section className="mt-5">
          <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">
            Approval history
          </h2>
          {approvals.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--ink-muted)]">No decisions recorded.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {approvals.map((entry) => (
                <li className="flex flex-wrap justify-between gap-2 border-b border-[var(--border)] py-1 print:border-gray-200" key={entry.id}>
                  <span>
                    <span className="font-semibold">{CHANGE_ORDER_DECISION_LABELS[entry.decision]}</span>
                    {entry.decided_by_name ? ` · ${entry.decided_by_name}` : ""}
                    {entry.signer_name ? ` · Signed: ${entry.signer_name}` : ""}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </span>
                  <span className="text-[var(--ink-muted)] print:text-gray-600">{entry.created_at?.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-[var(--border)] p-3 print:border-gray-300">
            <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">
              Accepted by (signature)
            </p>
            <p className="mt-6 border-t border-[var(--border)] pt-1 text-sm print:border-gray-400">
              {order.approved_signer_name ?? ""}
              {order.approved_at ? ` · ${order.approved_at.slice(0, 10)}` : ""}
            </p>
          </div>
          <div className="rounded-md border border-[var(--border)] p-3 print:border-gray-300">
            <p className="text-xs font-semibold uppercase text-[var(--ink-muted)] print:text-gray-600">Attachments</p>
            {attachments.length === 0 ? (
              <p className="mt-1 text-sm text-[var(--ink-muted)]">None</p>
            ) : (
              <ul className="mt-1 list-inside list-disc text-sm">
                {attachments.map((attachment) => (
                  <li key={attachment.id}>{attachment.file_name}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </article>
    </main>
  );
}
