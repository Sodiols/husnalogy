import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { customizationFromRow, customizationInsertRow } from "@/lib/customizer/customizations";
import { validateCustomizationSave } from "@/lib/customizer/save-validation";
import { prepareCustomerWrite } from "@/lib/customizer/customization-write";
import { resolvePrivateAssetsForDelivery } from "@/lib/customizer/server/private-assets";
import { getCustomizerTemplateByProductId } from "@/lib/customizer/store";
import { getTemplateVersion } from "@/lib/customizer/versions";
import { writeCustomizerAudit } from "@/lib/customizer/audit";
import { getProductRecordsForCheckout } from "@/lib/products";
import { rateLimit } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { bodyErrorResponse, readJsonBody } from "@/lib/http/read-body";
import { logEvent, requestIdFrom } from "@/lib/observability/logger";

// Generous enough for the real autosave cadence (900ms debounce, spec
// lib/customizer/save-queue.ts) plus retries, but still bounds a runaway or
// scripted client from hammering the save endpoint.
const SAVE_RATE_LIMIT = { name: "customizations-save", limit: 300, windowMs: 5 * 60 * 1000 };
/** A large multi-page design with many customer layers stays well below this. */
const MAX_CUSTOMIZATION_BODY_BYTES = 2 * 1024 * 1024;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export const dynamic = "force-dynamic";

// GET /api/customizations — the caller's own customizations (RLS + explicit
// owner filter).
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401, headers: PRIVATE_HEADERS });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const productId = url.searchParams.get("productId");
  const templateId = url.searchParams.get("templateId");
  const templateVersion = Math.max(0, Number(url.searchParams.get("templateVersion") || 0));
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 50)));

  let query = supabase.from("product_customizations").select("*").eq("user_id", user.id).order("updated_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (productId) query = query.eq("product_id", productId);
  if (templateId) query = query.eq("template_id", templateId);
  if (templateVersion) query = query.eq("template_version", templateVersion);
  query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    logEvent("error", "customizations.list_failed", { requestId: requestIdFrom(request), userId: user.id, error });
    return Response.json({ ok: false, error: "Could not load your designs." }, { status: 500, headers: PRIVATE_HEADERS });
  }

  const customizations = await Promise.all(
    (data || []).map((row) => resolvePrivateAssetsForDelivery(customizationFromRow(row), { userId: user.id }, "editor", supabase)),
  );
  return Response.json({ ok: true, customizations }, { headers: PRIVATE_HEADERS });
}

// POST /api/customizations — CREATE a new customization. Updating an existing
// design is PATCH /api/customizations/[id]; POST never updates.
export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const limited = rateLimit(request, { ...SAVE_RATE_LIMIT, identity: user.id });
  if (limited) return limited;

  let rawBody: Record<string, any>;
  try {
    rawBody = (await readJsonBody(request, MAX_CUSTOMIZATION_BODY_BYTES)) as Record<string, any>;
  } catch (error) {
    return bodyErrorResponse(error) || Response.json({ ok: false, error: "The request body is invalid." }, { status: 400 });
  }

  const requestedId = String(rawBody?.customizationId || rawBody?.id || "").trim();
  if (requestedId && !requestedId.startsWith("local_")) {
    return Response.json(
      { ok: false, error: "Use PATCH /api/customizations/{id} to update an existing design." },
      { status: 400 },
    );
  }

  const prepared = prepareCustomerWrite(rawBody, null);
  if (prepared.ok === false) return Response.json({ ok: false, error: prepared.error }, { status: prepared.status });
  const body = prepared.body;

  // The product must be one a customer can personalize right now, and the
  // template/version must be ITS published template.
  const productId = String(body.productId || "");
  const product = (await getProductRecordsForCheckout([productId])).get(productId)?.product;
  if (!product || product.status !== "active" || product.visibility === "hidden") {
    return Response.json({ ok: false, error: "This product cannot be personalized right now." }, { status: 404 });
  }
  const productTemplate = await getCustomizerTemplateByProductId(productId);
  const version = productTemplate ? await getTemplateVersion(String(productTemplate.id), Number(body.templateVersion) || 0) : null;
  if (!productTemplate || String(productTemplate.id) !== String(body.templateId) || !version || version.productId !== productId) {
    return Response.json({ ok: false, error: "This design template is no longer available. Please reload the page." }, { status: 409 });
  }

  const service = createServiceRoleClient();
  if (body.cartItemId) {
    const { data: cartLine } = await service.from("cart_items").select("id").eq("id", String(body.cartItemId)).eq("user_id", user.id).maybeSingle();
    if (!cartLine) return Response.json({ ok: false, error: "Cart item not found." }, { status: 404 });
  }

  const validation = await validateCustomizationSave(user.id, body);
  if (validation.ok === false) {
    await writeCustomizerAudit(service, {
      actorId: user.id,
      action: "customization.save_rejected",
      productId,
      editorState: body.editorState || body.renderData?.editorState,
      details: { violationCodes: validation.violations.map((item) => item.code) },
    });
    return Response.json({ ok: false, error: validation.error, violations: validation.violations }, { status: validation.status });
  }

  const row = customizationInsertRow(user.id, { ...validation.body, status: validation.body.status || "draft" });
  const { data, error } = await service.from("product_customizations").insert(row).select("*").single();
  if (error) {
    logEvent("error", "customizations.create_failed", { requestId, userId: user.id, productId, error });
    return Response.json({ ok: false, error: "Your design could not be saved. Please try again." }, { status: 500 });
  }

  await writeCustomizerAudit(service, {
    actorId: user.id,
    action: "customization.created",
    customizationId: data.id,
    productId: data.product_id,
    editorState: body.editorState || body.renderData?.editorState,
    details: { schemaVersion: 4 },
  });

  const customization = await resolvePrivateAssetsForDelivery(customizationFromRow(data), { userId: user.id }, "editor", supabase);
  return Response.json({ ok: true, customization }, { headers: PRIVATE_HEADERS });
}
