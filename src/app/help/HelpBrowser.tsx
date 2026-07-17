"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LifeBuoy, Search } from "lucide-react";
import { helpCategories, helpTopics, searchHelpTopics, type HelpCategory, type HelpTopic } from "./_data/topics";

function groupByCategory(topics: HelpTopic[]) {
  const grouped = new Map<HelpCategory, HelpTopic[]>();

  for (const category of helpCategories) {
    grouped.set(category, []);
  }

  for (const topic of topics) {
    const list = grouped.get(topic.category);
    if (list) {
      list.push(topic);
    }
  }

  return grouped;
}

export function HelpBrowser() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => searchHelpTopics(query), [query]);
  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);
  const totalShown = filtered.length;
  const trimmedQuery = query.trim();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <LifeBuoy className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">Help Center</p>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">How can we help?</h1>
        </div>
      </div>

      <label className="mt-6 block">
        <span className="sr-only">Search help</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-[var(--ink-muted)]" aria-hidden="true" />
          <input
            autoFocus
            className="h-12 w-full rounded-md border border-[var(--border)] bg-white pl-12 pr-4 text-base text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by question, feature, or keyword..."
            type="search"
            value={query}
          />
        </span>
      </label>

      <p className="mt-3 text-xs text-[var(--ink-muted)]">
        {trimmedQuery
          ? `Showing ${totalShown} of ${helpTopics.length} topics matching "${trimmedQuery}".`
          : `${helpTopics.length} topics across ${helpCategories.length} categories.`}
      </p>

      <div className="mt-8 space-y-8">
        {helpCategories.map((category) => {
          const topicsInCategory = grouped.get(category) ?? [];
          if (topicsInCategory.length === 0) {
            return null;
          }

          return (
            <section key={category}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">{category}</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {topicsInCategory.map((topic) => (
                  <Link
                    className="group block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:border-[var(--primary)] hover:shadow-md"
                    href={`/help/${topic.slug}`}
                    key={topic.slug}
                  >
                    <h3 className="font-semibold text-[var(--ink)] group-hover:text-[var(--primary)]">{topic.title}</h3>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">{topic.summary}</p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
        {totalShown === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--ink-muted)]">
            No help topics match <span className="font-semibold text-[var(--ink)]">&quot;{trimmedQuery}&quot;</span>.
            Try a different keyword, or email us if you can&apos;t find what you&apos;re looking for.
          </div>
        ) : null}
      </div>
    </div>
  );
}
