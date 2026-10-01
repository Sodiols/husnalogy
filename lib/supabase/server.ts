import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { logEvent } from "@/lib/observability/logger";

function normalizeSupabaseUrl(value) {
  return String(value || "").replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/g, "");
}

function getSupabaseUrl() {
  const value = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing.");
  return value;
}

function getPublishableKey() {
  const value =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing. NEXT_PUBLIC_SUPABASE_ANON_KEY is also accepted."
    );
  }
  return value;
}

const CLOCK_SKEW_RETRY_DELAY_MS = 1200;

/** Claims of a JWT bearer token (never the token itself). */
function bearerClaims(init?: RequestInit, input?: RequestInfo | URL): { iat?: number; exp?: number } | null {
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  const token = (headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) return null; // sb_publishable_/sb_secret_ keys are not JWTs
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return { iat: Number(claims.iat) || undefined, exp: Number(claims.exp) || undefined };
  } catch {
    return null;
  }
}

/**
 * `fetch` that retries a PostgREST request ONCE when it is rejected with
 * PGRST303 "JWT issued at future", and REPORTS the measured clock difference.
 *
 * PGRST303 means the token's `iat` is ahead of PostgREST's clock. With
 * `sb_secret_`/`sb_publishable_` keys the token is minted per request by
 * Supabase's gateway, not by this app; with a user session it is minted by
 * Supabase Auth. PostgREST rejects the request during authentication, before
 * any SQL runs, so ONE replay is safe for every method. Only /rest/v1 is
 * retried: its bodies are JSON strings and can be re-sent, unlike uploads.
 *
 * The retry is not the fix: each occurrence is logged at error level (and
 * reaches monitoring) with the server clock, the token's iat/exp and the
 * gateway's Date header, so the actual skew can be measured and the clock
 * synchronized (HOSTINGER_DEPLOYMENT.md, "Clock synchronization").
 */
export async function clockSkewRetryFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401) return response;

  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/rest/v1/")) return response;

  const body = await response.clone().json().catch(() => null);
  if (body?.code !== "PGRST303") return response;

  const serverNowMs = Date.now();
  const claims = bearerClaims(init, input);
  const gatewayDateMs = Date.parse(response.headers.get("date") || "");
  logEvent("error", "supabase.jwt_issued_in_future", {
    stage: "clock_skew",
    path: new URL(url).pathname,
    serverNow: new Date(serverNowMs).toISOString(),
    credentialKind: claims ? "jwt" : "api-key",
    iat: claims?.iat ? new Date(claims.iat * 1000).toISOString() : undefined,
    exp: claims?.exp ? new Date(claims.exp * 1000).toISOString() : undefined,
    iatAheadOfServerMs: claims?.iat ? claims.iat * 1000 - serverNowMs : undefined,
    // One-second resolution; negative means this server is ahead of Supabase.
    gatewayMinusServerMs: Number.isFinite(gatewayDateMs) ? gatewayDateMs - serverNowMs : undefined,
  });
  await new Promise((resolve) => setTimeout(resolve, CLOCK_SKEW_RETRY_DELAY_MS));
  return fetch(input, init);
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getPublishableKey(), {
    global: { fetch: clockSkewRetryFetch },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always set cookies; middleware refreshes them.
        }
      },
    },
  });
}

/** A hung storage/database request must not hold a production lease forever. */
export async function boundedServiceFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const inherited = init?.signal || (input instanceof Request ? input.signal : null);
  const timeout = AbortSignal.timeout(60_000);
  return clockSkewRetryFetch(input, { ...init, signal: inherited ? AbortSignal.any([inherited, timeout]) : timeout });
}

export function createServiceRoleClient(options: { signal?: AbortSignal } = {}) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  }

  return createSupabaseClient(getSupabaseUrl(), serviceRoleKey, {
    global: { fetch: (input, init) => {
      const inherited = init?.signal || (input instanceof Request ? input.signal : null);
      return boundedServiceFetch(input, { ...init, signal: options.signal ? AbortSignal.any([options.signal, ...(inherited ? [inherited] : [])]) : inherited });
    } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
