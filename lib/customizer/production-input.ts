/** Versioned manufacturing contract. No live catalogue or customer lookups. */
import { createHash } from "node:crypto";
import { isCustomizerFeatureEnabled } from "@/lib/customizer/v2/feature-flags";
import type { GoogleFontFamily, FontDependency } from "@/lib/customizer/v2/google-fonts";

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const PRODUCTION_RENDERER_VERSION = "husnalogy-snapshot-1";
export const ORDER_ASSET_BUCKET = "order-production";
export type ProductionAsset = { key: string; bucket: string; path: string; checksum: string; size: number; mimeType: string; kind: "image" | "font" | "license" | "document" };
export type ProductionFont = FontDependency & { assetKey: string; licenseKey: string; provider: "google-fonts"; version: string };
export type ProductionInput = {
  rendererVersion: string;
  mode: "automatic" | "manual";
  requiredJobTypes: Array<"print_png" | "print_pdf">;
  template: Record<string, any>;
  values: Record<string, any>;
  editorState: any;
  assets: ProductionAsset[];
  fonts: ProductionFont[];
  fontCatalog: GoogleFontFamily[];
  instructions?: Record<string, unknown>;
};

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
/** JSONB key order must never affect integrity. */
export function productionIntegrityHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function makeProductionInput(template: Record<string, any>, values: any, editorState: any): ProductionInput {
  const automatic = isCustomizerFeatureEnabled(template, "customizer_v2_server_rendering");
  return JSON.parse(JSON.stringify({
    rendererVersion: PRODUCTION_RENDERER_VERSION,
    mode: automatic ? "automatic" : "manual",
    requiredJobTypes: automatic ? ["print_png", ...(isCustomizerFeatureEnabled(template, "customizer_v2_print_pdf") ? ["print_pdf"] : [])] : [],
    template, values, editorState, assets: [], fonts: [], fontCatalog: [],
  }));
}

export function readProductionSnapshot(row: any): ProductionInput {
  const snapshot = row?.snapshot;
  if (row?.snapshot_schema_version !== SNAPSHOT_SCHEMA_VERSION || snapshot?.snapshotSchemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`SNAPSHOT_SCHEMA_UNSUPPORTED: ${row?.snapshot_schema_version ?? 0}; historical design requires reviewed remediation.`);
  }
  if (productionIntegrityHash(snapshot) !== row.integrity_hash) throw new Error("SNAPSHOT_INTEGRITY_INVALID: manufacturing input checksum differs.");
  const input = snapshot.production as ProductionInput;
  if (!input || input.rendererVersion !== PRODUCTION_RENDERER_VERSION) throw new Error("SNAPSHOT_RENDERER_UNSUPPORTED: retain the versioned renderer for historical orders.");
  if (!["manual", "automatic"].includes(input.mode) || !Array.isArray(input.requiredJobTypes) || !Array.isArray(input.assets) || !Array.isArray(input.fonts) || !Array.isArray(input.fontCatalog)) throw new Error("SNAPSHOT_INPUT_INVALID");
  if (input.mode !== row.production_mode || new Set(input.requiredJobTypes).size !== input.requiredJobTypes.length || (input.mode === "manual" && input.requiredJobTypes.length > 0) || (input.mode === "automatic" && (!input.requiredJobTypes.includes("print_png") || input.requiredJobTypes.some((type) => !["print_png", "print_pdf"].includes(type))))) throw new Error("SNAPSHOT_MODE_INVALID");
  const template = input.template;
  for (const key of input.mode === "manual" && input.instructions ? [] : ["canvasWidthPx", "canvasHeightPx", "cardWidthIn", "cardHeightIn", "dpi"]) {
    if (!Number.isFinite(Number(template?.[key])) || Number(template[key]) <= 0) throw new Error(`SNAPSHOT_DIMENSIONS_INVALID: ${key}`);
  }
  if (!(input.mode === "manual" && input.instructions) && !template.pages?.some((page: any) => page.enabled !== false)) throw new Error("SNAPSHOT_PAGES_INVALID");
  if (input.mode === "automatic") {
    const width = Number(template.canvasWidthPx) + Number(template.bleed?.left || 0) + Number(template.bleed?.right || 0);
    const height = Number(template.canvasHeightPx) + Number(template.bleed?.top || 0) + Number(template.bleed?.bottom || 0);
    const pages = template.pages.filter((page: any) => page.enabled !== false);
    if (!Number.isFinite(width * height) || width > 12000 || height > 12000 || width * height > 50_000_000 || width * height * pages.length > 200_000_000 || Number(template.dpi) > 1200) throw new Error("SNAPSHOT_RENDER_LIMIT_EXCEEDED: review production dimensions before checkout.");
    if (pages.length > 32 || new Set(pages.map((page: any) => page.id)).size !== pages.length || pages.some((page: any) => !/^[a-zA-Z0-9_-]{1,100}$/.test(page.id))) throw new Error("SNAPSHOT_PAGES_INVALID");
    if (Object.values(template.bleed || {}).some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error("SNAPSHOT_DIMENSIONS_INVALID: bleed");
  }
  if (input.assets.length > 256 || input.fonts.length > 100) throw new Error("SNAPSHOT_ASSET_LIMIT_EXCEEDED");
  const keys = new Set<string>();
  for (const asset of input.assets) {
    if (keys.has(asset.key) || !["image", "font", "license", "document"].includes(asset.kind) || (asset.kind === "document" && input.mode !== "manual") || asset.key !== asset.checksum || !/^[a-f0-9]{64}$/.test(asset.checksum) || asset.bucket !== ORDER_ASSET_BUCKET || asset.path !== `orders/${row.order_id}/assets/${asset.checksum}` || !Number.isInteger(asset.size) || asset.size < 1 || asset.size > 30 * 1024 * 1024) throw new Error("SNAPSHOT_ASSET_INVALID");
    keys.add(asset.key);
  }
  for (const font of input.fonts) if (!keys.has(font.assetKey) || !keys.has(font.licenseKey)) throw new Error("SNAPSHOT_FONT_INVALID");
  return input;
}
