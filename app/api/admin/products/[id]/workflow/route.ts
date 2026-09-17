import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentActor, canReviewProducts } from "@/lib/auth/roles";
import { resolveWorkflowTransition, type WorkflowAction } from "@/lib/products/workflow";
import { logServerFailure } from "@/lib/core/server-errors";

/**
 * POST /api/admin/products/[id]/workflow  { action, note? }
 *
 * The ONLY way a product's `workflow_state` changes. The ordinary product
 * update endpoint strips workflow fields entirely, so state can never be moved
 * by posting a product body — a designer cannot send
 * `workflow_state: "published"` and have it stick (spec §21).
 *
 * Who may do what is decided by `resolveWorkflowTransition`, which is pure and
 * separately tested:
 *
 *   designer  submit
 *   admin     request_revision | approve | publish | unpublish | archive
 *
 * The product row is always re-read here, so authorization is based on stored
 * ownership and stored state rather than on anything the browser sent.
 */

const ACTIONS = new Set<WorkflowAction>([
  "submit",
  "request_revision",
  "approve",
  "publish",
  "unpublish",
  "archive",
]);

export async function POST(request: Request, { params }: any) {
  const actor = await getCurrentActor();
  if (!actor) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "") as WorkflowAction;
  if (!ACTIONS.has(action)) {
    return Response.json({ ok: false, error: "Unknown workflow action." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: product } = await supabase
    .from("products")
    .select("id,status,created_by,assigned_designer_id,workflow_state")
    .eq("id", String(id || ""))
    .maybeSingle();

  // A product the actor may not touch is reported exactly like one that does
  // not exist, so this cannot be used to enumerate the catalogue.
  if (!product) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const decision = resolveWorkflowTransition(action, actor, product, { note: body?.note });
  if (!decision.ok) {
    return Response.json({ ok: false, error: decision.error }, { status: decision.status });
  }

  const patch: Record<string, unknown> = { ...decision.patch, updated_at: new Date().toISOString() };

  /**
   * Publication is TWO facts, deliberately kept separate: `workflow_state`
   * records the editorial decision, `status`/`published_at` make it public.
   * Only an admin ever reaches this branch, because only `publish`/`unpublish`
   * produce these states and both are gated on `canPublish`.
   */
  if (decision.nextState === "published") {
    patch.status = "active";
    patch.published_at = new Date().toISOString();
  } else if (action === "unpublish") {
    patch.status = "draft";
  } else if (decision.nextState === "archived") {
    patch.status = "deleted";
    patch.deleted_at = new Date().toISOString();
  }

  const { error } = await supabase.from("products").update(patch).eq("id", product.id);
  if (error) {
    logServerFailure(`Workflow transition failed (${action} on ${product.id})`, error);
    return Response.json({ ok: false, error: "The product could not be updated." }, { status: 500 });
  }

  // Attributable audit trail for every editorial decision (spec §47).
  console.info(
    `[workflow] ${action}: product=${product.id} ${product.workflow_state} -> ${decision.nextState} by=${actor.id} role=${actor.role}`,
  );

  return Response.json({ ok: true, workflowState: decision.nextState });
}

/**
 * PUT /api/admin/products/[id]/workflow  { designerId }
 *
 * Assign or reassign a product to a designer. Admin only: a designer must never
 * be able to hand themselves work (spec §22).
 */
export async function PUT(request: Request, { params }: any) {
  const actor = await getCurrentActor();
  if (!actor) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canReviewProducts(actor)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const designerId = body?.designerId ? String(body.designerId) : null;

  const supabase = createServiceRoleClient();

  if (designerId) {
    // Only an actual designer may be assigned; assigning a customer would grant
    // studio access the capability layer never intended.
    const { data: profile } = await supabase
      .from("profiles")
      .select("id,role")
      .eq("id", designerId)
      .maybeSingle();
    if (!profile || profile.role !== "designer") {
      return Response.json({ ok: false, error: "That user is not a designer." }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from("products")
    .update({ assigned_designer_id: designerId, updated_at: new Date().toISOString() })
    .eq("id", String(id || ""));
  if (error) {
    logServerFailure(`Designer assignment failed on ${id}`, error);
    return Response.json({ ok: false, error: "The product could not be updated." }, { status: 500 });
  }

  console.info(`[workflow] assign: product=${id} designer=${designerId || "none"} by=${actor.id}`);
  return Response.json({ ok: true, assignedDesignerId: designerId });
}
