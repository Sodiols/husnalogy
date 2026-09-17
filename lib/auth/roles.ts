/**
 * Husnalogy's capability layer.
 *
 * There are three application roles — `customer`, `designer`, `admin` — and the
 * `designer` role previously existed ONLY as a value in the `profiles.role`
 * check constraint. No application code read it, and the single guard
 * (`requireAdmin`) rejected anything that was not an admin, so a designer had
 * no access at all.
 *
 * The temptation when adding one is to widen `requireAdmin` to accept designers
 * too. That is precisely the thing not to do: it makes "can open the design
 * builder" and "can read every customer's order" the same permission. Instead
 * every sensitive operation names the CAPABILITY it needs, and this module is
 * the only place a role is turned into capabilities. Adding a fourth role later
 * is then a change to one file rather than a hunt for `role === "..."` across
 * the codebase.
 *
 * Two rules this module exists to enforce:
 *
 *   1. A designer is a PRODUCTION CONTENT role, not an administrator. They
 *      create products and designs; they never publish, never see orders,
 *      customers, revenue or settings, and never manage users.
 *   2. Authorization is decided on the SERVER from the session, never from
 *      anything the browser sends. A product id in a URL is a request, not a
 *      permission — ownership is re-read from the database every time.
 */

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export type AppRole = "customer" | "designer" | "admin";

export type Actor = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
};

/** Product workflow states (spec §9). */
export const PRODUCT_WORKFLOW_STATES = [
  "draft",
  "in_review",
  "needs_revision",
  "approved",
  "published",
  "archived",
] as const;
export type ProductWorkflowState = (typeof PRODUCT_WORKFLOW_STATES)[number];

export function normalizeRole(value: unknown): AppRole {
  const role = String(value || "").toLowerCase();
  return role === "admin" || role === "designer" ? role : "customer";
}

/**
 * The signed-in actor, or null.
 *
 * Reads the role from `profiles`, never from the JWT body or a client header —
 * a token can be replayed, and profile role changes must take effect at once.
 */
export async function getCurrentActor(): Promise<Actor | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,email,full_name,role")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: profile?.email || user.email || "",
    name: profile?.full_name || user.email?.split("@")[0] || "User",
    role: normalizeRole(profile?.role),
  };
}

/**
 * Where a role's work lives.
 *
 * Centralised so the post-login redirect does not carry its own role knowledge:
 * sending a designer to `/admin/dashboard` is what produced a 404 on every
 * designer sign-in before this existed.
 */
export function homePathForRole(role: AppRole): string {
  if (role === "admin") return "/admin/dashboard";
  if (role === "designer") return "/designer";
  return "/";
}

/** Is this path part of a workspace the role may not open at all? */
export function isForbiddenWorkspacePath(role: AppRole, path: string): boolean {
  if (path.startsWith("/admin")) return role !== "admin";
  if (path.startsWith("/designer")) return role !== "designer" && role !== "admin";
  return false;
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                               */
/* -------------------------------------------------------------------------- */

const isAdmin = (actor: Actor | null): boolean => actor?.role === "admin";
const isDesigner = (actor: Actor | null): boolean => actor?.role === "designer";

/** Open the design builder and the product authoring surfaces at all. */
export const canAccessStudio = (actor: Actor | null): boolean => isAdmin(actor) || isDesigner(actor);

/** Create a new product draft. */
export const canCreateProduct = (actor: Actor | null): boolean => isAdmin(actor) || isDesigner(actor);

/**
 * Make a design or a product PUBLIC. Admin only, without exception — this is
 * the gate the whole review workflow exists to protect.
 */
export const canPublish = (actor: Actor | null): boolean => isAdmin(actor);

/** Move a product through the review workflow on the admin's side. */
export const canReviewProducts = (actor: Actor | null): boolean => isAdmin(actor);

/**
 * See the element library the way a producer does — license verdicts on blocked
 * collections, and imports that land in the permanent shared library.
 *
 * Designers build that library too, so this is studio access rather than
 * administration. Named explicitly so the two Iconify routes stop deciding it
 * with their own `role === "admin"` comparison.
 */
export const canUseLibraryProducerAudience = (actor: Actor | null): boolean => canAccessStudio(actor);

/** Business administration. None of it is ever a designer capability. */
export const canManageOrders = (actor: Actor | null): boolean => isAdmin(actor);
export const canManageCustomers = (actor: Actor | null): boolean => isAdmin(actor);
export const canManageSettings = (actor: Actor | null): boolean => isAdmin(actor);
export const canManageUsers = (actor: Actor | null): boolean => isAdmin(actor);
export const canViewRevenue = (actor: Actor | null): boolean => isAdmin(actor);
export const canManageBackups = (actor: Actor | null): boolean => isAdmin(actor);
export const canDeletePermanently = (actor: Actor | null): boolean => isAdmin(actor);
export const canArchiveProduct = (actor: Actor | null): boolean => isAdmin(actor);
export const canAssignDesigner = (actor: Actor | null): boolean => isAdmin(actor);
export const canManageRenderJobs = (actor: Actor | null): boolean => isAdmin(actor);

/** The minimum a product row needs for an ownership decision. */
export type OwnableProduct = {
  id?: string;
  createdBy?: string | null;
  created_by?: string | null;
  assignedDesignerId?: string | null;
  assigned_designer_id?: string | null;
  workflowState?: string | null;
  workflow_state?: string | null;
};

const createdBy = (product: OwnableProduct | null): string =>
  String(product?.createdBy ?? product?.created_by ?? "");
const assignedTo = (product: OwnableProduct | null): string =>
  String(product?.assignedDesignerId ?? product?.assigned_designer_id ?? "");
export const workflowStateOf = (product: OwnableProduct | null): string =>
  String(product?.workflowState ?? product?.workflow_state ?? "draft");

/**
 * May this actor edit this product?
 *
 * A designer may edit a product they created, or one an admin explicitly
 * assigned to them — and only while it is theirs to work on. A product that has
 * been approved or published is out of the designer's hands: editing it would
 * change work the admin has already signed off. They get it back only when an
 * admin sends it for revision.
 */
export function canEditProduct(actor: Actor | null, product: OwnableProduct | null): boolean {
  if (!actor || !product) return false;
  if (isAdmin(actor)) return true;
  if (!isDesigner(actor)) return false;

  const owns = createdBy(product) === actor.id || assignedTo(product) === actor.id;
  if (!owns) return false;

  const state = workflowStateOf(product);
  return state === "draft" || state === "needs_revision" || state === "in_review";
}

/** May this actor open the design builder for this product? Same rule. */
export const canDesignProduct = canEditProduct;

/** May this actor SUBMIT this product for admin review? */
export function canSubmitForReview(actor: Actor | null, product: OwnableProduct | null): boolean {
  if (!canEditProduct(actor, product)) return false;
  const state = workflowStateOf(product);
  return state === "draft" || state === "needs_revision";
}

/** May this actor see this product in their own workspace listing? */
export function canViewProduct(actor: Actor | null, product: OwnableProduct | null): boolean {
  if (!actor || !product) return false;
  if (isAdmin(actor)) return true;
  if (!isDesigner(actor)) return false;
  return createdBy(product) === actor.id || assignedTo(product) === actor.id;
}

/* -------------------------------------------------------------------------- */
/* Route guards                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Guard results.
 *
 * The optional counterpart members are deliberate: this project compiles with
 * `strict: false`, which turns OFF discriminated-union narrowing on literal
 * booleans, so `if (!guard.ok) return guard.response` would not type-check
 * against a clean two-member union. Declaring both sides of each shape keeps
 * every call site readable and matches how `requireAdmin` already behaves.
 */
export type GuardFailure = { ok: false; response: Response; actor?: undefined; product?: undefined };
export type ActorSuccess = { ok: true; actor: Actor; response?: undefined };

function deny(status: 401 | 403, error: string): GuardFailure {
  return { ok: false, response: Response.json({ ok: false, error }, { status }) };
}

/**
 * Any signed-in actor holding the given capability.
 *
 * 401 when there is no session at all and 403 when there is one without the
 * capability, so a designer probing an admin route learns only that it is
 * forbidden — never whether it exists or what it holds.
 */
export async function requireCapability(
  capability: (actor: Actor | null) => boolean,
  message = "Forbidden",
): Promise<ActorSuccess | GuardFailure> {
  const actor = await getCurrentActor();
  if (!actor) return deny(401, "Unauthorized");
  if (!capability(actor)) return deny(403, message);
  return { ok: true, actor };
}

/** Designer OR admin — the product/design authoring surfaces. */
export async function requireDesignerOrAdmin(): Promise<ActorSuccess | GuardFailure> {
  return requireCapability(canAccessStudio, "Design studio access is required.");
}

/**
 * Authorization for one specific product, re-read from the database.
 *
 * The product id arrives from the browser, so it is treated as a request and
 * nothing more: the row is loaded server side and ownership is checked against
 * the session. A designer cannot reach another designer's product by guessing
 * or editing an id.
 */
export async function requireProductEditor(
  productId: string,
): Promise<(ActorSuccess & { product: Record<string, any> }) | GuardFailure> {
  const actor = await getCurrentActor();
  if (!actor) return deny(401, "Unauthorized");
  if (!canAccessStudio(actor)) return deny(403, "Design studio access is required.");

  const id = String(productId || "").trim();
  if (!id) return deny(403, "Forbidden");

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("products")
    .select("id,created_by,assigned_designer_id,workflow_state,status")
    .eq("id", id)
    .maybeSingle();

  // A product a designer may not touch is reported exactly like one that does
  // not exist, so the endpoint cannot be used to enumerate the catalog.
  if (!data) return deny(403, "Forbidden");
  if (!canEditProduct(actor, data as OwnableProduct)) return deny(403, "Forbidden");

  return { ok: true, actor, product: data as Record<string, any> };
}
