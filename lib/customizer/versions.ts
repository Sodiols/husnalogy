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
import { collectFontDependencies } from "@/lib/customizer/v2/fonts";
import { CUSTOMIZER_ENGINE_VERSION, CUSTOMIZER_SCHEMA_VERSION } from "@/lib/customizer/v2/types";

export type TemplateVersionRow = {
  id: string;
  templateId: string;
  productId: string;
  version: number;
  schemaVersion: number;
  engineVersion: string;
  document: Record<string, unknown>;
  fontDependencies: unknown[];
  publishedBy: string | null;
  notes: string;
  createdAt: string;
};

function versionFromRow(row: any): TemplateVersionRow {
  return {
    id: row.id,
    templateId: row.template_id,
    productId: row.product_id || "",
    version: Number(row.version) || 1,
    schemaVersion: Number(row.schema_version) || 2,
    engineVersion: row.engine_version || "",
    document: row.document || {},
    fontDependencies: Array.isArray(row.font_dependencies) ? row.font_dependencies : [],
    publishedBy: row.published_by || null,
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

// Publish the current draft of a product's template as a new immutable
// version. Runs detailed validation first — blocking errors abort the publish.
export async function publishTemplateVersion(
  productId: string,
  publishedBy: string | null = null,
  notes = "",
): Promise<
  | { ok: true; version: TemplateVersionRow; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] }
> {
  const template = await getCustomizerTemplateByProductId(productId);
  if (!template) return { ok: false, errors: ["This product has no customizer template."], warnings: [] };
  if (!template.enabled) return { ok: false, errors: ["Enable the customizer before publishing."], warnings: [] };

  const { errors, warnings } = validateCustomizerTemplateDetailed(template);
  if (errors.length) return { ok: false, errors, warnings };

  const { document, warnings: migrationWarnings } = templateToDocument(template);
  const textStyles = document.layers
    .filter((layer) => layer.type === "text")
    .map((layer: any) => layer.textStyle || {});
  const fonts = collectFontDependencies(textStyles);

  const supabase = createServiceRoleClient();

  // Next version = one past the highest published version (independent of the
  // draft's structural version counter, which may lag behind).
  const { data: latest, error: latestError } = await supabase
    .from("customizer_template_versions")
    .select("version")
    .eq("template_id", template.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  const nextVersion = Math.max(Number(latest?.version) || 0, Number(template.version) || 0) + 1;

  const { data, error } = await supabase
    .from("customizer_template_versions")
    .insert({
      template_id: template.id,
      product_id: productId,
      version: nextVersion,
      schema_version: CUSTOMIZER_SCHEMA_VERSION,
      engine_version: CUSTOMIZER_ENGINE_VERSION,
      document: { ...document, templateVersion: nextVersion },
      font_dependencies: fonts.files,
      published_by: publishedBy,
      notes,
    })
    .select("*")
    .single();
  if (error) throw error;

  // The draft row's version now tracks the published version so new
  // customizations record the right number.
  const { error: bumpError } = await supabase
    .from("product_customizer_templates")
    .update({ version: nextVersion })
    .eq("id", template.id);
  if (bumpError) throw bumpError;

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
    .select("id, template_id, product_id, version, schema_version, engine_version, published_by, notes, created_at, font_dependencies")
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
  return data ? versionFromRow(data) : null;
}

export async function getLatestTemplateVersion(templateId: string): Promise<TemplateVersionRow | null> {
  if (!templateId) return null;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? versionFromRow(data) : null;
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
