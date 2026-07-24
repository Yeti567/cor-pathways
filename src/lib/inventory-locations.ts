import type { InventoryLocationKind } from "@/types/database";

/**
 * Stocking places: where inventory can sit.
 *
 * Deliberately a separate concept from `public.locations`. Locations is the list of
 * places people go, and it feeds worker assignment, visitors, equipment, incidents and
 * the worker app through around thirty queries that mostly filter nothing. A stocking
 * place either points at one of those locations, or at a truck, or at a worker, or at
 * nothing at all when it is virtual. Keeping them apart is what stops "In transit"
 * appearing in a list of sites somebody could be assigned to.
 */

export type InventoryLocationBacking = "location" | "equipment" | "user" | "none";

type KindMeta = {
  backing: InventoryLocationBacking;
  description: string;
  label: string;
  /** Virtual places are created by the system, cannot be removed, and hold no real address. */
  virtual: boolean;
};

export const inventoryLocationKinds: Record<InventoryLocationKind, KindMeta> = {
  customer_site: {
    backing: "location",
    description: "A customer or lease site where your stock sits while it is out.",
    label: "Customer site",
    virtual: false,
  },
  job: {
    backing: "location",
    description: "A job or project that consumes stock.",
    label: "Job",
    virtual: false,
  },
  loss: {
    backing: "none",
    description:
      "Damage, shrinkage, and count corrections land here, so a balance is adjusted by recording where it went rather than by editing a number.",
    label: "Loss and write-off",
    virtual: true,
  },
  transit: {
    backing: "none",
    description:
      "Holds a load that has left one place but not arrived at the next, so stock in flight is visible instead of missing.",
    label: "In transit",
    virtual: true,
  },
  vehicle: {
    backing: "equipment",
    description: "Stock carried on a truck. Loading a truck is a movement, not a special case.",
    label: "Vehicle",
    virtual: false,
  },
  vendor: {
    backing: "location",
    description: "A supplier or repair shop holding your stock.",
    label: "Vendor",
    virtual: false,
  },
  worker: {
    backing: "user",
    description: "Tools checked out to a person. Checking a tool out is a movement too.",
    label: "Worker",
    virtual: false,
  },
  yard: {
    backing: "location",
    description: "Your own yard or shop. The usual home for stock.",
    label: "Yard",
    virtual: false,
  },
};

/** The kinds an admin may create. The virtual two are seeded by the system, never chosen. */
export const selectableInventoryLocationKinds = (
  Object.keys(inventoryLocationKinds) as InventoryLocationKind[]
)
  .filter((kind) => !inventoryLocationKinds[kind].virtual)
  .sort((a, b) => inventoryLocationKinds[a].label.localeCompare(inventoryLocationKinds[b].label));

/** The two places every tenant with the module on must have, exactly once each. */
export const virtualInventoryLocations = [
  { kind: "transit" as const, name: "In transit" },
  { kind: "loss" as const, name: "Loss and write-off" },
];

export function coerceInventoryLocationKind(value: unknown): InventoryLocationKind | null {
  return typeof value === "string" && value in inventoryLocationKinds ? (value as InventoryLocationKind) : null;
}

export function isVirtualInventoryLocation(kind: InventoryLocationKind) {
  return inventoryLocationKinds[kind].virtual;
}

export type InventoryLocationWrite = {
  equipment_id: string | null;
  kind: InventoryLocationKind;
  location_id: string | null;
  name: string | null;
  user_id: string | null;
};

export type InventoryLocationWriteResult =
  | { ok: false; error: string }
  | { ok: true; write: InventoryLocationWrite };

/**
 * Builds the row for a new stocking place, or explains why it cannot be built.
 *
 * Mirrors inventory_location_backing_check. The database is what makes the rule true;
 * this is what makes a mistake readable. A backed place stores no name of its own, so a
 * renamed yard cannot drift out of step with the stocking place that points at it.
 */
export function buildInventoryLocationWrite(input: {
  backingId: string | null;
  kind: InventoryLocationKind | null;
}): InventoryLocationWriteResult {
  if (!input.kind) {
    return { ok: false, error: "Choose what sort of place this is." };
  }

  const meta = inventoryLocationKinds[input.kind];

  if (meta.virtual) {
    return { ok: false, error: `${meta.label} is created automatically and cannot be added by hand.` };
  }

  if (!input.backingId) {
    const what =
      meta.backing === "equipment" ? "a vehicle" : meta.backing === "user" ? "a worker" : "a location";
    return { ok: false, error: `Choose ${what} for this stocking place.` };
  }

  return {
    ok: true,
    write: {
      equipment_id: meta.backing === "equipment" ? input.backingId : null,
      kind: input.kind,
      location_id: meta.backing === "location" ? input.backingId : null,
      name: null,
      user_id: meta.backing === "user" ? input.backingId : null,
    },
  };
}

/**
 * The name to show for a stocking place.
 *
 * Backed places borrow their name live from whatever backs them, which is why the column
 * is left null for them: there is nothing to keep in sync.
 */
export function inventoryLocationLabel(
  row: { kind: InventoryLocationKind; name: string | null },
  backingName?: string | null,
): string {
  return backingName?.trim() || row.name?.trim() || inventoryLocationKinds[row.kind].label;
}
