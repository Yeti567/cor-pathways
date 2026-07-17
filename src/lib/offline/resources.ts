import { compareResourceOrder, getKnowledgeSearchTerms, normalizeKnowledgeSearchQuery } from "@/lib/document-control";
import type { Json } from "@/types/database";
import { cacheRecord } from "./sync-queue";
import { createOfflineRecordKey, getOfflineDatabase, type CachedRecord } from "./db";

export type OfflineResourceSummary = {
  bodyText: string | null;
  dcn: string | null;
  id: string;
  mimeType: string | null;
  name: string;
  sectionId: string | null;
  signedUrl: string | null;
  sortOrder: number;
  storagePath: string;
  tenantId: string;
  updatedAt: string;
};

export type OfflineResourceSectionSummary = {
  id: string;
  name: string;
  sortOrder: number;
  tenantId: string;
};

export type CachedOfflineResourceFile = {
  cachedAt: string;
  dataUrl: string;
  fileName: string;
  kind: "resource_file";
  mimeType: string | null;
  resourceId: string;
  tenantId: string;
};

type OfflineResourceMetadataRecord = OfflineResourceSummary & {
  kind: "resource_metadata";
};

type OfflineResourceSectionRecord = OfflineResourceSectionSummary & {
  kind: "resource_section";
};

function isRecord(value: Json | undefined): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function metadataKey(resourceId: string) {
  return `metadata:${resourceId}`;
}

function fileKey(resourceId: string) {
  return `file:${resourceId}`;
}

function sectionKey(sectionId: string) {
  return `metadata:${sectionId}`;
}

function stringValue(value: Json | undefined) {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: Json | undefined) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: Json | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resourceMetadataFromPayload(payload: Json): OfflineResourceSummary | null {
  if (!isRecord(payload) || payload.kind !== "resource_metadata") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);
  const name = stringValue(payload.name);
  const storagePath = stringValue(payload.storagePath);

  if (!id || !tenantId || !name || !storagePath) {
    return null;
  }

  return {
    bodyText: nullableStringValue(payload.bodyText),
    dcn: nullableStringValue(payload.dcn),
    id,
    mimeType: nullableStringValue(payload.mimeType),
    name,
    sectionId: nullableStringValue(payload.sectionId),
    signedUrl: nullableStringValue(payload.signedUrl),
    sortOrder: numberValue(payload.sortOrder),
    storagePath,
    tenantId,
    updatedAt: stringValue(payload.updatedAt),
  };
}

function resourceSectionFromPayload(payload: Json): OfflineResourceSectionSummary | null {
  if (!isRecord(payload) || payload.kind !== "resource_section") {
    return null;
  }

  const id = stringValue(payload.id);
  const tenantId = stringValue(payload.tenantId);
  const name = stringValue(payload.name);

  if (!id || !tenantId || !name) {
    return null;
  }

  return {
    id,
    name,
    sortOrder: numberValue(payload.sortOrder),
    tenantId,
  };
}

function resourceFileFromPayload(payload: Json): CachedOfflineResourceFile | null {
  if (!isRecord(payload) || payload.kind !== "resource_file") {
    return null;
  }

  const resourceId = stringValue(payload.resourceId);
  const tenantId = stringValue(payload.tenantId);
  const dataUrl = stringValue(payload.dataUrl);

  if (!resourceId || !tenantId || !dataUrl.startsWith("data:")) {
    return null;
  }

  return {
    cachedAt: stringValue(payload.cachedAt),
    dataUrl,
    fileName: stringValue(payload.fileName) || "resource",
    kind: "resource_file",
    mimeType: nullableStringValue(payload.mimeType),
    resourceId,
    tenantId,
  };
}

function recordsToResources(records: CachedRecord[]) {
  return records
    .map((record) => resourceMetadataFromPayload(record.payload))
    .filter((resource): resource is OfflineResourceSummary => Boolean(resource))
    .sort(compareOfflineResourceOrder);
}

function recordsToSections(records: CachedRecord[]) {
  return records
    .map((record) => resourceSectionFromPayload(record.payload))
    .filter((section): section is OfflineResourceSectionSummary => Boolean(section))
    .sort(compareOfflineResourceSectionOrder);
}

export function compareOfflineResourceOrder(left: OfflineResourceSummary, right: OfflineResourceSummary) {
  return compareResourceOrder(
    { name: left.name, sort_order: left.sortOrder, updated_at: left.updatedAt },
    { name: right.name, sort_order: right.sortOrder, updated_at: right.updatedAt },
  );
}

export function compareOfflineResourceSectionOrder(
  left: OfflineResourceSectionSummary,
  right: OfflineResourceSectionSummary,
) {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  return left.name.localeCompare(right.name);
}

export function resourceFileName(resource: Pick<OfflineResourceSummary, "name" | "storagePath">) {
  return resource.storagePath.split("/").at(-1)?.trim() || resource.name;
}

export function offlineResourceMatchesSearch(resource: OfflineResourceSummary, query: string) {
  const terms = getKnowledgeSearchTerms(normalizeKnowledgeSearchQuery(query));

  if (terms.length === 0) {
    return true;
  }

  const searchText = [resource.name, resource.dcn, resource.storagePath, resource.mimeType, resource.bodyText]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase();

  return terms.every((term) => searchText.includes(term.toLowerCase()));
}

export function filterOfflineResources(resources: OfflineResourceSummary[], query: string) {
  return resources.filter((resource) => offlineResourceMatchesSearch(resource, query)).sort(compareOfflineResourceOrder);
}

export async function cacheOfflineResourceLibrary(input: {
  expiresAt: string | null;
  resources: OfflineResourceSummary[];
  sections: OfflineResourceSectionSummary[];
}) {
  await Promise.all([
    ...input.resources.map((resource) => {
      const payload: OfflineResourceMetadataRecord = {
        ...resource,
        kind: "resource_metadata",
        signedUrl: null,
      };

      return cacheRecord({
        expiresAt: input.expiresAt,
        id: metadataKey(resource.id),
        payload,
        table: "resources",
        tenantId: resource.tenantId,
      });
    }),
    ...input.sections.map((section) => {
      const payload: OfflineResourceSectionRecord = {
        ...section,
        kind: "resource_section",
      };

      return cacheRecord({
        expiresAt: input.expiresAt,
        id: sectionKey(section.id),
        payload,
        table: "resource_sections",
        tenantId: section.tenantId,
      });
    }),
  ]);
}

export async function getCachedOfflineResourceLibrary(tenantId: string) {
  const db = getOfflineDatabase();
  const [resourceRecords, sectionRecords] = await Promise.all([
    db.cachedRecords.where("[table+tenantId]").equals(["resources", tenantId]).toArray(),
    db.cachedRecords.where("[table+tenantId]").equals(["resource_sections", tenantId]).toArray(),
  ]);

  return {
    resources: recordsToResources(resourceRecords),
    sections: recordsToSections(sectionRecords),
  };
}

export async function getCachedOfflineResourceFile(input: { resourceId: string; tenantId: string }) {
  const db = getOfflineDatabase();
  const record = await db.cachedRecords.get(createOfflineRecordKey("resources", fileKey(input.resourceId)));
  const file = record ? resourceFileFromPayload(record.payload) : null;

  return file?.tenantId === input.tenantId ? file : null;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Resource could not be cached.")));
    reader.readAsDataURL(blob);
  });
}

export async function cacheOfflineResourceFile(input: {
  dataUrl: string;
  resource: OfflineResourceSummary;
}) {
  const cachedAt = new Date().toISOString();
  const payload: CachedOfflineResourceFile = {
    cachedAt,
    dataUrl: input.dataUrl,
    fileName: resourceFileName(input.resource),
    kind: "resource_file",
    mimeType: input.resource.mimeType,
    resourceId: input.resource.id,
    tenantId: input.resource.tenantId,
  };

  await cacheRecord({
    id: fileKey(input.resource.id),
    payload,
    table: "resources",
    tenantId: input.resource.tenantId,
  });

  return payload;
}

export async function downloadResourceForOffline(resource: OfflineResourceSummary) {
  if (!resource.signedUrl) {
    throw new Error("This resource does not have an online link right now.");
  }

  const response = await fetch(resource.signedUrl);

  if (!response.ok) {
    throw new Error("Resource could not be downloaded for offline use.");
  }

  return cacheOfflineResourceFile({
    dataUrl: await blobToDataUrl(await response.blob()),
    resource,
  });
}
