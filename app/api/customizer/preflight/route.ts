import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { customizationFromRow } from "@/lib/customizer/customizations";
import { getTrustedTemplateForCustomization } from "@/lib/customizer/versions";
import { templateToDocument, resolveCustomerDocument } from "@/lib/customizer/v2/document";
import { runPreflight } from "@/lib/customizer/v2/preflight";
import { createServerMeasure } from "@/lib/customizer/v2/server/server-fonts";
import { readJsonObject } from "@/lib/http/read-body";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";

// POST /api/customizer/preflight — server preflight for the caller's own
// customization (spec §24). Used before cart/checkout; blocking errors stop
// ordering. Results are stored for the audit trail.
export async function POST(request: Request) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  const limited = rateLimit(request, { name: "customizer-preflight", limit: 60, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const bodyRead34 = await readJsonObject(request, 4 * 1024);
  if (bodyRead34.response) return bodyRead34.response;
  const body = bodyRead34.body;
  const customizationId = String(body.customizationId || "").trim();
  const context = (["save", "cart", "checkout"] as const).find((candidate) => candidate === body.context) ?? "save";
  if (!customizationId) {
    return Response.json({ ok: false, error: "customizationId is required." }, { status: 400 });
  }

  // Ownership via the caller's RLS-scoped client.
  const { data: row, error } = await supabase
    .from("product_customizations")
    .select("*")
    .eq("id", customizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: "Could not load customization." }, { status: 500 });
  if (!row) return Response.json({ ok: false, error: "Not found." }, { status: 404 });

  try {
    const customization = customizationFromRow(row);
    const trusted = await getTrustedTemplateForCustomization(customization);
    if (!trusted) {
      return Response.json({ ok: false, error: "This design's template is no longer available." }, { status: 409 });
    }

    const { document } = templateToDocument(trusted.template);
    const resolved = resolveCustomerDocument(
      document,
      customization.values || {},
      customization.renderData?.editorState || null,
    );
    const preflight = runPreflight(resolved, { measure: createServerMeasure() });

    const service = createServiceRoleClient();
    await service.from("customizer_preflight_results").insert({
      customization_id: customization.id,
      context,
      ok: preflight.ok,
      blocking: preflight.blocking,
      issues: preflight.issues,
    });

    return Response.json({ ok: true, preflight });
  } catch (preflightError) {
    console.error("Preflight failed:", preflightError);
    return Response.json({ ok: false, error: "Preflight could not run." }, { status: 500 });
  }
}
