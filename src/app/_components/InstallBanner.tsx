"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { APP_NAME } from "@/lib/brand";

const DISMISS_STORAGE_KEY = "core-pathways:install-banner-dismissed";
const ALLOWED_PATH_PREFIXES = ["/admin", "/web"];

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isIosSafari() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

  return isIos && isSafari;
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") {
    return false;
  }

  if (window.matchMedia?.("(display-mode: standalone)").matches) {
    return true;
  }

  return Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function isDismissed() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(DISMISS_STORAGE_KEY) === "1";
}

function markDismissed() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(DISMISS_STORAGE_KEY, "1");
}

// The iOS hint depends only on browser-static facts (device, display mode, the
// dismissed flag), so we read it with useSyncExternalStore rather than setting
// state inside an effect, which would trigger a cascading render. The snapshot is
// re-read on every render, so a dismiss (which re-renders) re-evaluates it.
function subscribeNoop() {
  return () => {};
}

function iosHintSnapshot() {
  return isIosSafari() && !isStandaloneDisplayMode() && !isDismissed();
}

function iosHintServerSnapshot() {
  return false;
}

export function InstallBanner() {
  const pathname = usePathname();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const showIosHint = useSyncExternalStore(subscribeNoop, iosHintSnapshot, iosHintServerSnapshot);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    // Already installed or previously dismissed: register no listeners and show
    // nothing. We deliberately do not call setState here. Doing so synchronously
    // in an effect triggers a cascading re-render; instead we leave the banner
    // unrendered because nothing sets installPrompt or showIosHint.
    if (isStandaloneDisplayMode() || isDismissed()) {
      return;
    }

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setInstallPrompt(null);
      setDismissed(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const onAllowedPath = ALLOWED_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix));
  const shouldRender = onAllowedPath && !dismissed && (installPrompt !== null || showIosHint);

  if (!shouldRender) {
    return null;
  }

  const handleInstall = async () => {
    if (!installPrompt) {
      return;
    }

    try {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === "accepted") {
        markDismissed();
        setDismissed(true);
      }
    } finally {
      setInstallPrompt(null);
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
