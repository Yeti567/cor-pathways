// Reshape a form from a written-down definition, without breaking what has been filed.
//
// WHY THIS EXISTS. Editing a live form by hand in the builder is fine for one field and
// hopeless for twenty: the ordering has to be redone, the evidence-photo default has to be
// switched off on every item one at a time, and there is no record afterwards of what the
// form used to be. This applies a definition file instead, so the shape of the form is a
// reviewable document and the same run can be repeated.
//
// THE RULE IT WILL NOT BREAK. It never deletes a form item. A submission's answers are
// rows keyed by form_item_id, so deleting an item orphans every answer ever given to it --
// silently, because the answer row survives with nothing to render it against. Items are
// matched to the definition by `was` (their current label) and UPDATED in place, so a
// renamed field keeps its history. An item in the form but not in the definition is left
// alone and reported.
//
// Usage:
//   npx tsx scripts/apply-form-definition.ts --definition <file.json> [--apply]
//
// Without --apply it prints the diff and writes nothing.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/types/database";

/** Minimal .env.local reader, matching load-client-pack.ts. Never echoes a value. */
function loadEnv(): void {
  const path = join(process.cwd(), ".env.local");

  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

type ItemDefinition = {
  /** The item's label now, when it already exists and is being renamed or moved. */
  was?: string;
  label: string;
  fieldType: string;
  required?: boolean;
  flaggable?: boolean;
  helperText?: string | null;
  /** Merged over whatever the item already carries. */
  settings?: Record<string, Json>;
};

type SectionDefinition = {
  title: string;
  collapsible?: boolean;
  repeatable?: boolean;
  items: ItemDefinition[];
};

type FormDefinition = {
  tenantId: string;
  formCode: string;
  name?: string;
  description?: string;
  sections: SectionDefinition[];
};

type FormRow = { id: string; code: string; name: string; description: string | null };
type SectionRow = { id: string; title: string; sort_order: number; collapsible: boolean; repeatable: boolean };
type ItemRow = {
  id: string;
  section_id: string | null;
  label: string;
  field_type: string;
  required: boolean;
  flaggable: boolean;
  helper_text: string | null;
  settings: Record<string, Json> | null;
  sort_order: number;
};

function parseArgs(argv: string[]) {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const definition = read("--definition");

  if (!definition) {
    console.error("Usage: npx tsx scripts/apply-form-definition.ts --definition <file.json> [--apply]");
    process.exit(1);
  }

  return { definition, apply: argv.includes("--apply") };
}

async function main(): Promise<void> {
  loadEnv();

  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local.");
    process.exit(1);
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });
  const definition = JSON.parse(readFileSync(args.definition, "utf8")) as FormDefinition;

  const { data: form } = await supabase
    .from("forms")
    .select("id, code, name, description")
    .eq("tenant_id", definition.tenantId)
    .eq("code", definition.formCode)
    .maybeSingle<FormRow>();

  if (!form) {
    console.error(`No form with code ${definition.formCode} in this tenant.`);
    process.exit(1);
  }

  const { data: sectionRows } = await supabase
    .from("form_sections")
    .select("id, title, sort_order, collapsible, repeatable")
    .eq("form_id", form.id)
    .returns<SectionRow[]>();

  const { data: itemRows } = await supabase
    .from("form_items")
    .select("id, section_id, label, field_type, required, flaggable, helper_text, settings, sort_order")
    .eq("form_id", form.id)
    .returns<ItemRow[]>();

  const existingSections = new Map((sectionRows ?? []).map((row) => [row.title.trim().toLowerCase(), row]));
  const existingItems = new Map((itemRows ?? []).map((row) => [row.label.trim().toLowerCase(), row]));

  console.log(`Form:     ${form.code} "${form.name}"`);
  console.log(`Now:      ${sectionRows?.length ?? 0} section(s), ${itemRows?.length ?? 0} item(s)`);
  console.log(`Defined:  ${definition.sections.length} section(s), ${definition.sections.reduce((n, s) => n + s.items.length, 0)} item(s)`);
  console.log(args.apply ? "Mode:     APPLY" : "Mode:     check only, nothing will be written");
  console.log("");

  const problems: string[] = [];
  const touched = new Set<string>();
  let created = 0;
  let updated = 0;

  // Every item the definition claims already exists must actually exist, and no two
  // definition entries may claim the same one. Both mistakes end with an item silently
  // duplicated rather than renamed.
  const claimed = new Map<string, string>();

  for (const section of definition.sections) {
    for (const item of section.items) {
      if (!item.was) {
        continue;
      }

      const current = existingItems.get(item.was.trim().toLowerCase());

      if (!current) {
        problems.push(`"${item.label}" says it was "${item.was}", but no item has that label`);
        continue;
      }

      if (claimed.has(current.id)) {
        problems.push(`"${item.label}" and "${claimed.get(current.id)}" both claim the item "${item.was}"`);
      }

      claimed.set(current.id, item.label);
    }
  }

  if (problems.length > 0) {
    console.error("The definition does not line up with the form:");
    for (const problem of problems) {
      console.error(`  ! ${problem}`);
    }
    process.exit(1);
  }

  let sectionOrder = 0;

  for (const section of definition.sections) {
    sectionOrder += 100;

    const current = existingSections.get(section.title.trim().toLowerCase());
    let sectionId = current?.id;

    const wantedSection = {
      collapsible: section.collapsible ?? false,
      repeatable: section.repeatable ?? false,
      sort_order: sectionOrder,
      title: section.title,
    };

    if (current) {
      const changes: string[] = [];

      if (current.sort_order !== wantedSection.sort_order) changes.push(`order ${current.sort_order} -> ${wantedSection.sort_order}`);
      if (current.repeatable !== wantedSection.repeatable) changes.push(`repeatable ${current.repeatable} -> ${wantedSection.repeatable}`);
      if (current.collapsible !== wantedSection.collapsible) changes.push(`collapsible ${current.collapsible} -> ${wantedSection.collapsible}`);

      console.log(`  section "${section.title}"${changes.length ? `  (${changes.join(", ")})` : "  (unchanged)"}`);

      if (args.apply && changes.length > 0) {
        const { error } = await supabase.from("form_sections").update(wantedSection).eq("id", current.id);

        if (error) {
          problems.push(`section "${section.title}": ${error.message}`);
        }
      }
    } else {
      console.log(`  section "${section.title}"  (NEW${wantedSection.repeatable ? ", repeatable" : ""})`);

      if (args.apply) {
        const { data, error } = await supabase
          .from("form_sections")
          .insert({ ...wantedSection, form_id: form.id, tenant_id: definition.tenantId })
          .select("id")
          .single<{ id: string }>();

        if (error || !data) {
          problems.push(`section "${section.title}": ${error?.message}`);
          continue;
        }

        sectionId = data.id;
      }
    }

    let itemOrder = 0;

    for (const item of section.items) {
      itemOrder += 100;

      const lookup = (item.was ?? item.label).trim().toLowerCase();
      const currentItem = existingItems.get(lookup);

      // section_id is not nullable: every item belongs to a section. In a check-only run
      // a brand new section has no id yet, so nothing is written and the existing id (or
      // an empty string that never reaches the database) stands in for the diff.
      const wantedItem = {
        field_type: item.fieldType,
        flaggable: item.flaggable ?? false,
        helper_text: item.helperText ?? null,
        label: item.label,
        required: item.required ?? false,
        section_id: sectionId ?? currentItem?.section_id ?? "",
        // Merged, not replaced: an item can carry settings this definition says nothing
        // about (a worker picker scope, a managed list id) and blowing those away would
        // break the field in a way nothing here would report.
        settings: { ...(currentItem?.settings ?? {}), ...(item.settings ?? {}) } as Json,
        sort_order: itemOrder,
      };

      if (currentItem) {
        touched.add(currentItem.id);

        const changes: string[] = [];

        if (currentItem.label !== wantedItem.label) changes.push(`renamed from "${currentItem.label}"`);
        if (currentItem.field_type !== wantedItem.field_type) changes.push(`type ${currentItem.field_type} -> ${wantedItem.field_type}`);
        if (currentItem.required !== wantedItem.required) changes.push(`required ${currentItem.required} -> ${wantedItem.required}`);
        if (currentItem.flaggable !== wantedItem.flaggable) changes.push(`flaggable ${currentItem.flaggable} -> ${wantedItem.flaggable}`);
        if (currentItem.section_id !== wantedItem.section_id) changes.push("moved section");
        if (JSON.stringify(currentItem.settings ?? {}) !== JSON.stringify(wantedItem.settings)) changes.push("settings");

        console.log(`      ${changes.length ? "~" : "="} ${item.label}${changes.length ? `  (${changes.join(", ")})` : ""}`);

        if (args.apply) {
          if (!wantedItem.section_id) {
            problems.push(`"${item.label}": its section was not created, so it was not moved`);
            continue;
          }

          const { error } = await supabase.from("form_items").update(wantedItem).eq("id", currentItem.id);

          if (error) {
            problems.push(`"${item.label}": ${error.message}`);
          } else if (changes.length > 0) {
            updated += 1;
          }
        }
      } else {
        console.log(`      + ${item.label}  (NEW, ${item.fieldType})`);

        if (args.apply) {
          if (!wantedItem.section_id) {
            problems.push(`"${item.label}": its section was not created, so it was not added`);
            continue;
          }

          const { error } = await supabase.from("form_items").insert({
            ...wantedItem,
            form_id: form.id,
            tenant_id: definition.tenantId,
          });

          if (error) {
            problems.push(`"${item.label}": ${error.message}`);
          } else {
            created += 1;
          }
        }
      }
    }
  }

  // An item that exists but the definition never mentions. Never deleted: something may
  // already have been answered against it.
  const orphans = (itemRows ?? []).filter((row) => !touched.has(row.id) && !claimed.has(row.id));

  if (orphans.length > 0) {
    console.log("\nStill on the form but not in the definition (left alone):");
    for (const orphan of orphans) {
      console.log(`  ? ${orphan.label} (${orphan.field_type})`);
    }
  }

  // A section the definition does not mention, whose items have all moved elsewhere, is
  // an empty heading on the form. Removing it is safe in a way removing an item is not:
  // answers are keyed by form_item_id, and nothing points at a section.
  const definedSections = new Set(definition.sections.map((section) => section.title.trim().toLowerCase()));
  const leftoverSections = (sectionRows ?? []).filter((row) => !definedSections.has(row.title.trim().toLowerCase()));

  for (const section of leftoverSections) {
    // Read the live count, not the snapshot: this runs after the items have been moved.
    const { count } = args.apply
      ? await supabase.from("form_items").select("id", { count: "exact", head: true }).eq("section_id", section.id)
      : { count: (itemRows ?? []).filter((row) => row.section_id === section.id && !touched.has(row.id)).length };

    if ((count ?? 0) > 0) {
      console.log(`\nSection "${section.title}" is not in the definition and still holds ${count} item(s). Left alone.`);
      continue;
    }

    console.log(`\nSection "${section.title}" is not in the definition and is now empty. Removing it.`);

    if (args.apply) {
      const { error } = await supabase.from("form_sections").delete().eq("id", section.id);

      if (error) {
        problems.push(`removing empty section "${section.title}": ${error.message}`);
      }
    }
  }

  if (definition.name || definition.description) {
    console.log("");

    if (args.apply) {
      const { error } = await supabase
        .from("forms")
        .update({
          ...(definition.name ? { name: definition.name } : {}),
          ...(definition.description ? { description: definition.description } : {}),
        })
        .eq("id", form.id);

      if (error) {
        problems.push(`form header: ${error.message}`);
      }
    }

    console.log(`  form name:        ${definition.name ?? form.name}`);
    console.log(`  form description: ${definition.description ?? form.description ?? "(none)"}`);
  }

  console.log("");

  if (args.apply) {
    console.log(`Created ${created} item(s), updated ${updated}.`);
  } else {
    console.log("Check only. Nothing was written. Re-run with --apply.");
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) {
      console.error(`  ! ${problem}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
