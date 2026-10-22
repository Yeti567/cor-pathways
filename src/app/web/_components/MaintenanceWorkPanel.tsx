"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { CloudOff, Hammer, Package, Timer, WifiOff } from "lucide-react";
import { workerMoveWorkOrder, workerUsePart } from "@/app/web/maintenance-actions";
import { countPendingWorkOrderLabour, queueWorkOrderLabour } from "@/lib/offline/maintenance";
import { flushQueuedMutations } from "@/lib/offline/sync";
import { syncQueueChangedEvent } from "@/lib/offline/sync-queue";

export type WorkerWorkOrder = {
  id: string;
  label: string;
  title: string;
  description: string | null;
  status: "approved" | "assigned" | "in_progress" | "on_hold";
  statusLabel: string;
  priorityLabel: string;
  assetLabel: string | null;
  dueDate: string | null;
  metered: boolean;
  lastMeter: number | null;
  tasks: { id: string; title: string; done: boolean }[];
};

const inputClass =
  "h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const buttonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50";
const secondaryClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] disabled:opacity-50";

function subscribeOnlineStatus(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

/**
 * The worker's maintenance work orders. The list is the last-loaded page, so it stays
 * readable with no signal. Logging time works offline: it queues on the phone and posts
 * once when there is signal again. Starting, holding, completing and using parts need a
 * connection, because they settle the corrective action, move the scheduled service and
 * post to the stock ledger, so those controls are disabled while offline.
 */
export function MaintenanceWorkPanel({
  items,
  places,
  tenantId,
  userId,
  workOrders,
}: {
  items: { id: string; name: string; unit: string }[];
  places: { id: string; label: string }[];
  tenantId: string;
  userId: string;
  workOrders: WorkerWorkOrder[];
}) {
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    () => navigator.onLine,
    () => true,
  );
  const offline = !isOnline;
  const [pending, setPending] = useState(0);
  const [message, setMessage] = useState<{ kind: "error" | "notice"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      countPendingWorkOrderLabour()
        .then((count) => {
          if (active) setPending(count);
        })
        .catch(() => {});
    };

    refresh();
    window.addEventListener(syncQueueChangedEvent, refresh);
    return () => {
      active = false;
      window.removeEventListener(syncQueueChangedEvent, refresh);
    };
  }, []);

  async function logTime(event: FormEvent<HTMLFormElement>, workOrderId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const hours = Number(String(data.get("hours") ?? "").replace(/,/g, "."));
    const result = await queueWorkOrderLabour({
      hours: Number.isFinite(hours) ? hours : null,
      note: String(data.get("note") ?? "") || null,
      tenantId,
      userId,
      workOrderId,
      workedOn: String(data.get("workedOn") ?? ""),
    });

    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }

    form.reset();
    setMessage({
      kind: "notice",
      text: navigator.onLine ? "Time logged." : "Time saved on this phone. It posts when you have signal.",
    });

    if (navigator.onLine) {
      await flushQueuedMutations().catch(() => {});
    }
  }

  return (
    <section className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" id="maintenance">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <Hammer className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">My work orders</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Repairs and service assigned to you. Log your time, record the parts you use, and complete the job when it is done.
          </p>
        </div>
      </div>

      {offline ? (
        <p className="mt-4 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-[var(--warning)]">
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          You are offline. Time you log is kept on this phone; starting, completing and parts need signal.
        </p>
      ) : null}
      {pending > 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-[var(--ink-muted)]">
          <CloudOff className="h-4 w-4" aria-hidden="true" />
          {pending} time {pending === 1 ? "entry is" : "entries are"} waiting to sync.
        </p>
      ) : null}
      {message ? (
        <p
          className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${
            message.kind === "error" ? "bg-red-50 text-[var(--danger)]" : "bg-emerald-50 text-[var(--success)]"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {workOrders.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-center text-sm text-[var(--ink-muted)]">
          No work orders assigned to you right now.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {workOrders.map((workOrder) => (
            <li className="rounded-md border border-[var(--border)] bg-white p-4" key={workOrder.id}>
              <p className="text-xs font-semibold text-[var(--primary)]">
                {workOrder.label} · {workOrder.priorityLabel} · {workOrder.statusLabel}
              </p>
              <p className="mt-1 font-semibold text-[var(--ink)]">{workOrder.title}</p>
              <p className="text-sm text-[var(--ink-muted)]">
                {[workOrder.assetLabel, workOrder.dueDate ? `due ${workOrder.dueDate}` : null].filter(Boolean).join(", ")}
              </p>
              {workOrder.description ? (
                <p className="mt-2 whitespace-pre-line text-sm text-[var(--ink)]">{workOrder.description}</p>
              ) : null}
              {workOrder.tasks.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {workOrder.tasks.map((task) => (
                    <li className={task.done ? "text-[var(--ink-muted)] line-through" : "text-[var(--ink)]"} key={task.id}>
                      {task.title}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {workOrder.status !== "in_progress" ? (
                  <form action={workerMoveWorkOrder}>
                    <input name="workOrderId" type="hidden" value={workOrder.id} />
                    <input name="action" type="hidden" value="start" />
                    <button className={buttonClass} disabled={offline} type="submit">
                      {workOrder.status === "on_hold" ? "Resume" : "Start"}
                    </button>
                  </form>
                ) : null}
                {workOrder.status !== "on_hold" ? (
                  <details className="w-full sm:w-auto">
                    <summary className={`${secondaryClass} cursor-pointer list-none`}>Put on hold</summary>
                    <form action={workerMoveWorkOrder} className="mt-2 flex gap-2">
                      <input name="workOrderId" type="hidden" value={workOrder.id} />
                      <input name="action" type="hidden" value="hold" />
                      <input aria-label="Why" className={inputClass} name="reason" placeholder="Why (for example, waiting on a part)" required />
                      <button className={secondaryClass} disabled={offline} type="submit">
                        Hold
                      </button>
                    </form>
                  </details>
                ) : null}
              </div>

              <details className="mt-3 rounded-md border border-[var(--border)] p-3">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  <Timer className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  Log time (works offline)
                </summary>
                <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={(event) => logTime(event, workOrder.id)}>
                  <input aria-label="Hours" className={inputClass} inputMode="decimal" name="hours" placeholder="Hours" required />
                  <input
                    aria-label="Day worked"
                    className={inputClass}
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    name="workedOn"
                    type="date"
                  />
                  <input aria-label="Note" className={inputClass} name="note" placeholder="Note (optional)" />
                  <button className={`${secondaryClass} sm:col-span-3`} type="submit">
                    Save time
                  </button>
                </form>
              </details>

              <details className="mt-2 rounded-md border border-[var(--border)] p-3">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  <Package className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                  Record a part used
                </summary>
                <form action={workerUsePart} className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input name="workOrderId" type="hidden" value={workOrder.id} />
                  {items.length > 0 ? (
                    <>
                      <select aria-label="Stock item" className={inputClass} defaultValue="" name="itemId">
                        <option value="">Not from stock (describe it)</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.unit})
                          </option>
                        ))}
                      </select>
                      <select aria-label="Taken from" className={inputClass} defaultValue="" name="placeId">
                        <option value="">Taken from (stock items)</option>
                        {places.map((place) => (
                          <option key={place.id} value={place.id}>
                            {place.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  <input aria-label="Description" className={inputClass} name="description" placeholder="Description (if not from stock)" />
                  <input aria-label="Quantity" className={inputClass} inputMode="decimal" name="qty" placeholder="Quantity" required />
                  <input aria-label="Unit cost" className={inputClass} inputMode="decimal" name="unitCost" placeholder="Unit cost (if not from stock)" />
                  <button className={secondaryClass} disabled={offline} type="submit">
                    Record part
                  </button>
                </form>
              </details>

              <details className="mt-2 rounded-md border border-[var(--border)] p-3">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">Complete the work order</summary>
                <form action={workerMoveWorkOrder} className="mt-2 grid gap-2">
                  <input name="workOrderId" type="hidden" value={workOrder.id} />
                  <input name="action" type="hidden" value="complete" />
                  <textarea
                    aria-label="What was done"
                    className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
                    name="notes"
                    placeholder="What was done"
                    required
                  />
                  {workOrder.assetLabel ? (
                    <input
                      aria-label="Meter reading"
                      className={inputClass}
                      inputMode="decimal"
                      min={workOrder.lastMeter ?? 0}
                      name="meter"
                      placeholder={
                        workOrder.metered
                          ? `Meter reading (required${workOrder.lastMeter !== null ? `, last ${workOrder.lastMeter}` : ""})`
                          : "Meter reading (optional)"
                      }
                      required={workOrder.metered}
                      step="0.1"
                      type="number"
                    />
                  ) : null}
                  <button className={buttonClass} disabled={offline || workOrder.status === "on_hold"} type="submit">
                    {workOrder.status === "on_hold" ? "Resume before completing" : "Complete"}
                  </button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
