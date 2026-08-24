// Trusted resolution of customer element layers (spec §44, §45).
//
// A customer element layer names a permanent Husnalogy asset by `assetId`.
// Everything else on the layer — `src`, `url`, `bucket`, `path`, dimensions —
// is a DISPLAY HINT supplied by the browser and is never authoritative.
//
// This module answers one question the server must not take on trust:
// does this assetId name a real, ready, customer-usable asset?

import { createServiceRoleClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ElementAssetVerdict = {
  /** assetIds that resolved to a usable asset. */
  allowed: Set<string>;
  /** assetIds that did not — forged, deleted, archived or admin-only. */
  rejected: Set<string>;
};

/** Every element-layer assetId referenced by a submitted editor state. */
export function collectElementAssetIds(editorState: any): string[] {
  const ids = new Set<string>();
  for (const layer of editorState?.userLayers || []) {
    if (layer?.type !== "element") continue;
    const assetId = String(layer?.assetId || "").trim();
    if (assetId) ids.add(assetId);
  }
  return [...ids];
}

/**
 * Resolve assetIds against `customizer_assets`.
 *
 * An id is allowed only when the row exists AND is ready, active, not archived
 * and customer-available. A syntactically invalid id is rejected without a
 * query — a forged value must never reach the database as a filter.
 */
export async function verifyElementAssets(
  assetIds: string[],
  options: { supabase?: any } = {},
): Promise<ElementAssetVerdict> {
  const allowed = new Set<string>();
  const rejected = new Set<string>();

  const candidates = assetIds.filter((id) => {
    if (UUID.test(id)) return true;
    rejected.add(id);
    return false;
  });
  if (!candidates.length) return { allowed, rejected };

  const supabase = options.supabase || createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_assets")
    .select("id,status,active,archived,customer_available")
    .in("id", candidates);

  if (error) {
    // Fail closed: an unverifiable asset is not a usable asset.
    console.error("[customizer] Could not verify element assets:", error.message);
    candidates.forEach((id) => rejected.add(id));
    return { allowed, rejected };
  }

  const byId = new Map((data || []).map((row: any) => [String(row.id), row]));
  for (const id of candidates) {
    const row: any = byId.get(id);
    const usable = Boolean(
      row
        && row.status === "ready"
        && row.active
        && !row.archived
        && row.customer_available,
    );
    if (usable) allowed.add(id);
    else rejected.add(id);
  }

  return { allowed, rejected };
}

/**
 * Drop element layers whose asset could not be verified, and strip the
 * client's display hints from the ones that survive — those are re-derived
 * from the permanent asset on read, so an expired or forged URL can never
 * become part of the saved design (spec §42, §43).
 */
export function applyElementAssetVerdict(editorState: any, verdict: ElementAssetVerdict) {
  if (!editorState?.userLayers?.length) return { editorState, removed: [] as string[] };

  const removed: string[] = [];
  const userLayers = editorState.userLayers.filter((layer: any) => {
    if (layer?.type !== "element") return true;
    const assetId = String(layer?.assetId || "").trim();
    if (verdict.allowed.has(assetId)) return true;
    removed.push(assetId || "(missing)");
    return false;
  }).map((layer: any) => {
    if (layer?.type !== "element") return layer;
    // `assetId` is the authority; the rest is re-signed on read.
    const { src, url, originalUrl, thumbnailUrl, editorUrl, expiresAt, ...rest } = layer;
    return rest;
  });

  return { editorState: { ...editorState, userLayers }, removed };
}
