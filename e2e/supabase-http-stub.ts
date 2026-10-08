/**
 * A stand-in for Supabase's HTTP API on the dead stub address, for local
 * deterministic e2e runs that must never reach a real project. Started once
 * per run by e2e/global-setup.ts.
 *
 * It answers only what SERVER-side code needs to render deterministically:
 *   GET  /auth/v1/user        → the account named by the Bearer token
 *                               (id, email and name are read from the stub
 *                               token itself; see e2e/customer-stub.ts)
 *   GET  /rest/v1/profiles    → that account's profile (role: customer)
 *   GET  /rest/v1/products    → ONE fixed, public catalogue product
 *                               (STUB_CATALOGUE_PRODUCT), so the storefront's
 *                               listing and product page render real cards
 *   any  /rest/v1/*           → [] (otherwise an empty project: settings fall
 *                               back to their defaults)
 *   any  /storage/*, other    → 404
 * Tokens are never verified — this process holds no data and listens only on
 * 127.0.0.1.
 */
import { createServer, type Server } from "node:http";

const STUB_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54399").replace(/\/$/, "");

let server: Server | null = null;

/** The local catalogue: one active, public, non-personalizable product. */
export const STUB_CATALOGUE_PRODUCT = {
  id: "e2e0c0de-0000-4000-8000-00000000c001",
  slug: "e2e-stub-wedding-card",
  title: "Stub Wedding Card",
  category: "Wedding Cards",
  category_id: null,
  status: "active",
  visibility: "public",
  price: 250,
  sale_price: null,
  thumbnail: "/images/weddings.png",
  description: "A fixed catalogue product served by the local e2e stand-in.",
  featured: true,
  data: {},
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
  product_images: [],
  product_mockups: [],
  product_videos: [],
  product_collection_products: [],
  product_customizer_templates: [],
  reviews: [],
};

/** The PostgREST filters the storefront uses on products (eq / neq / in); anything else is ignored. */
function matchesFilters(row: Record<string, unknown>, params: URLSearchParams): boolean {
  for (const [column, filter] of params) {
    if (["select", "order", "limit", "offset"].includes(column) || !(column in row)) continue;
    const value = String(row[column] ?? "");
    const [operator, ...rest] = filter.split(".");
    const operand = rest.join(".");
    if (operator === "eq" && value !== operand) return false;
    if (operator === "neq" && value === operand) return false;
    if (operator === "in" && !operand.replace(/^\(|\)$/g, "").split(",").map((entry) => entry.replace(/^"|"$/g, "")).includes(value)) return false;
  }
  return true;
}

type TokenAccount = { id: string; email: string; name: string };

function accountOf(authorization: string | undefined): TokenAccount | null {
  try {
    const token = String(authorization || "").replace(/^Bearer\s+/i, "");
    const claims = JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8"));
    if (!claims?.sub || claims.role !== "authenticated") return null;
    return { id: String(claims.sub), email: String(claims.email || ""), name: String(claims.user_metadata?.full_name || "Customer") };
  } catch {
    return null;
  }
}

export async function startSupabaseHttpStub(): Promise<void> {
  if (server) return;
  const target = new URL(STUB_URL);
  if (!/^(127\.0\.0\.1|localhost)$/.test(target.hostname)) throw new Error(`Refusing to start the Supabase stand-in for ${STUB_URL}: not a local address.`);
  const candidate = createServer((request, response) => {
    const url = new URL(request.url || "/", STUB_URL);
    const account = accountOf(request.headers.authorization);
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === "/auth/v1/user") {
      return account
        ? send(200, { id: account.id, aud: "authenticated", role: "authenticated", email: account.email, app_metadata: { provider: "email" }, user_metadata: { full_name: account.name } })
        : send(401, { message: "invalid JWT" });
    }
    if (url.pathname === "/rest/v1/profiles") {
      const profile = account ? { id: account.id, full_name: account.name, email: account.email, role: "customer", avatar_url: null } : null;
      const single = String(request.headers.accept || "").includes("vnd.pgrst.object");
      return single ? send(200, profile) : send(200, profile ? [profile] : []);
    }
    if (url.pathname === "/rest/v1/products") {
      const rows = [STUB_CATALOGUE_PRODUCT].filter((row) => matchesFilters(row, url.searchParams));
      const single = String(request.headers.accept || "").includes("vnd.pgrst.object");
      return single ? send(rows.length ? 200 : 406, rows[0] ?? { code: "PGRST116", message: "no rows" }) : send(200, rows);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const single = String(request.headers.accept || "").includes("vnd.pgrst.object");
      return single ? send(200, null) : send(200, []);
    }
    return send(404, { message: "not stubbed" });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      candidate.once("error", reject);
      candidate.listen(Number(target.port), target.hostname, () => resolve());
    });
    server = candidate;
  } catch (error) {
    // Already answered by this run's global stand-in: nothing to do.
    if ((error as NodeJS.ErrnoException)?.code !== "EADDRINUSE") throw error;
  }
}

export async function stopSupabaseHttpStub(): Promise<void> {
  if (!server) return;
  const closing = server;
  server = null;
  await new Promise<void>((resolve) => closing.close(() => resolve()));
}
