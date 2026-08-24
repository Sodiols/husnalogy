// Request rate limiting.
//
// PRODUCTION NOTE: the in-memory bucket store below is per-instance. On a
// serverless platform each cold start gets its own map, so the effective
// limit is (configured limit x live instances). That is real, useful
// protection against a single abusive client and against runaway retry
// loops, but it is NOT a globally exact limiter.
//
// To make it global, set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// (both server-only, never NEXT_PUBLIC). When they are present every limit
// is enforced in Redis and shared across all instances; when they are
// absent the in-memory limiter is used unchanged, so the app never depends
// on an external service being reachable to serve traffic.

const buckets = new Map();

function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const firstForwarded = forwarded.split(",")[0]?.trim();

  return (
    firstForwarded ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function cleanup(now) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function tooManyRequests(retryAfterSeconds) {
  return Response.json(
    { ok: false, error: "Too many requests. Please try again soon." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } }
  );
}

export function isDistributedRateLimitConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Synchronous, per-instance limiter. Kept as the default and as the fallback
 * whenever distributed limiting is unavailable.
 */
export function rateLimit(request, { name, limit, windowMs }) {
  const now = Date.now();
  cleanup(now);

  const key = `${name}:${getClientIp(request)}`;
  const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count <= limit) return null;

  return tooManyRequests(Math.ceil((bucket.resetAt - now) / 1000));
}

/**
 * Distributed limiter for the highest-value endpoints (order creation,
 * uploads, expensive renders). Uses Upstash's REST API — no extra dependency,
 * works on edge/serverless — via INCR + EXPIRE, which is atomic per key.
 *
 * FAILS OPEN to the in-memory limiter: if Redis is unreachable we must not
 * take checkout down, and the per-instance limiter still applies.
 */
export async function rateLimitDistributed(request, { name, limit, windowMs }) {
  if (!isDistributedRateLimitConfigured()) {
    return rateLimit(request, { name, limit, windowMs });
  }

  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const key = `ratelimit:${name}:${getClientIp(request)}`;
  const baseUrl = String(process.env.UPSTASH_REDIS_REST_URL).replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    // Pipeline INCR + EXPIRE so the key always carries a TTL.
    const response = await fetch(`${baseUrl}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(windowSeconds), "NX"],
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });

    if (!response.ok) throw new Error(`Upstash responded ${response.status}`);
    const results = await response.json();
    const count = Number(results?.[0]?.result);
    if (!Number.isFinite(count)) throw new Error("Unexpected Upstash response shape");

    if (count > limit) return tooManyRequests(windowSeconds);
    return null;
  } catch (error) {
    console.error(`[rate-limit] Distributed limiter unavailable for "${name}"; falling back to the in-memory limiter.`, error);
    return rateLimit(request, { name, limit, windowMs });
  }
}

export function rejectLargeRequest(request, maxBytes) {
  const length = Number(request.headers.get("content-length") || 0);

  if (!Number.isFinite(length) || length <= maxBytes) return null;

  return Response.json(
    { ok: false, error: "Request is too large." },
    { status: 413 }
  );
}
