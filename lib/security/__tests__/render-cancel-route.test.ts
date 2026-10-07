/**
 * DELETE /api/customizer/render/[jobId] — the render cancellation endpoint
 * follows the same mutation contract as every other customer write:
 * same-origin guard → rate limit → session → ownership → job state → cancel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySupabase, type MemorySupabase } from "@/lib/testing/memory-supabase";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let store: MemorySupabase;
let sessionUser: string | null = A;
let queriesBeforeAuth = 0;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser ? { id: sessionUser } : null }, error: null }) },
    from: (table: string) => {
      queriesBeforeAuth += 1;
      return store.client.from(table);
    },
  }),
  createServiceRoleClient: () => store.client,
}));

const { DELETE } = await import("@/app/api/customizer/render/[jobId]/route");
const { cancelRenderJob } = await import("@/lib/customizer/render-jobs");

const job = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, status, customization_id: "cust-a", order_id: null, job_type: "preview", attempts: 0, ...extra });

beforeEach(() => {
  sessionUser = A;
  queriesBeforeAuth = 0;
  store = createMemorySupabase({
    product_customizations: [{ id: "cust-a", user_id: A }, { id: "cust-b", user_id: B }],
    customizer_render_jobs: [
      job("job-queued", "queued"),
      job("job-processing", "processing"),
      job("job-done", "completed"),
      job("job-order", "queued", { order_id: "order-1" }),
      job("job-b", "queued", { customization_id: "cust-b" }),
    ],
  });
});

const cancel = (id: string, headers: Record<string, string> = { origin: "http://localhost", host: "localhost" }) =>
  DELETE(new Request(`http://localhost/api/customizer/render/${id}`, { method: "DELETE", headers }), { params: Promise.resolve({ jobId: id }) });
const statusOf = (id: string) => store.table("customizer_render_jobs").find((row) => row.id === id)?.status;

describe("render cancellation", () => {
  it("refuses a cross-site request before touching the session or the database", async () => {
    for (const headers of [{ origin: "https://evil.test", host: "localhost" }, { "sec-fetch-site": "cross-site", host: "localhost" }]) {
      const response = await cancel("job-queued", headers);
      expect(response.status).toBe(403);
    }
    expect(queriesBeforeAuth).toBe(0);
    expect(statusOf("job-queued")).toBe("queued");
  });

  it("the owner cancels a queued job immediately", async () => {
    const response = await cancel("job-queued");
    expect(response.status).toBe(200);
    expect(statusOf("job-queued")).toBe("cancelled");
  });

  it("a running job is asked to stop, not marked cancelled under the worker", async () => {
    await cancel("job-processing");
    const row = store.table("customizer_render_jobs").find((entry) => entry.id === "job-processing")!;
    expect(row.status).toBe("processing");
    expect(row.cancel_requested_at).toBeTruthy();
  });

  it("finished jobs are returned unchanged", async () => {
    const response = await cancel("job-done");
    expect((await response.json()).job.status).toBe("completed");
    expect(statusOf("job-done")).toBe("completed");
  });

  it("another customer's job is not found; order production renders cannot be cancelled; signed-out is refused", async () => {
    expect((await cancel("job-b")).status).toBe(404);
    expect(statusOf("job-b")).toBe("queued");
    expect((await cancel("job-order")).status).toBe(403);
    expect(statusOf("job-order")).toBe("queued");
    sessionUser = null;
    expect((await cancel("job-queued")).status).toBe(401);
    expect(statusOf("job-queued")).toBe("queued");
  });

  it("never overwrites a state a worker reached after the job was read (compare-and-set)", async () => {
    // The worker completes the job between the cancel's read and its write.
    const original = store.client.from;
    let reads = 0;
    store.client.from = (table: string) => {
      const builder = original(table);
      if (table === "customizer_render_jobs") {
        const select = builder.select;
        builder.select = (...args: unknown[]) => {
          reads += 1;
          if (reads === 2) store.table("customizer_render_jobs").find((row) => row.id === "job-queued")!.status = "completed";
          return select(...args);
        };
      }
      return builder;
    };
    try {
      const result = await cancelRenderJob("job-queued");
      expect(result?.status).toBe("completed");
      expect(statusOf("job-queued")).toBe("completed");
    } finally {
      store.client.from = original;
    }
  });
});
