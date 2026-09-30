import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

/** Bounded rolling verification: ready DB records must still have exact storage bytes. */
export async function verifyProductionOutputs(supabase = createServiceRoleClient(), limit = 10, timeBudgetMs = 20_000) {
  const started = Date.now();
  const { data, error } = await supabase.from("customizer_render_outputs").select("id,job_id,bucket,path,checksum,file_size_bytes").not("snapshot_id", "is", null).eq("status", "ready").order("verified_at", { ascending: true }).limit(Math.min(25, Math.max(1, limit)));
  if (error) throw error;
  let invalid = 0;
  let checked = 0;
  for (const output of data || []) {
    if (Date.now() - started >= timeBudgetMs) break;
    const { data: blob, error: downloadError } = await supabase.storage.from(output.bucket).download(output.path);
    if (downloadError && String(downloadError.statusCode) !== "404" && !/not found|not_found/i.test(downloadError.message || "")) throw new Error("Production storage verification is unavailable.");
    const bytes = blob && blob.size <= 120 * 1024 * 1024 ? Buffer.from(await blob.arrayBuffer()) : null;
    if (!bytes || bytes.length !== Number(output.file_size_bytes) || createHash("sha256").update(bytes).digest("hex") !== output.checksum) {
      const { error: invalidationError } = await supabase.rpc("invalidate_snapshot_output", { p_output_id: output.id, p_reason: "Storage verification: output missing or checksum differs" });
      if (invalidationError) throw invalidationError;
      invalid++;
    } else {
      const { error: updateError } = await supabase.from("customizer_render_outputs").update({ verified_at: new Date().toISOString() }).eq("id", output.id).eq("status", "ready");
      if (updateError) throw updateError;
    }
    checked++;
  }
  return { checked, invalid };
}
