import { createServiceRoleClient } from "@/lib/supabase/server";
import { createFlatMockupTemplate, validatePerspectivePoints, type MockupTemplate } from "@/lib/customizer/v2/mockups";
import { RenderError } from "@/lib/customizer/v2/server/render";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function validateMockupTemplate(template: MockupTemplate): string[] {
  const errors: string[] = [];
  if (!template.name?.trim()) errors.push("Mockup name is required.");
  if (!Number.isFinite(template.width) || template.width < 1 || !Number.isFinite(template.height) || template.height < 1) errors.push("Mockup dimensions are invalid.");
  if (!template.views?.length) errors.push("At least one mockup view is required.");
  for (const view of template.views || []) {
    if (!view.name?.trim()) errors.push(`View ${view.id || "unknown"} needs a name.`);
    if (!view.baseImageUrl && !view.baseImageAssetId) errors.push(`${view.name || view.id} needs a base image.`);
    if (!view.artworkAreas?.length) errors.push(`${view.name || view.id} needs at least one artwork area.`);
    for (const area of view.artworkAreas || []) {
      if (!area.sourcePageId) errors.push(`${view.name || view.id} has an artwork area without a source page.`);
      if (area.width <= 0 || area.height <= 0) errors.push(`${view.name || view.id} has an artwork area with invalid dimensions.`);
      if (area.warpType === "perspective") {
        const validation = validatePerspectivePoints(area.perspectivePoints || {
          topLeft: { x: area.x, y: area.y }, topRight: { x: area.x + area.width, y: area.y },
          bottomRight: { x: area.x + area.width, y: area.y + area.height }, bottomLeft: { x: area.x, y: area.y + area.height },
        });
        if (validation.valid === false) errors.push(`${view.name || view.id}: ${validation.reason}`);
      }
    }
  }
  return errors;
}

export async function loadNormalizedMockupTemplate(
  productId: string,
  options: { includeDraft?: boolean; client?: ServiceClient } = {},
): Promise<MockupTemplate | null> {
  if (!productId) return null;
  const supabase = options.client || createServiceRoleClient();
  let query = supabase.from("customizer_mockup_templates").select("*").eq("product_id", productId).eq("active", true);
  if (!options.includeDraft) query = query.eq("status", "published");
  let { data: templateRow, error } = await query.order("version", { ascending: false }).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error?.code === "42703") {
    const legacy = await supabase.from("customizer_mockup_templates").select("*").eq("product_id", productId).eq("active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    templateRow = legacy.data;
    error = legacy.error;
  }
  if (error) throw error;
  if (!templateRow) return null;
  const { data: viewRows, error: viewError } = await supabase.from("customizer_mockup_views").select("*").eq("mockup_template_id", templateRow.id).order("sort_order");
  if (viewError) throw viewError;
  const viewIds = (viewRows || []).map((row: any) => row.id);
  const [{ data: areaRows, error: areaError }, { data: overlayRows, error: overlayError }] = viewIds.length
    ? await Promise.all([
        supabase.from("customizer_mockup_artwork_areas").select("*").in("mockup_view_id", viewIds).order("sort_order"),
        supabase.from("customizer_mockup_overlays").select("*").in("mockup_view_id", viewIds).order("sort_order"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (areaError) throw areaError;
  if (overlayError) throw overlayError;
  const views = (viewRows || []).map((view: any) => ({
    id: view.id,
    name: view.name,
    baseImageAssetId: view.base_image_asset_id || undefined,
    baseImageUrl: view.base_image_url || undefined,
    width: number(view.width, number(templateRow.config?.width, 1600)),
    height: number(view.height, number(templateRow.config?.height, 1200)),
    sortOrder: number(view.sort_order),
    requiresTransparency: Boolean(view.requires_transparency),
    artworkAreas: (areaRows || []).filter((area: any) => area.mockup_view_id === view.id).map((area: any) => ({
      id: area.id,
      sourcePageId: area.source_page_id,
      x: number(area.x), y: number(area.y), width: number(area.width), height: number(area.height), rotation: number(area.rotation),
      clipPath: area.clip_path || undefined,
      perspectivePoints: area.perspective_points || undefined,
      warpType: area.warp_type || "none",
      opacity: number(area.opacity, 1),
      blendMode: area.blend_mode || undefined,
      sortOrder: number(area.sort_order),
      visible: area.visible !== false,
      locked: Boolean(area.locked),
    })),
    overlays: (overlayRows || []).filter((overlay: any) => overlay.mockup_view_id === view.id).map((overlay: any) => ({
      id: overlay.id,
      assetId: overlay.asset_id || undefined,
      src: overlay.src || undefined,
      type: overlay.overlay_type,
      opacity: number(overlay.opacity, 1),
      blendMode: overlay.blend_mode || undefined,
      sortOrder: number(overlay.sort_order),
      visible: overlay.visible !== false,
      locked: Boolean(overlay.locked),
    })),
  }));
  return {
    id: templateRow.id,
    productId,
    productType: templateRow.product_type || templateRow.config?.productType || "flat-card",
    name: templateRow.name,
    width: number(templateRow.config?.width, views[0]?.width || 1600),
    height: number(templateRow.config?.height, views[0]?.height || 1200),
    version: number(templateRow.version, 1),
    status: templateRow.status || "draft",
    views,
  };
}

export async function saveNormalizedMockupTemplate(productId: string, template: MockupTemplate, publish = false): Promise<MockupTemplate> {
  const errors = validateMockupTemplate(template);
  if (errors.length) throw new RenderError("MOCKUP_PERSPECTIVE_INVALID", errors[0]);
  const supabase = createServiceRoleClient();
  const { error } = await supabase.rpc("upsert_customizer_mockup", { p_product_id: productId, p_payload: template, p_publish: publish });
  if (error) throw error;
  const saved = await loadNormalizedMockupTemplate(productId, { includeDraft: !publish, client: supabase });
  if (!saved) throw new Error("Mockup was saved but could not be reloaded.");
  return saved;
}

export async function importLegacyMockupsForProduct(productId: string, legacyTemplates: unknown): Promise<{ imported: number; templates: MockupTemplate[] }> {
  const source = Array.isArray(legacyTemplates) ? legacyTemplates : [];
  const templates = source.length ? source : [createFlatMockupTemplate(productId)];
  const candidates = templates.map((raw) => ({ ...createFlatMockupTemplate(productId), ...(raw as any), productId } as MockupTemplate));
  const seen = new Set<string>();
  const mergedViews = candidates.flatMap((candidate, templateIndex) => candidate.views.map((view, viewIndex) => {
    let id = view.id || `view-${templateIndex + 1}-${viewIndex + 1}`;
    while (seen.has(id)) id = `${id}-${templateIndex + 1}`;
    seen.add(id);
    return { ...view, id, sortOrder: seen.size - 1 };
  }));
  const merged = { ...candidates[0], productId, views: mergedViews };
  const saved = await saveNormalizedMockupTemplate(productId, merged, false);
  return { imported: templates.length, templates: [saved] };
}
