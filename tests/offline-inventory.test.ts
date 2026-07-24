import { describe, expect, it } from "vitest";
import {
  buildFieldMovementPayload,
  normalizeFieldMovementPayload,
  type FieldMovementInput,
} from "@/lib/offline/inventory";

const base: FieldMovementInput = {
  fromLocationId: "yard",
  itemId: "mat",
  note: null,
  qty: 12,
  tenantId: "tenant-1",
  toLocationId: "truck",
  userId: "user-1",
};

const UUID = "11111111-2222-3333-4444-555555555555";
const AT = "2026-07-24T12:00:00.000Z";

const build = (overrides: Partial<FieldMovementInput> = {}) =>
  buildFieldMovementPayload({ ...base, ...overrides }, UUID, AT);

function payloadOf(result: ReturnType<typeof build>) {
  if (!result.ok) throw new Error(`expected a payload, got: ${result.error}`);
  return result.payload;
}
function errorOf(result: ReturnType<typeof build>) {
  if (result.ok) throw new Error("expected an error, got a payload");
  return result.error;
}

describe("buildFieldMovementPayload", () => {
  it("stamps the move with the idempotency key and time it was given", () => {
    const payload = payloadOf(build({ note: "  ticket 12  " }));

    expect(payload).toMatchObject({
      client_uuid: UUID,
      created_by: "user-1",
      from_location_id: "yard",
      item_id: "mat",
      movement_type: "transfer",
      note: "ticket 12",
      occurred_at: AT,
      qty: 12,
      tenant_id: "tenant-1",
      to_location_id: "truck",
    });
  });

  it("requires an item and a positive quantity", () => {
    expect(errorOf(build({ itemId: "" }))).toContain("Choose an item");
    expect(errorOf(build({ qty: 0 }))).toContain("greater than zero");
    expect(errorOf(build({ qty: -3 }))).toContain("greater than zero");
    expect(errorOf(build({ qty: null }))).toContain("greater than zero");
  });

  it("requires two different places", () => {
    expect(errorOf(build({ fromLocationId: "" }))).toContain("coming from and going to");
    expect(errorOf(build({ toLocationId: "" }))).toContain("coming from and going to");
    expect(errorOf(build({ fromLocationId: "same", toLocationId: "same" }))).toContain("two different places");
  });

  it("blanks an empty note rather than storing whitespace", () => {
    expect(payloadOf(build({ note: "   " })).note).toBeNull();
  });
});

describe("normalizeFieldMovementPayload", () => {
  // A payload that the panel produced round-trips through the sync gate unchanged.
  it("accepts what the builder produced", () => {
    const payload = payloadOf(build());
    expect(normalizeFieldMovementPayload(payload as never)).toMatchObject({
      client_uuid: UUID,
      from_location_id: "yard",
      qty: 12,
      to_location_id: "truck",
    });
  });

  // A queued payload has sat in IndexedDB and must not be trusted to still be well formed.
  it("rejects a payload missing its idempotency key", () => {
    const payload = { ...payloadOf(build()), client_uuid: undefined };
    expect(normalizeFieldMovementPayload(payload as never)).toBeNull();
  });

  it("rejects a non-positive or non-numeric quantity", () => {
    expect(normalizeFieldMovementPayload({ ...payloadOf(build()), qty: 0 } as never)).toBeNull();
    expect(normalizeFieldMovementPayload({ ...payloadOf(build()), qty: "12" } as never)).toBeNull();
  });

  it("rejects a move that goes nowhere or in a circle", () => {
    expect(normalizeFieldMovementPayload({ ...payloadOf(build()), from_location_id: "" } as never)).toBeNull();
    expect(
      normalizeFieldMovementPayload({ ...payloadOf(build()), to_location_id: "yard" } as never),
    ).toBeNull();
  });

  it("rejects a non-object", () => {
    expect(normalizeFieldMovementPayload(null as never)).toBeNull();
    expect(normalizeFieldMovementPayload("nope" as never)).toBeNull();
    expect(normalizeFieldMovementPayload([] as never)).toBeNull();
  });
});
