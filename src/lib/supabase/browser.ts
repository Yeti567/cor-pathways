import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { assertSupabasePublicEnv } from "@/lib/env";

export function createSupabaseBrowserClient() {
  const env = assertSupabasePublicEnv();

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_KEY,
  );
}
