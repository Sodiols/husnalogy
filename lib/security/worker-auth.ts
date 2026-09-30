/**
 * Authentication for the scheduled worker endpoints (Hostinger cron).
 *
 * The secret is accepted only in a header (never the URL, which ends up in
 * access logs) and compared in constant time against every configured secret,
 * so response timing does not reveal which secret matched.
 */

import { timingSafeEqual } from "node:crypto";
import { getRenderWorkerSecrets } from "@/lib/env/server-env";

function safeSecretMatch(provided: string, secret: string) {
  if (!provided || !secret) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

export function hasWorkerSecret(request: Request): boolean {
  const provided = [bearerToken(request), (request.headers.get("x-render-secret") || "").trim()].filter(Boolean);
  const secrets = getRenderWorkerSecrets();
  if (!secrets.length) {
    console.error("[worker] Neither CRON_SECRET nor RENDER_WORKER_SECRET is configured; secret-authenticated runs are disabled.");
    return false;
  }
  let matched = false;
  for (const candidate of provided) {
    for (const secret of secrets) {
      if (safeSecretMatch(candidate, secret)) matched = true;
    }
  }
  return matched;
}
