import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { assertSupabasePublicEnv } from "@/lib/env";

export function createSupabaseAdminClient() {
  const env = assertSupabasePublicEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return null;
  }

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
