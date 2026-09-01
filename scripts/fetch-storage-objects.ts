// Download named storage objects so a load can be checked byte for byte.
//
// The point of a verification pass is to read the data back OUT of the app. A row that
// names a storage path proves nothing on its own: the path can be there and the object
// missing, or the object can be the wrong file. This pulls the bytes down so they can be
// hashed against the source that was uploaded.
//
// Usage:
//   npx tsx scripts/fetch-storage-objects.ts --plan <plan.json> --out <folder>
//
// The plan is the JSON array written by the spot-check: each entry needs "bucket" and
// "storagePath".

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

type PlanEntry = {
  kind: string;
  driver: string;
  label: string;
  bucket: string;
  storagePath: string | null;
  source: string;
};

async function main(): Promise<void> {
  loadEnv();

  const argv = process.argv.slice(2);
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const planPath = read("--plan");
  const out = read("--out");

  if (!planPath || !out) {
    console.error("Usage: npx tsx scripts/fetch-storage-objects.ts --plan <plan.json> --out <folder>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local.");
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as PlanEntry[];

  let matched = 0;
  const problems: string[] = [];

  for (const [index, entry] of plan.entries()) {
    console.log(`\n${entry.kind.toUpperCase()}  ${entry.driver} / ${entry.label}`);

    if (!entry.storagePath) {
      problems.push(`${entry.driver} / ${entry.label}: the row names no stored file`);
      console.log("  ! the row names no stored file");
      continue;
    }

    const { data, error } = await supabase.storage.from(entry.bucket).download(entry.storagePath);

    if (error || !data) {
      problems.push(`${entry.driver} / ${entry.label}: download failed, ${error?.message}`);
      console.log(`  ! download failed: ${error?.message}`);
      continue;
    }

    const downloaded = Buffer.from(await data.arrayBuffer());
    const target = join(out, `${index + 1}-${entry.kind}.pdf`);
    writeFileSync(target, downloaded);

    const fromApp = createHash("sha256").update(downloaded).digest("hex");

    if (!existsSync(entry.source)) {
      problems.push(`${entry.driver} / ${entry.label}: the source file is gone, cannot compare`);
      console.log(`  ! source missing: ${entry.source}`);
      continue;
    }

    const fromDisk = createHash("sha256").update(readFileSync(entry.source)).digest("hex");
    const same = fromApp === fromDisk;

    console.log(`  ${downloaded.byteLength} bytes out of the app`);
    console.log(`  app  ${fromApp.slice(0, 32)}`);
    console.log(`  disk ${fromDisk.slice(0, 32)}`);
    console.log(`  ${same ? "IDENTICAL" : "DIFFERENT -- the app is not holding the file that was uploaded"}`);

    if (same) {
      matched += 1;
    } else {
      problems.push(`${entry.driver} / ${entry.label}: stored bytes differ from the source`);
    }
  }

  console.log(`\n${matched} of ${plan.length} byte-for-byte identical to the source on disk.`);

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
