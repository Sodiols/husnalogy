/**
 * proxy.js — BEHAVIOUR, not source strings: which paths the proxy actually
 * runs on (the real `config.matcher`, evaluated by Next's own matcher), and
 * what it answers for each kind of visitor.
 *
 * The Design Studio's phone upload page used to be listed as protected while
 * the matcher never ran the proxy on it — a string check on the list passed
 * while the protection did not exist.
 */
import { NextRequest } from "next/server";
import { getRedirectUrl, isRewrite, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const visitor: { user: { id: string } | null; role: string | null } = { user: null, role: null };

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: visitor.user } }) },
    from: () => {
      const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: visitor.role ? { role: visitor.role } : null }) };
      return chain;
    },
  }),
}));

let proxy: (request: NextRequest) => Promise<Response>;
let config: { matcher: string[] };

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= "publishable-test-key";
  ({ proxy, config } = (await import("@/proxy")) as any);
});

beforeEach(() => {
  visitor.user = null;
  visitor.role = null;
});

const as = (role: string | null) => {
  visitor.user = role ? { id: "11111111-1111-4111-8111-111111111111" } : null;
  visitor.role = role;
};
const visit = (path: string) => proxy(new NextRequest(`https://husnalogy.com${path}`));
const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe("the proxy runs on every page it claims to protect", () => {
  it.each(["/upload-from-phone", "/designer", "/account", "/account/orders", "/checkout", "/cart", "/orders", "/profile", "/saved-addresses", "/favorites", "/admin", "/admin/dashboard", "/api/admin/products"])("%s", (path) => {
    expect(matches(path)).toBe(true);
  });

  it("does not run on public pages", () => {
    for (const path of ["/", "/products", "/products/pearl-card", "/about", "/api/health"]) expect(matches(path), path).toBe(false);
  });
});

describe("Design Studio phone upload (/upload-from-phone)", () => {
  it("a signed-out visitor is sent to sign in and back", async () => {
    const response = await visit("/upload-from-phone");
    expect(getRedirectUrl(response as any)).toBe("https://husnalogy.com/login?next=%2Fupload-from-phone");
  });

  it("a customer gets a 404 — the studio interface does not exist for them", async () => {
    as("customer");
    const response = await visit("/upload-from-phone");
    expect(isRewrite(response as any)).toBe(true);
    expect(response.status).toBe(404);
  });

  it("designers and admins pass through to the page (which checks again)", async () => {
    for (const role of ["designer", "admin"]) {
      as(role);
      const response = await visit("/upload-from-phone");
      expect(response.status, role).toBe(200);
      expect(getRedirectUrl(response as any), role).toBeNull();
      expect(isRewrite(response as any), role).toBe(false);
    }
  });
});

describe("designer workspace (/designer)", () => {
  it("signed-out: 404; customer: 404; designer: through", async () => {
    expect((await visit("/designer")).status).toBe(404);
    as("customer");
    expect((await visit("/designer")).status).toBe(404);
    as("designer");
    expect((await visit("/designer")).status).toBe(200);
  });
});
