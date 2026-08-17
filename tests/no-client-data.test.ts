import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Real client data has reached this repo more than once, by the same route
// every time: a client sends a filled-in pack, we write a test fixture straight
// from it, and their employees' names and mail domain get committed. The public
// mirror carried two real employees' names and a live customer domain for weeks
// before anyone noticed.
//
// This is an ALLOWLIST, not a denylist. A denylist of client names only catches
// the clients we already thought of, which is exactly the set that is not the
// problem. Anything not recognisably fake fails, and adding a domain here is a
// deliberate act with a reason attached.
//
// It reads git's tracked file list rather than walking the directory, because
// the claim being made is about what is committed. Walking the working tree
// also picks up gitignored CLI scratch (supabase/.temp holds the linked
// project's owner address), which is noise, not a leak.

const SCANNED = /^(src|tests|scripts|supabase)\/.*\.(ts|tsx|js|jsx|sql|json|md)$/;

// Reserved by RFC 2606 and RFC 6761: these can never belong to a real company.
const RESERVED_TLDS = [".test", ".example", ".invalid", ".localhost"];
const RESERVED_DOMAINS = ["example.com", "example.org", "example.net"];

// Deliberate exceptions, each with a reason. Keep this list short: every entry
// is a real domain that a real person could own.
const ALLOWED_DOMAINS = new Set([
  "corpathway360.com", // our own sending domain and the shared demo tenant
  "gmail.com", // the marketing landing page's own contact address
  "yourcompany.ca", // the placeholder we ship IN the client pack for them to replace
  "acme.com", // generic stand-in, not a customer
  "company.com", // generic stand-in, not a customer
  "x.com", // one-character fixture used for length and parsing edges
]);

// A deployment's own landing page is a copy of that company's site by design.
const EXEMPT_PREFIXES = ["src/app/_landing/"];

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function trackedFiles(cwd: string): string[] {
  return execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => SCANNED.test(line))
    .filter((line) => !EXEMPT_PREFIXES.some((prefix) => line.startsWith(prefix)));
}

function isAllowed(domain: string) {
  const lower = domain.toLowerCase();

  return (
    RESERVED_TLDS.some((tld) => lower.endsWith(tld)) ||
    RESERVED_DOMAINS.includes(lower) ||
    ALLOWED_DOMAINS.has(lower)
  );
}

describe("no real client data in the repo", () => {
  it("every committed email address uses a reserved or explicitly allowed domain", () => {
    const cwd = process.cwd();
    const offenders: string[] = [];

    for (const file of trackedFiles(cwd)) {
      let contents: string;

      try {
        contents = readFileSync(join(cwd, file), "utf8");
      } catch {
        continue; // listed by git but not on disk right now
      }

      for (const match of contents.matchAll(EMAIL)) {
        if (!isAllowed(match[1])) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }

    expect(
      offenders,
      "Found email addresses on domains that are not reserved for testing.\n" +
        "If this is a client's data, remove it and use a .test domain instead.\n" +
        "If it is genuinely safe, add the domain to ALLOWED_DOMAINS with a reason.\n\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
