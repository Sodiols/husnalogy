/**
 * Role-aware post-login routing, shared by every sign-in path.
 *
 * This module is deliberately free of server imports so the browser login
 * forms (email/password, the auth modal, the implicit-flow finish page) and the
 * server OAuth callback resolve a destination with the SAME function. Before it
 * existed the email/password path only knew about admins, so a designer signing
 * in with a password landed on the storefront while the same designer signing in
 * with Google landed in /designer.
 *
 * Routing is a convenience, not authorization: every workspace page and API
 * route still re-checks the role server side.
 */

export type AppRole = "customer" | "designer" | "admin";

export function normalizeRole(value: unknown): AppRole {
  const role = String(value || "").toLowerCase();
  return role === "admin" || role === "designer" ? role : "customer";
}

/** Where a role's work lives. */
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

/** Same-origin relative path only; never an auth page, never protocol-relative. */
export function getSafeRedirectPath(value: unknown = "/"): string {
  const next = String(value || "/");
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  // The URL parser (and every browser) silently drops tabs/newlines and treats
  // "\" as "/", so "/\t/evil.com" would become "//evil.com". Refuse those
  // characters outright, then let the real parser confirm the result stays on
  // this origin.
  if (/[\u0000-\u001F\u007F\\]/.test(next)) return "/";
  let parsed: URL;
  try {
    parsed = new URL(next, "https://same-origin.invalid");
  } catch {
    return "/";
  }
  if (parsed.origin !== "https://same-origin.invalid") return "/";
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (path.startsWith("/login") || path.startsWith("/signup")) return "/";
  return path;
}

/**
 * The destination after a successful sign-in.
 *
 * - admin    → an explicit admin/designer/storefront `next`, else /admin/dashboard
 * - designer → an explicit `next` they may open, else /designer
 * - customer → the requested storefront page, else /; never a workspace
 *
 * `role` is null when it could not be read; that is treated as a customer so a
 * lookup failure can never route anyone into a privileged area.
 */
export function resolvePostLoginPath(role: AppRole | null | undefined, next: unknown = "/"): string {
  const safePath = getSafeRedirectPath(next);
  const effectiveRole = role ? normalizeRole(role) : "customer";
  const home = homePathForRole(effectiveRole);

  if (isForbiddenWorkspacePath(effectiveRole, safePath)) return home;
  if (safePath === "/") return home;
  return safePath;
}
