import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessProductionHealth, CRITICAL_SUBSYSTEMS, MAINTENANCE_SUBSYSTEMS } from "@/lib/worker/health-policy";

const SECRET = "h".repeat(40);
const mocks = vi.hoisted(() => ({ health: {} as Record<string, unknown>, admin: false }));

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: async () => ({ data: mocks.health, error: null }) }) }));
vi.mock("@/lib/auth/admin-server", () => ({
  requireAdmin: async () => (mocks.admin ? { ok: true, admin: { id: "admin" } } : { ok: false, response: Response.json({ ok: false }, { status: 401 }) }),
}));

const NOW = Date.parse("2026-10-01T12:00:00Z");
const RUN = "6f0c1d3e-0000-4000-8000-000000000001";
const ok = (extra: Record<string, unknown> = {}) => ({ last_status: "ok", consecutive_failures: 0, last_finished_at: new Date(NOW - 60_000).toISOString(), last_success_at: new Date(NOW - 60_000).toISOString(), last_result: { runId: RUN }, ...extra });
const healthy = (): Record<string, any> => ({
  worker: { last_finished_at: new Date(NOW - 60_000).toISOString(), last_status: "ok" },
  renderJobs: { pending: 0, failed: 0 },
  productionTasks: { pending: 0, failed: 0 },
  notificationTasks: { pending: 0, failed: 0 },
  chain: {},
  subsystems: Object.fromEntries([...CRITICAL_SUBSYSTEMS, ...MAINTENANCE_SUBSYSTEMS].map((name) => [name, name === "lease_recovery" ? ok({ last_result: { runId: RUN, clock: { offsetMs: 120 } } }) : ok()])),
  storageCleanup: { deadLettered: 0 },
  outputs: { invalid: 0 },
  checkoutPreparations: { expiredActive: 0 },
});
const skipped = (lastSuccess: string) => ({
  last_status: "skipped",
  consecutive_failures: 1,
  last_error: "Skipped: time budget exhausted: earlier subsystems used the pass budget",
  last_finished_at: new Date(NOW - 30_000).toISOString(),
  last_success_at: lastSuccess,
  last_result: { runId: RUN, reason: "time budget exhausted: earlier subsystems used the pass budget", budgetMs: 0, skippedAt: new Date(NOW - 30_000).toISOString() },
});

describe("production health policy: critical vs maintenance subsystems", () => {
  it("is healthy when every subsystem ran", () => {
    expect(assessProductionHealth(healthy(), NOW)).toMatchObject({ status: "healthy", httpStatus: 200, problems: [], warnings: [] });
  });

  for (const [name, queue] of [["production_tasks", "productionTasks"], ["render_jobs", "renderJobs"], ["notifications", "notificationTasks"]] as const) {
    it(`${name} = skipped → UNHEALTHY (503) with run id, reason, last success and queue backlog`, () => {
      const health = healthy();
      health.subsystems[name] = skipped("2026-10-01T11:40:00.000Z");
      health[queue] = { pending: 4, failed: 0, oldestPendingAt: "2026-10-01T11:50:00.000Z" };
      const assessment = assessProductionHealth(health, NOW);
      expect(assessment).toMatchObject({ status: "unhealthy", httpStatus: 503 });
      expect(assessment.subsystemIssues).toEqual([
        expect.objectContaining({ subsystem: name, classification: "critical", status: "skipped", runId: RUN, lastSuccessAt: "2026-10-01T11:40:00.000Z", pending: 4, oldestPendingAt: "2026-10-01T11:50:00.000Z", reason: expect.stringMatching(/time budget exhausted/) }),
      ]);
      const message = assessment.problems.join("\n");
      expect(message).toContain(`Critical worker subsystem ${name} is skipped`);
      expect(message).toContain(`run ${RUN}`);
      expect(message).toContain("last success 2026-10-01T11:40:00.000Z");
      expect(message).toContain("4 pending, oldest since 2026-10-01T11:50:00.000Z");
    });
  }

  it("a critical subsystem that is degraded or failed is UNHEALTHY too", () => {
    for (const status of ["degraded", "failed"]) {
      const health = healthy();
      health.subsystems.notifications = { ...ok(), last_status: status, consecutive_failures: 2, last_error: "2 task(s) failed and will be retried: provider 503" };
      expect(assessProductionHealth(health, NOW)).toMatchObject({ status: "unhealthy", httpStatus: 503 });
    }
  });

  it("a critical subsystem with no recorded run at all is treated as skipped (never silently healthy)", () => {
    const health = healthy();
    delete health.subsystems.render_jobs;
    const assessment = assessProductionHealth(health, NOW);
    expect(assessment.status).toBe("unhealthy");
    expect(assessment.subsystemIssues[0]).toMatchObject({ subsystem: "render_jobs", status: "skipped" });
  });

  it("storage_cleanup = skipped → production stays healthy-to-serve; maintenance is DEGRADED (200 + warning)", () => {
    const health = healthy();
    health.subsystems.storage_cleanup = skipped("2026-10-01T10:00:00.000Z");
    const assessment = assessProductionHealth(health, NOW);
    expect(assessment).toMatchObject({ status: "degraded", httpStatus: 200, problems: [] });
    expect(assessment.warnings.join("\n")).toMatch(/Maintenance worker subsystem storage_cleanup is skipped/);
    expect(assessment.subsystemIssues[0]).toMatchObject({ subsystem: "storage_cleanup", classification: "maintenance" });
  });

  it("output_verification = failed while production ran → DEGRADED, not unhealthy", () => {
    const health = healthy();
    health.subsystems.output_verification = { ...ok(), last_status: "failed", consecutive_failures: 1, last_error: "storage unavailable" };
    const assessment = assessProductionHealth(health, NOW);
    expect(assessment).toMatchObject({ status: "degraded", httpStatus: 200, problems: [] });
    expect(assessment.warnings.join("\n")).toMatch(/output_verification is failed \(reason: storage unavailable/);
    expect(health.subsystems.production_tasks.last_status).toBe("ok");
  });

  it("customer-impacting consequences of maintenance (stuck jobs, missing outputs, clock skew) remain UNHEALTHY", () => {
    const stuck = healthy();
    stuck.subsystems.lease_recovery = { ...ok(), last_status: "failed", last_error: "rpc down" };
    stuck.chain = { stuckJobs: 2 };
    expect(assessProductionHealth(stuck, NOW).status).toBe("unhealthy");
    const skew = healthy();
    skew.subsystems.lease_recovery = ok({ last_result: { runId: RUN, clock: { offsetMs: 14_500 } } });
    expect(assessProductionHealth(skew, NOW).problems.join("\n")).toMatch(/differs from the database clock by 14500 ms/);
  });

  it("dead-lettered cleanup objects are a maintenance warning", () => {
    const health = healthy();
    health.storageCleanup = { deadLettered: 2 };
    expect(assessProductionHealth(health, NOW)).toMatchObject({ status: "degraded", httpStatus: 200 });
  });
});

describe("GET /api/admin/production/health", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    mocks.admin = false;
    mocks.health = { ...healthy(), worker: { last_finished_at: new Date().toISOString(), last_status: "ok" } };
  });
  const get = async (headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) => {
    const { GET } = await import("@/app/api/admin/production/health/route");
    return GET(new Request("https://husnalogy.com/api/admin/production/health", { headers }));
  };

  it("is not public: no secret and no admin session → 401", async () => {
    expect((await get({})).status).toBe(401);
    mocks.admin = true;
    expect((await get({})).status).toBe(200);
  });

  it("returns 503 'unhealthy' for a skipped critical subsystem and 200 'degraded' for a skipped maintenance one", async () => {
    const critical = healthy();
    critical.worker = { last_finished_at: new Date().toISOString(), last_status: "error" };
    critical.subsystems.render_jobs = skipped("2026-10-01T11:40:00.000Z");
    mocks.health = critical;
    const unhealthy = await get();
    expect(unhealthy.status).toBe(503);
    expect(await unhealthy.json()).toMatchObject({ ok: false, status: "unhealthy", subsystemIssues: [expect.objectContaining({ subsystem: "render_jobs", status: "skipped" })] });

    const maintenance = healthy();
    maintenance.worker = { last_finished_at: new Date().toISOString(), last_status: "degraded" };
    maintenance.subsystems.storage_cleanup = skipped("2026-10-01T11:40:00.000Z");
    mocks.health = maintenance;
    const degraded = await get();
    expect(degraded.status).toBe(200);
    expect(await degraded.json()).toMatchObject({ ok: false, status: "degraded", problems: [] });
  });
});
