#!/usr/bin/env node
/**
 * Measure this machine's clock against the Supabase database, the Supabase
 * gateway and an independent reference. Run it ON the host that runs
 * `npm start` (Hostinger SSH) and on any staging machine:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-clock.mjs
 *
 * Reads .env.local when present (local/staging convenience). Never prints a
 * key or token. Exit code 1 when any measured offset exceeds 2 seconds.
 *
 * Offsets are "this machine minus reference": positive = this clock is AHEAD.
 */
import { existsSync, readFileSync } from "node:fs";

const LIMIT_MS = 2_000;
const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !line.trimStart().startsWith("#") && !env[line.slice(0, index).trim()]) env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, "");
  }
}
const base = String(env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");

async function best(samples, measure) {
  const results = [];
  for (let index = 0; index < samples; index++) {
    try { results.push(await measure()); } catch (error) { results.push({ error: error instanceof Error ? error.message : String(error) }); }
  }
  const good = results.filter((entry) => !entry.error).sort((a, b) => a.roundTripMs - b.roundTripMs);
  return good[0] || results[0];
}

async function timed(url, init) {
  const t0 = Date.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const t1 = Date.now();
  return { response, mid: (t0 + t1) / 2, roundTripMs: t1 - t0 };
}

const report = {
  host: { now: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tzEnv: env.TZ || null, utcOffsetMinutes: -new Date().getTimezoneOffset(), node: process.version },
  measurements: {},
  problems: [],
};

if (base && key) {
  report.measurements.database = await best(3, async () => {
    const { response, mid, roundTripMs } = await timed(`${base}/rest/v1/rpc/server_clock`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`server_clock ${response.status} ${body?.code || ""} ${body?.message || ""}`.trim());
    return { offsetMs: Math.round(mid - Date.parse(body.now)), roundTripMs, precision: "ms" };
  });
} else {
  report.measurements.database = { error: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to measure the database clock." };
}
if (base) {
  report.measurements.supabaseGateway = await best(3, async () => {
    const { response, mid, roundTripMs } = await timed(`${base}/auth/v1/health`);
    return { offsetMs: Math.round(mid - Date.parse(response.headers.get("date"))), roundTripMs, precision: "1s (HTTP Date header)" };
  });
}
report.measurements.cloudflare = await best(3, async () => {
  const { response, mid, roundTripMs } = await timed("https://www.cloudflare.com/cdn-cgi/trace");
  const ts = Number((await response.text()).match(/ts=([\d.]+)/)?.[1]);
  if (!Number.isFinite(ts)) throw new Error("no ts in trace");
  return { offsetMs: Math.round(mid - ts * 1000), roundTripMs, precision: "ms" };
});

for (const [name, entry] of Object.entries(report.measurements)) {
  if (entry && !entry.error) {
    const tolerance = name === "supabaseGateway" ? LIMIT_MS + 1_000 : LIMIT_MS;
    if (Math.abs(entry.offsetMs) > tolerance) report.problems.push(`${name}: this clock is ${Math.abs(entry.offsetMs)} ms ${entry.offsetMs > 0 ? "AHEAD" : "BEHIND"} (limit ${tolerance} ms). Synchronize with NTP.`);
  }
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.problems.length ? 1 : 0);
