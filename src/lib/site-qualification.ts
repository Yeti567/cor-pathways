// --- Who is qualified to load where ------------------------------------
//
// A terminal badge is not like a ticket. A lapsed H2S makes a driver unfit to
// drive anywhere; a lapsed refinery orientation stops them at one gate and nowhere
// else. contractedDriverOverallTone deliberately keeps badges out of the
// driver's overall reading for exactly that reason, which is right for the
// roster and useless for dispatch: nothing answered "can I send this one to
// a given terminal today".
//
// This builds that answer. One row per driver, one column per site, and the
// only green is a badge that is present, dated and in date.

import { daysUntilCertificationExpiry } from "@/lib/workers";

export type SiteQualificationState =
  | "qualified"
  | "expiring"
  | "expired"
  | "unconfirmed"
  | "none";

export type SiteQualification = {
  state: SiteQualificationState;
  badgeNumber: string | null;
  expiresOn: string | null;
  daysUntilExpiry: number | null;
};

export type SiteQualificationRow = {
  driverId: string;
  driverName: string;
  carrierName: string;
  /** "contracted" or "employee" - dispatch cares which roster a name came from. */
  source: "contracted" | "employee";
  bySite: Record<string, SiteQualification>;
  /** Sites this driver holds a badge for and can currently load at. */
  qualifiedCount: number;
  /** Sites where a badge exists but cannot be relied on. */
  blockedCount: number;
};

export type SiteQualificationInput = {
  driverId: string;
  driverName: string;
  carrierName: string;
  source: "contracted" | "employee";
  credentials: readonly {
    siteName: string;
    badgeNumber: string | null;
    expiresOn: string | null;
  }[];
};

export const SITE_QUALIFICATION_LABELS: Record<SiteQualificationState, string> = {
  qualified: "Qualified",
  expiring: "Expires soon",
  expired: "NOT QUALIFIED",
  unconfirmed: "Expiry unknown",
  none: "No badge",
};

export function siteQualificationClass(state: SiteQualificationState) {
  switch (state) {
    case "qualified":
      return "border-[var(--success)] bg-emerald-50 text-[var(--success)]";
    case "expiring":
      return "border-[var(--warning)] bg-amber-50 text-[var(--warning)]";
    case "expired":
      return "border-[var(--danger)] bg-red-50 text-[var(--danger)]";
    case "unconfirmed":
      // Deliberately amber, not grey. A badge number with no expiry anywhere in
      // the source is not a pass, it is a question nobody has answered, and the
      // whole point of this page is that a driver never reads green on a
      // credential we cannot actually vouch for.
      return "border-[var(--warning)] bg-amber-50 text-[var(--warning)]";
    default:
      return "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink-muted)]";
  }
}

/**
 * How one badge reads.
 *
 * A badge with no expiry recorded is "unconfirmed", never "qualified". Some
 * terminals are tracked by badge number alone with no expiry anywhere on the
 * source, so the honest answer is that we do not know, and a dispatcher should
 * confirm before sending someone.
 */
export function qualificationFor(
  credential: { badgeNumber: string | null; expiresOn: string | null } | undefined,
  now = new Date(),
  expiringWithinDays = 30,
): SiteQualification {
  if (!credential) {
    return { state: "none", badgeNumber: null, expiresOn: null, daysUntilExpiry: null };
  }

  const daysUntilExpiry = daysUntilCertificationExpiry(credential.expiresOn, now);
  const base = {
    badgeNumber: credential.badgeNumber,
    expiresOn: credential.expiresOn,
    daysUntilExpiry,
  };

  if (daysUntilExpiry === null) {
    return { ...base, state: "unconfirmed" };
  }
  if (daysUntilExpiry < 0) {
    return { ...base, state: "expired" };
  }
  if (daysUntilExpiry <= expiringWithinDays) {
    return { ...base, state: "expiring" };
  }
  return { ...base, state: "qualified" };
}

export function buildSiteQualificationRows(
  drivers: readonly SiteQualificationInput[],
  siteNames: readonly string[],
  now = new Date(),
): SiteQualificationRow[] {
  return drivers
    .map((driver) => {
      const bySiteName = new Map(driver.credentials.map((c) => [c.siteName, c]));
      const bySite: Record<string, SiteQualification> = {};
      let qualifiedCount = 0;
      let blockedCount = 0;

      for (const siteName of siteNames) {
        const qualification = qualificationFor(bySiteName.get(siteName), now);
        bySite[siteName] = qualification;
        if (qualification.state === "qualified") {
          qualifiedCount += 1;
        } else if (qualification.state !== "none") {
          // "expiring" counts as blocked-soon on purpose: dispatch planning a
          // run next week needs it in the same bucket as already-lapsed.
          blockedCount += 1;
        }
      }

      return {
        driverId: driver.driverId,
        driverName: driver.driverName,
        carrierName: driver.carrierName,
        source: driver.source,
        bySite,
        qualifiedCount,
        blockedCount,
      };
    })
    // Anyone with a problem sorts to the top; a driver with nothing on file at
    // all sinks, because they were never going to that site anyway.
    .sort(
      (left, right) =>
        right.blockedCount - left.blockedCount ||
        right.qualifiedCount - left.qualifiedCount ||
        left.driverName.localeCompare(right.driverName),
    );
}

export function summariseSiteQualification(rows: readonly SiteQualificationRow[], siteNames: readonly string[]) {
  const perSite = siteNames.map((siteName) => {
    const held = rows.filter((row) => row.bySite[siteName]?.state !== "none");
    return {
      siteName,
      qualified: held.filter((row) => row.bySite[siteName].state === "qualified").length,
      expiring: held.filter((row) => row.bySite[siteName].state === "expiring").length,
      expired: held.filter((row) => row.bySite[siteName].state === "expired").length,
      unconfirmed: held.filter((row) => row.bySite[siteName].state === "unconfirmed").length,
      total: held.length,
    };
  });

  return {
    perSite,
    driversWithAProblem: rows.filter((row) => row.blockedCount > 0).length,
    totalExpired: perSite.reduce((sum, site) => sum + site.expired, 0),
    totalUnconfirmed: perSite.reduce((sum, site) => sum + site.unconfirmed, 0),
  };
}
