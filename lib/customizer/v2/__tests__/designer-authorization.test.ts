// Designer/Admin authorization boundary (spec §2–§8, §30, §31).
//
// The `designer` role existed only as a value in the `profiles.role` check
// constraint — no application code read it, and the single guard
// (`requireAdmin`) rejected everything that was not an admin.
//
// The dangerous way to add one is to widen `requireAdmin` so designers pass it
// too, which makes "can open the design builder" and "can read every customer's
// order" the same permission. These tests pin the opposite: capabilities are
// named individually, a designer holds only the production-content ones, and
// ownership is decided from the database row rather than from anything the
// browser sent.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  canAccessStudio,
  canArchiveProduct,
  canAssignDesigner,
  canCreateProduct,
  canDeletePermanently,
  canDesignProduct,
  canEditProduct,
  canManageBackups,
  canManageCustomers,
  canManageOrders,
  canManageRenderJobs,
  canManageSettings,
  canManageUsers,
  canPublish,
  canReviewProducts,
  canSubmitForReview,
  canViewProduct,
  canViewRevenue,
  normalizeRole,
  workflowStateOf,
  type Actor,
} from "@/lib/auth/roles";

const admin: Actor = { id: "admin-1", email: "a@h.com", name: "Admin", role: "admin" };
const designer: Actor = { id: "des-1", email: "d@h.com", name: "Designer", role: "designer" };
const otherDesigner: Actor = { id: "des-2", email: "d2@h.com", name: "Other", role: "designer" };
const customer: Actor = { id: "cus-1", email: "c@h.com", name: "Customer", role: "customer" };

const product = (extra: Record<string, unknown> = {}) => ({
  id: "prod-1",
  created_by: "des-1",
  assigned_designer_id: null,
  workflow_state: "draft",
  ...extra,
});

/* -------------------------------------------------------------------------- */

describe("role normalization", () => {
  it("recognises exactly three roles and defaults to customer", () => {
    expect(normalizeRole("admin")).toBe("admin");
    expect(normalizeRole("designer")).toBe("designer");
    expect(normalizeRole("customer")).toBe("customer");
    // Anything unexpected is the LEAST privileged role, never the most.
    expect(normalizeRole("superuser")).toBe("customer");
    expect(normalizeRole(null)).toBe("customer");
    expect(normalizeRole(undefined)).toBe("customer");
    expect(normalizeRole({ role: "admin" })).toBe("customer");
  });
});

describe("what a designer CAN do", () => {
  it("reaches the studio and creates product drafts", () => {
    expect(canAccessStudio(designer)).toBe(true);
    expect(canCreateProduct(designer)).toBe(true);
  });

  it("edits and designs a product they created", () => {
    expect(canEditProduct(designer, product())).toBe(true);
    expect(canDesignProduct(designer, product())).toBe(true);
  });

  it("edits a product an admin assigned to them", () => {
    const assigned = product({ created_by: "someone-else", assigned_designer_id: "des-1" });
    expect(canEditProduct(designer, assigned)).toBe(true);
  });

  it("submits their own draft for review", () => {
    expect(canSubmitForReview(designer, product({ workflow_state: "draft" }))).toBe(true);
    expect(canSubmitForReview(designer, product({ workflow_state: "needs_revision" }))).toBe(true);
  });

  it("gets a product back when an admin asks for revisions", () => {
    expect(canEditProduct(designer, product({ workflow_state: "needs_revision" }))).toBe(true);
  });
});

describe("what a designer CANNOT do", () => {
  const forbidden: Array<[string, (actor: Actor | null) => boolean]> = [
    ["publish", canPublish],
    ["review products", canReviewProducts],
    ["manage orders", canManageOrders],
    ["manage customers", canManageCustomers],
    ["manage settings", canManageSettings],
    ["manage users", canManageUsers],
    ["view revenue", canViewRevenue],
    ["manage backups", canManageBackups],
    ["delete permanently", canDeletePermanently],
    ["archive products", canArchiveProduct],
    ["assign designers", canAssignDesigner],
    ["manage render jobs", canManageRenderJobs],
  ];

  for (const [name, capability] of forbidden) {
    it(`cannot ${name}`, () => {
      expect(capability(designer)).toBe(false);
      // ...and an admin can, so the capability is not simply always false.
      expect(capability(admin)).toBe(true);
    });
  }

  it("cannot touch another designer's unassigned product", () => {
    expect(canEditProduct(otherDesigner, product())).toBe(false);
    expect(canDesignProduct(otherDesigner, product())).toBe(false);
    expect(canViewProduct(otherDesigner, product())).toBe(false);
    expect(canSubmitForReview(otherDesigner, product())).toBe(false);
  });

  it("cannot edit their own product once it is approved or published", () => {
    // Editing signed-off work would change what the admin approved.
    expect(canEditProduct(designer, product({ workflow_state: "approved" }))).toBe(false);
    expect(canEditProduct(designer, product({ workflow_state: "published" }))).toBe(false);
    expect(canEditProduct(designer, product({ workflow_state: "archived" }))).toBe(false);
  });

  it("cannot re-submit something already under review or approved", () => {
    expect(canSubmitForReview(designer, product({ workflow_state: "in_review" }))).toBe(false);
    expect(canSubmitForReview(designer, product({ workflow_state: "approved" }))).toBe(false);
  });
});

describe("a customer holds no production capability at all", () => {
  it("cannot reach the studio or any admin capability", () => {
    expect(canAccessStudio(customer)).toBe(false);
    expect(canCreateProduct(customer)).toBe(false);
    expect(canEditProduct(customer, product({ created_by: "cus-1" }))).toBe(false);
    expect(canPublish(customer)).toBe(false);
    expect(canManageOrders(customer)).toBe(false);
  });

  it("treats an absent session as a customer, not as a bypass", () => {
    expect(canAccessStudio(null)).toBe(false);
    expect(canEditProduct(null, product())).toBe(false);
    expect(canPublish(null)).toBe(false);
  });
});

describe("admin holds everything", () => {
  it("edits, designs and publishes any product in any state", () => {
    for (const state of ["draft", "in_review", "needs_revision", "approved", "published", "archived"]) {
      expect(canEditProduct(admin, product({ created_by: "des-2", workflow_state: state })), state).toBe(true);
    }
    expect(canPublish(admin)).toBe(true);
    expect(canViewProduct(admin, product({ created_by: "des-2" }))).toBe(true);
  });
});

describe("ownership is read from the row, in either naming convention", () => {
  it("accepts snake_case database rows and camelCase application objects", () => {
    expect(canEditProduct(designer, { createdBy: "des-1", workflowState: "draft" })).toBe(true);
    expect(canEditProduct(designer, { assignedDesignerId: "des-1", workflowState: "draft" })).toBe(true);
    expect(workflowStateOf({ workflow_state: "in_review" })).toBe("in_review");
    expect(workflowStateOf({ workflowState: "approved" })).toBe("approved");
    // A row with no state at all is a draft, the least privileged reading.
    expect(workflowStateOf({})).toBe("draft");
  });

  it("refuses a product that does not exist", () => {
    expect(canEditProduct(designer, null)).toBe(false);
    expect(canViewProduct(designer, null)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Structural guarantee: the admin surface stays admin-only                   */
/* -------------------------------------------------------------------------- */

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts" || entry === "route.tsx") out.push(full);
  }
  return out;
}

describe("every admin API route is guarded", () => {
  const routes = routeFiles(path.join(process.cwd(), "app/api/admin"));

  it("finds the admin route surface", () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it("guards each one with an explicit admin-level check", () => {
    // This is the structural half of §31: a designer cannot reach business
    // administration by calling the API directly, because every route under
    // /api/admin demands an admin-level guard before it does anything. A new
    // unguarded route fails this test the moment it is added.
    // Logout is deliberately unguarded: it ends whatever session is present,
    // and requiring a privileged session to sign out would strand anyone whose
    // role changed while they were signed in.
    const exempt = new Set(["app/api/admin/logout/route.ts"]);
    const unguarded = routes.filter((file) => {
      if (exempt.has(path.relative(process.cwd(), file).split(path.sep).join("/"))) return false;
      const source = readFileSync(file, "utf8");
      const namedGuard =
        source.includes("requireAdmin") ||
        source.includes("requireCapability") ||
        source.includes("requireProductEditor") ||
        source.includes("requireDesignerOrAdmin");
      // A route whose permission depends on the REQUESTED ACTION (the workflow
      // endpoint: submit vs approve vs publish) cannot pick a guard up front.
      // It resolves the session itself and then asks the capability layer — which
      // is still an explicit server-side check, so it counts, but only when a
      // capability is genuinely consulted.
      const resolvedGuard =
        source.includes("getCurrentActor") && /can[A-Z]\w*\(|resolveWorkflowTransition\(/.test(source);
      return !(namedGuard || resolvedGuard);
    });
    expect(unguarded.map((file) => path.relative(process.cwd(), file))).toEqual([]);
  });

  it("never lets a studio-level guard stand alone on a business route", () => {
    // `requireDesignerOrAdmin` is a STUDIO guard. If it ever appears on orders,
    // settings, users, revenue or backups it has been used as an admin guard by
    // mistake, which is exactly the widening this layer exists to prevent.
    const businessAreas = ["orders", "settings", "newsletter", "contact-messages", "order-requests"];
    const leaked = routes.filter((file) => {
      const relative = path.relative(process.cwd(), file).replace(/\\/g, "/");
      if (!businessAreas.some((area) => relative.includes(`/${area}`))) return false;
      const source = readFileSync(file, "utf8");
      return source.includes("requireDesignerOrAdmin") && !source.includes("requireAdmin");
    });
    expect(leaked.map((file) => path.relative(process.cwd(), file))).toEqual([]);
  });
});

describe("the capability layer is the only place roles are interpreted", () => {
  it("does not scatter raw role comparisons through the API surface", () => {
    // Centralising this is what makes the boundary auditable: one file decides
    // what a role means, rather than dozens of string comparisons that drift.
    const offenders: string[] = [];
    for (const file of routeFiles(path.join(process.cwd(), "app/api"))) {
      const source = readFileSync(file, "utf8");
      if (/role\s*===\s*["'](designer|admin)["']/.test(source)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
