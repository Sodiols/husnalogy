// Server-only template versioning (spec §19).
//
// The product_customizer_templates row is the working draft the admin builder
// edits and autosaves. Publishing snapshots that draft into an immutable
// customizer_template_versions row (a V2 CustomizerDocument). New customers
// always receive the latest published version; saved designs, cart items, and
// order snapshots keep the version they were created against.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCustomizerTemplateByProductId } from "@/lib/customizer/store";
import { validateCustomizerTemplateDetailed } from "@/lib/customizer";
import { templateToDocument } from "@/lib/customizer/v2/document";
import { collectFontDependencies } from "@/lib/customizer/v2/google-fonts";
import { getFontCatalogSafe } from "@/lib/customizer/v2/server/google-fonts-catalog";
import { CUSTOMIZER_ENGINE_VERSION, CUSTOMIZER_SCHEMA_VERSION } from "@/lib/customizer/v2/types";
import type { CustomizerRow } from "@/lib/supabase/database.types";
import { hydrateAdminAssetUrls, stripAdminAssetUrls } from "@/lib/customizer/server/admin-assets";
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

// Publish the current draft of a product's template as a new immutable
// version. Runs detailed validation first — blocking errors abort the publish.
export async function publishTemplateVersion(
  productId: string,
  publishedBy: string | null = null,
  notes = "",
  updateType: CustomizerUpdateType = "minor",
): Promise<
  | { ok: true; version: TemplateVersionRow; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] }
> {
  const template = await getCustomizerTemplateByProductId(productId);
  if (!template) return { ok: false, errors: ["This product has no customizer template."], warnings: [] };
  if (!template.enabled) return { ok: false, errors: ["Enable the customizer before publishing."], warnings: [] };

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

export async function getTemplateVersion(templateId: string, version: number): Promise<TemplateVersionRow | null> {
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
  const hydratedDocument = await hydrateAdminAssetUrls(data.document, supabase);
  return versionFromRow({ ...data, document: hydratedDocument });
}

// The trusted template a customization must be validated and rendered
// against: its exact published version snapshot when one exists, otherwise
// the live template row (legacy templates published before versioning).
export async function getTrustedTemplateForCustomization(customization: {
  templateId?: string;
  productId?: string;
  templateVersion?: number;
}): Promise<{ template: any; source: "version" | "live" } | null> {
  const templateId = customization.templateId || "";
  const version = Number(customization.templateVersion) || 0;

  if (templateId && version) {
    const snapshot = await getTemplateVersion(templateId, version);
    if (snapshot && snapshot.document && Object.keys(snapshot.document).length) {
      // V2 documents round-trip into the flat template shape for the V1
      // validators/renderers via the pages/layers overlap.
      const doc: any = snapshot.document;
      return {
        template: {
          id: snapshot.templateId,
          version: snapshot.version,
          enabled: true,
          engine: "svg",
          canvasWidthPx: doc.canvas?.widthPx,
          canvasHeightPx: doc.canvas?.heightPx,
          cardWidthIn: doc.canvas?.widthIn,
          cardHeightIn: doc.canvas?.heightIn,
          dpi: doc.canvas?.dpi,
          orientation: doc.canvas?.orientation,
          defaultPage: doc.pages?.[0]?.id || "front",
          pages: (doc.pages || []).map((page: any) => ({
            id: page.id,
            label: page.name,
            enabled: page.enabled,
            backgroundImage: page.backgroundImage || "",
            backgroundColor: page.backgroundColor || "#ffffff",
            thumbnail: page.thumbnail || page.backgroundImage || "",
            allowCustomerText: page.allowCustomerText,
          })),
          fields: doc.fields || [],
          layers: (doc.layers || []).map((layer: any) => ({
            ...layer,
            page: layer.pageId || layer.page,
          })),
          safeArea: doc.pages?.[0]?.safeArea || {},
          bleed: doc.pages?.[0]?.bleed || {},
          settings: doc.settings || {},
          assets: doc.assets || {},
        },
        source: "version",
      };
    }
  }

  if (customization.productId) {
    const live = await getCustomizerTemplateByProductId(customization.productId);
    if (live) return { template: live, source: "live" };
  }
  return null;
}
