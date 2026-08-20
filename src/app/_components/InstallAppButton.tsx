"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Download, Share, SquarePlus, X } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import {
  getDeferredPrompt,
  getServerPrompt,
  isInAppBrowser,
  isIosBrowser,
  isStandaloneDisplayMode,
  promptInstall,
  subscribeToInstallPrompt,
} from "@/lib/install-prompt";

/**
 * "Install the app", offered wherever somebody might want it.
 *
 * Two shapes, one implementation:
 *
 *  - `block` sits under the sign-in form. That page is the one place every person
 *    reaches before they have an account, so it is where a first install belongs.
 *  - `compact` sits in the app header, next to Sign out. It exists because a person
 *    who was busy the first time had no way back: the bottom banner can be dismissed,
 *    and the sign-in page is unreachable once you are signed in and stay signed in.
 *    This one is never dismissible and never disappears.
 *
 * Both hide completely once the app is actually installed, so nobody is nagged to
 * install something they are already running.
 */
export function InstallAppButton({ variant = "block" }: { variant?: "block" | "compact" }) {
  const [expanded, setExpanded] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);

  const deferredPrompt = useSyncExternalStore(subscribeToInstallPrompt, getDeferredPrompt, getServerPrompt);

  // Read through useSyncExternalStore as well so the server render and the first
  // client render agree: all of these are false until hydration.
  const standalone = useSyncExternalStore(subscribeToInstallPrompt, isStandaloneDisplayMode, () => false);
  const ios = useSyncExternalStore(subscribeToInstallPrompt, isIosBrowser, () => false);
  const inApp = useSyncExternalStore(subscribeToInstallPrompt, isInAppBrowser, () => false);

  // Already running as an installed app: there is nothing to offer.
  if (standalone) {
    return null;
  }

  const canInstallDirectly = deferredPrompt !== null;

  const handleClick = async () => {
    if (!canInstallDirectly) {
      setExpanded((value) => !value);
      return;
    }

    const outcome = await promptInstall();

    if (outcome === "accepted") {
      setJustInstalled(true);
      return;
    }

    // Declined, or the browser refused to show it. Either way the steps are better
    // than a button that appears to do nothing.
    if (outcome === "unavailable") {
      setExpanded(true);
    }
  };

  const instructions = inApp ? (
    <>
      <p className="font-semibold">Open this page in your browser first</p>
      <p className="mt-1 text-[var(--ink-muted)]">
        You are viewing this inside another app, which cannot install anything. Tap the menu in the corner and
        choose &ldquo;Open in browser&rdquo; (Safari on iPhone, Chrome on Android), then use this button again.
      </p>
    </>
  ) : ios ? (
    <>
      <p className="font-semibold">Add to your home screen</p>
      <ol className="mt-2 space-y-1.5 text-[var(--ink-muted)]">
        <li className="flex items-start gap-2">
          <Share className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Tap the Share button at the bottom of Safari.</span>
        </li>
        <li className="flex items-start gap-2">
          <SquarePlus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Scroll down and choose &ldquo;Add to Home Screen&rdquo;.</span>
        </li>
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Tap Add. {APP_NAME} appears with your other apps.</span>
        </li>
      </ol>
    </>
  ) : (
    <>
      <p className="font-semibold">Install from your browser menu</p>
      <p className="mt-1 text-[var(--ink-muted)]">
        Open the browser menu (⋮ or ⋯) and choose &ldquo;Install app&rdquo; or &ldquo;Add to Home screen&rdquo;.
      </p>
    </>
  );

  if (variant === "compact") {
    return (
      <div className="relative">
        <button
          aria-label={`Install ${APP_NAME}`}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
          onClick={handleClick}
          title={`Install ${APP_NAME} on this device`}
          type="button"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
        </button>

        {justInstalled ? (
          <div className="absolute right-0 top-12 z-50 w-72 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm font-medium text-[var(--success)] shadow-lg">
            Installed. Look for {APP_NAME} on your home screen.
          </div>
        ) : null}

        {expanded && !canInstallDirectly ? (
          <div className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--ink)] shadow-lg">
            <button
              aria-label="Close"
              className="absolute right-2 top-2 text-[var(--ink-muted)] hover:text-[var(--ink)]"
              onClick={() => setExpanded(false)}
              type="button"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="pr-6">{instructions}</div>
          </div>
        ) : null}
      </div>
    );
  }

  if (justInstalled) {
    return (
      <p className="mt-4 flex items-center justify-center gap-2 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm font-medium text-[var(--success)]">
        <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
        Installed. Look for {APP_NAME} on your home screen.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <button
        aria-expanded={canInstallDirectly ? undefined : expanded}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--primary)] bg-white px-4 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
        onClick={handleClick}
        type="button"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Install {APP_NAME} on this device
      </button>

      {expanded && !canInstallDirectly ? (
        <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink)]">
          {instructions}
        </div>
      ) : null}
    </div>
  );
}
