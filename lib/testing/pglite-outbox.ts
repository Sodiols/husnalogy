/**
 * Outbox task stores on PGlite (test-only). They call the REAL SQL lease
 * functions (`claim_*_tasks`, `finish_*_task`, `defer_notification_task`)
 * as the service role, exactly like lib/outbox/supabase-tasks.ts does through
 * PostgREST.
 */

import type { TaskOutcome, TaskStore } from "@/lib/outbox/processor";
import type { ProductionTaskRow } from "@/lib/customizer/order-snapshots";
import type { NotificationTask } from "@/lib/notifications/notification-runner";
import type { TestDatabase } from "@/lib/testing/pglite-supabase";

export function productionStore(t: TestDatabase): TaskStore<ProductionTaskRow> {
  return {
    async claim(limit, orderId) {
      const result = await t.asService((db) => db.query<ProductionTaskRow>("select * from public.claim_production_tasks($1, 300, $2)", [limit, orderId ?? null]));
      return result.rows;
    },
    async complete(task) {
      await t.asService((db) => db.query("select public.finish_production_task($1, $2, null)", [task.id, task.lock_token]));
    },
    async fail(task, message) {
      const result = await t.asService((db) => db.query<{ s: string }>("select public.finish_production_task($1, $2, $3) as s", [task.id, task.lock_token, message]));
      return result.rows[0]?.s ?? null;
    },
  };
}

export function notificationStore(t: TestDatabase): TaskStore<NotificationTask> {
  return {
    async claim(limit, orderId) {
      const result = await t.asService((db) => db.query<NotificationTask>("select * from public.claim_notification_tasks($1, 120, $2)", [limit, orderId ?? null]));
      return result.rows;
    },
    async complete(task, reference) {
      await t.asService((db) => db.query("select public.finish_notification_task($1, $2, null, $3)", [task.id, task.lock_token, reference ?? null]));
    },
    async fail(task, message) {
      const result = await t.asService((db) => db.query<{ s: string }>("select public.finish_notification_task($1, $2, $3) as s", [task.id, task.lock_token, message]));
      return result.rows[0]?.s ?? null;
    },
    async defer(task, reason) {
      await t.asService((db) => db.query("select public.defer_notification_task($1, $2, $3)", [task.id, task.lock_token, reason]));
    },
  };
}

/**
 * Stand-in for `runProductionTask` (which needs Supabase + the renderer):
 * enqueues a print job for the snapshot with the same dedupe rule as
 * `enqueueRenderJob` (existing job for the same order/design/type is reused)
 * and marks the snapshot queued.
 */
export function fakeRenderRunner(t: TestDatabase, fail?: () => boolean) {
  return async (task: ProductionTaskRow): Promise<TaskOutcome> => {
    if (fail?.()) throw new Error("render service unavailable");
    await t.asService(async (db) => {
      await db.query(
        `insert into public.customizer_render_jobs (customization_id, order_id, job_type, status, input_hash)
         select $1::uuid, $2::text, 'print_png', 'queued', $3::text
          where not exists (select 1 from public.customizer_render_jobs where order_id = $2::text and customization_id = $1::uuid and job_type = 'print_png')`,
        [task.customization_id, task.order_id, `hash-${task.customization_id}`],
      );
      await db.query("update public.order_design_snapshots set render_status = 'queued' where id = $1 and render_status in ('pending', 'failed')", [task.snapshot_id]);
    });
    return { kind: "done" };
  };
}
