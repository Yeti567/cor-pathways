import type { NextRequest } from "next/server";

export const dynamic = "force-static";
export const revalidate = false;

const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_BUILD_ID ||
  process.env.npm_package_version ||
  `dev-${Date.now()}`;

const SERVICE_WORKER_SOURCE = `// build:${BUILD_ID}
const BUILD_ID = ${JSON.stringify(BUILD_ID)};
const CACHE_VERSION = "core-pathways-shell-" + BUILD_ID;
const APP_SHELL = ["/offline", "/manifest.webmanifest", "/icons/icon.svg"];
const OFFLINE_QUEUE_SYNC_TAG = "core-pathways-sync-queue";
const OFFLINE_QUEUE_FLUSH_MESSAGE_TYPE = "CORE_PATHWAYS_FLUSH_QUEUE";
const SKIP_WAITING_MESSAGE_TYPE = "CORE_PATHWAYS_SKIP_WAITING";

async function notifyClientsToFlushQueue() {
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const client of clientsList) {
    client.postMessage({ tag: OFFLINE_QUEUE_SYNC_TAG, type: OFFLINE_QUEUE_FLUSH_MESSAGE_TYPE });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL)),
  );
});

self.addEventListener("message", (event) => {
  if (event && event.data && event.data.type === SKIP_WAITING_MESSAGE_TYPE) {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname === "/sw.js") {
    return;
  }

  if (request.mode === "navigate") {
    if (requestUrl.pathname.startsWith("/admin")) {
      return;
    }

    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          return cachedPage || caches.match("/offline");
        }),
    );
    return;
  }

  if (requestUrl.pathname.startsWith("/admin")) {
    return;
  }

  if (requestUrl.pathname.startsWith("/_next/static/") || APP_SHELL.includes(requestUrl.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }

        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        });
      }),
    );
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag !== OFFLINE_QUEUE_SYNC_TAG) {
    return;
  }

  event.waitUntil(notifyClientsToFlushQueue());
});
`;

export function GET(_request: NextRequest) {
  return new Response(SERVICE_WORKER_SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
