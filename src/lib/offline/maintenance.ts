import type { Json } from "@/types/database";
import { buildLabourWrite } from "@/lib/maintenance";
import { getOfflineDatabase } from "./db";
import { queueOfflineMutation } from "./sync-queue";

/**
 * Offline time logging for maintenance work orders: a worker records the hours they spent
 * on a job assigned to them, from their phone, with or without signal.
 *
 * The entry is queued as an insert into maintenance_work_order_labour and replayed when
 * the connection returns. Each entry carries a client_uuid, and the table has a unique
 * index on (tenant_id, client_uuid), so a sync that runs twice posts the time once, the
 * same way the inventory field moves work. The database guard accepts it only from the
 * person the work order is assigned to, for their own time, while its costs are open.
 *
 * Starting, holding, completing and using parts need a connection: completion settles the
 * corrective action and the scheduled service, and a part posts to the stock ledger, and
 * none of those can be decided on a phone that cannot see the latest stock or status.
 */

export type WorkOrderLabourInput = {
  hours: number | null;
  note: string | null;
  tenantId: string;
  userId: string;
  workOrderId: string;
  workedOn: string;
};

export type WorkOrderLabourPayload = {
  client_uuid: string;
  cost: number;
  hours: number;
  note: string | null;
  rate: number;
  tenant_id: string;
  work_order_id: string;
  worked_on: string;
  worker_id: string;
};

export type WorkOrderLabourResult = { ok: false; error: string } | { ok: true; payload: WorkOrderLabourPayload };

/**
 * Validates a time entry and stamps it with the id that makes it idempotent. Pure (the
 * caller supplies the uuid and today) so it can be tested without a browser. A worker's
 * own entry carries no rate; a manager sets rates on the work order.
 */
export function buildWorkOrderLabourPayload(
  input: WorkOrderLabourInput,
  clientUuid: string,
  today: string,
): WorkOrderLabourResult {
  if (!input.workOrderId) {
    return { error: "Choose the work order.", ok: false };
  }

  const built = buildLabourWrite(
    { hours: input.hours, note: input.note, rate: 0, workedOn: input.workedOn, workerId: input.userId },
    today,
  );

  if (!built.ok) {
    return built;
  }

  return {
    ok: true,
    payload: {
      client_uuid: clientUuid,
      cost: built.write.cost,
      hours: built.write.hours,
      note: built.write.note,
      rate: built.write.rate,
      tenant_id: input.tenantId,
      work_order_id: input.workOrderId,
      worked_on: built.write.worked_on,
      worker_id: input.userId,
    },
  };
}

/**
 * The reverse gate, run by the sync engine before a queued entry is sent. Defensive on
 * every field, because a queued payload has sat in IndexedDB. Returns the exact row to
 * insert, or null to fail the mutation. The rate is always zero from a phone.
 */
export function normalizeWorkOrderLabourPayload(payload: Json): WorkOrderLabourPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, Json | undefined>;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "");
  const hours = typeof record.hours === "number" && Number.isFinite(record.hours) ? record.hours : 0;
  const workedOn = text("worked_on");

  if (
    !text("tenant_id") ||
    !text("work_order_id") ||
    !text("worker_id") ||
    !text("client_uuid") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(workedOn) ||
    hours <= 0 ||
    hours > 24
  ) {
    return null;
  }

  return {
    client_uuid: text("client_uuid"),
    cost: 0,
    hours: Math.round(hours * 100) / 100,
    note: text("note") || null,
    rate: 0,
    tenant_id: text("tenant_id"),
    work_order_id: text("work_order_id"),
    worked_on: workedOn,
    worker_id: text("worker_id"),
  };
}

/** Queues a validated time entry. Runs in the browser only. */
export async function queueWorkOrderLabour(input: WorkOrderLabourInput): Promise<WorkOrderLabourResult> {
  const today = new Date().toISOString().slice(0, 10);
  const result = buildWorkOrderLabourPayload(input, crypto.randomUUID(), today);

  if (!result.ok) {
    return result;
  }

  await queueOfflineMutation({
    operation: "insert",
    payload: result.payload as unknown as Json,
    recordId: result.payload.client_uuid,
    table: "maintenance_work_order_labour",
    tenantId: input.tenantId,
  });

  return result;
}

/** How many time entries are still waiting to sync, for the panel's status line. */
export async function countPendingWorkOrderLabour(): Promise<number> {
  const db = getOfflineDatabase();
  return db.queuedMutations.where("table").equals("maintenance_work_order_labour").count();
}
