// What the Finish Your Units screen would show for a tenant, without signing in.
//
// Reads only (SELECTs). Prints counts and unit numbers, never VINs or plates. Used to
// check the screen against real data before anyone relies on it.
//
// Usage:
//   npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/finish-preview.ts --tenant <uuid>

import { createClient } from "@supabase/supabase-js";
import { certificationTypeNameMap } from "@/lib/equipment";
import { buildUnitFinish, finishQueue, type FinishDocumentRow, type FinishUnitRow } from "@/lib/unit-finish";

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const tenantId = arg("tenant");

  if (!tenantId) {
    throw new Error("Pass --tenant <uuid>.");
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const [units, documents, types, requirements] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, unit_number, name, category, is_commercial")
      .eq("tenant_id", tenantId)
      .in("category", ["vehicle", "trailer"])
      .is("deleted_at", null)
      .neq("status", "retired")
      .neq("status", "sold")
      .returns<FinishUnitRow[]>(),
    supabase
      .from("equipment_document")
      .select("id, equipment_id, doc_type, certification_type_id, expiry_date, issued_date, is_active, reminder_lead_days, title, attachment_ids")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .limit(10000)
      .returns<FinishDocumentRow[]>(),
    supabase
      .from("equipment_certification_types")
      .select("id, name, applies_by_default")
      .eq("tenant_id", tenantId)
      .returns<{ applies_by_default: boolean; id: string; name: string }[]>(),
    supabase
      .from("equipment_certification_requirement")
      .select("equipment_id, certification_type_id")
      .eq("tenant_id", tenantId)
      .returns<{ certification_type_id: string; equipment_id: string }[]>(),
  ]);

  for (const result of [units, documents, types, requirements]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const required = new Map<string, string[]>();
  for (const row of requirements.data ?? []) {
    required.set(row.equipment_id, [...(required.get(row.equipment_id) ?? []), row.certification_type_id]);
  }

  const byUnit = new Map<string, FinishDocumentRow[]>();
  for (const row of documents.data ?? []) {
    byUnit.set(row.equipment_id, [...(byUnit.get(row.equipment_id) ?? []), row]);
  }

  const typeInputs = (types.data ?? []).map((type) => ({ appliesByDefault: type.applies_by_default, id: type.id, name: type.name }));
  const finishes = (units.data ?? []).map((unit) =>
    buildUnitFinish({
      certificationTypeNames: certificationTypeNameMap(typeInputs),
      certificationTypes: typeInputs,
      documents: byUnit.get(unit.id) ?? [],
      requiredTypeIds: required.get(unit.id) ?? null,
      unit,
    }),
  );
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
