/**
 * Authentication for the scheduled worker endpoints (Hostinger cron).
 *
 * The secret is accepted only in a header (never the URL, which ends up in
 * access logs) and compared in constant time against every configured secret,
 * so response timing does not reveal which secret matched.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { getRenderWorkerSecrets } from "@/lib/env/server-env";

/**
 * Both sides are hashed to a fixed 32 bytes first, so the comparison takes the
 * same time whatever the provided value's length (no length oracle).
 */
function safeSecretMatch(provided: string, secret: string) {
  if (!provided || !secret) return false;
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(left, right);
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
