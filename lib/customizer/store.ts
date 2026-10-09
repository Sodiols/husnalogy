// Server-only persistence for customizer templates.
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  normalizeCustomizerTemplate,
  prepareCustomizerTemplateForSave,
  templateFromRow,
  templateToRow,
} from "@/lib/customizer";
import { hydrateAdminAssetUrls, stripAdminAssetUrls } from "@/lib/customizer/server/admin-assets";
import { DraftConflictError, draftMatchesExpectedRevision } from "@/lib/customizer/draft-revision";

export async function getCustomizerTemplateByProductId(productId: string) {
  if (!productId) return null;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("product_customizer_templates")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle();

  if (error) throw error;
  return data ? hydrateAdminAssetUrls(templateFromRow(data), supabase) : null;
}

// Upsert a product's mutable draft. Draft saves and autosaves never create or
// advertise a new published version.
//
// `expectedUpdatedAt` is the draft revision the editor last saw. When given,
// a draft that has changed since is not overwritten: DraftConflictError is
// thrown before anything is written, and the write itself is a
// compare-and-swap on the stored `updated_at`, so a save that lands between
// the check and the write is caught too. Without it (legacy callers) the save
// is last-write-wins.
export async function saveCustomizerTemplate(
  productId: string,
  template: any,
  options: { expectedUpdatedAt?: string | null } = {},
) {
  if (!productId) return null;
  const supabase = createServiceRoleClient();

  const { data: existingRow, error: readError } = await supabase
    .from("product_customizer_templates")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle();
  if (readError) throw readError;

  const guarded = Boolean(options.expectedUpdatedAt && existingRow);
  if (guarded && !draftMatchesExpectedRevision(existingRow.updated_at, options.expectedUpdatedAt)) {
    throw new DraftConflictError();
  }

  const existing = existingRow ? templateFromRow(existingRow) : null;
  // Reconcile layer<->field connections before persisting so customer-editable
  // layers always have a saved field and orphans are dropped.
  const next = normalizeCustomizerTemplate(prepareCustomizerTemplateForSave(template), existing || {});

  if (existing) {
    next.version = Number(existing.version || 1);
  } else {
    next.version = 1;
  }

  const row = templateToRow(productId, stripAdminAssetUrls(next));

  if (guarded) {
    const { data, error } = await supabase
      .from("product_customizer_templates")
      .update(row)
      .eq("product_id", productId)
      .eq("updated_at", existingRow.updated_at)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new DraftConflictError();
    return hydrateAdminAssetUrls(templateFromRow(data), supabase);
  }

  const { data, error } = await supabase
    .from("product_customizer_templates")
    .upsert(row, { onConflict: "product_id" })
    .select("*")
    .single();

  if (error) throw error;
  return hydrateAdminAssetUrls(templateFromRow(data), supabase);
}
