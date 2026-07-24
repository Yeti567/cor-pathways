"use client";

import { useState } from "react";
import { recordInventoryCount } from "@/app/admin/inventory/actions";
import { buildInventoryCountPlan, describeCountDelta } from "@/lib/inventory-count";
import { formatInventoryQty, parseInventoryQty } from "@/lib/inventory-ledger";

type ItemOption = { id: string; name: string; unit: string };
type PlaceOption = { id: string; label: string };

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

/**
 * The count form, made honest by showing its own arithmetic.
 *
 * As soon as an item and a place are chosen it shows what the books say is there, and as
 * the counted number is typed it previews the correction that will be posted. The preview
 * uses the very same reconciliation function the server does, so what it promises is what
 * lands: a shortage out to loss, a windfall back from it, a match posts nothing.
 */
export function CountEntryForm({
  items,
  places,
  balances,
  lossLocationId,
  defaultItemId,
  defaultPlaceId,
}: {
  items: ItemOption[];
  places: PlaceOption[];
  /** On-hand per item and place, keyed "itemId::placeId". Absent means zero. */
  balances: Record<string, number>;
  lossLocationId: string | null;
  defaultItemId?: string;
  defaultPlaceId?: string;
}) {
  const [itemId, setItemId] = useState(defaultItemId ?? "");
  const [locationId, setLocationId] = useState(defaultPlaceId ?? "");
  const [counted, setCounted] = useState("");

  const item = items.find((option) => option.id === itemId);
  const hasPair = Boolean(itemId && locationId);
  const expected = hasPair ? balances[`${itemId}::${locationId}`] ?? 0 : null;

  const countedQty = parseInventoryQty(counted);
  const preview =
    hasPair && expected !== null && counted.trim()
      ? buildInventoryCountPlan({ countedQty, expectedQty: expected, locationId, lossLocationId })
      : null;

  return (
    <form action={recordInventoryCount} className="mt-4 space-y-3">
      <label className="block space-y-2">
        <span className="text-sm font-medium text-[var(--ink)]">Item</span>
        <select
          className={inputClass}
          name="itemId"
          onChange={(event) => setItemId(event.target.value)}
          required
          value={itemId}
        >
          <option value="">Choose...</option>
          {items.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-[var(--ink)]">Place counted</span>
        <select
          className={inputClass}
          name="locationId"
          onChange={(event) => setLocationId(event.target.value)}
          required
          value={locationId}
        >
          <option value="">Choose...</option>
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.label}
            </option>
          ))}
        </select>
      </label>

      {hasPair && expected !== null ? (
        <p className="rounded-md bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--ink-muted)]">
          The books say{" "}
          <span className="font-semibold text-[var(--ink)]">
            {formatInventoryQty(expected)} {item?.unit}
          </span>{" "}
          here.
        </p>
      ) : null}

      <label className="block space-y-2">
        <span className="text-sm font-medium text-[var(--ink)]">Counted quantity</span>
        <input
          className={inputClass}
          inputMode="decimal"
          name="countedQty"
          onChange={(event) => setCounted(event.target.value)}
          placeholder="46"
          required
          value={counted}
        />
      </label>

      {preview?.ok ? (
        preview.plan.delta === 0 ? (
          <p className="rounded-md border border-[var(--success)] bg-emerald-50 px-3 py-2 text-sm text-[var(--success)]">
            Matches the books. Nothing will be posted.
          </p>
        ) : (
          <p
            className={`rounded-md border px-3 py-2 text-sm ${
              preview.plan.delta < 0
                ? "border-[var(--warning)] bg-amber-50 text-[var(--warning)]"
                : "border-[var(--primary)] bg-blue-50 text-[var(--primary)]"
            }`}
          >
            {describeCountDelta(preview.plan.delta)}: this will {preview.plan.delta < 0 ? "move" : "pull back"}{" "}
            {formatInventoryQty(preview.plan.adjustment?.qty ?? 0)} {item?.unit}{" "}
            {preview.plan.delta < 0 ? "out to Loss" : "from Loss"}.
          </p>
        )
      ) : preview && !preview.ok ? (
        <p className="rounded-md border border-[var(--danger)] bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {preview.error}
        </p>
      ) : null}

      <label className="block space-y-2">
        <span className="text-sm font-medium text-[var(--ink)]">Note (optional)</span>
        <input className={inputClass} name="note" placeholder="Quarterly count" />
      </label>

      <button
        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
        type="submit"
      >
        Record count
      </button>
    </form>
  );
}
