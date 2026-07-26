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

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  return Response.json(
    { ok: false, error: "Too many requests. Please try again soon." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

export function rejectLargeRequest(request, maxBytes) {
  const length = Number(request.headers.get("content-length") || 0);

  if (!Number.isFinite(length) || length <= maxBytes) return null;

  return Response.json(
    { ok: false, error: "Request is too large." },
    { status: 413 }
  );
}
