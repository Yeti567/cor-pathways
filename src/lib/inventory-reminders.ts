import { isPowerAtLeast } from "@/lib/access-control";
import { formatInventoryQty } from "@/lib/inventory-ledger";
import {
  lowStockLevels,
  summariseInventoryStockLevels,
  type ItemStockLevel,
  type StockLevelBalance,
  type StockLevelItem,
} from "@/lib/inventory-stock-levels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTenantAuditEvent } from "@/lib/tenant-audit";
import type { Database } from "@/types/database";

// Low-stock reminders, built on the same notification machinery as equipment service
// reminders. The shape is deliberately identical: a pure builder that turns the current
// picture into candidate notifications, and a sender that dedupes them against what has
// already gone out so the same shortage is not announced twice.

type InventoryReminderClient = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;
type InventoryReminderNotification = Database["public"]["Tables"]["notifications"]["Insert"];
type InventoryReminderNotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "body" | "created_at" | "delivery_status" | "id" | "recipient_name" | "recipient_type" | "title" | "user_id"
>;
type InventoryReminderUser = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;
type InventoryReminderAuditSource = "cron" | "page";

function displayName(user: Pick<InventoryReminderUser, "email" | "full_name"> | null | undefined) {
  return user?.full_name?.trim() || user?.email || "Manager";
}

// Reorder is a management concern: there is no assigned worker for a shelf running low, so
// the recipients are the people who can act on it, the managers and admins.
function managerRecipients(users: InventoryReminderUser[]) {
  return users.filter(
    (user) =>
      user.active &&
      (isPowerAtLeast(user.power_level, "manager") ||
        user.app_access === "admin_access" ||
        user.app_access === "super_admin_access"),
  );
}

function baseNotification(input: {
  body: string;
  createdAt: string;
  tenantId: string;
  title: string;
  user: InventoryReminderUser;
}): InventoryReminderNotification {
  return {
    body: input.body,
    channel: "in_app",
    created_at: input.createdAt,
    delivered_at: input.createdAt,
    delivery_status: "delivered",
    recipient_name: displayName(input.user),
    recipient_type: "inventory_manager",
    tenant_id: input.tenantId,
    title: input.title,
    user_id: input.user.id,
  };
}

function lowStockBody(level: ItemStockLevel) {
  const reorder = formatInventoryQty(level.reorderPoint);
  const unit = level.unit ? ` ${level.unit}` : "";

  if (level.state === "out") {
    return `${level.name} is out of stock: nothing on hand across your places, with a reorder point of ${reorder}${unit}. Reorder before a job needs it.`;
  }

  return `${level.name} is low: ${formatInventoryQty(level.onHand)}${unit} on hand, at or below the reorder point of ${reorder}${unit}. Reorder before you run out.`;
}

export function buildInventoryLowStockNotifications({
  balances,
  createdAt,
  items,
  tenantId,
  users,
}: {
  balances: StockLevelBalance[];
  createdAt: string;
  items: StockLevelItem[];
  tenantId: string;
  users: InventoryReminderUser[];
}) {
  const attention = lowStockLevels(summariseInventoryStockLevels(items, balances));

  if (attention.length === 0) {
    return [];
  }

  const recipients = managerRecipients(users);
  const notifications: InventoryReminderNotification[] = [];

  for (const level of attention) {
    const title = `${level.state === "out" ? "Out of stock" : "Low stock"}: ${level.name}`;
    const body = lowStockBody(level);

    for (const user of recipients) {
      notifications.push(baseNotification({ body, createdAt, tenantId, title, user }));
    }
  }

  return notifications;
}

/**
 * Loads the current picture, raises a low-stock notification for anything at or below its
 * reorder point, and dedupes against notifications already sent so the same shortage does
 * not nag every time a page loads. The dedup key is (recipient, title, body): the body
 * carries the on-hand figure, so a shortage that gets worse is announced again, while an
 * unchanged one stays quiet.
 */
export async function sendInventoryLowStockNotifications(
  tenantId: string,
  now = new Date(),
  client?: InventoryReminderClient,
  options: {
    auditClient?: InventoryReminderClient | null;
    auditSource?: InventoryReminderAuditSource;
  } = {},
) {
  const supabase = client ?? (await createSupabaseServerClient());
  const createdAt = now.toISOString();

  const [{ data: items, error: itemsError }, { data: balances, error: balancesError }, { data: users, error: usersError }] =
    await Promise.all([
      supabase
        .from("inventory_item")
        .select("id, name, unit_of_measure, reorder_point, active")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("active", true)
        .not("reorder_point", "is", null)
        .returns<StockLevelItem[]>(),
      supabase
        .from("inventory_balance")
        .select("item_id, qty, allows_negative")
        .eq("tenant_id", tenantId)
        .returns<StockLevelBalance[]>(),
      supabase
        .from("users")
        .select("id, full_name, email, active, power_level, app_access")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .returns<InventoryReminderUser[]>(),
    ]);

  const error = itemsError?.message ?? balancesError?.message ?? usersError?.message ?? null;

  if (error) {
    return { auditError: null, created: 0, error, skipped: 0 };
  }

  const candidateNotifications = buildInventoryLowStockNotifications({
    balances: balances ?? [],
    createdAt,
    items: items ?? [],
    tenantId,
    users: users ?? [],
  });

  if (candidateNotifications.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: 0 };
  }

  const titles = Array.from(new Set(candidateNotifications.map((notification) => notification.title ?? ""))).filter(
    Boolean,
  );
  const { data: existingNotifications, error: existingError } =
    titles.length > 0
      ? await supabase
          .from("notifications")
          .select("body, title, user_id")
          .eq("tenant_id", tenantId)
          .in("title", titles)
          .returns<Pick<Database["public"]["Tables"]["notifications"]["Row"], "body" | "title" | "user_id">[]>()
      : { data: [], error: null };

  if (existingError) {
    return { auditError: null, created: 0, error: existingError.message, skipped: 0 };
  }

  const existingKeys = new Set(
    (existingNotifications ?? []).map(
      (notification) => `${notification.user_id ?? ""}|${notification.title}|${notification.body}`,
    ),
  );
  const newNotifications = candidateNotifications.filter(
    (notification) => !existingKeys.has(`${notification.user_id ?? ""}|${notification.title}|${notification.body}`),
  );

  if (newNotifications.length === 0) {
    return { auditError: null, created: 0, error: null, skipped: candidateNotifications.length };
  }

  const { data: insertedNotifications, error: insertError } = await supabase
    .from("notifications")
    .insert(newNotifications)
    .select("body, created_at, delivery_status, id, recipient_name, recipient_type, title, user_id")
    .returns<InventoryReminderNotificationAuditRow[]>();

  let auditError: string | null = null;

  if (!insertError && insertedNotifications && insertedNotifications.length > 0) {
    try {
      for (const notification of insertedNotifications) {
        await recordTenantAuditEvent(
          {
            action: "inventory_reminder.notification.sent",
            actorRole: "system",
            entityId: notification.id,
            entityTable: "notifications",
            metadata: {
              created_at: notification.created_at,
              delivery_status: notification.delivery_status,
              recipient_name: notification.recipient_name,
              recipient_type: notification.recipient_type,
              source: options.auditSource ?? "page",
              title: notification.title,
              user_id: notification.user_id,
            },
            tenantId,
          },
          options.auditClient === undefined ? undefined : options.auditClient,
        );
      }
    } catch (auditException) {
      auditError = auditException instanceof Error ? auditException.message : "Inventory reminder audit was not recorded.";
    }
  }

  return {
    auditError,
    created: insertError ? 0 : newNotifications.length,
    error: insertError?.message ?? null,
    skipped: candidateNotifications.length - newNotifications.length,
  };
}
