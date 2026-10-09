/**
 * Scheduled runs must never overlap inside one server process: a cron call
 * that arrives while a pass is still running is answered 409 and starts
 * nothing; once the pass finishes, the next call runs. (Across processes the
 * database leases keep every job single-owner — postgres-concurrency.test.ts.)
 * The heartbeat brackets every run, also a failed one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "o".repeat(24) + "-overlap-worker-secret-0123456789";
const mocks = vi.hoisted(() => ({ pass: vi.fn(), rpc: vi.fn(async (..._args: unknown[]) => ({ data: null, error: null })) }));

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/outbox/supabase-tasks", () => ({ productionWorkerSubsystems: () => [] }));
vi.mock("@/lib/worker/production-worker", () => ({ runWorkerPass: mocks.pass }));
vi.mock("@/lib/auth/admin-server", () => ({ requireAdmin: async () => ({ ok: false, response: Response.json({ ok: false }, { status: 401 }) }) }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentActor: async () => null }));

const url = "https://husnalogy.com/api/admin/customizer/render/process";
const cron = () => new Request(url, { headers: { authorization: `Bearer ${SECRET}` } });
const report = (status: string) => ({ runId: "r", status, startedAt: new Date().toISOString(), durationMs: 1, subsystems: [] });

describe("worker endpoint: no overlapping runs", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    mocks.pass.mockReset();
    mocks.rpc.mockClear();
  });

  it("a second cron call during a running pass gets 409 and starts nothing; the next call after it runs", async () => {
    let finish!: (value: unknown) => void;
    mocks.pass.mockImplementationOnce(() => new Promise((resolvePass) => { finish = resolvePass; }));
    const { GET } = await import("@/app/api/admin/customizer/render/process/route");
    const first = GET(cron());
    await vi.waitFor(() => expect(mocks.pass).toHaveBeenCalledTimes(1));
    const second = await GET(cron());
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ busy: true });
    expect(mocks.pass).toHaveBeenCalledTimes(1);
    finish(report("ok"));
    expect((await first).status).toBe(200);
    mocks.pass.mockResolvedValueOnce(report("ok"));
    expect((await GET(cron())).status).toBe(200);
    expect(mocks.pass).toHaveBeenCalledTimes(2);
  });

  it("every run is bracketed by heartbeats, and a crashed pass still records its finish and frees the slot", async () => {
    mocks.pass.mockRejectedValueOnce(new Error("unexpected crash"));
    const { GET } = await import("@/app/api/admin/customizer/render/process/route");
    expect((await GET(cron())).status).toBe(500);
    const phases = mocks.rpc.mock.calls.filter((call) => call[0] === "record_worker_run").map((call) => (call[1] as { p_phase: string; p_status?: string }));
    expect(phases.map((phase) => phase.p_phase)).toEqual(["start", "finish"]);
    expect(phases[1].p_status).toBe("error");
    mocks.pass.mockResolvedValueOnce(report("ok"));
    expect((await GET(cron())).status).toBe(200);
  });

  it("GET never runs without the secret (cron misconfiguration is visible as 401, not silent work)", async () => {
    const { GET } = await import("@/app/api/admin/customizer/render/process/route");
    expect((await GET(new Request(url))).status).toBe(401);
    expect((await GET(new Request(`${url}?secret=${SECRET}`))).status).toBe(401);
    expect(mocks.pass).not.toHaveBeenCalled();
  });
});
