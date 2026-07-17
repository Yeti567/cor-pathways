"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, ExternalLink, FileText, RefreshCw, Search, WifiOff } from "lucide-react";
import {
  cacheOfflineResourceLibrary,
  downloadResourceForOffline,
  filterOfflineResources,
  getCachedOfflineResourceFile,
  getCachedOfflineResourceLibrary,
  type CachedOfflineResourceFile,
  type OfflineResourceSectionSummary,
  type OfflineResourceSummary,
} from "@/lib/offline/resources";

type ResourceLibraryPanelProps = {
  initialResources: OfflineResourceSummary[];
  initialSections: OfflineResourceSectionSummary[];
  offlineSyncDays: number;
  referenceSearch: string;
  tenantId: string;
};

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function sectionCount(resources: OfflineResourceSummary[], sectionId: string) {
  return resources.filter((resource) => resource.sectionId === sectionId).length;
}

function formatCachedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function ResourceLibraryPanel({
  initialResources,
  initialSections,
  offlineSyncDays,
  referenceSearch,
  tenantId,
}: ResourceLibraryPanelProps) {
  const [resources, setResources] = useState(initialResources);
  const [sections, setSections] = useState(initialSections);
  const [query, setQuery] = useState(referenceSearch);
  const [activeSectionId, setActiveSectionId] = useState("all");
  const [cachedFiles, setCachedFiles] = useState<Record<string, CachedOfflineResourceFile>>({});
  const [savingResourceId, setSavingResourceId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const expiresAt = useMemo(() => addDays(new Date(), offlineSyncDays).toISOString(), [offlineSyncDays]);

  useEffect(() => {
    let active = true;

    async function hydrateResources() {
      if (initialResources.length > 0 || initialSections.length > 0) {
        await cacheOfflineResourceLibrary({
          expiresAt,
          resources: initialResources,
          sections: initialSections,
        });
      }

      const cached = await getCachedOfflineResourceLibrary(tenantId);

      if (!active) {
        return;
      }

      setResources(initialResources.length > 0 ? initialResources : cached.resources);
      setSections(initialSections.length > 0 ? initialSections : cached.sections);
    }

    hydrateResources().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [expiresAt, initialResources, initialSections, tenantId]);

  useEffect(() => {
    let active = true;

    async function hydrateCachedFiles() {
      const entries = await Promise.all(
        resources.map(async (resource) => [resource.id, await getCachedOfflineResourceFile({ resourceId: resource.id, tenantId })] as const),
      );

      if (!active) {
        return;
      }

      setCachedFiles(
        Object.fromEntries(entries.filter((entry): entry is readonly [string, CachedOfflineResourceFile] => Boolean(entry[1]))),
      );
    }

    hydrateCachedFiles().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [resources, tenantId]);

  const filteredResources = useMemo(() => filterOfflineResources(resources, query), [query, resources]);
  const visibleResources = filteredResources.filter((resource) => {
    if (activeSectionId === "all") {
      return true;
    }

    if (activeSectionId === "unsectioned") {
      return !resource.sectionId;
    }

    return resource.sectionId === activeSectionId;
  });
  const unsectionedCount = filteredResources.filter((resource) => !resource.sectionId).length;

  async function saveForOffline(resource: OfflineResourceSummary) {
    setSavingResourceId(resource.id);
    setNotice("");
    setError("");

    try {
      const cached = await downloadResourceForOffline(resource);
      setCachedFiles((current) => ({ ...current, [resource.id]: cached }));
      setNotice(`${resource.name} is saved for offline use.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Resource could not be saved for offline use.");
    } finally {
      setSavingResourceId(null);
    }
  }

  function resourceOpenUrl(resource: OfflineResourceSummary) {
    return cachedFiles[resource.id]?.dataUrl ?? resource.signedUrl;
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" id="resources">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Resources</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {query ? `${filteredResources.length} matches` : `${resources.length} available`}
          </p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <FileText className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <input
          className="h-10 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveSectionId("all");
          }}
          placeholder="working alone procedure"
          type="search"
          value={query}
        />
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          type="submit"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
        </button>
      </form>

      {notice ? (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {resources.length > 0 ? (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            <button
              className={`inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-sm font-semibold ${
                activeSectionId === "all"
                  ? "border-[var(--primary)] bg-[var(--surface-muted)] text-[var(--primary)]"
                  : "border-[var(--border)] bg-white text-[var(--ink)]"
              }`}
              onClick={() => setActiveSectionId("all")}
              type="button"
            >
              All ({filteredResources.length})
            </button>
            {sections.map((section) => {
              const count = sectionCount(filteredResources, section.id);

              if (count === 0) {
                return null;
              }

              return (
                <button
                  className={`inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-sm font-semibold ${
                    activeSectionId === section.id
                      ? "border-[var(--primary)] bg-[var(--surface-muted)] text-[var(--primary)]"
                      : "border-[var(--border)] bg-white text-[var(--ink)]"
                  }`}
                  key={section.id}
                  onClick={() => setActiveSectionId(section.id)}
                  type="button"
                >
                  {section.name} ({count})
                </button>
              );
            })}
            {unsectionedCount > 0 ? (
              <button
                className={`inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-sm font-semibold ${
                  activeSectionId === "unsectioned"
                    ? "border-[var(--primary)] bg-[var(--surface-muted)] text-[var(--primary)]"
                    : "border-[var(--border)] bg-white text-[var(--ink)]"
                }`}
                onClick={() => setActiveSectionId("unsectioned")}
                type="button"
              >
                Unsectioned ({unsectionedCount})
              </button>
            ) : null}
          </div>

          {visibleResources.length > 0 ? (
            <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
              {visibleResources.map((resource) => {
                const cachedFile = cachedFiles[resource.id];
                const openUrl = resourceOpenUrl(resource);
                const section = resource.sectionId ? sections.find((candidate) => candidate.id === resource.sectionId) : null;

                return (
                  <article className="grid gap-3 p-3 sm:grid-cols-[1fr_auto]" key={resource.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[var(--ink)]">{resource.name}</p>
                        {cachedFile ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-[var(--success)]">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Offline
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">{resource.dcn ?? resource.storagePath}</p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        {section?.name ?? "Unsectioned"}
                        {cachedFile ? ` - saved ${formatCachedAt(cachedFile.cachedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      {openUrl ? (
                        <a
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                          href={openUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          Open
                        </a>
                      ) : (
                        <span className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm font-semibold text-[var(--ink-muted)]">
                          <WifiOff className="h-4 w-4" aria-hidden="true" />
                          Offline only
                        </span>
                      )}
                      {resource.signedUrl ? (
                        <button
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={savingResourceId === resource.id}
                          onClick={() => saveForOffline(resource)}
                          type="button"
                        >
                          {savingResourceId === resource.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Download className="h-4 w-4" aria-hidden="true" />
                          )}
                          {cachedFile ? "Update" : "Save"}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
              No matching resources found.
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
          No resources uploaded yet.
        </div>
      )}
    </div>
  );
}
