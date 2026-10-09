/** Checkout pins bytes; rendering opens only the private, checksum-bound copies. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as opentype from "opentype.js";
import { withGposKerning } from "@/lib/customizer/v2/gpos-kerning";
import sharp from "sharp";
import { ORDER_ASSET_BUCKET, type ProductionAsset, type ProductionInput } from "@/lib/customizer/production-input";
import { collectPageImageUrls } from "@/lib/customizer/v2/svg";
import { getEnabledPages, getEffectiveLayersForPage } from "@/app/components/customizer/customizer-utils";
import { collectFontDependencies, type GoogleFontFamily } from "@/lib/customizer/v2/google-fonts";
import { collectTextStyles } from "@/lib/customizer/v2/server/server-fonts";
import { readFontBuffer } from "@/lib/customizer/v2/server/google-font-files";
import { getFontCatalog } from "@/lib/customizer/v2/server/google-fonts-catalog";
import { loadTrustedImageBuffer, RenderError } from "@/lib/customizer/v2/server/render";
import { sniffImageType, sanitizeSvg } from "@/lib/customizer/v2/uploads";
import { readBodyBytes } from "@/lib/http/read-body";
import { validateProductionPdf } from "@/lib/customizer/server/production-pdf";
import { ProductionAssetBudget, ProductionLimitError, renderBoundsErrors } from "@/lib/customizer/production-limits";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export interface ProductionStorage {
  put(path: string, bytes: Buffer, mimeType: string): Promise<void>;
  get(path: string): Promise<Buffer>;
}
export function productionStorage(supabase: any): ProductionStorage {
  return {
    async put(path, bytes, mimeType) {
      const { error } = await supabase.storage.from(ORDER_ASSET_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
      // Duplicate content in the same order is safe only after read-back below.
      if (error && String(error.statusCode) !== "409" && !/already exists|duplicate/i.test(error.message || "")) throw error;
    },
    async get(path) {
      const { data, error } = await supabase.storage.from(ORDER_ASSET_BUCKET).download(path);
      if (error || !data) throw new RenderError("ASSET_NOT_FOUND", "An immutable order asset is unavailable.");
      if (data.size > 30 * 1024 * 1024) throw new RenderError("ASSET_REFERENCE_INVALID", "Order asset exceeds its size bound.");
      return Buffer.from(await data.arrayBuffer());
    },
  };
}
export async function readProductionAsset(asset: ProductionAsset, storage: ProductionStorage): Promise<Buffer> {
  const bytes = await storage.get(asset.path);
  if (bytes.length !== asset.size || digest(bytes) !== asset.checksum) throw new RenderError("ASSET_REFERENCE_INVALID", "Immutable order asset checksum verification failed.");
  return bytes;
}

function replaceSources<T>(value: T, sources: Map<string, string>, property = ""): T {
  if (typeof value === "string") return (["src", "url", "signedUrl", "backgroundImage", "placeholderImage"].includes(property) ? sources.get(value) ?? value : value) as T;
  if (Array.isArray(value)) return value.map((child) => replaceSources(child, sources, property)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceSources(child, sources, key)])) as T;
  return value;
}

/** Retain the original open-source notice with the font. Unknown licences fail checkout. */
export async function loadGoogleFontLicense(family: string): Promise<Buffer> {
  const directory = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const path of [`ofl/${directory}/OFL.txt`, `apache/${directory}/LICENSE.txt`, `ufl/${directory}/LICENCE.txt`]) {
    const response = await fetch(`https://raw.githubusercontent.com/google/fonts/main/${path}`, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) continue;
    if (!response.ok) throw new RenderError("FONT_FILE_MISSING", `Font license unavailable for ${family}.`);
    const bytes = Buffer.from(await readBodyBytes(response, 64 * 1024));
    if (bytes.length > 64 * 1024 || !/SIL OPEN FONT LICENSE|Apache License|Ubuntu Font Licen[cs]e/i.test(bytes.toString("utf8"))) throw new RenderError("FONT_FILE_MISSING", `Unrecognized font license for ${family}.`);
    return bytes;
  }
  throw new RenderError("FONT_FILE_MISSING", `The license for ${family} must be verified before storing a production font.`);
}

export async function pinProductionInput(orderId: string, input: ProductionInput, storage: ProductionStorage, deps: {
  loadImage?: typeof loadTrustedImageBuffer;
  catalog?: () => Promise<GoogleFontFamily[]>;
  loadFont?: typeof readFontBuffer;
  loadLicense?: typeof loadGoogleFontLicense;
  /** Order-wide budget shared by every line of one checkout. */
  budget?: ProductionAssetBudget;
} = {}): Promise<ProductionInput> {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(orderId)) throw new Error("Invalid production order identity.");
  const budget = deps.budget || new ProductionAssetBudget();
  // Cheap bounds first: a template whose print canvas is out of range is
  // refused before a single byte is downloaded.
  // (Templates without print dimensions are refused by readProductionSnapshot.)
  // Trusted limits from the PUBLISHED template — never from the customer.
  if (input.mode === "automatic" && (input.template?.canvasWidthPx !== undefined || input.template?.canvasHeightPx !== undefined)) {
    const boundsErrors = renderBoundsErrors(input.template);
    if (boundsErrors.length) {
      throw new ProductionLimitError("printCanvas", `This product's print size cannot be produced automatically (${boundsErrors[0]}) Please contact us to order it.`);
    }
  }
  const assets = new Map<string, ProductionAsset>();
  const pin = async (bytes: Buffer, mimeType: string, kind: ProductionAsset["kind"]) => {
    if (!bytes.length || bytes.length > budget.limits.maxFileBytes) throw new ProductionLimitError("maxFileBytes", "A file in your design exceeds the 30 MB limit.");
    const checksum = digest(bytes);
    const asset = { key: checksum, bucket: ORDER_ASSET_BUCKET, path: `orders/${orderId}/assets/${checksum}`, checksum, size: bytes.length, mimeType, kind };
    if (!assets.has(checksum)) {
      budget.reserveAsset(checksum, bytes.length, kind);
      // Recorded before the upload: a stored object may exist even when the
      // response is lost, and a failed checkout must be able to remove it.
      budget.recordStored(asset.path);
      await storage.put(asset.path, bytes, mimeType);
      await readProductionAsset(asset, storage);
      assets.set(checksum, asset);
    }
    return asset;
  };
  const urls = new Set<string>();
  for (const page of getEnabledPages(input.template)) for (const url of collectPageImageUrls(input.template, input.values, input.editorState, page.id)) urls.add(url);
  budget.assertDesignCounts(urls.size, 0);
  const replacements = new Map<string, string>();
  for (const source of urls) {
    budget.assertTime();
    const bytes = await (deps.loadImage || loadTrustedImageBuffer)(source);
    if (bytes.length > budget.limits.maxFileBytes) throw new ProductionLimitError("maxFileBytes", "A file in your design exceeds the 30 MB limit.");
    if (input.mode === "manual" && bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
      await validateProductionPdf(bytes);
      const asset = await pin(bytes, "application/pdf", "document");
      replacements.set(source, `order-asset:${asset.key}`);
      continue;
    }
    const type = sniffImageType(bytes, true);
    if (!type.ok) throw new RenderError("IMAGE_DECODE_FAILED", "Production image type is unsupported.");
    // Re-sanitize vector originals; never persist scripts or external hrefs.
    const sanitized = type.mime === "image/svg+xml" ? sanitizeSvg(bytes.toString("utf8")) : null;
    if (sanitized && sanitized.ok === false) throw new RenderError("IMAGE_DECODE_FAILED", sanitized.error);
    const safe = sanitized?.ok ? Buffer.from(sanitized.svg) : bytes;
    if (sanitized?.ok && /<(?:text|animate|animateTransform|animateMotion|set)\b/i.test(sanitized.svg)) throw new RenderError("IMAGE_DECODE_FAILED", "Production vectors must have outlined text and static geometry.");
    // Header only (no decode): reserve the decoded size before decoding.
    let pixels = 0;
    try {
      const meta = await sharp(safe, { limitInputPixels: false }).metadata();
      pixels = Number(meta.width) * Number(meta.height) * Math.max(1, Number(meta.pages) || 1);
    } catch { throw new RenderError("IMAGE_DECODE_FAILED", "Production image bytes cannot be decoded safely."); }
    budget.reservePixels(pixels);
    try { await sharp(safe, { limitInputPixels: budget.limits.maxImagePixels, failOn: "error" }).resize(1, 1).raw().toBuffer(); }
    catch { throw new RenderError("IMAGE_DECODE_FAILED", "Production image bytes cannot be decoded safely."); }
    const asset = await pin(safe, type.mime, "image");
    replacements.set(source, `order-asset:${asset.key}`);
  }
  const styles = collectTextStyles(input.template, input.editorState);
  const catalog = styles.length ? await (deps.catalog || getFontCatalog)() : [];
  const { dependencies, missingFamilies } = collectFontDependencies(catalog, styles);
  if (missingFamilies.length) throw new RenderError("FONT_FILE_MISSING", `Required fonts unavailable: ${missingFamilies.join(", ")}`);
  budget.assertDesignCounts(urls.size, dependencies.length);
  const fonts: ProductionInput["fonts"] = [];
  const licenses = new Map<string, ProductionAsset>();
  for (const font of dependencies) {
    budget.assertTime();
    const bytes = await (deps.loadFont || readFontBuffer)(font);
    // A parse failure must not fall through to fallback measurement.
    try { opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
    catch { throw new RenderError("FONT_FILE_MISSING", `Required font cannot be parsed: ${font.family} ${font.variantKey}`); }
    const asset = await pin(bytes, "font/ttf", "font");
    if (!licenses.has(font.family)) licenses.set(font.family, await pin(await (deps.loadLicense || loadGoogleFontLicense)(font.family), "text/plain", "license"));
    fonts.push({ ...font, assetKey: asset.key, licenseKey: licenses.get(font.family)!.key, provider: "google-fonts", version: catalog.find((entry) => entry.family === font.family)?.version || "" });
  }
  const imageFields = new Set<string>();
  for (const page of getEnabledPages(input.template)) for (const layer of getEffectiveLayersForPage(input.template, page.id, input.editorState || undefined)) {
    if (["image", "frame"].includes(layer.type) && layer.customerEditable && layer.fieldId) imageFields.add(layer.fieldId);
  }
  const frozen = replaceSources(input, replacements);
  // A customer's text can equal an image URL; only image-bearing properties
  // and image field values may be rewritten into pinned references.
  frozen.values = Object.fromEntries(Object.entries(input.values).map(([key, value]) => [key, imageFields.has(key) && typeof value === "string" ? replacements.get(value) ?? value : replaceSources(value, replacements)]));
  return { ...frozen, assets: [...assets.values()], fonts, fontCatalog: catalog.filter((entry) => fonts.some((font) => font.family === entry.family)) };
}

export async function openProductionInput(input: ProductionInput, storage: ProductionStorage) {
  const buffers = new Map<string, Buffer>();
  for (const asset of input.assets) buffers.set(asset.key, await readProductionAsset(asset, storage));
  const imageData: Record<string, string> = {};
  for (const asset of input.assets.filter((entry) => entry.kind === "image")) imageData[`order-asset:${asset.key}`] = `data:${asset.mimeType};base64,${buffers.get(asset.key)!.toString("base64")}`;
  // Verify coverage before rendering: an unpinned URL must never reach fetch().
  for (const page of getEnabledPages(input.template)) for (const url of collectPageImageUrls(input.template, input.values, input.editorState, page.id)) {
    if (!imageData[url]) throw new RenderError("ASSET_REFERENCE_INVALID", "Production image is not pinned in the order manifest.");
  }
  const { dependencies, missingFamilies } = collectFontDependencies(input.fontCatalog, collectTextStyles(input.template, input.editorState));
  if (missingFamilies.length) throw new RenderError("FONT_FILE_MISSING", "Snapshot font metadata is incomplete.");
  const parsed = new Map<string, opentype.Font>();
  const filePaths: string[] = [];
  const directory = join(tmpdir(), "husnalogy-order-fonts");
  await mkdir(directory, { recursive: true });
  for (const dependency of dependencies) {
    const font = input.fonts.find((entry) => entry.family === dependency.family && entry.variantKey === dependency.variantKey && entry.url === dependency.url);
    if (!font || !buffers.has(font.assetKey)) throw new RenderError("FONT_FILE_MISSING", "Exact snapshot font variant is unavailable.");
    const bytes = buffers.get(font.assetKey)!;
    try {
      const fontBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      // Kerning the way browsers apply it (opentype.js misses Extension lookups).
      parsed.set(`${font.family}|${font.variantKey}|${font.url}`, withGposKerning(opentype.parse(fontBytes), fontBytes));
    }
    catch { throw new RenderError("FONT_FILE_MISSING", "Pinned production font cannot be parsed."); }
    const path = join(directory, `${font.assetKey}.ttf`);
    // Publish the complete cache file atomically so another worker cannot read
    // a file that was truncated by a concurrent writer.
    const cached = await readFile(path).catch(() => null);
    if (!cached || digest(cached) !== font.assetKey) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { flag: "wx" });
      try { await rename(temporary, path); }
      catch (error) {
        await unlink(temporary).catch(() => undefined);
        const winner = await readFile(path).catch(() => null);
        if (!winner || digest(winner) !== font.assetKey) throw error;
      }
    }
    if (digest(await readFile(path)) !== font.assetKey) throw new RenderError("FONT_FILE_MISSING", "Pinned font cache checksum failed.");
    filePaths.push(path);
  }
  return { imageData, frozenFonts: { catalog: input.fontCatalog, parsed, filePaths } };
}
