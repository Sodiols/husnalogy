import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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

/**
 * `fetch` that retries a PostgREST request ONCE when it is rejected with
 * PGRST303 "JWT issued at future".
 *
 * The token in question is minted per request by Supabase's own gateway (the
 * `sb_secret_`/`sb_publishable_` API keys), not by this app, so a brief clock
 * difference between the gateway and PostgREST occasionally dates it a moment
 * ahead. PostgREST rejects the request during authentication, before any SQL
 * runs, so replaying it is safe for every method. Only /rest/v1 is retried:
 * its bodies are JSON strings and can be re-sent, unlike storage uploads.
 */
export async function clockSkewRetryFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401) return response;

  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/rest/v1/")) return response;

  const body = await response.clone().json().catch(() => null);
  if (body?.code !== "PGRST303") return response;

  console.warn(`[supabase] PGRST303 (JWT issued at future) from ${new URL(url).pathname}; retrying once.`);
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

export function createServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  }

  return createSupabaseClient(getSupabaseUrl(), serviceRoleKey, {
    global: { fetch: clockSkewRetryFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
