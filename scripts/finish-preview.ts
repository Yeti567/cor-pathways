// What Finish Your Units and the Getting Started checklist would show for a tenant,
// without signing in.
//
// Reads only (SELECTs), through the same loaders the pages use. Prints counts and unit
// numbers, never VINs, plates or names. Used to check the screens against real data
// before anyone relies on them.
//
// Usage:
//   npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/finish-preview.ts --tenant <uuid>

import { createClient } from "@supabase/supabase-js";
import { loadGettingStarted } from "@/lib/getting-started-data";
import { finishQueue } from "@/lib/unit-finish";
import { loadUnitFinishes } from "@/lib/unit-finish-data";
import type { Database } from "@/types/database";

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const tenantId = arg("tenant");

  if (!tenantId) {
    throw new Error("Pass --tenant <uuid>.");
  }

  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const finishes = await loadUnitFinishes(supabase, tenantId);
  const queue = finishQueue(finishes);
  const tasks = finishes.flatMap((entry) => entry.tasks);

  console.log(`units: ${finishes.length}, finished: ${finishes.filter((entry) => entry.open === 0).length}, in queue: ${queue.length}`);
  console.log(
    `open by count: ${JSON.stringify(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, queue.filter((entry) => entry.open === n).length])))}`,
  );
  console.log(
    `tasks: ${tasks.length} (attach ${tasks.filter((task) => task.mode === "attach").length}, new ${tasks.filter((task) => task.mode === "new").length}, can wait ${tasks.filter((task) => task.canWait).length}, waivable ${tasks.filter((task) => task.waivable).length})`,
  );
  console.log("first five in the queue:");
  for (const entry of queue.slice(0, 5)) {
    console.log(`  ${entry.unit.unit_number}: ${entry.tasks.map((task) => `${task.label} [${task.state}${task.canWait ? ", can wait" : ""}, ${task.mode}]`).join("; ")}`);
  }

  console.log("getting started:");
  for (const step of await loadGettingStarted(supabase, tenantId)) {
    console.log(`  [${step.done ? "x" : " "}] ${step.title}: ${step.progress}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
