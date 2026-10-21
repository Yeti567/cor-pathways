import { Paperclip } from "lucide-react";

type Props = {
  paths: readonly string[];
  /** Signed links by storage path, made on the page for this request only. */
  urls: ReadonlyMap<string, string>;
};

/**
 * "Open scan" buttons for a filed contracted document.
 *
 * Every row on a contracted unit or driver could take a scan but only the one-off
 * paperwork could give it back, so a registration or a ticket was filed and then
 * could not be checked. The links are signed per request (the page's ten minute
 * window), never stored: this is another company's paperwork in a private bucket.
 */
export function ContractedScanLinks({ paths, urls }: Props) {
  if (paths.length === 0) {
    return null;
  }

  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {paths.map((path, index) => {
        const url = urls.get(path);

        return (
          <li key={path}>
            {url ? (
              <a
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-white px-2 py-1 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                href={url}
                rel="noreferrer"
                target="_blank"
              >
                <Paperclip
                  className="h-3.5 w-3.5 text-[var(--primary)]"
                  aria-hidden="true"
                />
                {paths.length > 1 ? `Scan ${index + 1}` : "Open scan"}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                Scan unavailable
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
