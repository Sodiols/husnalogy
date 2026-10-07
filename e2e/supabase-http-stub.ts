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
 *   any  /rest/v1/*           → [] (an empty project: no products, settings
 *                               fall back to their defaults)
 *   any  /storage/*, other    → 404
 * Tokens are never verified — this process holds no data and listens only on
 * 127.0.0.1.
 */
import { createServer, type Server } from "node:http";

const STUB_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54399").replace(/\/$/, "");

let server: Server | null = null;

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
