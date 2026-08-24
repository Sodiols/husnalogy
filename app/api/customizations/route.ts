import { createClient } from "@/lib/supabase/server";
import {
  customizationFromRow,
  customizationInsertRow,
  customizationUpdateRow,
} from "@/lib/customizer/customizations";
import { validateCustomizationSave } from "@/lib/customizer/save-validation";
import { resolvePrivateAssetsForDelivery } from "@/lib/customizer/server/private-assets";
import { writeCustomizerAudit } from "@/lib/customizer/audit";
import { rateLimit } from "@/lib/security/rate-limit";

// Generous enough for the real autosave cadence (900ms debounce, spec
// lib/customizer/save-queue.ts) plus retries, but still bounds a runaway or
// scripted client from hammering the save endpoint.
const SAVE_RATE_LIMIT = { name: "customizations-save", limit: 300, windowMs: 5 * 60 * 1000 };

// GET /api/customizations — list customizations visible to the caller.
// RLS restricts this to the caller's own rows (or all rows for admins).
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

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
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const customizations = await Promise.all(
    (data || []).map((row) => resolvePrivateAssetsForDelivery(customizationFromRow(row), { userId: user.id }, "editor", supabase)),
  );
  return Response.json({ ok: true, customizations });
}

// POST /api/customizations — create (or save a draft of) a customization.
export async function POST(request: Request) {
  const limited = rateLimit(request, SAVE_RATE_LIMIT);
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const rawBody = await request.json().catch(() => ({}));
  const requestedId = String(rawBody.customizationId || rawBody.id || "").trim();

  // Server-side permission validation against the trusted template (spec §21).
  // Unauthorized changes are rejected; permitted changes are sanitized.
  const validation = await validateCustomizationSave(user.id, rawBody);
  if (validation.ok === false) {
    await writeCustomizerAudit(supabase, {
      actorId: user.id,
      action: "customization.save_rejected",
      productId: rawBody.productId,
      editorState: rawBody.editorState || rawBody.renderData?.editorState,
      details: { violationCodes: validation.violations.map((item) => item.code) },
    });
    return Response.json(
      { ok: false, error: validation.error, violations: validation.violations },
      { status: validation.status },
    );
  }
  const body = validation.body;

  if (requestedId && !requestedId.startsWith("local_")) {
    const { data: existing, error: existingError } = await supabase
      .from("product_customizations")
      .select("id,status")
      .eq("id", requestedId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingError) return Response.json({ ok: false, error: existingError.message }, { status: 500 });
    if (!existing) return Response.json({ ok: false, error: "Customization not found." }, { status: 404 });
    if (existing.status === "ordered") {
      return Response.json({ ok: false, error: "Placed-order designs are locked. Duplicate the design to make changes." }, { status: 409 });
    }
    const { data, error } = await supabase
      .from("product_customizations")
      .update(customizationUpdateRow(body))
      .eq("id", requestedId)
      .eq("user_id", user.id)
      .neq("status", "ordered")
      .select("*")
      .maybeSingle();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    if (data) {
      await writeCustomizerAudit(supabase, {
        actorId: user.id,
        action: "customization.updated",
        customizationId: data.id,
        productId: data.product_id,
        editorState: rawBody.editorState || rawBody.renderData?.editorState,
        details: { schemaVersion: 4 },
      });
      const customization = await resolvePrivateAssetsForDelivery(customizationFromRow(data), { userId: user.id }, "editor", supabase);
      return Response.json({ ok: true, customization });
    }
  }

  const row = customizationInsertRow(user.id, body);

  const { data, error } = await supabase.from("product_customizations").insert(row).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  await writeCustomizerAudit(supabase, {
    actorId: user.id,
    action: "customization.created",
    customizationId: data.id,
    productId: data.product_id,
    editorState: rawBody.editorState || rawBody.renderData?.editorState,
    details: { schemaVersion: 4 },
  });

  const customization = await resolvePrivateAssetsForDelivery(customizationFromRow(data), { userId: user.id }, "editor", supabase);
  return Response.json({ ok: true, customization });
}
