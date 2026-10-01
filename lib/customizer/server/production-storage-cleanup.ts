import { createServiceRoleClient } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createServiceRoleClient>;

export type CleanupItem = { id: string; bucket: string; path: string; reason: string; attempt_count: number };

export type CleanupResult = {
  claimed: number;
  deleted: number;
  failed: number;
  deadLettered: number;
  preparationsCleaned: number;
  failures: Array<{ bucket: string; path: string; attempt: number; status: string | null; error: string }>;
};

/**
 * Remove a bounded batch of abandoned production copies, ONE OBJECT AT A TIME.
 *
 * Candidates come from the database (claim_storage_cleanup_items): bytes of a
 * failed/abandoned checkout preparation, or copies unreferenced for 48 hours.
 * Committed originals and ready outputs are never candidates, and a storage
 * trigger refuses their deletion anyway.
 *
 * A failure is recorded against that object (attempt count, error, backoff,
 * dead letter after the ceiling) and the loop CONTINUES with the next one. The
 * database decides the outcome from storage state, so "remove reported
 * success but the object is still there" is a failure too.
 */
export async function cleanupProductionStorage(supabase: Supabase = createServiceRoleClient(), options: { limit?: number; timeBudgetMs?: number } = {}): Promise<CleanupResult> {
  const started = Date.now();
  const budget = Math.max(1_000, options.timeBudgetMs ?? 10_000);
  const result: CleanupResult = { claimed: 0, deleted: 0, failed: 0, deadLettered: 0, preparationsCleaned: 0, failures: [] };

  const { data, error } = await supabase.rpc("claim_storage_cleanup_items", { p_limit: Math.max(1, Math.min(100, options.limit ?? 25)) });
  if (error) throw error;
  const items = (Array.isArray(data) ? data : []) as CleanupItem[];
  result.claimed = items.length;

  for (const item of items) {
    // Unprocessed claims are simply retried after their short lease.
    if (Date.now() - started >= budget) break;
    let removalError: string | null = null;
    try {
      const { error: removeError } = await supabase.storage.from(item.bucket).remove([item.path]);
      if (removeError) removalError = String(removeError.message || removeError).slice(0, 500);
    } catch (thrown) {
      removalError = (thrown instanceof Error ? thrown.message : String(thrown)).slice(0, 500);
    }
    let status: string | null = null;
    try {
      const recorded = await supabase.rpc("record_storage_cleanup_result", { p_id: item.id, p_error: removalError });
      if (recorded.error) throw recorded.error;
      status = typeof recorded.data === "string" ? recorded.data : null;
    } catch (recordError) {
      // The claim lease expires and the attempt is counted at claim time, so
      // the object is retried (bounded) — never lost, never looped forever.
      removalError = removalError || `Outcome not recorded: ${recordError instanceof Error ? recordError.message : String(recordError)}`.slice(0, 500);
    }
    if (status === "deleted") {
      result.deleted++;
      continue;
    }
    result.failed++;
    if (status === "dead_letter") result.deadLettered++;
    if (result.failures.length < 10) result.failures.push({ bucket: item.bucket, path: item.path, attempt: item.attempt_count, status, error: removalError || "Object still present after removal." });
  }

  const { data: cleaned, error: preparationError } = await supabase.rpc("complete_checkout_preparation_cleanup", { p_limit: 200 });
  if (preparationError) throw preparationError;
  result.preparationsCleaned = Number(cleaned) || 0;
  return result;
}
