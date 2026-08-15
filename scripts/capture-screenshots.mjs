/**
 * Capture real product screenshots of the running app for directory listings
 * (G2, Capterra, SourceForge) and for corpathway.com.
 *
 * These are genuine captures of the application running against the local seed
 * fixtures in supabase/seed.sql. Nothing here mocks up or fabricates a screen.
 * The demo tenant is "Northwind Civil", so no real customer data is exposed.
 *
 * Prerequisites, in this order:
 *   npx supabase start          # loads migrations and supabase/seed.sql
 *   npm run dev                 # serves on 127.0.0.1:3000
 *   node scripts/capture-screenshots.mjs
 *
 * Output: screenshots/*.png
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.CAPTURE_EMAIL ?? "admin@northwind.test";
const PASSWORD = process.env.CAPTURE_PASSWORD ?? "Password123!";
const OUT = "screenshots";

/** Desktop shots. Wide enough that tables are not cramped, short enough that G2
 *  does not letterbox them into uselessness. */
const DESKTOP = { width: 1440, height: 900 };
/** The field app is phone first, so shooting it at desktop width misrepresents it. */
const MOBILE = { width: 430, height: 932 };

const SHOTS = [
  { file: "01-cor-audit-readiness", path: "/admin/cor", viewport: DESKTOP },
  { file: "02-forms", path: "/admin/forms", viewport: DESKTOP },
  { file: "03-incidents", path: "/admin/incidents", viewport: DESKTOP },
  { file: "04-corrective-actions", path: "/admin/follow-ups", viewport: DESKTOP },
  { file: "05-workers-certifications", path: "/admin/workers", viewport: DESKTOP },
  { file: "06-daily-trip-inspection", path: "/admin/daily-inspection", viewport: DESKTOP },
  { file: "07-analytics", path: "/admin/analytics", viewport: DESKTOP },
  { file: "08-documents", path: "/admin/documents", viewport: DESKTOP },
  { file: "09-field-app-mobile", path: "/web", viewport: MOBILE },
];

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole("button", { name: /^Next$/ }).click();
  await page.waitForURL(/\/(choose|admin|web)/, { timeout: 30_000 });
}

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2, // G2 wants crisp images; 2x renders text cleanly
  });
  const page = await context.newPage();

  await login(page);
  console.log("logged in as %s", EMAIL);

  for (const shot of SHOTS) {
    await page.setViewportSize(shot.viewport);
    await page.goto(BASE + shot.path, { waitUntil: "networkidle" });
    // Let skeletons resolve into real content before firing the shutter.
    await page.waitForTimeout(2500);
    const file = `${OUT}/${shot.file}.png`;
    await page.screenshot({ path: file });
    const heading = await page
      .locator("h1")
      .first()
      .innerText()
      .catch(() => "(no h1)");
    console.log("  %s  <- %s  [%s]", file, shot.path, heading.replace(/\s+/g, " ").trim());
  }

  await browser.close();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
