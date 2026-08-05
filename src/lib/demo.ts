// Optional one-click "try the live demo" login.
//
// This only turns on when both env vars are set on the deployment, so the shared codebase
// stays clean: a client fork that has no demo tenant never sets these, and the button
// simply does not render. The credentials are a deliberately shared, public demo login,
// but they live in server-only env vars (not NEXT_PUBLIC) so they are never shipped to the
// browser, and the sign-in happens in a server action.
//
// To enable on a deployment, set:
//   DEMO_LOGIN_EMAIL      the demo account email
//   DEMO_LOGIN_PASSWORD   the demo account password

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type DemoLoginCredentials = { email: string; password: string };

export function getDemoLoginCredentials(): DemoLoginCredentials | null {
  const email = process.env.DEMO_LOGIN_EMAIL?.trim().toLowerCase();
  const password = process.env.DEMO_LOGIN_PASSWORD;

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

export function isDemoLoginEnabled(): boolean {
  return getDemoLoginCredentials() !== null;
}

// A demo tenant is a shared, public "try it" tenant. Uploads into it are blocked
// at storage (see the 20260724040000 / 20260724050000 migrations); this is the
// matching gate for outbound email, so a demo visitor cannot send invites or
// Auto-Share reports to an arbitrary address on the deployment's Resend account.
// Keyed on the tenants.demo_mode flag so it survives the demo being torn down and
// rebuilt with a fresh tenant id on each nightly reset.
export async function isDemoTenant(
  client: SupabaseClient<Database>,
  tenantId: string,
): Promise<boolean> {
  const { data } = await client
    .from("tenants")
    .select("demo_mode")
    .eq("id", tenantId)
    .maybeSingle<{ demo_mode: boolean }>();

  return data?.demo_mode === true;
}
