import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarClock, Calculator, History, Paperclip, Printer, Trash2 } from "lucide-react";
import {
  addLineItem,
  addMarkup,
  deleteAttachment,
  deleteChangeOrder,
  deleteLineItem,
  deleteMarkup,
  setChangeOrderStatus,
  updateChangeOrder,
  uploadAttachment,
} from "@/app/admin/change-orders/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import {
  CHANGE_ORDER_DECISION_LABELS,
  CHANGE_ORDER_LINE_CATEGORIES,
  CHANGE_ORDER_LINE_CATEGORY_LABELS,
  CHANGE_ORDER_ORIGINS,
  CHANGE_ORDER_ORIGIN_LABELS,
  CHANGE_ORDER_STATUS_BADGE,
  CHANGE_ORDER_STATUS_LABELS,
  computeChangeOrderTotals,
  decisionNeedsSignature,
  formatCurrency,
  formatFileSize,
  formatPercent,
  type ChangeOrderApprovalRow,
  type ChangeOrderAttachmentRow,
  type ChangeOrderLineRow,
  type ChangeOrderMarkupRow,
  type ChangeOrderRow,
  type ChangeOrderStatus,
  type CoProjectRow,
} from "@/lib/change-orders";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
type ApprovalRow = Pick<
  ChangeOrderApprovalRow,
  "id" | "decision" | "decided_by_name" | "signer_name" | "note" | "created_at"
>;
type AttachmentRow = Pick<
  ChangeOrderAttachmentRow,
  "id" | "file_name" | "storage_path" | "content_type" | "file_size" | "created_at"
>;
type ProjectRow = Pick<CoProjectRow, "id" | "name" | "client_name">;
type LineRow = Pick<
  ChangeOrderLineRow,
  "id" | "category" | "description" | "quantity" | "unit" | "unit_cost" | "amount"
>;
type MarkupRow = Pick<ChangeOrderMarkupRow, "id" | "label" | "percent" | "amount">;

type DetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Sensible status transitions offered from each state.
const NEXT_STATUSES: Record<ChangeOrderStatus, ChangeOrderStatus[]> = {
  draft: ["submitted", "void"],
  submitted: ["approved", "rejected", "draft"],
  approved: ["draft", "void"],
  rejected: ["draft", "void"],
  void: ["draft"],
};

const STATUS_ACTION_LABEL: Record<ChangeOrderStatus, string> = {
  draft: "Move to draft",
  submitted: "Submit for approval",
  approved: "Approve",
  rejected: "Reject",
  void: "Void",
};

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function ChangeOrderDetailPage({ params, searchParams }: DetailPageProps) {
  await requireAppUser();
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.change_orders_enabled) {
    redirect("/admin/setup");
  }

  const { id } = await params;
  const query = await searchParams;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);

  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase
    .from("change_order")
    .select(
      "id, project_id, number, title, description, origin, status, schedule_impact_days, total_amount, approved_at, approved_signer_name, created_at",
    )
    .eq("id", id)
    .eq("tenant_id", context.appUser.tenant_id)
    .is("deleted_at", null)
    .maybeSingle<OrderRow>();

  if (!order) {
    notFound();
  }

  const [{ data: project }, { data: lineRows }, { data: markupRows }, { data: approvalRows }, { data: attachmentRows }] =
    await Promise.all([
      supabase
        .from("co_project")
        .select("id, name, client_name")
        .eq("id", order.project_id)
        .eq("tenant_id", context.appUser.tenant_id)
        .maybeSingle<ProjectRow>(),
      supabase
        .from("change_order_line")
        .select("id, category, description, quantity, unit, unit_cost, amount")
        .eq("change_order_id", order.id)
        .eq("tenant_id", context.appUser.tenant_id)
        .order("sort_order", { ascending: true })
        .returns<LineRow[]>(),
      supabase
        .from("change_order_markup")
        .select("id, label, percent, amount")
        .eq("change_order_id", order.id)
        .eq("tenant_id", context.appUser.tenant_id)
        .order("sort_order", { ascending: true })
        .returns<MarkupRow[]>(),
      supabase
        .from("change_order_approval")
        .select("id, decision, decided_by_name, signer_name, note, created_at")
        .eq("change_order_id", order.id)
        .eq("tenant_id", context.appUser.tenant_id)
        .order("created_at", { ascending: false })
        .returns<ApprovalRow[]>(),
      supabase
        .from("change_order_attachment")
        .select("id, file_name, storage_path, content_type, file_size, created_at")
        .eq("change_order_id", order.id)
        .eq("tenant_id", context.appUser.tenant_id)
        .order("created_at", { ascending: false })
        .returns<AttachmentRow[]>(),
    ]);

  const lines = lineRows ?? [];
  const markups = markupRows ?? [];
  const approvals = approvalRows ?? [];
  const attachments = attachmentRows ?? [];
  const totals = computeChangeOrderTotals(lines, markups);
  const isApproved = order.status === "approved";

  // Short-lived signed URLs so attachments are viewable without a public bucket.
  const attachmentUrls = new Map<string, string | null>();
  await Promise.all(
    attachments.map(async (attachment) => {
      const { data } = await supabase.storage
        .from("tenant-documents")
        .createSignedUrl(attachment.storage_path, 10 * 60);
      attachmentUrls.set(attachment.id, data?.signedUrl ?? null);
    }),
  );

  return (
    <AdminShell
      eyebrow="Contracts"
      tenantName={context.tenant?.name ?? "Company profile"}
      title={`CO #${order.number}: ${order.title}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
          href="/admin/change-orders"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Variations & Change Orders
        </Link>
        <Link
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href={`/admin/change-orders/${order.id}/print`}
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print / Save PDF
        </Link>
      </div>

      {notice ? (
        <p className="mt-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--ink-muted)]">
              {project ? (
                <Link className="font-semibold text-[var(--primary)] hover:underline" href={`/admin/change-orders/projects/${project.id}`}>
                  {project.name}
                </Link>
              ) : (
                "Project"
              )}
              {project?.client_name ? ` · ${project.client_name}` : ""}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">{order.title}</h2>
          </div>
          <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${CHANGE_ORDER_STATUS_BADGE[order.status]}`}>
            {CHANGE_ORDER_STATUS_LABELS[order.status]}
          </span>
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">Value</dt>
            <dd className="text-base font-semibold text-[var(--ink)]">{formatCurrency(order.total_amount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">Schedule impact</dt>
            <dd className="text-base font-semibold text-[var(--ink)]">
              {order.schedule_impact_days} day{order.schedule_impact_days === 1 ? "" : "s"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">Origin</dt>
            <dd className="text-base font-semibold text-[var(--ink)]">{CHANGE_ORDER_ORIGIN_LABELS[order.origin]}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">{isApproved ? "Approved" : "Created"}</dt>
            <dd className="text-base font-semibold text-[var(--ink)]">
              {(isApproved ? order.approved_at : order.created_at)?.slice(0, 10) ?? "—"}
            </dd>
            {isApproved && order.approved_signer_name ? (
              <dd className="text-xs text-[var(--ink-muted)]">Signed: {order.approved_signer_name}</dd>
            ) : null}
          </div>
        </dl>

        {order.description ? (
          <div className="mt-4 rounded-md border border-[var(--border)] bg-white p-3">
            <p className="whitespace-pre-wrap text-sm text-[var(--ink)]">{order.description}</p>
          </div>
        ) : null}
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <Calculator className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Pricing
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Cost line items and markup formulas. The change order value is the line subtotal plus markups.
        </p>

        <div className="mt-4 overflow-x-auto rounded-md border border-[var(--border)] bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Category</th>
                <th className="px-3 py-2 font-semibold">Description</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 font-semibold">Unit</th>
                <th className="px-3 py-2 text-right font-semibold">Unit cost</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {lines.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-center text-[var(--ink-muted)]" colSpan={7}>
                    No line items yet.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">
                      {CHANGE_ORDER_LINE_CATEGORY_LABELS[line.category]}
                    </td>
                    <td className="px-3 py-2 text-[var(--ink)]">{line.description}</td>
                    <td className="px-3 py-2 text-right text-[var(--ink-muted)]">{line.quantity}</td>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">{line.unit ?? ""}</td>
                    <td className="px-3 py-2 text-right text-[var(--ink-muted)]">{formatCurrency(line.unit_cost)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[var(--ink)]">{formatCurrency(line.amount)}</td>
                    <td className="px-3 py-2 text-right">
                      <form action={deleteLineItem}>
                        <input name="id" type="hidden" value={line.id} />
                        <input name="change_order_id" type="hidden" value={order.id} />
                        <button
                          aria-label="Remove line"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-red-50 hover:text-[var(--danger)]"
                          type="submit"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <form action={addLineItem} className="mt-3 grid gap-3 rounded-md border border-[var(--border)] bg-white p-3 lg:grid-cols-6 lg:items-end">
          <input name="change_order_id" type="hidden" value={order.id} />
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--ink-muted)]">Category</span>
            <select className={inputClass} defaultValue="labor" name="category">
              {CHANGE_ORDER_LINE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CHANGE_ORDER_LINE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 lg:col-span-2">
            <span className="text-xs font-medium text-[var(--ink-muted)]">Description</span>
            <input className={inputClass} name="description" required />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--ink-muted)]">Qty</span>
            <input className={inputClass} defaultValue="1" min="0" name="quantity" step="0.001" type="number" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--ink-muted)]">Unit cost</span>
            <input className={inputClass} defaultValue="0" name="unit_cost" step="0.01" type="number" />
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
            type="submit"
          >
            Add line
          </button>
        </form>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-md border border-[var(--border)] bg-white p-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">Markups</h3>
            {markups.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--ink-muted)]">No markups. Add overhead, fee, bond, or contingency.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {markups.map((markup, index) => (
                  <li className="flex items-center justify-between gap-3 py-2 text-sm" key={markup.id}>
                    <span className="text-[var(--ink)]">
                      {markup.label}
                      {markup.percent != null ? (
                        <span className="ml-1 text-xs text-[var(--ink-muted)]">({formatPercent(markup.percent)})</span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--ink)]">
                        {formatCurrency(totals.resolvedMarkups[index])}
                      </span>
                      <form action={deleteMarkup}>
                        <input name="id" type="hidden" value={markup.id} />
                        <input name="change_order_id" type="hidden" value={order.id} />
                        <button
                          aria-label="Remove markup"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-red-50 hover:text-[var(--danger)]"
                          type="submit"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <form action={addMarkup} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <input name="change_order_id" type="hidden" value={order.id} />
              <input className={inputClass} name="label" placeholder="e.g. Overhead & profit" required />
              <select className={inputClass} defaultValue="percent" name="kind">
                <option value="percent">Percent</option>
                <option value="fixed">Fixed</option>
              </select>
              <input className={`${inputClass} sm:w-24`} defaultValue="0" name="percent" placeholder="%" step="0.001" type="number" />
              <input className={`${inputClass} sm:w-28`} defaultValue="0" name="amount" placeholder="$" step="0.01" type="number" />
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 sm:col-span-4"
                type="submit"
              >
                Add markup
              </button>
            </form>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              A percent markup uses the % field; a fixed markup uses the $ field.
            </p>
          </div>

          <dl className="h-fit rounded-md border border-[var(--border)] bg-white p-4 text-sm">
            <div className="flex items-center justify-between py-1">
              <dt className="text-[var(--ink-muted)]">Subtotal</dt>
              <dd className="font-semibold text-[var(--ink)]">{formatCurrency(totals.subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between py-1">
              <dt className="text-[var(--ink-muted)]">Markups</dt>
              <dd className="font-semibold text-[var(--ink)]">{formatCurrency(totals.markupTotal)}</dd>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-[var(--border)] pt-2">
              <dt className="font-semibold text-[var(--ink)]">Total</dt>
              <dd className="text-base font-bold text-[var(--ink)]">{formatCurrency(totals.total)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <Paperclip className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Attachments
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">Field photos and supporting documents (PDF, images).</p>

        {attachments.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-center text-sm text-[var(--ink-muted)]">
            No attachments yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
            {attachments.map((attachment) => {
              const url = attachmentUrls.get(attachment.id) ?? null;

              return (
                <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={attachment.id}>
                  <span className="min-w-0">
                    {url ? (
                      <a
                        className="font-medium text-[var(--primary)] hover:underline"
                        href={url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {attachment.file_name}
                      </a>
                    ) : (
                      <span className="font-medium text-[var(--ink)]">{attachment.file_name}</span>
                    )}
                    {attachment.file_size ? (
                      <span className="ml-2 text-xs text-[var(--ink-muted)]">{formatFileSize(attachment.file_size)}</span>
                    ) : null}
                  </span>
                  <form action={deleteAttachment}>
                    <input name="id" type="hidden" value={attachment.id} />
                    <input name="change_order_id" type="hidden" value={order.id} />
                    <button
                      aria-label="Remove attachment"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-red-50 hover:text-[var(--danger)]"
                      type="submit"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}

        <form action={uploadAttachment} className="mt-3 flex flex-wrap items-center gap-3">
          <input name="change_order_id" type="hidden" value={order.id} />
          <input
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--ink)]"
            name="file"
            required
            type="file"
          />
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
            type="submit"
          >
            Upload
          </button>
        </form>
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <CalendarClock className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Status
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Only an approved change order is added to its project&apos;s revised contract value. Approving or rejecting
          captures a signature.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {NEXT_STATUSES[order.status]
            .filter((next) => !decisionNeedsSignature(next))
            .map((next) => (
              <form action={setChangeOrderStatus} key={next}>
                <input name="id" type="hidden" value={order.id} />
                <input name="status" type="hidden" value={next} />
                <button
                  className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                  type="submit"
                >
                  {STATUS_ACTION_LABEL[next]}
                </button>
              </form>
            ))}
        </div>

        {NEXT_STATUSES[order.status]
          .filter((next) => decisionNeedsSignature(next))
          .map((next) => (
            <details className="mt-3 rounded-md border border-[var(--border)] bg-white" key={next}>
              <summary
                className={`cursor-pointer px-3 py-2 text-sm font-semibold ${
                  next === "approved" ? "text-[var(--success)]" : "text-[var(--danger)]"
                }`}
              >
                {STATUS_ACTION_LABEL[next]}
              </summary>
              <form action={setChangeOrderStatus} className="grid gap-3 px-3 pb-3 pt-1 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <input name="id" type="hidden" value={order.id} />
                <input name="status" type="hidden" value={next} />
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[var(--ink-muted)]">Signature name</span>
                  <input className={inputClass} name="signer_name" placeholder="Authorized by" required />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[var(--ink-muted)]">Note (optional)</span>
                  <input className={inputClass} name="note" />
                </label>
                <button
                  className={`inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-semibold text-white transition hover:opacity-90 ${
                    next === "approved" ? "bg-[var(--success)]" : "bg-[var(--danger)]"
                  }`}
                  type="submit"
                >
                  {STATUS_ACTION_LABEL[next]}
                </button>
              </form>
            </details>
          ))}
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
          <History className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Approval history
        </h2>
        {approvals.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">No decisions recorded yet.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {approvals.map((entry) => (
              <li className="rounded-md border border-[var(--border)] bg-white p-3" key={entry.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--ink)]">
                    {CHANGE_ORDER_DECISION_LABELS[entry.decision]}
                  </span>
                  <span className="text-xs text-[var(--ink-muted)]">{entry.created_at?.slice(0, 10)}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {entry.decided_by_name ? `By ${entry.decided_by_name}` : "By a team member"}
                  {entry.signer_name ? ` · Signed: ${entry.signer_name}` : ""}
                </p>
                {entry.note ? <p className="mt-1 text-sm text-[var(--ink)]">{entry.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <details>
          <summary className="cursor-pointer text-base font-semibold text-[var(--primary)]">Edit details</summary>
          <form action={updateChangeOrder} className="mt-3 grid gap-4 sm:grid-cols-2">
            <input name="id" type="hidden" value={order.id} />
            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-medium text-[var(--ink)]">Title</span>
              <input className={inputClass} defaultValue={order.title} name="title" required />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-[var(--ink)]">Origin</span>
              <select className={inputClass} defaultValue={order.origin} name="origin">
                {CHANGE_ORDER_ORIGINS.map((origin) => (
                  <option key={origin} value={origin}>
                    {CHANGE_ORDER_ORIGIN_LABELS[origin]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-[var(--ink)]">Schedule impact (days)</span>
              <input
                className={inputClass}
                defaultValue={order.schedule_impact_days}
                name="schedule_impact_days"
                step="1"
                type="number"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-medium text-[var(--ink)]">Description</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                defaultValue={order.description ?? ""}
                name="description"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                type="submit"
              >
                Save changes
              </button>
            </div>
          </form>
        </details>
      </section>

      <section className="mt-5 rounded-lg border border-[var(--danger)] bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[var(--ink)]">Delete change order</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          This removes the change order from the project. This cannot be undone from the app.
        </p>
        <form action={deleteChangeOrder} className="mt-3">
          <input name="id" type="hidden" value={order.id} />
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--danger)] bg-white px-3 text-sm font-semibold text-[var(--danger)] transition hover:bg-red-50"
            type="submit"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete
          </button>
        </form>
      </section>
    </AdminShell>
  );
}
