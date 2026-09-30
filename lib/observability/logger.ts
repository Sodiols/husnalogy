/**
 * Structured server logging.
 *
 * One JSON object per line so Hostinger's log viewer (and any later log
 * shipper) can filter by `event`, `requestId`, `stage` or `userId`. Values
 * that look like credentials are redacted defensively: callers should never
 * pass tokens, but a logger must not become the way one leaks.
 */

import { randomUUID } from "node:crypto";
import { describeError } from "@/lib/core/server-errors";
import { captureError } from "@/lib/observability/monitor";

type Level = "info" | "warn" | "error";

const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|service[-_]?role|jwt/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (value instanceof Error) return describeError(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => redact(entry, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(entry, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const safe = redact(fields) as Record<string, unknown>;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...safe });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);

  // Every error-level event (checkout database failures, production task and
  // render failures, worker failures, …) also goes to external monitoring
  // when SENTRY_DSN is configured. Fire-and-forget; never throws.
  if (level === "error") {
    const original = fields.error;
    const { error: _error, ...context } = safe;
    void captureError(original instanceof Error ? original : new Error(event), {
      event,
      tags: { stage: typeof safe.stage === "string" ? safe.stage : undefined, requestId: typeof safe.requestId === "string" ? safe.requestId : undefined },
      extra: context,
    });
  }
}

/** A request correlation id: the proxy's if it is well-formed, else a new one. */
export function requestIdFrom(request: Request): string {
  const incoming = request.headers.get("x-request-id") || "";
  return /^[A-Za-z0-9._-]{8,80}$/.test(incoming) ? incoming : randomUUID();
}
