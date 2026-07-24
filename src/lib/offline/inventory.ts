import type { Json } from "@/types/database";
import { getOfflineDatabase } from "./db";
import { queueOfflineMutation } from "./sync-queue";

/**
 * Offline field capture for inventory: a worker records stock moving from one place to
 * another, from their phone, with or without signal.
 *
 * The move is queued as an insert into inventory_movement and replayed when the connection
 * returns. Each queued move carries a client_uuid, and the ledger has a unique index on
 * (tenant_id, client_uuid), so a sync that runs twice, or a phone that syncs the same
 * capture from two tabs, posts the move exactly once. That idempotency is the whole reason
 * the column exists.
 *
 * The pure builders here are shared by the worker panel (to queue) and by the sync engine
 * (to validate on the way out), so a move that the panel accepts is a move the ledger will
 * accept, and neither can drift from the other.
 */

export type FieldMovementInput = {
  fromLocationId: string;
  itemId: string;
  note: string | null;
  qty: number | null;
  tenantId: string;
  toLocationId: string;
  userId: string;
};

export type FieldMovementPayload = {
  client_uuid: string;
  created_by: string;
  from_location_id: string;
  item_id: string;
  movement_type: "transfer";
  note: string | null;
  occurred_at: string;
  qty: number;
  tenant_id: string;
  to_location_id: string;
};

export type FieldMovementResult = { ok: false; error: string } | { ok: true; payload: FieldMovementPayload };

/**
 * Validates a field move and stamps it with the ids that make it idempotent. Kept pure
 * (the caller supplies the uuid and the timestamp) so it can be exercised without a
 * browser or a clock.
 */
export function buildFieldMovementPayload(
  input: FieldMovementInput,
  clientUuid: string,
  occurredAtIso: string,
): FieldMovementResult {
  if (!input.itemId) {
    return { ok: false, error: "Choose an item." };
  }

  if (input.qty === null || !Number.isFinite(input.qty) || input.qty <= 0) {
    return { ok: false, error: "Enter a quantity greater than zero." };
  }

  if (!input.fromLocationId || !input.toLocationId) {
    return { ok: false, error: "Choose where the stock is coming from and going to." };
  }

  if (input.fromLocationId === input.toLocationId) {
    return { ok: false, error: "Choose two different places." };
  }

  return {
    ok: true,
    payload: {
      client_uuid: clientUuid,
      created_by: input.userId,
      from_location_id: input.fromLocationId,
      item_id: input.itemId,
      movement_type: "transfer",
      note: input.note?.trim() || null,
      occurred_at: occurredAtIso,
      qty: input.qty,
      tenant_id: input.tenantId,
      to_location_id: input.toLocationId,
    },
  };
}

/**
 * The reverse gate, run by the sync engine before a queued move is sent. Defensive on
 * every field, because a queued payload has sat in IndexedDB and must not be trusted to
 * still be well formed. Returns the exact row to insert, or null to fail the mutation.
 */
export function normalizeFieldMovementPayload(payload: Json): FieldMovementPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, Json | undefined>;
  const tenantId = typeof record.tenant_id === "string" ? record.tenant_id : "";
  const itemId = typeof record.item_id === "string" ? record.item_id : "";
  const fromId = typeof record.from_location_id === "string" ? record.from_location_id : "";
  const toId = typeof record.to_location_id === "string" ? record.to_location_id : "";
  const clientUuid = typeof record.client_uuid === "string" ? record.client_uuid : "";
  const qty = typeof record.qty === "number" && Number.isFinite(record.qty) ? record.qty : 0;

  if (!tenantId || !itemId || !fromId || !toId || !clientUuid || qty <= 0 || fromId === toId) {
    return null;
  }

  const occurredAt =
    typeof record.occurred_at === "string" && record.occurred_at ? record.occurred_at : new Date().toISOString();

  return {
    client_uuid: clientUuid,
    created_by: typeof record.created_by === "string" ? record.created_by : "",
    from_location_id: fromId,
    item_id: itemId,
    movement_type: "transfer",
    note: typeof record.note === "string" && record.note ? record.note : null,
    occurred_at: occurredAt,
    qty,
    tenant_id: tenantId,
    to_location_id: toId,
  };
}

/**
 * Queues a validated field move. Runs in the browser only. Generates the client_uuid here,
 * so a move captured offline keeps the same idempotency key however many times it later
 * syncs.
 */
export async function queueFieldMovement(input: FieldMovementInput): Promise<FieldMovementResult> {
  const result = buildFieldMovementPayload(input, crypto.randomUUID(), new Date().toISOString());

  if (!result.ok) {
    return result;
  }

  await queueOfflineMutation({
    table: "inventory_movement",
    operation: "insert",
    tenantId: input.tenantId,
    recordId: result.payload.client_uuid,
    payload: result.payload as unknown as Json,
  });

  return result;
}

/** How many field moves are still waiting to sync, for the panel's status line. */
export async function countPendingFieldMovements(): Promise<number> {
  const db = getOfflineDatabase();
  return db.queuedMutations.where("table").equals("inventory_movement").count();
}
