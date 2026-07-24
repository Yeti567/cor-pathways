"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CloudOff, PackagePlus } from "lucide-react";
import { countPendingFieldMovements, queueFieldMovement } from "@/lib/offline/inventory";
import { parseInventoryQty } from "@/lib/inventory-ledger";
import { flushQueuedMutations } from "@/lib/offline/sync";
import { syncQueueChangedEvent } from "@/lib/offline/sync-queue";

type PlaceOption = { id: string; label: string };
type ItemOption = { id: string; name: string; unit: string };

const inputClass =
  "h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

/**
 * Field capture for a driver's phone. Records stock moving from one place to another and
 * queues it offline, so a move made in a dead zone is on the books the moment there is
 * signal again. Each queued move carries an idempotency key, so it posts exactly once no
 * matter how many times the sync runs.
 *
 * A client component on purpose: queueing writes to the on-device store, which only exists
 * in the browser. It never blocks on the network; recording always succeeds locally and
 * the sync catches up later.
 */
export function InventoryFieldPanel({
  items,
  places,
  tenantId,
  userId,
}: {
  items: ItemOption[];
  places: PlaceOption[];
  tenantId: string;
  userId: string;
}) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState<{ from: string; item: string; qty: number; to: string }[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      countPendingFieldMovements()
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const result = await queueFieldMovement({
      fromLocationId: fromId,
      itemId,
      note: note || null,
      qty: parseInventoryQty(qty),
      tenantId,
      toLocationId: toId,
      userId,
    });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    const item = items.find((option) => option.id === itemId);
    const from = places.find((option) => option.id === fromId);
    const to = places.find((option) => option.id === toId);
    setRecorded((prev) =>
      [
        { from: from?.label ?? "?", item: item?.name ?? "item", qty: result.payload.qty, to: to?.label ?? "?" },
        ...prev,
      ].slice(0, 5),
    );

    setQty("");
    setNote("");

    // Try to send it now. If there is no signal this quietly does nothing and the move
    // stays queued; recording has already succeeded either way.
    try {
      await flushQueuedMutations();
    } catch {
      // Offline or a transient failure: the queue keeps the move for the next sync.
    }

    setBusy(false);
  }

  return (
    <section
      className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
      id="inventory"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <PackagePlus className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Move stock</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Loaded or dropped something? Record it here. It saves on your phone right away and syncs when you have
            signal.
          </p>
        </div>
      </div>

      {pending > 0 ? (
        <p className="mt-3 inline-flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-[var(--warning)]">
          <CloudOff className="h-4 w-4" aria-hidden="true" />
          {pending} move{pending === 1 ? "" : "s"} waiting to sync
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <form className="mt-4 grid gap-3" onSubmit={handleSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-[var(--ink)]">From</span>
            <select className={inputClass} onChange={(event) => setFromId(event.target.value)} required value={fromId}>
              <option value="">Choose...</option>
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[var(--ink)]">To</span>
            <select className={inputClass} onChange={(event) => setToId(event.target.value)} required value={toId}>
              <option value="">Choose...</option>
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <label className="space-y-1">
            <span className="text-sm font-medium text-[var(--ink)]">Item</span>
            <select className={inputClass} onChange={(event) => setItemId(event.target.value)} required value={itemId}>
              <option value="">Choose...</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[var(--ink)]">Quantity</span>
            <input
              className={inputClass}
              inputMode="decimal"
              onChange={(event) => setQty(event.target.value)}
              placeholder="60"
              required
              value={qty}
            />
          </label>
        </div>

        <label className="space-y-1">
          <span className="text-sm font-medium text-[var(--ink)]">Note (optional)</span>
          <input
            className={inputClass}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ticket 4471"
            value={note}
          />
        </label>

        <button
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? "Recording..." : "Record move"}
        </button>
      </form>

      {recorded.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Recorded this session</p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--ink)]">
            {recorded.map((move, index) => (
              <li key={index}>
                {move.qty} {move.item}: {move.from} &rarr; {move.to}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
