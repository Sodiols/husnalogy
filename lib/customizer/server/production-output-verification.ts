import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type VerificationResult = { checked: number; invalid: number; errors: number; failures: Array<{ outputId: string; error: string }> };

/**
 * Bounded rolling verification: ready DB records must still have exact
 * storage bytes. Each output is isolated — a download or database error on
 * one is recorded and the next is still checked. A MISSING or DIFFERENT
 * object invalidates the output (production re-renders it); a transient
 * storage error only leaves it for the next run (verified_at is unchanged, so
 * it stays first in line).
 */
export async function verifyProductionOutputs(supabase = createServiceRoleClient(), limit = 10, timeBudgetMs = 20_000): Promise<VerificationResult> {
  const started = Date.now();
  const { data, error } = await supabase.from("customizer_render_outputs").select("id,job_id,bucket,path,checksum,file_size_bytes").not("snapshot_id", "is", null).eq("status", "ready").order("verified_at", { ascending: true }).limit(Math.min(25, Math.max(1, limit)));
  if (error) throw error;
  const result: VerificationResult = { checked: 0, invalid: 0, errors: 0, failures: [] };
  for (const output of data || []) {
    if (Date.now() - started >= timeBudgetMs) break;
    try {
      const { data: blob, error: downloadError } = await supabase.storage.from(output.bucket).download(output.path);
      if (downloadError && String(downloadError.statusCode) !== "404" && !/not found|not_found/i.test(downloadError.message || "")) {
        throw new Error("Production storage verification is unavailable.");
      }
      const bytes = blob && blob.size <= 120 * 1024 * 1024 ? Buffer.from(await blob.arrayBuffer()) : null;
      if (!bytes || bytes.length !== Number(output.file_size_bytes) || createHash("sha256").update(bytes).digest("hex") !== output.checksum) {
        const { error: invalidationError } = await supabase.rpc("invalidate_snapshot_output", { p_output_id: output.id, p_reason: "Storage verification: output missing or checksum differs" });
        if (invalidationError) throw invalidationError;
        result.invalid++;
      } else {
        const { error: updateError } = await supabase.from("customizer_render_outputs").update({ verified_at: new Date().toISOString() }).eq("id", output.id).eq("status", "ready");
        if (updateError) throw updateError;
      }
      result.checked++;
    } catch (itemError) {
      result.errors++;
      if (result.failures.length < 10) result.failures.push({ outputId: String(output.id), error: (itemError instanceof Error ? itemError.message : String(itemError)).slice(0, 300) });
    }
  }
  return result;
}
