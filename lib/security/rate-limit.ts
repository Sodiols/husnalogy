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

/**
 * How many reverse proxies sit in front of Node and APPEND to
 * X-Forwarded-For. The default (1) assumes exactly one — it is an ASSUMPTION
 * about the hosting topology, not a verified fact: confirm it after every
 * deployment change with GET /api/admin/production/client-ip (see
 * HOSTINGER_DEPLOYMENT.md, "Rate limiting"). Too low lets a client choose its
 * own address; too high ignores real proxies. 0 is only for a server that
 * receives client connections directly — and since route handlers cannot read
 * the socket address, every anonymous client then shares ONE bucket.
 */
function trustedProxyHops(): number {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  return Number.isInteger(hops) && hops >= 0 && hops <= 5 ? hops : 1;
}

const IP_PATTERN = /^[0-9a-f.:]{3,45}$/i;

/**
 * The client address as seen by the LAST trusted proxy.
 *
 * The leftmost X-Forwarded-For entry is whatever the client typed: using it
 * (as this function previously did) let anyone pick a fresh "IP" per request
 * and bypass every rate limit. Proxies append the address they received the
 * connection from, so the trustworthy entry is the one `hops` positions from
 * the RIGHT. `x-real-ip`/`cf-connecting-ip` are not consulted: without a
 * proxy guaranteed to overwrite them they are equally client controlled.
 */
export function getClientIp(request) {
  const hops = trustedProxyHops();
  if (hops > 0) {
    const chain = String(request.headers.get("x-forwarded-for") || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const candidate = chain.length >= hops ? chain[chain.length - hops] : chain[0];
    if (candidate && IP_PATTERN.test(candidate)) return candidate;
  }
  return "unknown";
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

/** What the limiter sees for this request — for the operator's topology check, never for clients. */
export function rateLimitDiagnostics(request: Request) {
  return {
    trustedProxyHops: trustedProxyHops(),
    forwardedFor: String(request.headers.get("x-forwarded-for") || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    resolvedClientIp: getClientIp(request),
    distributed: isDistributedRateLimitConfigured(),
    scope: isDistributedRateLimitConfigured()
      ? "Shared across every Node process (Upstash Redis)."
      : "Per Node process (in memory): each process counts on its own, and a restart resets the counts.",
  };
}

export function isDistributedRateLimitConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Synchronous, per-instance limiter. Kept as the default and as the fallback
 * whenever distributed limiting is unavailable.
 */
export function rateLimit(request, { name, limit, windowMs, identity = "" }: { name: string; limit: number; windowMs: number; identity?: string }) {
  const now = Date.now();
  cleanup(now);

  // `identity` (e.g. the authenticated user id) makes a limit follow the
  // account instead of the network address, so one customer cannot spread
  // load across addresses and many customers behind one NAT do not share it.
  const key = `${name}:${identity || getClientIp(request)}`;
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
export async function rateLimitDistributed(request, { name, limit, windowMs, identity = "" }: { name: string; limit: number; windowMs: number; identity?: string }) {
  if (!isDistributedRateLimitConfigured()) {
    return rateLimit(request, { name, limit, windowMs, identity });
  }

  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const key = `ratelimit:${name}:${identity || getClientIp(request)}`;
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
    return rateLimit(request, { name, limit, windowMs, identity });
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
