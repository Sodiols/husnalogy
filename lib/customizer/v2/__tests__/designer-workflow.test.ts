// The product review workflow, and the wiring that makes it real (spec §29).
//
// The capability layer has always been correct; what was missing was that
// nothing used it. These tests cover the two halves of the fix:
//
//   1. the pure transition rules (`resolveWorkflowTransition`) — who may move a
//      product where, and from which state;
//   2. the STRUCTURAL wiring — that the routes a designer needs really did stop
//      demanding an admin, that the ones they must never reach did not, and
//      that the ordinary product endpoint cannot be used to escape review.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  designerMayEdit,
  resolveWorkflowTransition,
  sanitizeProductInputForActor,
  workflowStateForStatusChange,
  WORKFLOW_STATES,
  type WorkflowState,
} from "@/lib/products/workflow";
import { homePathForRole, isForbiddenWorkspacePath, type Actor } from "@/lib/auth/roles";

const admin: Actor = { id: "admin-1", email: "a@h.com", name: "Admin", role: "admin" };
const designer: Actor = { id: "des-1", email: "d@h.com", name: "Designer", role: "designer" };
const otherDesigner: Actor = { id: "des-2", email: "d2@h.com", name: "Other", role: "designer" };

const product = (state: WorkflowState, extra: Record<string, unknown> = {}) => ({
  id: "prod-1",
  status: "draft",
  created_by: "des-1",
  assigned_designer_id: null,
  workflow_state: state,
  ...extra,
});

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

/* -------------------------------------------------------------------------- */
/* The pipeline, end to end                                                   */
/* -------------------------------------------------------------------------- */

describe("the full designer → admin → published pipeline", () => {
  it("runs the whole happy path in order", () => {
    // draft --submit--> in_review
    const submitted = resolveWorkflowTransition("submit", designer, product("draft"));
    expect(submitted.ok).toBe(true);
    expect(submitted.nextState).toBe("in_review");
    expect(submitted.patch!.submitted_at).toBeTruthy();

    // in_review --request_revision--> needs_revision (with a note)
    const returned = resolveWorkflowTransition("request_revision", admin, product("in_review"), {
      note: "Please enlarge the names.",
    });
    expect(returned.nextState).toBe("needs_revision");
    expect(returned.patch!.review_note).toBe("Please enlarge the names.");
    expect(returned.patch!.reviewed_by).toBe("admin-1");

    // needs_revision --submit--> in_review, and the stale note is cleared
    const resubmitted = resolveWorkflowTransition("submit", designer, product("needs_revision"));
    expect(resubmitted.nextState).toBe("in_review");
    expect(resubmitted.patch!.review_note).toBeNull();

    // in_review --approve--> approved
    const approved = resolveWorkflowTransition("approve", admin, product("in_review"));
    expect(approved.nextState).toBe("approved");
    expect(approved.patch!.reviewed_at).toBeTruthy();

    // approved --publish--> published
    const published = resolveWorkflowTransition("publish", admin, product("approved"));
    expect(published.nextState).toBe("published");
  });

  it("locks the designer out while the work is with the admin", () => {
    expect(designerMayEdit("draft")).toBe(true);
    expect(designerMayEdit("needs_revision")).toBe(true);
    expect(designerMayEdit("in_review")).toBe(false);
    expect(designerMayEdit("approved")).toBe(false);
    expect(designerMayEdit("published")).toBe(false);
    expect(designerMayEdit("archived")).toBe(false);
  });

  it("refuses a second submission with a state error, not a permission error", () => {
    const again = resolveWorkflowTransition("submit", designer, product("in_review"));
    expect(again.ok).toBe(false);
    expect(again.status).toBe(409);
    expect(again.error).toContain("already under review");
  });

  it("refuses to publish something that was never approved", () => {
    const early = resolveWorkflowTransition("publish", admin, product("in_review"));
    expect(early.ok).toBe(false);
    expect(early.status).toBe(409);
    expect(early.error).toContain("Approve the product");
  });

  it("refuses to approve something that was never submitted", () => {
    expect(resolveWorkflowTransition("approve", admin, product("draft")).status).toBe(409);
  });
});

describe("a designer can only ever perform ONE transition", () => {
  const adminOnly = ["request_revision", "approve", "publish", "unpublish", "archive"] as const;

  for (const action of adminOnly) {
    it(`is refused ${action} with 403`, () => {
      for (const state of WORKFLOW_STATES) {
        const result = resolveWorkflowTransition(action, designer, product(state));
        expect(result.ok, `${action} from ${state}`).toBe(false);
        expect(result.status, `${action} from ${state}`).toBe(403);
      }
    });
  }

  it("cannot submit another designer's product", () => {
    const result = resolveWorkflowTransition("submit", otherDesigner, product("draft"));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("cannot act at all without a session", () => {
    expect(resolveWorkflowTransition("submit", null, product("draft")).status).toBe(403);
    expect(resolveWorkflowTransition("publish", null, product("approved")).status).toBe(403);
  });
});

/* -------------------------------------------------------------------------- */
/* §21 — the generic update endpoint cannot be used to escape review          */
/* -------------------------------------------------------------------------- */

describe("the ordinary product payload cannot move a product", () => {
  const hostile = {
    title: "Nice card",
    workflow_state: "published",
    workflowState: "published",
    status: "active",
    created_by: "someone-else",
    createdBy: "someone-else",
    assigned_designer_id: "des-2",
    reviewed_by: "admin-1",
    review_note: "I approve myself",
    publishedAt: "2020-01-01",
    featured: true,
  };

  it("strips workflow and ownership from a DESIGNER payload", () => {
    const clean = sanitizeProductInputForActor(hostile, designer, { status: "draft", visibility: "public" });
    for (const key of [
      "workflow_state",
      "workflowState",
      "created_by",
      "createdBy",
      "assigned_designer_id",
      "reviewed_by",
      "review_note",
      "publishedAt",
      "featured",
    ]) {
      expect(clean, key).not.toHaveProperty(key);
    }
    // Publication is forced back to a non-public value.
    expect(clean.status).toBe("draft");
    expect(clean.title).toBe("Nice card");
  });

  it("strips workflow and ownership from an ADMIN payload too", () => {
    // Admins move products through the dedicated endpoints, so the product body
    // is never the route for it — otherwise there would be two ways to change
    // state and only one of them audited.
    const clean = sanitizeProductInputForActor(hostile, admin, { status: "active" });
    expect(clean).not.toHaveProperty("workflow_state");
    expect(clean).not.toHaveProperty("created_by");
    expect(clean).not.toHaveProperty("review_note");
    // An admin keeps control of publication through the normal form.
    expect(clean.status).toBe("active");
    expect(clean.featured).toBe(true);
  });

  it("never lets a designer take a live product off sale by editing it", () => {
    const clean = sanitizeProductInputForActor({ title: "x", status: "deleted" }, designer, { status: "active" });
    expect(clean.status).toBe("draft");
  });
});

/* -------------------------------------------------------------------------- */
/* §8 — sign-in lands in a workspace that exists                              */
/* -------------------------------------------------------------------------- */

describe("post-login destination", () => {
  it("sends each role somewhere it can actually open", () => {
    expect(homePathForRole("admin")).toBe("/admin/dashboard");
    expect(homePathForRole("designer")).toBe("/designer");
    expect(homePathForRole("customer")).toBe("/");
  });

  it("refuses a workspace the role may not open", () => {
    expect(isForbiddenWorkspacePath("designer", "/admin/dashboard/orders")).toBe(true);
    expect(isForbiddenWorkspacePath("customer", "/designer")).toBe(true);
    expect(isForbiddenWorkspacePath("designer", "/designer")).toBe(false);
    expect(isForbiddenWorkspacePath("admin", "/designer")).toBe(false);
    expect(isForbiddenWorkspacePath("customer", "/products")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Structural wiring — the part that was actually missing                     */
/* -------------------------------------------------------------------------- */

describe("the routes a designer needs no longer demand an admin", () => {
  const cases: Array<[string, string]> = [
    ["app/api/admin/products/route.ts", "requireDesignerOrAdmin"],
    ["app/api/admin/products/route.ts", "requireCapability"],
    ["app/api/admin/products/[id]/route.ts", "requireProductEditor"],
    ["app/api/admin/uploads/route.ts", "requireDesignerOrAdmin"],
    ["app/api/admin/customizer/assets/route.ts", "requireDesignerOrAdmin"],
    ["app/api/admin/customizer/feature-flags/[productId]/route.ts", "requireProductEditor"],
    ["app/api/admin/customizer/mockups/[productId]/route.ts", "requireProductEditor"],
    ["app/api/admin/customizer/templates/[productId]/versions/route.ts", "requireProductEditor"],
  ];

  for (const [file, guard] of cases) {
    it(`${file} uses ${guard}`, () => {
      expect(read(file)).toContain(guard);
    });
  }

  it("creates products with server-derived ownership", () => {
    const source = read("app/api/admin/products/route.ts");
    expect(source).toContain("createProduct(body, { actor: session.actor })");
  });

  it("scopes the product list to what the actor may see", () => {
    expect(read("app/api/admin/products/route.ts")).toContain("canViewProduct(session.actor, product)");
  });
});

describe("the routes a designer must never reach still demand an admin", () => {
  const adminOnly = [
    "app/api/admin/customizer/templates/[productId]/publish/route.ts",
    "app/api/admin/customizer/mockups/[productId]/publish/route.ts",
    "app/api/admin/products/[id]/permanent-delete/route.ts",
    "app/api/admin/order-requests/route.ts",
    "app/api/admin/settings/route.ts",
    "app/api/admin/customizer/render/process/route.ts",
  ];

  for (const file of adminOnly) {
    it(`${file} is admin-only`, () => {
      const source = read(file);
      expect(source).toContain("requireAdmin");
      expect(source, "must not have been opened to the studio").not.toContain("requireDesignerOrAdmin");
    });
  }

  it("keeps DELETE (archive) on the product route admin-only", () => {
    const source = read("app/api/admin/products/[id]/route.ts");
    const deleteBody = source.slice(source.indexOf("export async function DELETE"));
    expect(deleteBody).toContain("requireAdmin");
  });
});

describe("the workflow endpoint is the only door to a state change", () => {
  const source = read("app/api/admin/products/[id]/workflow/route.ts");

  it("delegates every decision to the pure transition rules", () => {
    expect(source).toContain("resolveWorkflowTransition(action, actor, product");
  });

  it("re-reads the product rather than trusting the request", () => {
    expect(source).toContain('.from("products")');
    expect(source).toContain(".eq(\"id\", String(id || \"\"))");
  });

  it("only makes a product public on a publish transition", () => {
    expect(source).toContain('if (decision.nextState === "published")');
    expect(source).toContain('patch.status = "active"');
  });

  it("restricts assignment to admins and to real designers", () => {
    expect(source).toContain("canReviewProducts(actor)");
    expect(source).toContain('profile.role !== "designer"');
  });
});

describe("the designer workspace is its own surface", () => {
  const page = read("app/designer/page.tsx");
  const client = read("app/designer/designer-workspace-client.tsx");

  it("guards on studio access and hides itself from everyone else", () => {
    expect(page).toContain("canAccessStudio(actor)");
    expect(page).toContain("notFound()");
  });

  it("reuses the admin product form rather than duplicating it", () => {
    expect(client).toContain("@/app/admin/dashboard/product-upload-form");
  });

  it("offers no business administration navigation at all", () => {
    for (const forbidden of ["Orders", "Customers", "Revenue", "Settings", "Users", "Backups", "Render"]) {
      expect(client, `designer workspace must not link to ${forbidden}`).not.toContain(`>${forbidden}<`);
    }
  });

  it("submits through the workflow endpoint, never by posting a state", () => {
    expect(client).toContain('action: "submit"');
    expect(client).toContain("/workflow");
  });
});

describe("the two publish doors reach the same conclusion", () => {
  // The dashboard product form publishes by PUTting `status: "active"`, while
  // the review queue posts `action: "publish"`. When only the second one moved
  // `workflow_state`, an admin could put a designer's product on sale and still
  // find it sitting in "Awaiting review".
  const live = (state: WorkflowState) => product(state, { status: "active" });
  const offSale = (state: WorkflowState) => product(state, { status: "draft" });

  it("publishes the editorial state when an admin puts a product on sale", () => {
    expect(workflowStateForStatusChange(admin, offSale("in_review"), "active")).toBe("published");
    expect(workflowStateForStatusChange(admin, offSale("approved"), "active")).toBe("published");
    expect(workflowStateForStatusChange(admin, offSale("needs_revision"), "active")).toBe("published");
  });

  it("agrees with resolveWorkflowTransition on an approved product", () => {
    const viaQueue = resolveWorkflowTransition("publish", admin, product("approved"));
    expect(viaQueue.ok).toBe(true);
    expect(workflowStateForStatusChange(admin, offSale("approved"), "active")).toBe(viaQueue.nextState);
  });

  it("returns a product to approved when an admin takes it off sale", () => {
    expect(workflowStateForStatusChange(admin, live("published"), "draft")).toBe("approved");
    expect(workflowStateForStatusChange(admin, live("published"), "draft")).toBe(
      resolveWorkflowTransition("unpublish", admin, product("published")).nextState,
    );
  });

  it("archives rather than unpublishes when the status becomes deleted", () => {
    expect(workflowStateForStatusChange(admin, live("published"), "deleted")).toBe("archived");
  });

  it("moves nothing when an ordinary edit leaves publication alone", () => {
    expect(workflowStateForStatusChange(admin, live("published"), "active")).toBeNull();
    expect(workflowStateForStatusChange(admin, offSale("in_review"), "draft")).toBeNull();
    expect(workflowStateForStatusChange(admin, offSale("draft"), "draft")).toBeNull();
  });

  it("never lets a designer publish through the ordinary update path", () => {
    expect(workflowStateForStatusChange(designer, offSale("draft"), "active")).toBeNull();
    expect(workflowStateForStatusChange(null, offSale("draft"), "active")).toBeNull();
    // and their payload could not carry the status in the first place
    expect(sanitizeProductInputForActor({ status: "active" }, designer, offSale("draft")).status).not.toBe("active");
  });

  it("is applied by the one update path every product edit goes through", () => {
    const products = read("lib/products/index.ts");
    expect(products).toContain("workflowStateForStatusChange(actor, products[index], product.status)");
    expect(products).toContain("row.workflow_state = nextWorkflowState");
  });
});
