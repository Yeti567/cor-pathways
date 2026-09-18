// Which reminder notifications a tenant already holds, so a reminder run sends each one once.
//
// Every reminder module builds its candidate notifications, then drops the ones already on
// file before inserting. That read has to see every matching row. PostgREST caps a response
// at 1,000 rows, and the unpaged read this replaced saw only part of the table once a tenant
// passed that. Everything it missed was sent again on the next page load, which made the
// table bigger and the read blinder still: one tenant went from 3,000 notifications to
// over 100,000 in a single week, and every admin page slowed with it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type NotificationDedupeClient = Pick<SupabaseClient<Database>, "from">;
type NotificationKeyFields = Pick<Database["public"]["Tables"]["notifications"]["Row"], "body" | "title" | "user_id">;

export const NOTIFICATION_DEDUPE_PAGE_SIZE = 1000;

export function notificationKey(notification: {
  body?: string | null;
  title?: string | null;
  user_id?: string | null;
}) {
  return `${notification.user_id ?? ""}|${notification.title}|${notification.body}`;
}

export async function existingNotificationKeys(
  client: NotificationDedupeClient,
  tenantId: string,
  candidates: { body?: string | null; title?: string | null; user_id?: string | null }[],
  options: { since?: string } = {},
): Promise<{ error: string | null; keys: Set<string> }> {
  const keys = new Set<string>();
  const titles = Array.from(new Set(candidates.map((candidate) => candidate.title ?? ""))).filter(Boolean);

  if (titles.length === 0) {
    return { error: null, keys };
  }

  // Narrowing by recipient keeps the read small. A candidate with no recipient can only
  // match a row with no recipient, which an .in() filter cannot express, so skip it then.
  const userIds = Array.from(new Set(candidates.map((candidate) => candidate.user_id ?? null)));
  const filterByUser = !userIds.includes(null);

  for (let from = 0; ; from += NOTIFICATION_DEDUPE_PAGE_SIZE) {
    let query = client
      .from("notifications")
      .select("body, title, user_id")
      .eq("tenant_id", tenantId)
      .in("title", titles);

    if (filterByUser) {
      query = query.in("user_id", userIds as string[]);
    }

    if (options.since) {
      query = query.gte("created_at", options.since);
    }

    const { data, error } = await query
      .order("id")
      .range(from, from + NOTIFICATION_DEDUPE_PAGE_SIZE - 1)
      .returns<NotificationKeyFields[]>();

    if (error) {
      return { error: error.message, keys };
    }

    for (const row of data ?? []) {
      keys.add(notificationKey(row));
    }

    if (!data || data.length < NOTIFICATION_DEDUPE_PAGE_SIZE) {
      return { error: null, keys };
    }
  }
}
