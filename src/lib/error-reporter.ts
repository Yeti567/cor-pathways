// Getting a failure off the device that hit it.
//
// Runs in the browser. Everything here is written so that reporting a failure can
// never itself become one: no throw escapes, no unbounded memory, no retry storm,
// and a hard ceiling on how much one session can send. An error reporter that
// misbehaves turns one bug into two and teaches people to ignore the alert.
//
// The scrubbing and signature rules live in error-sink.ts and are shared with the
// server, so what the device decides is the same failure is what the watcher
// groups.

import { errorSignature, type ErrorSource } from "@/lib/error-sink";

const ENDPOINT = "/api/errors";

/** Reports one session may send before it goes quiet. A loop must not bill anyone. */
const SESSION_LIMIT = 50;

/** Buffered reports held while offline. Beyond this the oldest are dropped. */
const BUFFER_LIMIT = 25;

/** Wait after the first report so a burst leaves as one request. */
const FLUSH_DELAY_MS = 2000;

export type ErrorReport = {
  source: ErrorSource;
  kind: string;
  message: string;
  stack?: string | null;
  route?: string | null;
  occurredAt?: string;
  context?: Record<string, string | number | boolean>;
};

type ReporterState = {
  installed: boolean;
  sent: number;
  seen: Set<string>;
  buffer: ErrorReport[];
  timer: ReturnType<typeof setTimeout> | null;
};

const state: ReporterState = {
  installed: false,
  sent: 0,
  seen: new Set(),
  buffer: [],
  timer: null,
};

function currentRoute(): string | null {
  try {
    return typeof window === "undefined" ? null : window.location.pathname;
  } catch {
    return null;
  }
}

async function flush() {
  state.timer = null;

  if (state.buffer.length === 0) {
    return;
  }

  const batch = state.buffer.splice(0, state.buffer.length);

  try {
    await fetch(ENDPOINT, {
      body: JSON.stringify(batch),
      headers: { "content-type": "application/json" },
      // keepalive so a report survives the user navigating away mid-send, which
      // is the common case when a page has just broken under them.
      keepalive: true,
      method: "POST",
    });
  } catch {
    // The network is the thing that failed. Dropping is correct: retrying a
    // failed report on a broken connection is how a reporter becomes the outage.
  }
}

function scheduleFlush() {
  if (state.timer !== null) {
    return;
  }

  state.timer = setTimeout(() => {
    void flush();
  }, FLUSH_DELAY_MS);
}

/**
 * Report a failure. Safe to call from anywhere, including a catch block that is
 * already handling something odd. Never throws and never returns a rejection.
 */
export function reportError(report: ErrorReport): void {
  try {
    if (typeof window === "undefined" || state.sent >= SESSION_LIMIT) {
      return;
    }

    const route = report.route ?? currentRoute();
    const signature = errorSignature({
      source: report.source,
      kind: report.kind,
      message: report.message,
      route,
    });

    // One report per distinct failure per session. The watcher counts occurrences
    // across devices and sessions, so sending the same broken render two hundred
    // times from one phone adds nothing and costs bandwidth on a truck's data plan.
    if (state.seen.has(signature)) {
      return;
    }

    state.seen.add(signature);
    state.sent += 1;

    state.buffer.push({
      ...report,
      route,
      occurredAt: report.occurredAt ?? new Date().toISOString(),
    });

    if (state.buffer.length > BUFFER_LIMIT) {
      state.buffer.splice(0, state.buffer.length - BUFFER_LIMIT);
    }

    // While offline the request would simply fail, so hold it. The listener
    // installed below flushes when the connection returns.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return;
    }

    scheduleFlush();
  } catch {
    // Nothing here is worth interrupting the user for.
  }
}

/** A sync mutation that has run out of retries. */
export function reportDeadSyncMutation(input: {
  table: string;
  operation: string;
  attempts: number;
  lastError: string;
  recordId?: string | null;
}): void {
  reportError({
    source: "sync",
    kind: "sync_exhausted",
    // The table and operation carry the meaning; the message is what an admin
    // reads first, so it says what was lost rather than what threw.
    message: `${input.operation} on ${input.table} failed to sync: ${input.lastError}`,
    context: {
      table: input.table,
      operation: input.operation,
      attempts: input.attempts,
      ...(input.recordId ? { recordId: input.recordId } : {}),
    },
  });
}

function messageFrom(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) {
    return { message: `${value.name}: ${value.message}`, stack: value.stack ?? null };
  }

  if (typeof value === "string") {
    return { message: value, stack: null };
  }

  try {
    return { message: JSON.stringify(value)?.slice(0, 500) ?? "Unknown error", stack: null };
  } catch {
    return { message: "Unknown error", stack: null };
  }
}

/**
 * Install the global handlers. Idempotent, so mounting the component twice in
 * development does not double-report.
 */
export function installGlobalErrorReporter(): () => void {
  if (typeof window === "undefined" || state.installed) {
    return () => {};
  }

  state.installed = true;

  const onError = (event: ErrorEvent) => {
    const { message, stack } = messageFrom(event.error ?? event.message);

    reportError({
      source: "client",
      kind: "unhandled_error",
      message,
      stack,
      context: event.filename ? { file: event.filename, line: event.lineno ?? 0 } : undefined,
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const { message, stack } = messageFrom(event.reason);

    reportError({ source: "client", kind: "unhandled_rejection", message, stack });
  };

  const onOnline = () => {
    if (state.buffer.length > 0) {
      scheduleFlush();
    }
  };

  // A page being hidden is the last reliable moment to send on mobile, where a
  // backgrounded tab may never run another timer.
  const onHidden = () => {
    if (document.visibilityState === "hidden" && state.buffer.length > 0) {
      void flush();
    }
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onHidden);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onHidden);
    state.installed = false;
  };
}

/** Test seam: forget what this session has already sent. */
export function resetErrorReporterForTests() {
  state.installed = false;
  state.sent = 0;
  state.seen = new Set();
  state.buffer = [];

  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}
