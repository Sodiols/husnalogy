type AuditInput = {
  actorId: string;
  action: string;
  customizationId?: string | null;
  productId?: string | null;
  editorState?: any;
  details?: Record<string, unknown>;
};

function affectedLayerIds(editorState: any): string[] {
  const ids = new Set<string>();
  for (const id of Object.keys(editorState?.layerOverrides || {})) ids.add(id);
  for (const layer of editorState?.userLayers || []) {
    if (layer?.id) ids.add(String(layer.id));
  }
  return [...ids].slice(0, 500);
}

/** Best-effort append-only audit logging. A telemetry failure must not discard a valid customer save. */
export async function writeCustomizerAudit(supabase: any, input: AuditInput): Promise<void> {
  try {
    await supabase.from("customizer_audit_logs").insert({
      actor_id: input.actorId,
      customization_id: input.customizationId || null,
      product_id: input.productId || null,
      action: input.action,
      layer_ids: affectedLayerIds(input.editorState),
      details: input.details || {},
    });
  } catch {
    // Auditing is additive and may be unavailable during a rolling deployment.
  }
}
