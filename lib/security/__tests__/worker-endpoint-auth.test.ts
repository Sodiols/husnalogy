/**
 * The worker endpoint can only be triggered with the server-side secret (or an
 * admin session on POST). The secret is compared in constant time, never read
 * from the URL, never echoed and never shipped to the browser.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SECRET = "s".repeat(24) + "-correct-worker-secret-0123456789";

const mocks = vi.hoisted(() => ({
  pass: vi.fn(),
  rpc: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/outbox/supabase-tasks", () => ({ productionWorkerSubsystems: () => [] }));
vi.mock("@/lib/worker/production-worker", () => ({ runWorkerPass: mocks.pass }));
vi.mock("@/lib/auth/admin-server", () => ({ requireAdmin: async () => ({ ok: false, response: Response.json({ ok: false }, { status: 401 }) }) }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentActor: async () => null }));

const url = "https://husnalogy.com/api/admin/customizer/render/process";

describe("worker secret comparison", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("RENDER_WORKER_SECRET", "");
  });

  it("denies no secret, a wrong secret, a prefix, a longer value and a URL parameter; allows the exact secret", async () => {
    const { hasWorkerSecret } = await import("@/lib/security/worker-auth");
    const request = (headers: Record<string, string> = {}, query = "") => new Request(`${url}${query}`, { headers });
    expect(hasWorkerSecret(request())).toBe(false);
    expect(hasWorkerSecret(request({ authorization: "Bearer wrong-secret" }))).toBe(false);
    expect(hasWorkerSecret(request({ authorization: `Bearer ${SECRET.slice(0, -1)}` }))).toBe(false);
    expect(hasWorkerSecret(request({ authorization: `Bearer ${SECRET}x` }))).toBe(false);
    expect(hasWorkerSecret(request({ authorization: SECRET }))).toBe(false); // no Bearer scheme
    expect(hasWorkerSecret(request({}, `?secret=${SECRET}&token=${SECRET}`))).toBe(false);
    expect(hasWorkerSecret(request({ authorization: `Bearer ${SECRET}` }))).toBe(true);
    expect(hasWorkerSecret(request({ "x-render-secret": SECRET }))).toBe(true);
  });

  it("is disabled entirely when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { hasWorkerSecret } = await import("@/lib/security/worker-auth");
    expect(hasWorkerSecret(new Request(url, { headers: { authorization: "Bearer " } }))).toBe(false);
    expect(hasWorkerSecret(new Request(url, { headers: { authorization: "Bearer undefined" } }))).toBe(false);
  });
});

describe("worker endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    mocks.pass.mockReset();
    mocks.pass.mockResolvedValue({ status: "ok", startedAt: new Date().toISOString(), durationMs: 1, subsystems: [] });
  });

  it("GET: no secret → 401, wrong secret → 401, correct secret → runs", async () => {
    const { GET } = await import("@/app/api/admin/customizer/render/process/route");
    expect((await GET(new Request(url))).status).toBe(401);
    expect((await GET(new Request(url, { headers: { authorization: "Bearer not-the-secret" } }))).status).toBe(401);
    expect(mocks.pass).not.toHaveBeenCalled();
    const allowed = await GET(new Request(url, { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(allowed.status).toBe(200);
    expect(mocks.pass).toHaveBeenCalledTimes(1);
    expect(await allowed.text()).not.toContain(SECRET);
  });

  it("POST without the secret requires an admin session (anonymous → 401)", async () => {
    const { POST } = await import("@/app/api/admin/customizer/render/process/route");
    const anonymous = await POST(new Request(url, { method: "POST", headers: { origin: "https://husnalogy.com", "content-type": "application/json" }, body: "{}" }));
    expect(anonymous.status).toBe(401);
    expect(mocks.pass).not.toHaveBeenCalled();
    const scheduled = await POST(new Request(url, { method: "POST", headers: { "x-render-secret": SECRET }, body: "{}" }));
    expect(scheduled.status).toBe(200);
  });

  it("a degraded pass completes with 200; a critical failure answers 503", async () => {
    const { GET } = await import("@/app/api/admin/customizer/render/process/route");
    mocks.pass.mockResolvedValueOnce({ status: "degraded", startedAt: "", durationMs: 1, subsystems: [{ name: "storage_cleanup", critical: false, status: "degraded", startedAt: "", durationMs: 1, result: {}, error: "1 object could not be removed" }] });
    const degraded = await GET(new Request(url, { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(degraded.status).toBe(200);
    expect(await degraded.json()).toMatchObject({ ok: false, status: "degraded", subsystems: { storage_cleanup: { status: "degraded" } } });
    mocks.pass.mockResolvedValueOnce({ status: "error", startedAt: "", durationMs: 1, subsystems: [{ name: "production_tasks", critical: true, status: "failed", startedAt: "", durationMs: 1, result: {}, error: "database unavailable" }] });
    expect((await GET(new Request(url, { headers: { authorization: `Bearer ${SECRET}` } }))).status).toBe(503);
  });
});

describe("worker secrets never reach the browser", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (["node_modules", ".next", "__tests__"].includes(name)) return [];
      return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?|jsx?|mjs)$/.test(name) ? [path] : [];
    });

  it("no NEXT_PUBLIC_ variant of a worker secret exists, and client components never read one", () => {
    for (const file of [...sourceFiles("app"), ...sourceFiles("lib"), "next.config.mjs", "proxy.js"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/NEXT_PUBLIC_(CRON|RENDER_WORKER)_SECRET/);
      if (/^\s*["']use client["']/m.test(text)) expect(text, file).not.toMatch(/CRON_SECRET|RENDER_WORKER_SECRET/);
    }
  });
});
