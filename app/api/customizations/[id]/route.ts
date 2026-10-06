import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { customizationFromRow, customizationUpdateRow } from "@/lib/customizer/customizations";
import { validateCustomizationSave } from "@/lib/customizer/save-validation";
import { prepareCustomerWrite } from "@/lib/customizer/customization-write";
import { resolvePrivateAssetsForDelivery } from "@/lib/customizer/server/private-assets";
import { writeCustomizerAudit } from "@/lib/customizer/audit";
import { storedClientRevision, writeWithRevisionGuard } from "@/lib/customizer/save-revision";
import { rateLimit } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { bodyErrorResponse, readJsonBody } from "@/lib/http/read-body";
import { logEvent, requestIdFrom } from "@/lib/observability/logger";

// Shared with POST. The editor writes at most once a second while a customer
// is actively editing (lib/customizer/save-queue.ts minIntervalMs) plus a
// keepalive on unload and retries; this bounds a scripted client without ever
// throttling a real editing session.
const SAVE_RATE_LIMIT = { name: "customizations-save", limit: 600, windowMs: 5 * 60 * 1000 };
const MAX_CUSTOMIZATION_BODY_BYTES = 2 * 1024 * 1024;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** The caller's own customization, loaded with the service role + strict owner filter. */
async function loadOwned(id: string, userId: string) {
  if (!UUID.test(id)) return { row: null, error: null };
  const service = createServiceRoleClient();
  const { data, error } = await service.from("product_customizations").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return { row: data, error };
}

// GET /api/customizations/[id] — only the owner.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401, headers: PRIVATE_HEADERS });

  const { row, error } = await loadOwned(id, user.id);
  if (error) {
    logEvent("error", "customizations.read_failed", { requestId: requestIdFrom(request), userId: user.id, error });
    return Response.json({ ok: false, error: "Could not load this design." }, { status: 500, headers: PRIVATE_HEADERS });
  }
  if (!row) return Response.json({ ok: false, error: "Not found." }, { status: 404, headers: PRIVATE_HEADERS });

  const customization = await resolvePrivateAssetsForDelivery(customizationFromRow(row), { userId: user.id }, "editor", supabase);
  return Response.json({ ok: true, customization }, { headers: PRIVATE_HEADERS });
}

// PATCH /api/customizations/[id] — update the caller's own design.
//
// The product, template and template version are read from the STORED row and
// are authoritative: a request can neither change them nor omit them to skip
// validation. Design changes are validated against that exact published
// template version before anything is written.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFrom(request);
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const limited = rateLimit(request, { ...SAVE_RATE_LIMIT, identity: user.id });
  if (limited) return limited;

  let rawBody: Record<string, any>;
  try {
    rawBody = (await readJsonBody(request, MAX_CUSTOMIZATION_BODY_BYTES)) as Record<string, any>;
  } catch (error) {
    return bodyErrorResponse(error) || Response.json({ ok: false, error: "The request body is invalid." }, { status: 400 });
  }

  const { row: existingRow, error: readError } = await loadOwned(id, user.id);
  if (readError) {
    logEvent("error", "customizations.read_failed", { requestId, userId: user.id, error: readError });
    return Response.json({ ok: false, error: "Could not load this design." }, { status: 500 });
  }
  if (!existingRow) return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  if (existingRow.status === "ordered" || existingRow.order_id) {
    return Response.json({ ok: false, error: "Placed-order designs are locked. Duplicate the design to make changes." }, { status: 409 });
  }

  const context = {
    productId: String(existingRow.product_id || ""),
    templateId: String(existingRow.template_id || ""),
    templateVersion: Number(existingRow.template_version) || 0,
  };
  const prepared = prepareCustomerWrite(rawBody, context);
  if (prepared.ok === false) return Response.json({ ok: false, error: prepared.error }, { status: prepared.status });
  const body = prepared.body;

  const service = createServiceRoleClient();
  if (body.cartItemId) {
    const { data: cartLine } = await service.from("cart_items").select("id").eq("id", String(body.cartItemId)).eq("user_id", user.id).maybeSingle();
    if (!cartLine) return Response.json({ ok: false, error: "Cart item not found." }, { status: 404 });
  }

  const validation = await validateCustomizationSave(user.id, body, {
    ...context,
    editorState: (existingRow.render_data as any)?.editorState || null,
  });
  if (validation.ok === false) {
    await writeCustomizerAudit(service, {
      actorId: user.id,
      action: "customization.save_rejected",
      customizationId: id,
      productId: existingRow.product_id,
      editorState: body.editorState || body.renderData?.editorState,
      details: { violationCodes: validation.violations.map((item) => item.code) },
    });
    return Response.json({ ok: false, error: validation.error, violations: validation.violations }, { status: validation.status });
  }

  const clientRevision: number | null = typeof validation.body.clientRevision === "number" ? validation.body.clientRevision : null;
  /**
   * The row this request writes, built against the CURRENT stored row. A
   * compact design write (editorState without renderData — what the editor
   * sends with keepalive while the page unloads) only replaces the design
   * state inside render_data and keeps everything else stored there.
   */
  const rowFor = (current: any) => {
    const body = { ...validation.body };
    if (body.editorState !== undefined && body.renderData === undefined) {
      body.renderData = {
        ...((current?.render_data as Record<string, unknown>) || {}),
        editorState: body.editorState,
        ...(body.values !== undefined ? { values: body.values } : {}),
      };
    }
    if (clientRevision !== null && body.renderData && typeof body.renderData === "object") {
      body.renderData = { ...body.renderData, clientRevision };
    }
    return customizationUpdateRow(body);
  };
  const updateQuery = (current: any) =>
    service
      .from("product_customizations")
      .update(rowFor(current))
      .eq("id", id)
      .eq("user_id", user.id)
      .neq("status", "ordered")
      .is("order_id", null);

  let data: any = null;
  if (clientRevision !== null) {
    // Design writes are ordered: an older body can never replace a newer one.
    const written = await writeWithRevisionGuard(clientRevision, existingRow, {
      read: async () => {
        const reread = await loadOwned(id, user.id);
        return { row: reread.row, error: reread.error };
      },
      // Compare-and-swap on updated_at, so the revision check above and this
      // write see the same row.
      write: async (current: any) => {
        const { data: updated, error } = await updateQuery(current).eq("updated_at", current.updated_at).select("*").maybeSingle();
        return { row: updated, error };
      },
      isLocked: (current: any) => current.status === "ordered" || Boolean(current.order_id),
      revision: (current: any) => storedClientRevision(current.render_data),
    });
    if (written.ok === false) {
      if (written.reason === "stale") {
        return Response.json(
          { ok: false, code: "stale-revision", error: "A newer version of this design is already saved.", serverRevision: written.storedRevision },
          { status: 409, headers: PRIVATE_HEADERS },
        );
      }
      if (written.reason === "missing") return Response.json({ ok: false, error: "Not found." }, { status: 404 });
      if (written.reason === "error") {
        logEvent("error", "customizations.update_failed", { requestId, userId: user.id, customizationId: id, error: written.error });
        return Response.json({ ok: false, error: "Your changes could not be saved. Please try again." }, { status: 500 });
      }
      return Response.json({ ok: false, error: "Placed-order designs are locked. Duplicate the design to make changes." }, { status: 409 });
    }
    data = written.row;
  } else {
    const { data: updated, error } = await updateQuery(existingRow).select("*").maybeSingle();
    if (error) {
      logEvent("error", "customizations.update_failed", { requestId, userId: user.id, customizationId: id, error });
      return Response.json({ ok: false, error: "Your changes could not be saved. Please try again." }, { status: 500 });
    }
    data = updated;
  }
  if (!data) return Response.json({ ok: false, error: "Placed-order designs are locked. Duplicate the design to make changes." }, { status: 409 });

  await writeCustomizerAudit(service, {
    actorId: user.id,
    action: "customization.updated",
    customizationId: data.id,
    productId: data.product_id,
    editorState: body.editorState || body.renderData?.editorState,
    details: { schemaVersion: 4 },
  });

  const customization = await resolvePrivateAssetsForDelivery(customizationFromRow(data), { userId: user.id }, "editor", supabase);
  return Response.json({ ok: true, customization }, { headers: PRIVATE_HEADERS });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const { id } = await params;
  const { user } = await getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const { row: existing } = await loadOwned(id, user.id);
  if (!existing) return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  if (existing.status === "ordered" || existing.order_id) {
    return Response.json({ ok: false, error: "Placed-order designs cannot be deleted." }, { status: 409 });
  }

  const service = createServiceRoleClient();
  const { error } = await service.from("product_customizations").delete().eq("id", id).eq("user_id", user.id).neq("status", "ordered").is("order_id", null);
  if (error) {
    logEvent("error", "customizations.delete_failed", { requestId: requestIdFrom(request), userId: user.id, customizationId: id, error });
    return Response.json({ ok: false, error: "Could not delete this design." }, { status: 500 });
  }

  await writeCustomizerAudit(service, {
    actorId: user.id,
    action: "customization.deleted",
    productId: existing.product_id,
    details: { deletedCustomizationId: id },
  });

  return Response.json({ ok: true });
}
