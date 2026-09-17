/**
 * The product review workflow, and the rules that keep a designer inside it.
 *
 * `workflow_state` describes the EDITORIAL pipeline; `status`/`visibility`
 * remain what the public queries filter on. They are deliberately separate:
 * approving a design is not the same decision as putting it on sale, and only
 * an admin makes the second one.
 *
 *     draft ──submit──▶ in_review ──approve──▶ approved ──publish──▶ published
 *       ▲                   │
 *       └─ needs_revision ◀─┘  (admin requests changes)
 *
 * Everything here is pure so the transition rules can be tested without a
 * database, and so there is exactly ONE place that decides whether a state
 * change is legal. The API routes call into this; they never re-derive it.
 */

import type { Actor } from "@/lib/auth/roles";
import { canEditProduct, canPublish, canReviewProducts, workflowStateOf } from "@/lib/auth/roles";
import { designerMayEdit, type WorkflowState } from "./workflow-states";

export {
  WORKFLOW_STATES,
  WORKFLOW_LABELS,
  designerMayEdit,
  isWorkflowState,
  type WorkflowState,
} from "./workflow-states";

export type WorkflowAction = "submit" | "request_revision" | "approve" | "publish" | "unpublish" | "archive";

/**
 * The optional counterpart members mirror the guard types in `lib/auth/roles`:
 * this project compiles with `strict: false`, which disables narrowing on
 * literal-boolean discriminants, so both shapes declare both sides.
 */
export type TransitionResult =
  | { ok: true; nextState: WorkflowState; patch: Record<string, unknown>; error?: undefined; status?: undefined }
  | { ok: false; error: string; status: 403 | 409; nextState?: undefined; patch?: undefined };

/**
 * Resolve one workflow action into the exact row patch it implies.
 *
 * Returns 403 when the ACTOR may not perform the action at all, and 409 when
 * they may but the product is in the wrong state — so a designer submitting
 * twice gets a clear "already under review" rather than a permission error.
 */
export function resolveWorkflowTransition(
  action: WorkflowAction,
  actor: Actor | null,
  product: Record<string, any> | null,
  options: { note?: string } = {},
): TransitionResult {
  if (!actor || !product) return { ok: false, error: "Forbidden", status: 403 };
  const state = workflowStateOf(product) as WorkflowState;
  const now = new Date().toISOString();
  const note = String(options.note || "").slice(0, 2000);

  switch (action) {
    case "submit": {
      // Ownership decides 403; STATE decides 409. Checking `canSubmitForReview`
      // alone would answer "forbidden" to an owner re-submitting their own
      // product, which reads as a permission problem when it is really "you
      // already did this".
      if (!canEditProduct(actor, product)) {
        return { ok: false, error: "You cannot submit this product for review.", status: 403 };
      }
      if (!designerMayEdit(state)) {
        return {
          ok: false,
          error: state === "in_review" ? "This product is already under review." : "This product cannot be submitted right now.",
          status: 409,
        };
      }
      // The review note belongs to the previous round; clear it so the designer
      // is not still shown feedback they have already acted on.
      return { ok: true, nextState: "in_review", patch: { workflow_state: "in_review", submitted_at: now, review_note: null } };
    }

    case "request_revision": {
      if (!canReviewProducts(actor)) return { ok: false, error: "Forbidden", status: 403 };
      if (state !== "in_review" && state !== "approved") {
        return { ok: false, error: "Only a submitted or approved product can be sent back.", status: 409 };
      }
      return {
        ok: true,
        nextState: "needs_revision",
        patch: { workflow_state: "needs_revision", reviewed_at: now, reviewed_by: actor.id, review_note: note },
      };
    }

    case "approve": {
      if (!canReviewProducts(actor)) return { ok: false, error: "Forbidden", status: 403 };
      if (state !== "in_review") {
        return { ok: false, error: "Only a submitted product can be approved.", status: 409 };
      }
      return {
        ok: true,
        nextState: "approved",
        patch: { workflow_state: "approved", reviewed_at: now, reviewed_by: actor.id, review_note: note || null },
      };
    }

    case "publish": {
      if (!canPublish(actor)) return { ok: false, error: "Forbidden", status: 403 };
      if (state !== "approved" && state !== "published") {
        return { ok: false, error: "Approve the product before publishing it.", status: 409 };
      }
      return { ok: true, nextState: "published", patch: { workflow_state: "published", reviewed_at: now, reviewed_by: actor.id } };
    }

    case "unpublish": {
      if (!canPublish(actor)) return { ok: false, error: "Forbidden", status: 403 };
      return { ok: true, nextState: "approved", patch: { workflow_state: "approved" } };
    }

    case "archive": {
      if (!canReviewProducts(actor)) return { ok: false, error: "Forbidden", status: 403 };
      return { ok: true, nextState: "archived", patch: { workflow_state: "archived" } };
    }

    default:
      return { ok: false, error: "Unknown action.", status: 403 };
  }
}

/**
 * The editorial state implied by an admin changing `status` through the ordinary
 * product editor.
 *
 * `workflow_state` and `status` are separate facts, but they are not allowed to
 * contradict each other. The dashboard's product form is a SECOND door onto the
 * same decision the review queue's Publish button makes, and if only one of them
 * moves `workflow_state`, a product goes on sale while the review queue still
 * lists it as awaiting review.
 *
 * The conclusions here are deliberately identical to the `publish`, `unpublish`
 * and `archive` branches of `resolveWorkflowTransition`, so the two doors cannot
 * drift apart. Returns null when nothing needs to move.
 */
export function workflowStateForStatusChange(
  actor: Actor | null,
  existing: Record<string, any> | null,
  nextStatus: string | null | undefined,
): WorkflowState | null {
  // Only someone who may publish can move the editorial state this way. A
  // designer's `status` is overwritten by `sanitizeProductInputForActor`
  // anyway, but the check keeps the rule true on its own terms.
  if (!canPublish(actor) || !existing) return null;

  const state = workflowStateOf(existing) as WorkflowState;
  const status = String(nextStatus || "");

  if (status === "active") return state === "published" ? null : "published";
  if (status === "deleted") return state === "archived" ? null : "archived";
  // Anything else (draft, inactive) means "not on sale". Only a published
  // product has to come back, and it returns to `approved` exactly as the
  // `unpublish` action does — the review decision itself is not undone.
  return state === "published" ? "approved" : null;
}

/**
 * Strip anything a non-admin must not be able to set through the ordinary
 * product update endpoint.
 *
 * This is the backstop for §21: a designer's payload must never be able to
 * carry `workflow_state: "published"`, flip `status` to `active`, or rewrite
 * ownership. The generic update path is the widest attack surface in the whole
 * workflow, so it refuses these fields outright rather than trying to decide
 * which values are acceptable.
 */
export function sanitizeProductInputForActor(
  input: Record<string, any>,
  actor: Actor | null,
  existing: Record<string, any> | null,
): Record<string, any> {
  const next = { ...input };

  // Ownership and review metadata are server-owned for EVERYONE. Admins change
  // them through the dedicated assign/review endpoints, never by posting a
  // product body.
  delete next.createdBy;
  delete next.created_by;
  delete next.assignedDesignerId;
  delete next.assigned_designer_id;
  delete next.workflowState;
  delete next.workflow_state;
  delete next.submittedAt;
  delete next.submitted_at;
  delete next.reviewedAt;
  delete next.reviewed_at;
  delete next.reviewedBy;
  delete next.reviewed_by;
  delete next.reviewNote;
  delete next.review_note;

  if (actor?.role === "admin") return next;

  // A designer may not change publication. Keep whatever the product already
  // has so an edit cannot quietly take a product off sale either.
  next.status = existing?.status && existing.status !== "active" ? existing.status : "draft";
  next.visibility = existing?.visibility || "public";
  delete next.publishedAt;
  delete next.published_at;
  delete next.deletedAt;
  delete next.deleted_at;
  delete next.featured;
  delete next.isFeatured;
  delete next.isBestSeller;
  delete next.isNewArrival;
  delete next.isNew;

  return next;
}

