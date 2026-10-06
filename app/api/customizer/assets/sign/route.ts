import { createServiceRoleClient } from "@/lib/supabase/server";
import { canAccessStudio, getCurrentActor } from "@/lib/auth/roles";
import { rateLimit, rejectLargeRequest } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { readJsonObject } from "@/lib/http/read-body";
import { signAdminAssetRow, type AdminAssetAudience } from "@/lib/customizer/server/admin-assets";
import { adminAssetIdentity } from "@/lib/customizer/v2/asset-identity";

/**
 * POST /api/customizer/assets/sign
 *
 * Fresh signed URLs for Husnalogy LIBRARY assets, by durable identity. This is
 * the server half of the runtime asset resolver: the browser asks for a new
 * credential before the old one expires, after a load failure, or when a
 * recovered design arrives without URLs. Nothing about the design changes —
 * only a credential is issued.
 *
 *   body: { assets: [{ assetId, variant: "editor" | "original" }], productId?, reason? }
 *
 * Authorization (the asset rows are read with the service role, so this is
 * the only gate):
 *  - studio users (admin, designer) may sign any ready asset, original included;
 *  - everyone else receives EDITOR variants only — the full-resolution original
 *    of a library asset is proprietary — and only for assets that are offered
 *    to customers, or that the named product's PUBLISHED design actually uses.
 *    Guessing an asset id therefore yields nothing.
 *
 * `reason` ("editor-load-failed", "editor-low-res") is logged with the asset id
 * so defective editor variants can be found and repaired. URLs are never logged.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set(["editor-load-failed", "editor-low-res"]);
const PUBLISHED_CACHE_MS = 60_000;
const publishedAssetCache = new Map<string, { ids: Set<string>; at: number }>();

async function publishedAssetIds(supabase: any, productId: string): Promise<Set<string>> {
  const cached = publishedAssetCache.get(productId);
  if (cached && Date.now() - cached.at < PUBLISHED_CACHE_MS) return cached.ids;
  const { data, error } = await supabase
    .from("customizer_template_versions")
    .select("document")
    .eq("product_id", productId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ids = new Set<string>();
  if (!error && data?.document) {
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      const identity = adminAssetIdentity(value);
      if (identity && UUID.test(identity.id)) ids.add(identity.id);
      Object.values(value as Record<string, unknown>).forEach(visit);
    };
    visit(data.document);
  }
  publishedAssetCache.set(productId, { ids, at: Date.now() });
  if (publishedAssetCache.size > 500) publishedAssetCache.delete(publishedAssetCache.keys().next().value as string);
  return ids;
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  const tooLarge = rejectLargeRequest(request, 32 * 1024);
  if (tooLarge) return tooLarge;
  // Generous: a long session renews every image on screen about once an hour.
  const limited = rateLimit(request, { name: "customizer-asset-sign", limit: 600, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const read = await readJsonObject(request, 32 * 1024);
  if (read.response) return read.response;
  const body = read.body;
  const requested = (Array.isArray(body.assets) ? body.assets : [])
    .slice(0, 100)
    .map((entry: any) => ({ assetId: String(entry?.assetId || ""), variant: entry?.variant === "original" ? "original" : "editor" }))
    .filter((entry: { assetId: string }) => UUID.test(entry.assetId));
  if (!requested.length) return Response.json({ ok: false, error: "Provide at least one asset." }, { status: 400 });
  const productId = typeof body.productId === "string" ? body.productId.slice(0, 80) : "";
  const reason = typeof body.reason === "string" && REASONS.has(body.reason) ? body.reason : "";

  const actor = await getCurrentActor().catch(() => null);
  const studio = canAccessStudio(actor);
  const audience: AdminAssetAudience = studio ? "studio" : "customer";

  const supabase = createServiceRoleClient();
  const ids = [...new Set(requested.map((entry: { assetId: string }) => entry.assetId))];
  const { data: rows, error } = await supabase
    .from("customizer_assets")
    .select("*")
    .in("id", ids)
    .in("status", ["ready", "archived"]);
  if (error) {
    console.error(`[customizer-assets] sign lookup failed [count=${ids.length}]: ${error.message}`);
    return Response.json({ ok: false, error: "Assets could not be looked up." }, { status: 503 });
  }

  const byId = new Map((rows || []).map((row: any) => [String(row.id), row]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) console.warn(`[customizer-assets] sign: not found or not ready [assets=${missing.join(",")}]`);

  let allowed: (row: any) => boolean = () => true;
  if (!studio) {
    const published = productId ? await publishedAssetIds(supabase, productId) : new Set<string>();
    allowed = (row) => published.has(String(row.id)) || Boolean(row.customer_available && row.active !== false && !row.archived);
  }

  const denied: string[] = [];
  const signedRows = new Map<string, Promise<any>>();
  const results = await Promise.all(
    (requested as Array<{ assetId: string; variant: "editor" | "original" }>).map(async (entry) => {
      const row = byId.get(entry.assetId);
      if (!row) return null;
      if (!allowed(row)) {
        denied.push(entry.assetId);
        return null;
      }
      // Customers never receive the proprietary original, whatever they ask for.
      const variant = studio ? entry.variant : "editor";
      try {
        // One signing per asset, shared by its editor and original requests.
        const pending = signedRows.get(entry.assetId) || signAdminAssetRow(supabase, row, undefined, audience);
        signedRows.set(entry.assetId, pending);
        const signed = await pending;
        const url = variant === "original" ? signed.originalUrl || signed.editorUrl : signed.editorUrl;
        if (!url) throw new Error("no url");
        return { assetId: entry.assetId, variant: entry.variant, url: String(url), expiresAt: String(signed.expiresAt) };
      } catch (cause) {
        // Storage refused or the object is gone: report it, keep going with the rest.
        console.error(`[customizer-assets] signing failed [asset=${entry.assetId}] [variant=${variant}]: ${(cause as Error).message}`);
        return null;
      }
    }),
  );
  const assets = results.filter(Boolean);
  if (denied.length) console.warn(`[customizer-assets] sign denied for ${audience} [product=${productId || "-"}] [assets=${denied.join(",")}]`);
  if (reason) {
    // The browser could not use the editor variant: the evidence a repair needs.
    console.warn(`[customizer-assets] ${reason} [assets=${ids.join(",")}] [audience=${audience}] — editor variant needs inspection (scripts/repair-customizer-asset-variants.mjs --dry-run)`);
  }
  return Response.json({ ok: true, assets }, { headers: { "Cache-Control": "no-store" } });
}
