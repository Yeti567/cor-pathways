/**
 * Re-sends invite links to every worker in a tenant whose email address is
 * still unconfirmed. One-off recovery for links that expired before the
 * Supabase OTP expiry was raised to 24 hours.
 *
 * Usage: npx tsx scripts/resend-stale-invites.ts --tenant <uuid> [--apply]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { resendWorkerInviteByEmail } from "../src/lib/worker-invite";

function loadEnv(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  loadEnv();

  const tenantId = process.argv[process.argv.indexOf("--tenant") + 1];
  const apply = process.argv.includes("--apply");

  if (!tenantId || tenantId.startsWith("--")) {
    console.error("Pass --tenant <uuid>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!url || !serviceKey || !appUrl) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or NEXT_PUBLIC_APP_URL in .env.local");
    process.exit(1);
  }

  const supabase = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  if (!tenant) {
    console.error("Tenant not found");
    process.exit(1);
  }

  const { data: workers, error } = await supabase
    .from("users")
    .select("id, email, full_name")
    .eq("tenant_id", tenantId);

  if (error || !workers) {
    console.error("Could not list workers:", error?.message);
    process.exit(1);
  }

  const stale: { email: string; fullName: string }[] = [];

  for (const worker of workers) {
    const { data: authUser } = await supabase.auth.admin.getUserById(worker.id);
    if (authUser?.user && !authUser.user.email_confirmed_at) {
      stale.push({ email: worker.email, fullName: worker.full_name });
    }
  }

  console.log(`Tenant: ${tenant.name}`);
  console.log(`Unconfirmed workers: ${stale.length}`);
  for (const s of stale) console.log(`  - ${s.fullName} <${s.email}>`);

  if (!apply) {
    console.log("\nDry run. Pass --apply to send.");
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const s of stale) {
    const result = await resendWorkerInviteByEmail(supabase, {
      companyName: tenant.name,
      email: s.email,
      fullName: s.fullName,
      redirectTo: `${appUrl}/auth/confirm`,
      tenantId,
    });

    if (result.ok) {
      sent += 1;
      console.log(`SENT      ${s.fullName} <${s.email}>`);
    } else {
      failed += 1;
      console.log(`FAILED    ${s.fullName} <${s.email}>: ${result.error}`);
    }
  }

  console.log(`\n${sent} sent, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
