"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Download, Share, SquarePlus } from "lucide-react";
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
 * "Install the app" on the login screen.
 *
 * The banner elsewhere in the app only appears when the browser volunteers an
 * install prompt, which leaves everyone else with no way to install at all and
 * nothing on screen explaining how. This button is always visible to someone
 * signing in, and adapts:
 *
 *  - Chrome/Edge with a captured prompt: installs in one tap.
 *  - iPhone and iPad: shows the Share > Add to Home Screen steps, because iOS
 *    offers no programmatic install and never will.
 *  - A mail app's built-in browser: says to open in Safari or Chrome first,
 *    since no install is possible in a webview. This is the common case for
 *    someone who just tapped an invite link.
 */
export function InstallAppButton() {
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

  if (justInstalled) {
    return (
      <p className="mt-4 flex items-center justify-center gap-2 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm font-medium text-[var(--success)]">
        <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
        Installed. Look for {APP_NAME} on your home screen.
      </p>
    );
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

    // Declined, or the browser refused to show it. Either way the steps are
    // better than a button that appears to do nothing.
    if (outcome === "unavailable") {
      setExpanded(true);
    }
  };

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
          {inApp ? (
            <>
              <p className="font-semibold">Open this page in your browser first</p>
              <p className="mt-1 text-[var(--ink-muted)]">
                You are viewing this inside another app, which cannot install anything. Tap the menu in the corner
                and choose &ldquo;Open in browser&rdquo; (Safari on iPhone, Chrome on Android), then use this button
                again.
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
                Open the browser menu (⋮ or ⋯) and choose &ldquo;Install app&rdquo; or &ldquo;Add to Home
                screen&rdquo;. If you do not see it, sign in first and try again from inside the app.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
