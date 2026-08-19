"use client";

import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { APP_NAME } from "@/lib/brand";
import {
  getDeferredPrompt,
  getServerPrompt,
  isIosBrowser,
  isStandaloneDisplayMode,
  promptInstall,
  subscribeToInstallPrompt,
} from "@/lib/install-prompt";

const DISMISS_STORAGE_KEY = "core-pathways:install-banner-dismissed";

// /choose and /sub are here because they are where a person lands right after
// accepting an invite -- the one moment they are guaranteed to be looking at
// the app in a real browser. Restricting the banner to /admin and /web meant a
// freshly onboarded crew never saw an install prompt at all.
const ALLOWED_PATH_PREFIXES = ["/admin", "/web", "/choose", "/sub"];

// A dismissal used to be permanent, with no menu item to get the prompt back.
// One accidental tap and that phone could never install. Let it come back
// after a couple of weeks instead. The login page carries a permanent install
// button either way, so nobody is ever fully stuck.
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function isDismissed() {
  if (typeof window === "undefined") {
    return false;
  }

  const stored = window.localStorage.getItem(DISMISS_STORAGE_KEY);

  if (!stored) {
    return false;
  }

  // The legacy value "1" carried no timestamp; parse it as 0 so those old
  // permanent dismissals expire immediately rather than silencing the banner
  // forever.
  const dismissedAt = Number.parseInt(stored, 10) || 0;

  return Date.now() - dismissedAt < DISMISS_TTL_MS;
}

function markDismissed() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
}

export function InstallBanner() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  // The install prompt now lives in a module that starts listening at import
  // time. Registering the listener in an effect here meant the event, which
  // fires early and only once, could arrive before this component hydrated and
  // be lost for the rest of the visit.
  const installPrompt = useSyncExternalStore(subscribeToInstallPrompt, getDeferredPrompt, getServerPrompt);
  const standalone = useSyncExternalStore(subscribeToInstallPrompt, isStandaloneDisplayMode, () => false);
  const ios = useSyncExternalStore(subscribeToInstallPrompt, isIosBrowser, () => false);
  const alreadyDismissed = useSyncExternalStore(subscribeToInstallPrompt, isDismissed, () => false);

  const showIosHint = ios && !standalone;
  const onAllowedPath = ALLOWED_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix));
  const shouldRender =
    onAllowedPath && !standalone && !dismissed && !alreadyDismissed && (installPrompt !== null || showIosHint);

  if (!shouldRender) {
    return null;
  }

  const handleInstall = async () => {
    const outcome = await promptInstall();

    if (outcome === "accepted") {
      markDismissed();
      setDismissed(true);
    }
  };

  const handleDismiss = () => {
    markDismissed();
    setDismissed(true);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 sm:p-4">
      <div className="flex w-full max-w-2xl items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg sm:items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-lg">
          📲
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-[var(--ink)]">Install {APP_NAME}</p>
          <p className="mt-0.5 text-[var(--ink-muted)]">
            {installPrompt
              ? "Add it to your home screen for one-tap access and offline support."
              : "On iPhone or iPad, tap the Share button, then choose Add to Home Screen."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {installPrompt ? (
            <button
              className="inline-flex h-9 items-center rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
              onClick={handleInstall}
              type="button"
            >
              Install
            </button>
          ) : null}
          <button
            className="inline-flex h-9 items-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)]"
            onClick={handleDismiss}
            type="button"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
