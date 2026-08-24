// GET /api/customizer/iconify/search — server-mediated Iconify discovery.
//
// The browser talks to Husnalogy, never to Iconify: the server owns the
// upstream URL, the license policy and the caching (spec §6).

import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { normalizePage, normalizePageSize, normalizeSearchQuery } from "@/lib/customizer/v2/iconify";
import { IconifyUnavailableError, searchIcons } from "@/lib/customizer/v2/server/iconify";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const limited = rateLimit(request, { name: "iconify-search", limit: 120, windowMs: 5 * 60 * 1000 });
  if (limited) return limited;

  // Discovery is for signed-in users only: it is an outbound network cost and
  // a precursor to import, so it must not be an open endpoint (spec §14).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const url = new URL(request.url);
  const query = normalizeSearchQuery(url.searchParams.get("q"));
  if (!query) {
    return Response.json({ ok: true, results: [], total: 0, page: 1, pageSize: 0, hasMore: false });
  }

  const page = normalizePage(url.searchParams.get("page"));
  const pageSize = normalizePageSize(url.searchParams.get("pageSize"));

  // Admins may see license-blocked collections labelled with a verdict, so the
  // policy is diagnosable; customers only ever receive permitted results.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const audience = profile?.role === "admin" ? "admin" : "customer";

  try {
    const { results, total, filtered } = await searchIcons({ query, page, pageSize, audience });
    return Response.json({
      ok: true,
      results,
      total,
      page,
      pageSize,
      hasMore: results.length >= pageSize && page * pageSize < total,
      ...(audience === "admin" ? { filtered } : {}),
    });
  } catch (error) {
    if (error instanceof IconifyUnavailableError) {
      // A clean, non-fatal signal: the panel keeps its local library working.
      return Response.json(
        { ok: false, error: "Online graphics are temporarily unavailable.", code: "ICONIFY_UNAVAILABLE" },
        { status: 503 },
      );
    }
    console.error("[iconify] search failed:", error instanceof Error ? error.message : error);
    return Response.json(
      { ok: false, error: "Online graphics are temporarily unavailable.", code: "ICONIFY_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
