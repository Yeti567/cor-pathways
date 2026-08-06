import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guard on the migration folder itself.
//
// A duplicate version prefix is invisible until someone builds a database from
// scratch: `supabase db reset` dies on a duplicate key in schema_migrations and
// every migration after the collision silently never runs. A remote that already
// has the schema applied will not tell you, and neither will typecheck, lint, or
// any other test. A client forking the public repo hits it first.
//
// This is the cheapest possible place to catch it, so it lives here rather than
// in anyone's memory.

const MIGRATIONS_DIR = fileURLToPath(new URL("../supabase/migrations", import.meta.url));

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const FILENAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

describe("supabase/migrations", () => {
  it("has migrations to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("names every file <14-digit version>_<lower_snake_name>.sql", () => {
    const malformed = files.filter((name) => !FILENAME.test(name));

    expect(malformed).toEqual([]);
  });

  it("never repeats a version prefix", () => {
    const byVersion = new Map<string, string[]>();

    for (const name of files) {
      const version = FILENAME.exec(name)?.[1];
      if (version) {
        byVersion.set(version, [...(byVersion.get(version) ?? []), name]);
      }
    }

    const duplicates = [...byVersion.entries()].filter(([, names]) => names.length > 1);

    // Named in the failure so the fix is obvious: rename the later one.
    expect(duplicates).toEqual([]);
  });

  it("never repeats a migration name", () => {
    const byName = new Map<string, string[]>();

    for (const file of files) {
      const name = FILENAME.exec(file)?.[2];
      if (name) {
        byName.set(name, [...(byName.get(name) ?? []), file]);
      }
    }

    expect([...byName.entries()].filter(([, entries]) => entries.length > 1)).toEqual([]);
  });

  it("keeps versions in strictly ascending order, so filename order is apply order", () => {
    const versions = files.map((name) => FILENAME.exec(name)?.[1] ?? "");
    const ascending = [...versions].sort();

    expect(versions).toEqual(ascending);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("uses a version that reads as a real timestamp", () => {
    const bad = files.filter((name) => {
      const version = FILENAME.exec(name)?.[1];
      if (!version) {
        return true;
      }

      const month = Number(version.slice(4, 6));
      const day = Number(version.slice(6, 8));
      const hour = Number(version.slice(8, 10));
      const minute = Number(version.slice(10, 12));
      const second = Number(version.slice(12, 14));

      return month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59;
    });

    expect(bad).toEqual([]);
  });
});
