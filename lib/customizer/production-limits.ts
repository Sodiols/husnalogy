/**
 * Aggregate limits for the production inputs one checkout may pin.
 *
 * Per-file limits alone let one order multiply work: 50 lines x 100 images x
 * 30 MB is 150 GB of downloads, decodes, hashes and storage copies. Every
 * checkout therefore shares ONE budget across all of its lines, checked BEFORE
 * each expensive step (download, decode, upload), plus a wall-clock deadline.
 *
 * Sized for Husnalogy's products (5x7", 6x8" and A5 invitations and cards,
 * menus, place cards, and posters/prints within the render limits below): a
 * typical personalized design has 1-10 images and 1-6 font variants; the
 * largest legitimate print photo is well under 30 MB and 100 megapixels. The
 * database enforces looser backstops (600 assets / 512 MiB per order, 8 MiB
 * per snapshot).
 */

export const PRODUCTION_LIMITS = {
  /** One stored original (matches the order-production bucket limit). */
  maxFileBytes: 30 * 1024 * 1024,
  /** Distinct images one design may reference (the pre-existing pinning bound). */
  maxImagesPerDesign: 100,
  /** Distinct images across every line of one order. */
  maxImagesPerOrder: 200,
  /** Font files (family + variant) one design may use. */
  maxFontFilesPerDesign: 24,
  maxFontFilesPerOrder: 80,
  /** Manual-production documents (PDF uploads). */
  maxDocumentsPerOrder: 10,
  /** Everything pinned for one order: images, fonts, licences, documents. */
  maxAssetBytesPerOrder: 256 * 1024 * 1024,
  /** Decoded size of one image (10,000 x 10,000). */
  maxImagePixels: 100_000_000,
  /** Decoded pixels across every image of one order. */
  maxDecodedPixelsPerOrder: 800_000_000,
  /** Serialized manufacturing snapshot (template + values + manifest). */
  maxSnapshotBytes: 4 * 1024 * 1024,
  maxSnapshotBytesPerOrder: 16 * 1024 * 1024,
  /** Wall clock for all preparation of one checkout. */
  maxPreparationMs: 120_000,
  /**
   * Database lease: the deadline plus one bounded (60 s) asset fetch and the
   * transaction. It also bounds how long a checkout whose outcome is unknown
   * (lost database response) blocks the next attempt of the same customer.
   */
  preparationLeaseSeconds: 240,
} as const;

export class ProductionLimitError extends Error {
  readonly code = "PRODUCTION_LIMIT_EXCEEDED";
  constructor(public readonly limit: string, message: string) {
    super(message);
    this.name = "ProductionLimitError";
  }
}

type Kind = "image" | "font" | "license" | "document";

export type BudgetUsage = {
  images: number;
  fonts: number;
  licenses: number;
  documents: number;
  bytes: number;
  pixels: number;
  snapshotBytes: number;
  /** Every object this preparation stored (for immediate cleanup on failure). */
  storedPaths: string[];
};

/**
 * Shared, order-wide accounting. Assets are counted once per checksum: the
 * same bytes used by two lines are one stored object.
 */
export class ProductionAssetBudget {
  private readonly counted = new Set<string>();
  private readonly paths = new Set<string>();
  readonly usage: BudgetUsage = { images: 0, fonts: 0, licenses: 0, documents: 0, bytes: 0, pixels: 0, snapshotBytes: 0, storedPaths: [] };

  constructor(
    readonly limits: typeof PRODUCTION_LIMITS = PRODUCTION_LIMITS,
    private readonly deadline = Date.now() + limits.maxPreparationMs,
  ) {}

  /** Throw once the preparation deadline has passed. */
  assertTime(): void {
    if (Date.now() > this.deadline) {
      throw new ProductionLimitError("maxPreparationMs", "Preparing your personalized files took too long. Nothing was ordered — please try again.");
    }
  }

  /** Count checks that need no bytes: run before any download. */
  assertDesignCounts(images: number, fonts: number): void {
    if (images > this.limits.maxImagesPerDesign) throw new ProductionLimitError("maxImagesPerDesign", `A design may use at most ${this.limits.maxImagesPerDesign} images.`);
    if (fonts > this.limits.maxFontFilesPerDesign) throw new ProductionLimitError("maxFontFilesPerDesign", `A design may use at most ${this.limits.maxFontFilesPerDesign} font styles.`);
  }

  /** Reserve room for one decoded image before decoding it. */
  reservePixels(pixels: number): void {
    if (!Number.isFinite(pixels) || pixels <= 0 || pixels > this.limits.maxImagePixels) {
      throw new ProductionLimitError("maxImagePixels", "An image in your design is too large to print. Please use a smaller image.");
    }
    if (this.usage.pixels + pixels > this.limits.maxDecodedPixelsPerOrder) {
      throw new ProductionLimitError("maxDecodedPixelsPerOrder", "Your order contains too much image data to prepare at once. Please split it into smaller orders.");
    }
    this.usage.pixels += pixels;
  }

  /**
   * Account one asset before it is stored. Returns false when the same bytes
   * were already counted by this order.
   */
  reserveAsset(checksum: string, size: number, kind: Kind): boolean {
    this.assertTime();
    if (!Number.isInteger(size) || size < 1 || size > this.limits.maxFileBytes) {
      throw new ProductionLimitError("maxFileBytes", "A file in your design exceeds the 30 MB limit.");
    }
    if (this.counted.has(checksum)) return false;
    const next = { ...this.usage };
    if (kind === "image") next.images += 1;
    else if (kind === "font") next.fonts += 1;
    else if (kind === "license") next.licenses += 1;
    else next.documents += 1;
    next.bytes += size;
    if (next.images > this.limits.maxImagesPerOrder) throw new ProductionLimitError("maxImagesPerOrder", `An order may contain at most ${this.limits.maxImagesPerOrder} distinct images.`);
    if (next.fonts > this.limits.maxFontFilesPerOrder || next.licenses > this.limits.maxFontFilesPerOrder) throw new ProductionLimitError("maxFontFilesPerOrder", `An order may use at most ${this.limits.maxFontFilesPerOrder} font styles.`);
    if (next.documents > this.limits.maxDocumentsPerOrder) throw new ProductionLimitError("maxDocumentsPerOrder", `An order may contain at most ${this.limits.maxDocumentsPerOrder} documents.`);
    if (next.bytes > this.limits.maxAssetBytesPerOrder) throw new ProductionLimitError("maxAssetBytesPerOrder", "Your order's files are too large in total. Please use smaller images or split the order.");
    this.counted.add(checksum);
    Object.assign(this.usage, { images: next.images, fonts: next.fonts, licenses: next.licenses, documents: next.documents, bytes: next.bytes });
    return true;
  }

  /** Record a stored object (once it may exist in storage). */
  recordStored(path: string): void {
    if (this.paths.has(path)) return;
    this.paths.add(path);
    this.usage.storedPaths.push(path);
  }

  /** Account one serialized snapshot. */
  reserveSnapshot(serializedBytes: number): void {
    if (serializedBytes > this.limits.maxSnapshotBytes) throw new ProductionLimitError("maxSnapshotBytes", "A personalized design is too large to store. Please simplify it.");
    if (this.usage.snapshotBytes + serializedBytes > this.limits.maxSnapshotBytesPerOrder) throw new ProductionLimitError("maxSnapshotBytesPerOrder", "Your order's designs are too large to store together. Please split the order.");
    this.usage.snapshotBytes += serializedBytes;
  }
}

/**
 * Print canvas limits for AUTOMATIC server rendering.
 *
 * Measured under Node 22 (scripts/benchmark-render-limits.mjs; resvg raster →
 * PNG → PDF, one page): peak memory grows ~13 MB per megapixel — 19 MP ≈ 295 MB,
 * 35 MP ≈ 460 MB, 50 MP ≈ 640 MB, 78 MP (24x36" at 300 dpi) ≈ 960 MB — before
 * any decoded photos. Rendering runs inside the same `npm start` process that
 * serves the website on Hostinger, so a page is capped at 36 MP.
 *
 * What that supports (bleed included):
 *   - every card, invitation, menu and program size at 300 dpi;
 *   - prints up to 18x24" at 250 dpi and posters up to 24x36" at 200 dpi.
 * NOT supported for automatic rendering: 24x36" at 300 dpi (78 MP) — such a
 * product must use manual production or a lower dpi.
 *
 * SUPPORTED limits apply to everything new: template publishing (admin) and
 * checkout (before any asset is downloaded). The renderer's SAFETY ceiling is
 * the earlier, looser bound, kept so a snapshot accepted under it can always
 * be re-rendered: historical orders never become unrenderable.
 */
export type RenderLimits = {
  maxSidePx: number;
  maxPagePixels: number;
  maxDesignPixels: number;
  maxPages: number;
  minDpi: number;
  maxDpi: number;
};

export const PRODUCTION_RENDER_LIMITS: RenderLimits = {
  maxSidePx: 8_000,
  maxPagePixels: 36_000_000,
  maxDesignPixels: 150_000_000,
  maxPages: 32,
  minDpi: 72,
  maxDpi: 600,
};

export const RENDER_SAFETY_LIMITS: RenderLimits = {
  maxSidePx: 12_000,
  maxPagePixels: 50_000_000,
  maxDesignPixels: 200_000_000,
  maxPages: 32,
  minDpi: 1,
  maxDpi: 1_200,
};

const megapixels = (value: number) => `${(value / 1_000_000).toFixed(1)} MP`;

/** Every reason a template's print canvas is outside the limits (cheap; no bytes). */
export function renderBoundsErrors(template: Record<string, any>, limits: RenderLimits = PRODUCTION_RENDER_LIMITS): string[] {
  const errors: string[] = [];
  const bleed = template?.bleed || {};
  const bleeds = [bleed.left, bleed.right, bleed.top, bleed.bottom].map((value) => Number(value || 0));
  if (bleeds.some((value) => !Number.isFinite(value) || value < 0)) errors.push("Bleed values must be zero or positive numbers.");
  const width = Number(template?.canvasWidthPx) + bleeds[0] + bleeds[1];
  const height = Number(template?.canvasHeightPx) + bleeds[2] + bleeds[3];
  const dpi = Number(template?.dpi);
  const pages = Array.isArray(template?.pages) ? template.pages.filter((page: any) => page?.enabled !== false) : [];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    errors.push("The print canvas width and height must be positive numbers.");
    return errors;
  }
  if (width > limits.maxSidePx || height > limits.maxSidePx) {
    errors.push(`The print canvas is ${Math.round(width)} × ${Math.round(height)} px including bleed; production supports at most ${limits.maxSidePx.toLocaleString("en-US")} px per side.`);
  }
  if (width * height > limits.maxPagePixels) {
    errors.push(`One page is ${megapixels(width * height)} including bleed; production supports at most ${megapixels(limits.maxPagePixels)} per page (for example 24 × 36 in at 200 dpi). Lower the canvas size or dpi.`);
  }
  if (pages.length > limits.maxPages) errors.push(`A design may have at most ${limits.maxPages} printed pages.`);
  if (width * height * pages.length > limits.maxDesignPixels) {
    errors.push(`All ${pages.length} pages together are ${megapixels(width * height * pages.length)}; production supports at most ${megapixels(limits.maxDesignPixels)} per design.`);
  }
  if (!Number.isFinite(dpi) || dpi < limits.minDpi || dpi > limits.maxDpi) {
    errors.push(`Print resolution must be between ${limits.minDpi} and ${limits.maxDpi} dpi.`);
  }
  return errors;
}

/** Throws a controlled error when the print canvas is outside the limits. */
export function assertRenderBounds(template: Record<string, any>, limits: RenderLimits = PRODUCTION_RENDER_LIMITS): void {
  const errors = renderBoundsErrors(template, limits);
  if (!errors.length) return;
  const pages = Array.isArray(template?.pages) ? template.pages.filter((page: any) => page?.enabled !== false) : [];
  if (pages.length > limits.maxPages && errors.length === 1) throw new Error("SNAPSHOT_PAGES_INVALID");
  throw new Error(`SNAPSHOT_RENDER_LIMIT_EXCEEDED: ${errors.join(" ")}`);
}

