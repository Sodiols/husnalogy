#!/usr/bin/env node
/**
 * READ-ONLY summary of the production worker's queues — what the NEXT worker
 * run would do — for the approval before the first production run. It reads
 * statuses, kinds and timestamps only: no recipients, names, addresses,
 * order contents or file paths, and it changes nothing.
 *
 *   node scripts/worker/queue-summary.mjs --env <file with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY>
 *
 * "wouldNow" lists customer-facing or destructive effects of the next run:
 * e-mails that would be sent, checkout leases that would be expired, Storage
 * files that would be deleted by cleanup, production and render work.
 */
import { createClient } from "@supabase/supabase-js";
import { parseEnvFile } from "../staging/staging-env.mjs";
import { argValue, describeTarget, isMain, supabaseTargetId } from "../backup/lib/target.mjs";

/** Columns read per table — operational fields only. */
export const QUEUE_COLUMNS = {
  production_tasks: "status,next_attempt_at,attempt_count",
  notification_tasks: "kind,status,next_attempt_at,attempt_count",
  customizer_render_jobs: "status,job_type",
  checkout_preparations: "status,cleanup_status,lease_expires_at",
  production_storage_cleanup_items: "status,reason,next_attempt_at,manual_review_required",
  worker_runs: "worker,last_started_at,last_finished_at,last_status,run_count,last_success_at,last_failure_at",
  worker_subsystem_runs: "worker,subsystem,last_status,last_finished_at,consecutive_failures",
};

const countBy = (rows, key) => rows.reduce((out, row) => ({ ...out, [key(row)]: (out[key(row)] || 0) + 1 }), {});
const due = (row, now) => !row.next_attempt_at || Date.parse(row.next_attempt_at) <= now;

/** `read(table, columns)` returns rows or throws. */
export async function queueSummary(read, now = Date.now()) {
  const data = {};
  for (const [table, columns] of Object.entries(QUEUE_COLUMNS)) data[table] = await read(table, columns);
  const production = data.production_tasks;
  const notifications = data.notification_tasks;
  const preparations = data.checkout_preparations;
  const cleanup = data.production_storage_cleanup_items;
  return {
    generatedAt: new Date(now).toISOString(),
    workerHasRun: data.worker_runs.some((row) => Number(row.run_count) > 0),
    workerRuns: data.worker_runs,
    subsystems: data.worker_subsystem_runs,
    productionTasks: countBy(production, (row) => row.status),
    notificationTasks: countBy(notifications, (row) => `${row.kind}:${row.status}`),
    renderJobs: countBy(data.customizer_render_jobs, (row) => row.status),
    checkoutPreparations: countBy(preparations, (row) => `${row.status}/cleanup:${row.cleanup_status}`),
    cleanupItems: countBy(cleanup, (row) => `${row.reason}:${row.status}`),
    wouldNow: {
      sendEmails: notifications.filter((row) => row.status === "pending" && due(row, now)).length,
      runProductionTasks: production.filter((row) => row.status === "pending" && due(row, now)).length,
      renderJobs: data.customizer_render_jobs.filter((row) => ["queued", "retrying"].includes(row.status)).length,
      expireCheckoutLeases: preparations.filter((row) => row.status === "preparing" && Date.parse(row.lease_expires_at) < now).length,
      cleanUpAbandonedCheckouts: preparations.filter((row) => row.cleanup_status === "pending").length,
      deleteStorageFiles: cleanup.filter((row) => row.status === "pending" && !row.manual_review_required && due(row, now)).length,
    },
  };
}

async function main() {
  const file = argValue(process.argv.slice(2), "--env");
  if (!file) throw new Error("usage: queue-summary.mjs --env <file>");
  const env = parseEnvFile(file);
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error(`${file} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
  const target = describeTarget(supabaseTargetId(env.NEXT_PUBLIC_SUPABASE_URL));
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const read = async (table, columns) => {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(table).select(columns).range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  };
  console.log(JSON.stringify({ operation: "worker-queue-summary", target: target.id, kind: target.kind, readOnly: true, ...(await queueSummary(read)) }, null, 2));
}

if (isMain("scripts/worker/queue-summary.mjs")) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
