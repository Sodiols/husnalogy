import { createClient } from "@/lib/supabase/server";
import {
  customizationFromRow,
  customizationUpdateRow,
} from "@/lib/customizer/customizations";
import { validateCustomizationSave } from "@/lib/customizer/save-validation";
import { resolvePrivateAssetsForDelivery } from "@/lib/customizer/server/private-assets";
import { writeCustomizerAudit } from "@/lib/customizer/audit";

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// GET /api/customizations/[id] — RLS scopes this to the owner (or admin).
export async function GET(_request: Request, { params }: any) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const { data, error } = await supabase.from("product_customizations").select("*").eq("id", id).maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return Response.json({ ok: false, error: "Not found." }, { status: 404 });

  const customization = await resolvePrivateAssetsForDelivery(customizationFromRow(data), { userId: user.id }, "editor", supabase);
  return Response.json({ ok: true, customization });
}

// PATCH /api/customizations/[id] — update your own customization. RLS blocks
// updates to rows that are not yours.
export async function PATCH(request: Request, { params }: any) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const rawBody = await request.json().catch(() => ({}));

  // Load the existing row first (RLS scopes to the owner) so validation knows
  // the product/template even when the patch omits them.
  const { data: existingRow, error: readError } = await supabase
    .from("product_customizations")
    .select("id, product_id, template_id, template_version")
    .eq("id", id)
    .maybeSingle();
  if (readError) return Response.json({ ok: false, error: readError.message }, { status: 500 });
  if (!existingRow) return Response.json({ ok: false, error: "Not found." }, { status: 404 });

  // Server-side permission validation against the trusted template (spec §21).
  const validation = await validateCustomizationSave(user.id, rawBody, {
    productId: existingRow.product_id || "",
    templateId: existingRow.template_id || "",
    templateVersion: Number(existingRow.template_version) || 0,
  });
  if (validation.ok === false) {
    await writeCustomizerAudit(supabase, {
      actorId: user.id,
      action: "customization.save_rejected",
      customizationId: id,
      productId: existingRow.product_id,
      editorState: rawBody.editorState || rawBody.renderData?.editorState,
      details: { violationCodes: validation.violations.map((item) => item.code) },
    });
    return Response.json(
      { ok: false, error: validation.error, violations: validation.violations },
      { status: validation.status },
    );
  }

  const row = customizationUpdateRow(validation.body);

  const { data, error } = await supabase
    .from("product_customizations")
    .update(row)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return Response.json({ ok: false, error: "Not found." }, { status: 404 });

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

export async function DELETE(_request: Request, { params }: any) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const { data: existing } = await supabase.from("product_customizations").select("product_id").eq("id", id).maybeSingle();
  const { error } = await supabase.from("product_customizations").delete().eq("id", id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  await writeCustomizerAudit(supabase, {
    actorId: user.id,
    action: "customization.deleted",
    productId: existing?.product_id,
    details: { deletedCustomizationId: id },
  });

  return Response.json({ ok: true });
}
