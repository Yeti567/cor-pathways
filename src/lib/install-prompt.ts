"use client";

// One place that owns the browser's install prompt.
//
// `beforeinstallprompt` fires once, early, and often before React has hydrated.
// A component that registers its listener in an effect can miss it entirely,
// which is part of why the install banner so often had nothing to show. The
// listener here is registered at module import instead, so the event is captured
// whenever it arrives and replayed to whoever subscribes afterwards.
//
// It is also a single shared event on purpose: the prompt can only be used once,
// so the login button and the banner must not each hold their own copy.

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedThisSession = false;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress Chrome's own mini-infobar so the install happens on our button,
    // at a moment the person chose, rather than over the login form.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installedThisSession = true;
    emit();
  });
}

export function subscribeToInstallPrompt(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

// useSyncExternalStore calls this during server render, where no prompt can
// exist. Returning null keeps the server and first client render identical.
export function getServerPrompt(): BeforeInstallPromptEvent | null {
  return null;
}

export function wasInstalledThisSession() {
  return installedThisSession;
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferredPrompt;

  if (!event) {
    return "unavailable";
  }

  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return "unavailable";
  } finally {
    // The event is single use. Clearing it means a second click offers the
    // instructions rather than silently doing nothing.
    deferredPrompt = null;
    emit();
  }
}

export function isStandaloneDisplayMode() {
  if (typeof window === "undefined") {
    return false;
  }

  if (window.matchMedia?.("(display-mode: standalone)").matches) {
    return true;
  }

  return Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

export function isIosBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent;

  if (/iPad|iPhone|iPod/.test(ua)) {
    return true;
  }

  // iPadOS reports itself as a Mac; the touch points give it away.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/**
 * Whether this looks like an app's built-in browser (Gmail, Outlook, Teams,
 * Facebook, Slack).
 *
 * These cannot install anything, and they are exactly where an invite link
 * opens if the recipient taps it inside their mail app. Without naming this,
 * the install button looks broken to the one group most likely to press it.
 */
export function isInAppBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent;

  return /\bwv\b|FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|Slack|Teams|OutlookMobile|GSA\//i.test(ua);
}
