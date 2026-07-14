import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { clearFeatureFlagCache } from "@/lib/customizer/v2/feature-flags.server";
import { CUSTOMIZER_FEATURE_FLAGS } from "@/lib/customizer/v2/feature-flags";
import { rejectLargeRequest } from "@/lib/security/rate-limit";

const flagSet = new Set<string>(CUSTOMIZER_FEATURE_FLAGS);
const scopeSet = new Set(["global", "product_type", "product"]);

export async function GET(_request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const { productId } = await params;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("customizer_feature_flags").select("*").or(`scope.eq.global,and(scope.eq.product,scope_key.eq.${String(productId).replace(/[^a-zA-Z0-9_-]/g, "")})`).order("flag");
  if (error) return Response.json({ ok: false, error: "Could not load feature flags." }, { status: 500 });
  return Response.json({ ok: true, flags: data || [] });
}

export async function PUT(request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const tooLarge = rejectLargeRequest(request, 64 * 1024);
  if (tooLarge) return tooLarge;
  const { productId } = await params;
  const body = await request.json().catch(() => ({}));
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (!entries.length || entries.length > CUSTOMIZER_FEATURE_FLAGS.length * 3) return Response.json({ ok: false, error: "Valid feature flag entries are required." }, { status: 400 });
  const rows = entries.map((entry: any) => {
    const flag = String(entry.flag || "");
    const scope = String(entry.scope || "product");
    if (!flagSet.has(flag) || !scopeSet.has(scope)) throw new Error("INVALID_FLAG");
    const scopeKey = scope === "global" ? "*" : scope === "product" ? String(productId) : String(entry.scopeKey || entry.productType || "").trim();
    if (!scopeKey) throw new Error("INVALID_SCOPE");
    return {
      flag,
      scope,
      scope_key: scopeKey,
      product_id: scope === "product" ? String(productId) : null,
      product_type: scope === "product_type" ? scopeKey : null,
      enabled: Boolean(entry.enabled),
      environments: Array.isArray(entry.environments) ? entry.environments.map(String).slice(0, 8) : ["development", "preview", "production", "test"],
      rollout_percentage: Math.max(0, Math.min(100, Number(entry.rolloutPercentage ?? 100))),
      admin_only: Boolean(entry.adminOnly),
      updated_at: new Date().toISOString(),
    };
  });
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("customizer_feature_flags").upsert(rows, { onConflict: "scope,scope_key,flag" }).select("*");
  if (error) {
    console.error("Save feature flags failed:", error);
    return Response.json({ ok: false, error: "Could not save feature flags." }, { status: 500 });
  }
  clearFeatureFlagCache();
  console.info(`[customizer] Feature flags updated: product=${productId} by=${admin.admin?.id || "unknown"}`);
  return Response.json({ ok: true, flags: data || [] });
}
