// Server-only template versioning (spec §19).
//
// The product_customizer_templates row is the working draft the admin builder
// edits and autosaves. Publishing snapshots that draft into an immutable
// customizer_template_versions row (a V2 CustomizerDocument). New customers
// always receive the latest published version; saved designs, cart items, and
// order snapshots keep the version they were created against.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCustomizerTemplateByProductId } from "@/lib/customizer/store";
import { draftMatchesExpectedRevision } from "@/lib/customizer/draft-revision";
import { resolveLayerImageTransform, validateCustomizerTemplateDetailed } from "@/lib/customizer";
import { templateToDocument } from "@/lib/customizer/v2/document";

const sameInsets = (a: any, b: any) =>
  ["top", "right", "bottom", "left"].every((side) => Number(a?.[side] || 0) === Number(b?.[side] || 0));
import { collectFontDependencies } from "@/lib/customizer/v2/google-fonts";
import { getFontCatalogSafe } from "@/lib/customizer/v2/server/google-fonts-catalog";
import { CUSTOMIZER_ENGINE_VERSION, CUSTOMIZER_SCHEMA_VERSION } from "@/lib/customizer/v2/types";
import type { CustomizerRow } from "@/lib/supabase/database.types";
import { hydrateAdminAssetUrls, stripAdminAssetUrls, type AdminAssetAudience } from "@/lib/customizer/server/admin-assets";
import {
  formatCustomizerVersion,
  type CustomizerUpdateType,
} from "@/lib/customizer/public-version";

export type TemplateVersionRow = {
  id: string;
  templateId: string;
  productId: string;
  version: number;
  majorVersion: number;
  minorRevision: number;
  displayVersion: string;
  schemaVersion: number;
  engineVersion: string;
  document: Record<string, unknown>;
  fontDependencies: unknown[];
  publishedBy: string | null;
  notes: string;
  createdAt: string;
};

type TemplateVersionDatabaseRow = CustomizerRow<"customizer_template_versions">;

function versionFromRow(row: Partial<TemplateVersionDatabaseRow>): TemplateVersionRow {
  const majorVersion = Number(row.major_version) || 2;
  const minorRevision = Math.max(0, Number(row.minor_revision) || 0);
  return {
    id: row.id || "",
    templateId: row.template_id || "",
    productId: row.product_id || "",
    version: Number(row.version) || 1,
    majorVersion,
    minorRevision,
    displayVersion: formatCustomizerVersion({ major: majorVersion, revision: minorRevision }),
    schemaVersion: Number(row.schema_version) || 2,
    engineVersion: row.engine_version || "",
    document: (row.document && !Array.isArray(row.document) && typeof row.document === "object" ? row.document : {}) as Record<string, unknown>,
    fontDependencies: Array.isArray(row.font_dependencies) ? row.font_dependencies : [],
    publishedBy: row.published_by || null,
    notes: row.notes || "",
    createdAt: row.created_at || "",
  };
}

export { draftMatchesExpectedRevision };

// Publish the current draft of a product's template as a new immutable
// version. Runs detailed validation first — blocking errors abort the publish.
//
// `expectedDraftUpdatedAt` pins the publish to the draft revision the studio
// just saved: if anything else wrote the draft in between, the publish is
// refused (status "conflict") instead of freezing a revision nobody reviewed.
export async function publishTemplateVersion(
  productId: string,
  publishedBy: string | null = null,
  notes = "",
  updateType: CustomizerUpdateType = "minor",
  expectedDraftUpdatedAt: string | null = null,
): Promise<
  | { ok: true; version: TemplateVersionRow; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[]; conflict?: boolean }
> {
  const template = await getCustomizerTemplateByProductId(productId);
  if (!template) return { ok: false, errors: ["This product has no customizer template."], warnings: [] };
  if (!template.enabled) return { ok: false, errors: ["Enable the customizer before publishing."], warnings: [] };
  if (!draftMatchesExpectedRevision(template.updatedAt, expectedDraftUpdatedAt)) {
    return {
      ok: false,
      conflict: true,
      errors: ["The draft changed after it was saved. Save again, then publish."],
      warnings: [],
    };
  }

  const { errors, warnings } = validateCustomizerTemplateDetailed(template);
  if (errors.length) return { ok: false, errors, warnings };

  const { document, warnings: migrationWarnings } = templateToDocument(stripAdminAssetUrls(template));
  const textStyles = document.layers
    .filter((layer) => layer.type === "text")
    .map((layer: any) => layer.textStyle || {});
  // Freeze the exact Google Font variants this published version depends on,
  // so a later catalog change can never silently alter a published template.
  const fontCatalog = await getFontCatalogSafe();
  const fonts = collectFontDependencies(fontCatalog, textStyles);

  const supabase = createServiceRoleClient();

  // The database transaction serializes publications per template, calculates
  // both the internal snapshot sequence and public release identifier, inserts
  // the immutable row, and updates the draft's internal snapshot reference.
  const { data, error } = await (supabase.rpc as any)("publish_customizer_template_version", {
    p_template_id: template.id,
    p_product_id: productId,
    p_update_type: updateType,
    p_schema_version: CUSTOMIZER_SCHEMA_VERSION,
    p_engine_version: CUSTOMIZER_ENGINE_VERSION,
    p_document: document,
    p_font_dependencies: fonts.dependencies,
    p_published_by: publishedBy,
    p_notes: notes,
  });
  if (error) throw error;

  return {
    ok: true,
    version: versionFromRow(data),
    warnings: [...warnings, ...migrationWarnings.map((w) => w.message)],
  };
}

export async function listTemplateVersions(templateId: string): Promise<TemplateVersionRow[]> {
  if (!templateId) return [];
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_template_versions")
    .select("id, template_id, product_id, version, major_version, minor_revision, schema_version, engine_version, published_by, notes, created_at, font_dependencies")
    .eq("template_id", templateId)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => versionFromRow({ ...row, document: {} }));
}

export async function getTemplateVersion(
  templateId: string,
  version: number,
  audience: AdminAssetAudience = "customer",
): Promise<TemplateVersionRow | null> {
  if (!templateId || !version) return null;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .eq("version", version)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const hydratedDocument = await hydrateAdminAssetUrls(data.document, supabase, undefined, audience);
  return versionFromRow({ ...data, document: hydratedDocument });
}


/**
 * An immutable published snapshot, in the flat template shape the editor, the
 * validators and the renderers all consume.
 *
 * V2 documents round-trip into that shape through the pages/layers overlap.
 * This is deliberately the ONE conversion: the public customizer, the save
 * validator and the print renderer must all be looking at the same bytes, or a
 * customer can be shown one design and sold another.
 */
export function templateFromVersionSnapshot(snapshot: TemplateVersionRow | null): any | null {
  if (!snapshot || !snapshot.document || !Object.keys(snapshot.document).length) return null;
  const doc: any = snapshot.document;
  const pages = Array.isArray(doc.pages) ? doc.pages : [];
  const enabledPages = pages.filter((page: any) => page?.enabled !== false);
  // The configured opening page; documents published before it was carried
  // (and any stale id) fall back to the first enabled page.
  const defaultPage =
    enabledPages.find((page: any) => page.id === doc.defaultPageId)?.id ||
    enabledPages[0]?.id ||
    pages[0]?.id ||
    "front";
  return {
    id: snapshot.templateId,
    version: snapshot.version,
    publicVersion: snapshot.displayVersion,
    enabled: true,
    engine: "svg",
    canvasWidthPx: doc.canvas?.widthPx,
    canvasHeightPx: doc.canvas?.heightPx,
    cardWidthIn: doc.canvas?.widthIn,
    cardHeightIn: doc.canvas?.heightIn,
    dpi: doc.canvas?.dpi,
    orientation: doc.canvas?.orientation,
    defaultPage,
    pages: pages.map((page: any) => ({
      id: page.id,
      label: page.name,
      enabled: page.enabled,
      backgroundImage: page.backgroundImage || "",
      backgroundColor: page.backgroundColor || "#ffffff",
      thumbnail: page.thumbnail || page.backgroundImage || "",
      allowCustomerText: page.allowCustomerText,
      // Durable background identity: what re-signs the background (editor
      // variant for customers, original for production) once URLs expire.
      ...(page.backgroundAssetId ? { backgroundAssetId: page.backgroundAssetId } : {}),
      ...(page.bucket ? { bucket: page.bucket } : {}),
      ...(page.originalPath ? { originalPath: page.originalPath } : {}),
      ...(page.editorPath ? { editorPath: page.editorPath } : {}),
      ...(page.thumbnailPath ? { thumbnailPath: page.thumbnailPath } : {}),
      // The template-level safe area is the first page's; any page whose own
      // differs keeps it, so every renderer resolves the same per-page area.
      ...(page.safeArea && !sameInsets(page.safeArea, doc.pages?.[0]?.safeArea) ? { safeArea: page.safeArea } : {}),
    })),
    fields: doc.fields || [],
    layers: (doc.layers || []).map((layer: any) => {
      const flat: any = { ...layer, page: layer.pageId || layer.page };
      // Renderers read crop state as `imageTransform`; the document stores it
      // as `transform`. Only the known crop keys are carried across.
      if ((layer.type === "image" || layer.type === "frame") && !layer.imageTransform) {
        const crop = resolveLayerImageTransform({ transform: layer.transform });
        if (crop) flat.imageTransform = crop;
      }
      return flat;
    }),
    safeArea: doc.pages?.[0]?.safeArea || {},
    bleed: doc.pages?.[0]?.bleed || {},
    guides: Array.isArray(doc.guides) ? doc.guides : [],
    settings: doc.settings || {},
    assets: doc.assets || {},
  };
}

/**
 * The newest published snapshot for a product, or null when nothing has been
 * published yet.
 *
 * This is what a NEW customer must be given. The working draft in
 * `product_customizer_templates` is the designer's scratch pad: it changes on
 * every autosave, it has not been reviewed, and it is not what the save
 * validator or the print renderer will use. Serving it to the public means the
 * customer designs against one document and is sold another.
 */
export async function getLatestPublishedVersion(productId: string): Promise<TemplateVersionRow | null> {
  if (!productId) return null;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_template_versions")
    .select("*")
    .eq("product_id", productId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const hydratedDocument = await hydrateAdminAssetUrls(data.document, supabase, undefined, "customer");
  return versionFromRow({ ...data, document: hydratedDocument });
}

/**
 * The template a NEW public customizer session runs against: the latest
 * published version. A saved customization never comes through here — it
 * opens on its own exact version (`getExactPublishedVersion`).
 */
export async function getPublicCustomizerTemplate(productId: string): Promise<{ template: any; snapshot: TemplateVersionRow } | null> {
  const latest = await getLatestPublishedVersion(productId);
  const template = templateFromVersionSnapshot(latest);
  if (!template || !latest) return null;
  return { template, snapshot: latest };
}

export type ExactVersionResult =
  | { status: "ok"; template: any; snapshot: TemplateVersionRow }
  | { status: "unavailable"; reason: "missing" | "wrong-product" | "unreadable" };

/**
 * EXACTLY the immutable version a saved customization was made on — never a
 * substitute. A version that is missing, belongs to another product or cannot
 * be read right now is reported as unavailable; the caller blocks the editor
 * rather than open the design on artwork the customer never chose (the next
 * autosave would then rewrite their saved design against it).
 */
export async function getExactPublishedVersion(productId: string, templateId: string, version: number): Promise<ExactVersionResult> {
  if (!productId || !templateId || !(Number(version) > 0)) return { status: "unavailable", reason: "missing" };
  let snapshot: TemplateVersionRow | null;
  try {
    snapshot = await getTemplateVersion(templateId, Number(version));
  } catch {
    return { status: "unavailable", reason: "unreadable" };
  }
  if (!snapshot) return { status: "unavailable", reason: "missing" };
  if (snapshot.productId !== productId) return { status: "unavailable", reason: "wrong-product" };
  const template = templateFromVersionSnapshot(snapshot);
  if (!template) return { status: "unavailable", reason: "missing" };
  return { status: "ok", template, snapshot };
}

export type SessionTemplate =
  | { kind: "latest"; template: any; snapshot: TemplateVersionRow }
  | { kind: "pinned"; template: any; snapshot: TemplateVersionRow }
  | { kind: "unavailable"; templateVersion: number }
  | { kind: "none" };

/**
 * Which template the /personalize page opens.
 *
 *  - A `customizationId` the signed-in customer owns, for THIS product, opens
 *    on that design's own template id and version — or is BLOCKED when that
 *    exact version cannot be loaded (never the latest, never the draft).
 *  - Anything else (no id, a local id, a guest, someone else's or a guessed
 *    id) opens a new session on the latest published version, revealing
 *    nothing about the id; the editor then reports the design as not found.
 *  - "none" when nothing has been published.
 */
export async function resolveSessionTemplate(input: { productId: string; customizationId: string; userId: string }): Promise<SessionTemplate> {
  const customizationId = String(input.customizationId || "");
  if (customizationId && !customizationId.startsWith("local_") && input.userId) {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("product_customizations")
      .select("template_id,template_version,product_id,user_id")
      .eq("id", customizationId)
      .maybeSingle();
    // The design exists but cannot be read: its version is unknown, so no
    // version may be assumed for it.
    if (error) return { kind: "unavailable", templateVersion: 0 };
    if (data && data.product_id === input.productId && data.user_id === input.userId) {
      const templateVersion = Number(data.template_version) || 0;
      if (templateVersion > 0) {
        const exact = await getExactPublishedVersion(input.productId, String(data.template_id || ""), templateVersion);
        if (exact.status === "ok") return { kind: "pinned", template: exact.template, snapshot: exact.snapshot };
        return { kind: "unavailable", templateVersion };
      }
    }
  }
  const latest = await getPublicCustomizerTemplate(input.productId);
  return latest ? { kind: "latest", ...latest } : { kind: "none" };
}

/** Whether any version of this template was ever published. */
async function templateHasPublishedVersions(templateId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_template_versions")
    .select("id")
    .eq("template_id", templateId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// The trusted template a customization must be validated and rendered
// against: its exact published version snapshot when one exists, otherwise
// the live template row (legacy templates published before versioning).
//
// Identity binding: a template id and version are only honoured when that
// version was published FOR THE CUSTOMIZATION'S PRODUCT. Previously any
// (templateId, version) pair resolved, so a customization for product A could
// be validated and rendered against product B's template.
export async function getTrustedTemplateForCustomization(customization: {
  templateId?: string;
  productId?: string;
  templateVersion?: number;
}): Promise<{ template: any; source: "version" | "live"; versionId?: string } | null> {
  const templateId = customization.templateId || "";
  const productId = customization.productId || "";
  const version = Number(customization.templateVersion) || 0;
  if (!productId) return null;

  if (templateId && version) {
    const snapshot = await getTemplateVersion(templateId, version);
    if (snapshot && snapshot.productId !== productId) return null;
    const template = templateFromVersionSnapshot(snapshot);
    if (template && snapshot) return { template, source: "version", versionId: snapshot.id };
    // The exact snapshot is gone. Once a template has published versions, a
    // design made on one of them is never validated or rendered against
    // anything else — least of all the unreviewed working draft. Only a
    // template that predates versioning still resolves to its live row.
    if (await templateHasPublishedVersions(templateId)) return null;
  }

  const live = await getCustomizerTemplateByProductId(productId);
  if (!live) return null;
  // A template id that belongs to a different product is a mismatch, not a
  // reason to fall back to this product's template.
  if (templateId && String(live.id) !== templateId) return null;
  return { template: live, source: "live" };
}
