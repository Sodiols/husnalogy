/**
 * Per-account /api/account/*, /api/order-requests and Supabase cart/wishlist
 * answers, inside the browser context. Every request is attributed to the
 * account its session cookie (or access token) names, and sees only that
 * account's data — the rule the real routes enforce with RLS (proven against
 * the real schema in lib/database/__tests__/account-routes.test.ts). These
 * specs prove the BROWSER side: nothing of one account is cached, prefilled,
 * merged or shown for another.
 */
import type { BrowserContext, Route } from "@playwright/test";
import { STUB_PHOTO_URL, STUB_SUPABASE_URL, stubUserIdFromCookieHeader } from "./customer-stub";

type Address = Record<string, any>;
type Account = { addresses: Address[]; profile: { name: string; email: string; phone: string; avatarUrl: string }; orders: any[]; cart: any[]; wishlist: any[] };

const subjectOfBearer = (authorization: string | undefined) => {
  try {
    const token = String(authorization || "").replace(/^Bearer\s+/i, "");
    return String(JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8")).sub || "");
  } catch {
    return "";
  }
};

export class StubAccountServer {
  readonly accounts = new Map<string, Account>();
  readonly writes: Array<{ owner: string; method: string; path: string; body: any }> = [];
  private sequence = 0;

  account(id: string): Account {
    if (!this.accounts.has(id)) this.accounts.set(id, { addresses: [], profile: { name: "", email: "", phone: "", avatarUrl: "" }, orders: [], cart: [], wishlist: [] });
    return this.accounts.get(id)!;
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route("**/api/account/**", (route) => this.handleAccount(route));
    await context.route("**/api/order-requests**", (route) => this.handleOrders(route));
    await context.route("**/api/customizations**", (route) => route.fulfill({ json: { ok: true, customizations: [] } }));
    await context.route("**/api/checkout/quote", (route) => route.fulfill({ json: { ok: true, quote: { items: [], subtotal: 0, deliveryCharge: 0, total: 0, currency: "BDT", deliveryChargeConfirmed: false } } }));
    // Cart and wishlist are read by the browser straight from Supabase (RLS: own rows).
    await context.route(`${STUB_SUPABASE_URL}/rest/v1/cart_items**`, (route) => this.handleRows(route, "cart"));
    await context.route(`${STUB_SUPABASE_URL}/rest/v1/wishlist_items**`, (route) => this.handleRows(route, "wishlist"));
  }

  private async owner(route: Route): Promise<string> {
    return stubUserIdFromCookieHeader((await route.request().allHeaders())["cookie"]);
  }

  private async handleRows(route: Route, kind: "cart" | "wishlist") {
    const owner = subjectOfBearer(route.request().headers()["authorization"]);
    if (route.request().method() !== "GET") return route.fulfill({ status: 201, json: [] });
    return route.fulfill({ json: owner ? this.account(owner)[kind] : [] });
  }

  private async handleOrders(route: Route) {
    const owner = await this.owner(route);
    if (!owner) return route.fulfill({ status: 401, json: { ok: false, error: "Sign in required." } });
    return route.fulfill({ json: { ok: true, orders: this.account(owner).orders } });
  }

  private async handleAccount(route: Route) {
    const request = route.request();
    const owner = await this.owner(route);
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (!owner) return route.fulfill({ status: 401, json: { ok: false, error: "Sign in required." } });
    const account = this.account(owner);
    const body = method === "POST" && path.endsWith("/avatar") ? {} : request.postDataJSON?.() || {};
    if (method !== "GET") this.writes.push({ owner, method, path, body });

    if (path === "/api/account/addresses") {
      if (method === "GET") return route.fulfill({ json: { ok: true, addresses: account.addresses } });
      this.sequence += 1;
      const address = { id: `00000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`, area: "", district: "", postalCode: "", note: "", ...body, isDefault: !account.addresses.length || Boolean(body.isDefault) };
      if (address.isDefault) account.addresses.forEach((entry) => (entry.isDefault = false));
      account.addresses.unshift(address);
      return route.fulfill({ status: 201, json: { ok: true, address } });
    }
    const addressMatch = path.match(/^\/api\/account\/addresses\/(.+)$/);
    if (addressMatch) {
      const address = account.addresses.find((entry) => entry.id === addressMatch[1]);
      if (!address) return route.fulfill({ status: 404, json: { ok: false, error: "Address not found." } });
      if (method === "DELETE") {
        account.addresses = account.addresses.filter((entry) => entry !== address);
        return route.fulfill({ json: { ok: true } });
      }
      if (body.isDefault) account.addresses.forEach((entry) => (entry.isDefault = entry === address));
      Object.assign(address, { ...body, isDefault: body.isDefault ? true : address.isDefault });
      return route.fulfill({ json: { ok: true, address } });
    }
    if (path === "/api/account/profile") {
      if (method === "PATCH") Object.assign(account.profile, { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.phone !== undefined ? { phone: body.phone } : {}) });
      return route.fulfill({ json: { ok: true, profile: account.profile } });
    }
    if (path === "/api/account/avatar") {
      account.profile.avatarUrl = method === "DELETE" ? "" : `${STUB_PHOTO_URL}#owner=${owner}`;
      return route.fulfill({ json: { ok: true, avatarUrl: account.profile.avatarUrl } });
    }
    return route.fulfill({ status: 404, json: { ok: false } });
  }
}
