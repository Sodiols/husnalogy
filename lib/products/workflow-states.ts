/**
 * The workflow vocabulary, with NO imports.
 *
 * Client components (the designer workspace, the admin review queue) need the
 * state names, their labels, and "may a designer still edit this". Importing
 * those from `./workflow` would drag in `lib/auth/roles` and, through it,
 * `lib/supabase/server` — which uses `next/headers` and cannot be bundled for
 * the browser. Keeping the vocabulary dependency-free is what lets one
 * definition serve both sides.
 */

export type WorkflowState =
  | "draft"
  | "in_review"
  | "needs_revision"
  | "approved"
  | "published"
  | "archived";

export const WORKFLOW_STATES: readonly WorkflowState[] = [
  "draft",
  "in_review",
  "needs_revision",
  "approved",
  "published",
  "archived",
];

export function isWorkflowState(value: unknown): value is WorkflowState {
  return WORKFLOW_STATES.includes(String(value) as WorkflowState);
}

/** States in which a DESIGNER may still change the product. */
const DESIGNER_EDITABLE: readonly WorkflowState[] = ["draft", "needs_revision"];

/**
 * Can a designer still edit, in the sense the UI should present?
 *
 * `canEditProduct` in the capability layer also admits `in_review`, so a
 * submission sitting in the queue does not become unreachable if an admin never
 * looks at it. This is the tighter, product-facing answer: once submitted,
 * hands off until the admin responds.
 */
export function designerMayEdit(state: string): boolean {
  return DESIGNER_EDITABLE.includes(state as WorkflowState);
}

/** Human labels for the workspace and the review queue. */
export const WORKFLOW_LABELS: Record<WorkflowState, string> = {
  draft: "Draft",
  in_review: "In review",
  needs_revision: "Needs revision",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};
