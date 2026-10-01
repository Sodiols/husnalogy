import { describe, expect, it, vi } from "vitest";
import { runWorkerPass, type WorkerSubsystem } from "@/lib/worker/production-worker";

vi.mock("@/lib/observability/monitor", () => ({ captureError: vi.fn(async () => undefined) }));

function fakeClock() {
  let now = 1_000_000;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("runWorkerPass", () => {
  it("runs every subsystem in order even when earlier ones throw, and never throws itself", async () => {
    const order: string[] = [];
    const make = (name: WorkerSubsystem["name"], critical: boolean, fail = false): WorkerSubsystem => ({
      name, critical, maxMs: 10_000,
      async run() { order.push(name); if (fail) throw new Error(`${name} exploded`); return { result: {} }; },
    });
    const report = await runWorkerPass([
      make("lease_recovery", false, true),
      make("production_tasks", true),
      make("render_jobs", true),
      make("notifications", true),
      make("reconciliation", false, true),
      make("output_verification", false, true),
      make("storage_cleanup", false, true),
    ]);
    expect(order).toEqual(["lease_recovery", "production_tasks", "render_jobs", "notifications", "reconciliation", "output_verification", "storage_cleanup"]);
    expect(report.status).toBe("degraded");
    expect(report.subsystems.filter((entry) => entry.status === "failed").map((entry) => entry.name)).toEqual(["lease_recovery", "reconciliation", "output_verification", "storage_cleanup"]);
    expect(report.subsystems.find((entry) => entry.name === "storage_cleanup")?.error).toBe("storage_cleanup exploded");
  });

  it("a critical failure makes the pass 'error' but later subsystems still run", async () => {
    const ran: string[] = [];
    const report = await runWorkerPass([
      { name: "production_tasks", critical: true, maxMs: 1_000, async run() { throw new Error("db down"); } },
      { name: "notifications", critical: true, maxMs: 1_000, async run() { ran.push("notifications"); return { result: { sent: 2 } }; } },
    ]);
    expect(report.status).toBe("error");
    expect(ran).toEqual(["notifications"]);
  });

  it("reserves time for later subsystems so a slow render queue cannot starve notifications", async () => {
    const clock = fakeClock();
    const budgets: Record<string, number> = {};
    const subsystem = (name: WorkerSubsystem["name"], maxMs: number, minMs: number, spend: number): WorkerSubsystem => ({
      name, critical: true, maxMs, minMs,
      async run(budgetMs) { budgets[name] = budgetMs; clock.advance(Math.min(spend, budgetMs)); return { result: {} }; },
    });
    const report = await runWorkerPass([
      subsystem("production_tasks", 40_000, 5_000, 40_000),
      subsystem("render_jobs", 500_000, 5_000, 500_000),
      subsystem("notifications", 30_000, 5_000, 1_000),
    ], { totalBudgetMs: 100_000, now: clock.now });
    expect(budgets.production_tasks).toBe(40_000);
    expect(budgets.render_jobs).toBe(55_000); // 100 s - 40 s used - 5 s reserved for notifications
    expect(budgets.notifications).toBe(5_000);
    expect(report.status).toBe("ok");
  });

  it("a skipped CRITICAL subsystem makes the pass 'error' and records why, when, and in which run", async () => {
    const clock = fakeClock();
    const report = await runWorkerPass([
      { name: "render_jobs", critical: true, maxMs: 1_000_000, async run(budgetMs) { clock.advance(budgetMs + 20_000); return { result: {} }; } },
      { name: "notifications", critical: true, maxMs: 30_000, minMs: 5_000, async run() { return { result: {} }; } },
    ], { totalBudgetMs: 50_000, now: clock.now, runId: "run-1" });
    expect(report).toMatchObject({ runId: "run-1", status: "error" });
    expect(report.subsystems[1]).toMatchObject({
      name: "notifications",
      status: "skipped",
      error: expect.stringMatching(/time budget exhausted/),
      result: { runId: "run-1", reason: expect.stringMatching(/time budget exhausted/), budgetMs: 0, skippedAt: expect.any(String) },
    });
    expect(report.subsystems[0].result.runId).toBe("run-1");
  });

  it("a skipped MAINTENANCE subsystem only degrades the pass", async () => {
    const clock = fakeClock();
    const report = await runWorkerPass([
      { name: "notifications", critical: true, maxMs: 1_000_000, async run(budgetMs) { clock.advance(budgetMs + 5_000); return { result: {} }; } },
      { name: "storage_cleanup", critical: false, maxMs: 10_000, minMs: 1_000, async run() { return { result: {} }; } },
    ], { totalBudgetMs: 50_000, now: clock.now });
    expect(report.subsystems.map((entry) => entry.status)).toEqual(["ok", "skipped"]);
    expect(report.status).toBe("degraded");
  });

  it("records a subsystem that has no time left as skipped, never silently", async () => {
    const clock = fakeClock();
    const report = await runWorkerPass([
      // A job already running when its budget ends finishes anyway (overrun).
      { name: "render_jobs", critical: true, maxMs: 1_000_000, async run(budgetMs) { clock.advance(budgetMs + 20_000); return { result: {} }; } },
      { name: "storage_cleanup", critical: false, maxMs: 10_000, minMs: 1_000, async run() { return { result: {} }; } },
      { name: "notifications", critical: true, maxMs: 30_000, minMs: 5_000, async run() { return { result: {} }; } },
    ], { totalBudgetMs: 50_000, now: clock.now });
    expect(report.subsystems.map((entry) => entry.status)).toEqual(["ok", "skipped", "skipped"]);
    expect(report.status).toBe("error"); // notifications (critical) did not run
  });

  it("item-level failures are 'degraded', not 'failed'", async () => {
    const report = await runWorkerPass([{ name: "storage_cleanup", critical: false, maxMs: 1_000, async run() { return { status: "degraded", result: { failed: 1 }, error: "1 object could not be removed" }; } }]);
    expect(report.subsystems[0]).toMatchObject({ status: "degraded", error: "1 object could not be removed" });
    expect(report.status).toBe("degraded");
  });
});
