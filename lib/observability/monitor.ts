/**
 * External error monitoring (server only), dependency free.
 *
 * Sends events to Sentry (or any Sentry-protocol compatible service, e.g.
 * GlitchTip) through its HTTP envelope endpoint when `SENTRY_DSN` is set.
 * Without a DSN every call is a no-op, so local development is unaffected.
 *
 * Privacy: events carry the error, the event name and structured context
 * that has already passed the logger's secret redaction; e-mail addresses and
 * phone numbers are additionally masked, and request headers, bodies, cookies
 * and uploaded content are never attached.
 *
 * Reliability: fire-and-forget with a short timeout — monitoring can never
 * slow down or fail a customer request. Identical events are throttled.
 */

import { randomUUID } from "node:crypto";

type Dsn = { endpoint: string; publicKey: string; raw: string };

let cachedDsn: Dsn | null | undefined;

function parseDsn(value: string | undefined): Dsn | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!url.username || !projectId || url.protocol !== "https:") return null;
    return { endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`, publicKey: url.username, raw: value };
  } catch {
    return null;
  }
}

function dsn(): Dsn | null {
  if (cachedDsn === undefined) cachedDsn = parseDsn(process.env.SENTRY_DSN);
  return cachedDsn;
}

export function isMonitoringConfigured(): boolean {
  return Boolean(dsn());
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?88)?01[3-9]\d{8}/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|service[-_]?role|jwt|email|phone|address/i;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (typeof value === "string") {
    return value.replace(JWT, "[jwt]").replace(BEARER, "Bearer [redacted]").replace(EMAIL, "[email]").replace(PHONE, "[phone]").slice(0, 2000);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => scrub(entry, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : scrub(entry, depth + 1);
    }
    return out;
  }
  return value;
}

const recent = new Map<string, number>();
const THROTTLE_MS = 60_000;

function throttled(fingerprint: string): boolean {
  const now = Date.now();
  for (const [key, at] of recent) if (now - at > THROTTLE_MS) recent.delete(key);
  if (recent.has(fingerprint)) return true;
  recent.set(fingerprint, now);
  return false;
}

function frames(stack: string | undefined) {
  return String(stack || "")
    .split("\n")
    .slice(1, 30)
    .map((line) => line.trim().replace(/^at\s+/, ""))
    .filter(Boolean)
    .reverse()
    .map((line) => ({ function: line.split(" (")[0].slice(0, 200), filename: (line.match(/\(([^)]+)\)/)?.[1] || line).replace(/.*[\\/](app|lib|node_modules)[\\/]/, "$1/").slice(0, 300) }));
}

export type CaptureContext = {
  event?: string;
  level?: "error" | "warning" | "fatal";
  tags?: Record<string, string | number | undefined>;
  extra?: Record<string, unknown>;
};

/** Report an error. Never throws, never blocks. */
export function captureError(error: unknown, context: CaptureContext = {}, fetchImpl: typeof fetch = fetch): Promise<void> {
  const target = dsn();
  if (!target) return Promise.resolve();
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(scrub(error)));
  const fingerprint = `${context.event || ""}|${err.name}|${err.message}`.slice(0, 500);
  if (throttled(fingerprint)) return Promise.resolve();

  const eventId = randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: context.level || "error",
    logger: "husnalogy",
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    release: process.env.SENTRY_RELEASE || undefined,
    message: { formatted: scrub(`${context.event ? `${context.event}: ` : ""}${err.message}`) },
    exception: { values: [{ type: err.name, value: scrub(err.message), stacktrace: { frames: frames(err.stack) } }] },
    tags: Object.fromEntries(Object.entries({ event: context.event, ...(context.tags || {}) }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(scrub(String(value))).slice(0, 200)])),
    extra: scrub(context.extra || {}),
  };
  const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: target.raw })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;

  return fetchImpl(target.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=husnalogy-monitor/1.0, sentry_key=${target.publicKey}`,
    },
    body,
    signal: AbortSignal.timeout(3_000),
  })
    .then(() => undefined)
    .catch(() => undefined);
}

/** Test hook: forget the parsed DSN and throttle state. */
export function resetMonitorForTests(): void {
  cachedDsn = undefined;
  recent.clear();
}
