"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { warmOfflineStore } from "@/lib/offline/sync-queue";

const UPDATE_POLL_INTERVAL_MS = 30 * 60 * 1000;
const IDLE_RELOAD_AFTER_MS = 30 * 60 * 1000;
const SKIP_WAITING_MESSAGE_TYPE = "CORE_PATHWAYS_SKIP_WAITING";

function canRegisterServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }

  return (
    window.location.protocol === "https:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function shouldReloadForUpdate() {
  if (typeof document === "undefined") {
    return false;
  }

  const activeElement = document.activeElement;
  const tag = activeElement?.tagName?.toLowerCase();
  const editing =
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (activeElement instanceof HTMLElement && activeElement.isContentEditable);

  return !editing;
}

export function OfflineRuntime() {
  const pathname = usePathname();
  const [updatePending, setUpdatePending] = useState(false);
  const lastPathRef = useRef<string | null>(pathname);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    warmOfflineStore().catch(() => undefined);

    if (!canRegisterServiceWorker()) {
      return;
    }

    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const markUpdatePending = () => setUpdatePending(true);

    const requestSkipWaiting = (worker: ServiceWorker | null) => {
      if (!worker) {
        return;
      }

      worker.postMessage({ type: SKIP_WAITING_MESSAGE_TYPE });
    };

    const trackWaiting = (worker: ServiceWorker | null) => {
      if (!worker) {
        return;
      }

      if (worker.state === "installed") {
        markUpdatePending();
        requestSkipWaiting(worker);
        return;
      }

      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          markUpdatePending();
          requestSkipWaiting(worker);
        }
      });
    };

    const handleControllerChange = () => {
      markUpdatePending();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          markUpdatePending();
          requestSkipWaiting(reg.waiting);
        }

        reg.addEventListener("updatefound", () => {
          trackWaiting(reg.installing);
        });

        pollHandle = setInterval(() => {
          reg.update().catch(() => undefined);
        }, UPDATE_POLL_INTERVAL_MS);
      })
      .catch(() => undefined);

    return () => {
      if (pollHandle) {
        clearInterval(pollHandle);
      }

      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  useEffect(() => {
    if (!updatePending) {
      return;
    }

    if (lastPathRef.current && lastPathRef.current !== pathname && shouldReloadForUpdate()) {
      window.location.reload();
      return;
    }

    lastPathRef.current = pathname;
  }, [updatePending, pathname]);

  useEffect(() => {
    if (!updatePending) {
      return;
    }

    idleTimerRef.current = setTimeout(() => {
      if (shouldReloadForUpdate()) {
        window.location.reload();
      }
    }, IDLE_RELOAD_AFTER_MS);

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [updatePending]);

  return null;
}
