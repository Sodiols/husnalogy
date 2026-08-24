// Shared trusted asset ingestion (spec §16).
//
// One pipeline for every way bytes become a permanent `customizer_assets`
// record — admin upload and Iconify import alike. Centralizing it means a
// second, weaker path cannot appear by accident:
//
//   sanitize → tint detection → variants → checksum → dedupe → storage
//   → database row → rollback on failure
//
// Server-only.

import { createHash, randomUUID } from "node:crypto";
import { sanitizeSvg, detectTintable, safeFileName } from "@/lib/customizer/v2/uploads";
import { ADMIN_ASSET_BUCKET } from "@/lib/customizer/server/admin-assets";
import {
  buildRasterVariants,
  buildSvgVariants,
  variantStoragePath,
  VARIANT_GENERATION_VERSION,
  type AssetVariants,
} from "@/lib/customizer/server/asset-variants";

export type IngestSource = {
  /** Raw bytes as downloaded/uploaded. */
  buffer: Buffer;
  mime: string;
  /** Original file name, used only for a safe storage name. */
  filename: string;
};

/** Provenance for an externally sourced asset (spec §18). Omitted for local uploads. */
export type AssetProvenance = {
  provider: string;
  key: string;
  collection: string;
  license: string;
  licenseUrl: string;
  licenseSpdx: string;
  author: string;
};

export type IngestOptions = {
  title: string;
  assetType: string;
  categoryId?: string;
  folderId?: string;
  tags?: string[];
  keywords?: string;
  customerAvailable: boolean;
  adminAvailable: boolean;
  defaultColor?: string;
  createdBy?: string | null;
  provenance?: AssetProvenance | null;
};

export type PreparedAsset = {
  /** Sanitized bytes — for SVG this is the sanitized document, not the input. */
  buffer: Buffer;
  mime: string;
  variants: AssetVariants;
  tintable: boolean;
  checksum: string;
};

export class AssetIngestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AssetIngestError";
    this.status = status;
  }
}

export function variantMetadata(variants: AssetVariants, previous: Record<string, any> = {}) {
  return {
    ...previous,
    optimized: true,
    sourceWidth: variants.width,
    sourceHeight: variants.height,
    editorWidth: variants.editorWidth,
    editorHeight: variants.editorHeight,
    editorFormat: variants.editorMime,
    thumbnailWidth: variants.thumbnailWidth,
    thumbnailHeight: variants.thumbnailHeight,
    thumbnailFormat: "image/webp",
    variantGenerationVersion: VARIANT_GENERATION_VERSION,
    variantGeneratedAt: new Date().toISOString(),
  };
}

export function cleanSearchTerm(value: string) {
  return String(value || "").replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Sanitize, measure and build variants. SVG input is sanitized FIRST and the
 * sanitized document becomes the stored original, so unsafe markup never
 * reaches storage (spec §59).
 */
export async function prepareAsset(source: IngestSource): Promise<PreparedAsset> {
  let buffer = source.buffer;
  let tintable = false;
  let variants: AssetVariants;

  try {
    if (source.mime === "image/svg+xml") {
      const sanitized = sanitizeSvg(buffer.toString("utf8"));
      if (sanitized.ok === false) throw new AssetIngestError(sanitized.error, 400);
      buffer = Buffer.from(sanitized.svg, "utf8");
      tintable = detectTintable(sanitized.svg);
      variants = await buildSvgVariants(buffer);
    } else {
      variants = await buildRasterVariants(buffer);
    }
  } catch (cause) {
    if (cause instanceof AssetIngestError) throw cause;
    const message = (cause as Error).message || "";
    throw new AssetIngestError(
      message.includes("no larger than") ? message : "This file could not be safely decoded or optimized.",
      400,
    );
  }

  return {
    buffer,
    mime: source.mime,
    variants,
    tintable,
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
}

/** Look for an existing record with identical sanitized bytes (spec §21). */
export async function findByChecksum(supabase: any, checksum: string) {
  const { data } = await supabase
    .from("customizer_assets")
    .select("*")
    .eq("checksum", checksum)
    .in("status", ["ready", "archived"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/** Look for an existing record with the same external source identity (spec §18). */
export async function findBySourceIdentity(supabase: any, provider: string, key: string) {
  const { data } = await supabase
    .from("customizer_assets")
    .select("*")
    .eq("source_provider", provider)
    .eq("source_key", key)
    .in("status", ["ready", "archived"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/**
 * Widen an existing record's availability when a new ingest needs more than it
 * currently grants. Never narrows: another surface may depend on it.
 */
export async function ensureAvailability(supabase: any, row: any, options: Pick<IngestOptions, "customerAvailable" | "adminAvailable">) {
  const needsChange =
    (options.customerAvailable && !row.customer_available)
    || (options.adminAvailable && !row.admin_available)
    || row.archived
    || row.status === "archived";
  if (!needsChange) return row;

  const { data } = await supabase
    .from("customizer_assets")
    .update({
      customer_available: options.customerAvailable || row.customer_available,
      admin_available: options.adminAvailable || row.admin_available,
      archived: false,
      active: true,
      status: "ready",
    })
    .eq("id", row.id)
    .select("*")
    .single();
  return data || row;
}

export type StoredAsset = { row: any; uploadedPaths: string[] };

/**
 * Upload the original + variants and insert the record.
 *
 * Rolls back uploaded objects if the database insert fails, so a failed ingest
 * never leaves orphaned files behind.
 *
 * A unique-constraint collision on the source identity is NOT an error: a
 * concurrent import won the race, so its record is returned instead (spec §20).
 */
export async function storeAsset(
  supabase: any,
  prepared: PreparedAsset,
  source: IngestSource,
  options: IngestOptions,
): Promise<StoredAsset> {
  const assetId = randomUUID();
  const cleanName = safeFileName(source.filename, "asset");
  const originalPath = `assets/${assetId}/original/${cleanName}`;
  const editorPath = variantStoragePath(assetId, "editor", prepared.variants.editorBuffer, prepared.variants.editorExtension);
  const thumbnailPath = variantStoragePath(assetId, "thumbnail", prepared.variants.thumbnailBuffer);

  const uploads: Array<{ path: string; data: Buffer; contentType: string }> = [
    { path: originalPath, data: prepared.buffer, contentType: prepared.mime },
    { path: editorPath, data: prepared.variants.editorBuffer, contentType: prepared.variants.editorMime },
    { path: thumbnailPath, data: prepared.variants.thumbnailBuffer, contentType: "image/webp" },
  ];

  const uploadedPaths: string[] = [];
  for (const item of uploads) {
    const { error } = await supabase.storage.from(ADMIN_ASSET_BUCKET).upload(item.path, item.data, {
      contentType: item.contentType,
      upsert: false,
      cacheControl: "31536000",
    });
    if (error) {
      if (uploadedPaths.length) await supabase.storage.from(ADMIN_ASSET_BUCKET).remove(uploadedPaths);
      throw new AssetIngestError(`Upload failed: ${error.message}`, 500);
    }
    uploadedPaths.push(item.path);
  }

  const provenance = options.provenance;
  const { data, error } = await supabase
    .from("customizer_assets")
    .insert({
      id: assetId,
      category_id: options.categoryId || null,
      folder_id: options.folderId || null,
      title: options.title,
      original_filename: source.filename.slice(0, 300),
      asset_type: options.assetType,
      tags: options.tags || [],
      keywords: options.keywords || "",
      bucket: ADMIN_ASSET_BUCKET,
      path: originalPath,
      public_url: null,
      thumbnail_path: thumbnailPath,
      editor_path: editorPath,
      mime_type: prepared.mime,
      file_size_bytes: prepared.buffer.byteLength,
      width: prepared.variants.width,
      height: prepared.variants.height,
      tintable: prepared.tintable,
      default_color: options.defaultColor || null,
      customer_available: options.customerAvailable,
      admin_available: options.adminAvailable,
      active: true,
      archived: false,
      status: "ready",
      checksum: prepared.checksum,
      usage_count: 0,
      metadata: variantMetadata(prepared.variants, { originalMimeType: prepared.mime }),
      created_by: options.createdBy || null,
      ...(provenance
        ? {
            source_provider: provenance.provider,
            source_key: provenance.key,
            source_collection: provenance.collection || null,
            source_license: provenance.license || null,
            source_license_url: provenance.licenseUrl || null,
            source_license_spdx: provenance.licenseSpdx || null,
            source_author: provenance.author || null,
          }
        : {}),
    })
    .select("*")
    .single();

  if (error || !data) {
    await supabase.storage.from(ADMIN_ASSET_BUCKET).remove(uploadedPaths);

    // 23505 = unique violation. For an external asset that means a concurrent
    // import already created this exact source identity — reuse the winner
    // rather than surfacing a database error (spec §20).
    if ((error as any)?.code === "23505" && provenance) {
      const winner = await findBySourceIdentity(supabase, provenance.provider, provenance.key);
      if (winner) return { row: winner, uploadedPaths: [] };
    }

    throw new AssetIngestError(
      "The file was processed, but its asset record could not be saved. The uploaded files were rolled back.",
      500,
    );
  }

  return { row: data, uploadedPaths };
}
