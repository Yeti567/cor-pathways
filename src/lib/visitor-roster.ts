export type VisitorRosterLocation = {
  code: string | null;
  id: string;
  name: string;
};

export type VisitorRosterVisitor = {
  full_name: string;
  id: string;
  location_id: string;
  organization: string | null;
  signed_in_at: string;
  signed_out_at: string | null;
  visit_reason: string;
};

export type VisitorRosterWorker = {
  id: string;
  location_id: string;
  note: string | null;
  signed_in_at: string;
  signed_out_at: string | null;
  worker_email: string | null;
  worker_full_name: string;
  worker_user_id: string;
};

export type VisitorRosterEntry = VisitorRosterVisitor & {
  durationLabel: string;
  signedInLabel: string;
};

export type VisitorRosterWorkerEntry = VisitorRosterWorker & {
  durationLabel: string;
  signedInLabel: string;
};

export type VisitorRosterGroup = {
  locationCode: string | null;
  locationId: string;
  locationName: string;
  visitors: VisitorRosterEntry[];
  workers: VisitorRosterWorkerEntry[];
};

export type VisitorRosterSummary = {
  groups: VisitorRosterGroup[];
  occupiedLocationCount: number;
  selectedLocation: VisitorRosterLocation | null;
  totalPeople: number;
  totalVisitors: number;
  totalWorkers: number;
};

function cleanLocationId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function timeValue(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function plural(value: number, singular: string) {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}

export function formatVisitorRosterDateTime(value: string | null | undefined) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatVisitorRosterDuration(signedInAt: string, now = new Date()) {
  const start = new Date(signedInAt).getTime();
  const end = now.getTime();

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return "Unknown duration";
  }

  const minutes = Math.max(0, Math.round((end - start) / 60_000));

  if (minutes < 60) {
    return plural(minutes, "min");
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0 ? `${plural(hours, "hr")} ${plural(remainingMinutes, "min")}` : plural(hours, "hr");
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${plural(days, "day")} ${plural(remainingHours, "hr")}` : plural(days, "day");
}

export function visitorRosterLocationLabel(group: Pick<VisitorRosterGroup, "locationCode" | "locationName">) {
  return group.locationCode ? `${group.locationName} (${group.locationCode})` : group.locationName;
}

export function buildVisitorRoster({
  locationId,
  locations,
  now = new Date(),
  visitors,
  workers = [],
}: {
  locationId?: string | null;
  locations: VisitorRosterLocation[];
  now?: Date;
  visitors: VisitorRosterVisitor[];
  workers?: VisitorRosterWorker[];
}): VisitorRosterSummary {
  const selectedLocationId = cleanLocationId(locationId);
  const selectedLocation = selectedLocationId
    ? locations.find((location) => location.id === selectedLocationId) ?? null
    : null;
  const visibleLocations = selectedLocationId
    ? locations.filter((location) => location.id === selectedLocationId)
    : locations;
  const groupsByLocationId = new Map<string, VisitorRosterGroup>();

  for (const location of visibleLocations) {
    groupsByLocationId.set(location.id, {
      locationCode: location.code,
      locationId: location.id,
      locationName: location.name,
      visitors: [],
      workers: [],
    });
  }

  for (const visitor of visitors) {
    if (visitor.signed_out_at || (selectedLocationId && visitor.location_id !== selectedLocationId)) {
      continue;
    }

    let group = groupsByLocationId.get(visitor.location_id);

    if (!group) {
      const location = locations.find((candidate) => candidate.id === visitor.location_id);
      group = {
        locationCode: location?.code ?? null,
        locationId: visitor.location_id,
        locationName: location?.name ?? "Unknown location",
        visitors: [],
        workers: [],
      };
      groupsByLocationId.set(visitor.location_id, group);
    }

    group.visitors.push({
      ...visitor,
      durationLabel: formatVisitorRosterDuration(visitor.signed_in_at, now),
      signedInLabel: formatVisitorRosterDateTime(visitor.signed_in_at),
    });
  }

  for (const worker of workers) {
    if (worker.signed_out_at || (selectedLocationId && worker.location_id !== selectedLocationId)) {
      continue;
    }

    let group = groupsByLocationId.get(worker.location_id);

    if (!group) {
      const location = locations.find((candidate) => candidate.id === worker.location_id);
      group = {
        locationCode: location?.code ?? null,
        locationId: worker.location_id,
        locationName: location?.name ?? "Unknown location",
        visitors: [],
        workers: [],
      };
      groupsByLocationId.set(worker.location_id, group);
    }

    group.workers.push({
      ...worker,
      durationLabel: formatVisitorRosterDuration(worker.signed_in_at, now),
      signedInLabel: formatVisitorRosterDateTime(worker.signed_in_at),
    });
  }

  const groups = Array.from(groupsByLocationId.values())
    .map((group) => ({
      ...group,
      visitors: [...group.visitors].sort(
        (left, right) => timeValue(left.signed_in_at) - timeValue(right.signed_in_at) || left.full_name.localeCompare(right.full_name),
      ),
      workers: [...group.workers].sort(
        (left, right) =>
          timeValue(left.signed_in_at) - timeValue(right.signed_in_at) ||
          left.worker_full_name.localeCompare(right.worker_full_name),
      ),
    }))
    .sort(
      (left, right) =>
        left.locationName.localeCompare(right.locationName) || (left.locationCode ?? "").localeCompare(right.locationCode ?? ""),
    );
  const totalVisitors = groups.reduce((total, group) => total + group.visitors.length, 0);
  const totalWorkers = groups.reduce((total, group) => total + group.workers.length, 0);

  return {
    groups,
    occupiedLocationCount: groups.filter((group) => group.visitors.length > 0 || group.workers.length > 0).length,
    selectedLocation,
    totalPeople: totalVisitors + totalWorkers,
    totalVisitors,
    totalWorkers,
  };
}

function csvValue(value: string | number | null | undefined) {
  const normalized = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return /[",]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

export function buildVisitorRosterCsv({
  generatedAt,
  groups,
  tenantName,
}: {
  generatedAt: Date;
  groups: VisitorRosterGroup[];
  tenantName: string;
}) {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Emergency Site Roster"],
    ["Tenant", tenantName],
    ["Generated", formatVisitorRosterDateTime(generatedAt.toISOString())],
    [],
    ["Location", "Type", "Name", "Organization / Worker Email", "Reason / Note", "Signed In", "Duration"],
  ];

  for (const group of groups) {
    if (group.visitors.length === 0 && group.workers.length === 0) {
      rows.push([visitorRosterLocationLabel(group), "None", "No active people", "", "", "", ""]);
      continue;
    }

    for (const visitor of group.visitors) {
      rows.push([
        visitorRosterLocationLabel(group),
        "Visitor",
        visitor.full_name,
        visitor.organization ?? "",
        visitor.visit_reason,
        visitor.signedInLabel,
        visitor.durationLabel,
      ]);
    }

    for (const worker of group.workers) {
      rows.push([
        visitorRosterLocationLabel(group),
        "Worker",
        worker.worker_full_name,
        worker.worker_email ?? "",
        worker.note ?? "",
        worker.signedInLabel,
        worker.durationLabel,
      ]);
    }
  }

  return `${rows.map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`;
}
