import { createServiceRoleClient } from "@/lib/supabase/server";

/** Remove a bounded batch of abandoned copies; committed bytes are DB-protected. */
export async function cleanupProductionStorage(supabase = createServiceRoleClient()) {
  const { data, error } = await supabase.rpc("production_storage_cleanup_candidates", { p_limit: 25 });
  if (error) throw error;
  const started = Date.now();
  let removed = 0;
  for (const candidate of data || []) {
    if (Date.now() - started >= 10_000) break;
    const { error: removalError } = await supabase.storage.from(candidate.bucket).remove([candidate.path]);
    if (removalError) throw removalError;
    removed++;
  }
  return { removed };
}
