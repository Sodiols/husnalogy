// Server-only persistence for customizer templates.
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  normalizeCustomizerTemplate,
  prepareCustomizerTemplateForSave,
  shouldBumpTemplateVersion,
  templateFromRow,
  templateToRow,
} from "@/lib/customizer";

export async function getCustomizerTemplateByProductId(productId: string) {
  if (!productId) return null;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("product_customizer_templates")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle();

  if (error) throw error;
  return data ? templateFromRow(data) : null;
}

// Upsert a product's template, bumping the version when the editable structure
// changed (Part 13). One row per product (product_id is unique).
export async function saveCustomizerTemplate(productId: string, template: any) {
  if (!productId) return null;
  const supabase = createServiceRoleClient();

  const { data: existingRow, error: readError } = await supabase
    .from("product_customizer_templates")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle();
  if (readError) throw readError;

  const existing = existingRow ? templateFromRow(existingRow) : null;
  // Reconcile layer<->field connections before persisting so customer-editable
  // layers always have a saved field and orphans are dropped.
  const next = normalizeCustomizerTemplate(prepareCustomizerTemplateForSave(template), existing || {});

  if (existing) {
    next.version = shouldBumpTemplateVersion(existing, next)
      ? Number(existing.version || 1) + 1
      : Number(existing.version || 1);
  } else {
    next.version = 1;
  }

  const row = templateToRow(productId, next);

  const { data, error } = await supabase
    .from("product_customizer_templates")
    .upsert(row, { onConflict: "product_id" })
    .select("*")
    .single();

  if (error) throw error;
  return templateFromRow(data);
}

export async function deleteCustomizerTemplate(productId: string) {
  if (!productId) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("product_customizer_templates").delete().eq("product_id", productId);
  if (error) throw error;
}
