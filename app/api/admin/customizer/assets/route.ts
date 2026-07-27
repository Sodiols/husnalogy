import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sniffImageType, sanitizeSvg, detectTintable, safeFileName } from "@/lib/customizer/v2/uploads";
import { categoryFromRow, folderFromRow } from "@/lib/customizer/assets";
import { ADMIN_ASSET_BUCKET, signAdminAssetRow, signAdminAssetRows } from "@/lib/customizer/server/admin-assets";
import {
  buildRasterVariants,
  buildSvgVariants,
  inspectStoredVariant,
  variantStoragePath,
  VARIANT_GENERATION_VERSION,
  type AssetVariants,
} from "@/lib/customizer/server/asset-variants";

/** Variant metadata recorded alongside the row for diagnostics and repair. */
function variantMetadata(variants: AssetVariants, previous: Record<string, any> = {}) {
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

/**
 * Rebuild the editor and thumbnail files for an asset whose stored variants are
 * missing, undecodable or too small for their purpose.
 *
 * Variants are written to content-addressed paths, so a repair produces new
 * URLs rather than rewriting bytes behind a year-long cache header. The original
 * is never touched. Returns the refreshed row, or null when repair was not
 * possible — the caller then keeps the existing row and the resolver falls back
 * to the original file.
 */
async function repairAssetVariants(supabase: any, row: any, source: Buffer, mime: string) {
  const bucket = row.bucket || ADMIN_ASSET_BUCKET;
  try {
    const variants = mime === "image/svg+xml" ? await buildSvgVariants(source) : await buildRasterVariants(source);
    const editorPath = variantStoragePath(row.id, "editor", variants.editorBuffer, variants.editorExtension);
    const thumbnailPath = variantStoragePath(row.id, "thumbnail", variants.thumbnailBuffer);

    for (const [storagePath, data, contentType] of [
      [editorPath, variants.editorBuffer, variants.editorMime],
      [thumbnailPath, variants.thumbnailBuffer, "image/webp"],
    ] as Array<[string, Buffer, string]>) {
      const { error } = await supabase.storage.from(bucket).upload(storagePath, data, {
        contentType,
        upsert: true,
        cacheControl: "31536000",
      });
      if (error) {
        console.error(`Asset variant repair failed to upload [asset=${row.id}] [path=${storagePath}]:`, error.message);
        return null;
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("customizer_assets")
      .update({
        editor_path: editorPath,
        thumbnail_path: thumbnailPath,
        width: variants.width,
        height: variants.height,
        metadata: variantMetadata(variants, row.metadata || {}),
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (updateError) {
      console.error(`Asset variant repair failed to update record [asset=${row.id}]:`, updateError.message);
      return null;
    }
    return updated || null;
  } catch (cause) {
    console.error(`Asset variant repair failed [asset=${row.id}]:`, (cause as Error).message);
    return null;
  }
}

const MAX_SIZE = 25 * 1024 * 1024;

const assetTypeSchema = z.enum(["image", "element", "svg", "frame", "background", "texture", "mockup", "overlay", "other"]);

function cleanSearchTerm(value: string) {
  return value.replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim();
}

// GET /api/admin/customizer/assets — permanent administrator asset library.
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const search = cleanSearchTerm((url.searchParams.get("search") || "").slice(0, 120));
  const categoryId = (url.searchParams.get("category") || "").trim();
  const folderId = (url.searchParams.get("folder") || "").trim();
  const assetType = (url.searchParams.get("type") || "").trim();
  const mimeType = (url.searchParams.get("mime") || "").trim();
  const includeArchived = url.searchParams.get("archived") === "1";
  const includeUnavailable = url.searchParams.get("includeUnavailable") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize")) || 40));

  const supabase = createServiceRoleClient();
  let query = supabase
    .from("customizer_assets")
    .select("*", { count: "exact" })
    .in("status", includeArchived ? ["ready", "archived"] : ["ready"])
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (!includeArchived) query = query.eq("archived", false);
  if (!includeUnavailable) query = query.eq("admin_available", true);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (folderId === "unfiled") query = query.is("folder_id", null);
  else if (folderId) query = query.eq("folder_id", folderId);
  if (assetType) query = query.eq("asset_type", assetType);
  if (mimeType) query = query.eq("mime_type", mimeType);
  if (search) query = query.or(`title.ilike.%${search}%,original_filename.ilike.%${search}%,keywords.ilike.%${search}%`);

  const [{ data, error, count }, categoriesResult, foldersResult] = await Promise.all([
    query,
    supabase.from("customizer_asset_categories").select("*").order("sort_order").order("name"),
    supabase.from("customizer_asset_folders").select("*").order("name"),
  ]);
  if (error) {
    console.error("List customizer assets failed:", error);
    return Response.json({ ok: false, error: "Could not load assets." }, { status: 500 });
  }

  try {
    const assets = await signAdminAssetRows(supabase, data || []);
    return Response.json({
      ok: true,
      assets,
      categories: (categoriesResult.data || []).map(categoryFromRow),
      folders: (foldersResult.data || []).map(folderFromRow),
      total: count || 0,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("Sign customizer assets failed:", error);
    return Response.json({ ok: false, error: "Assets were found but could not be opened securely." }, { status: 500 });
  }
}

// POST /api/admin/customizer/assets — validate, optimize, persist, and record
// an administrator upload. Original bytes are never overwritten; sanitized SVG
// is the protected source because unsafe SVG input is rejected before storage.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file") as File | null;
  if (!file) return Response.json({ ok: false, error: "No file provided." }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ ok: false, error: "Assets must be 25MB or smaller." }, { status: 400 });

  const title = String(formData?.get("title") || "").trim().slice(0, 200) || file.name.replace(/\.[^.]+$/, "");
  const categoryId = String(formData?.get("categoryId") || "").trim().slice(0, 80);
  const folderId = String(formData?.get("folderId") || "").trim().slice(0, 80);
  const parsedAssetType = assetTypeSchema.safeParse(String(formData?.get("assetType") || "element"));
  if (!parsedAssetType.success) return Response.json({ ok: false, error: "Unsupported asset type." }, { status: 400 });
  const tags = String(formData?.get("tags") || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 30);
  const suppliedKeywords = String(formData?.get("keywords") || "").trim().slice(0, 500);
  const keywords = cleanSearchTerm([suppliedKeywords, title, file.name, ...tags].filter(Boolean).join(" ")).slice(0, 500);
  const customerAvailable = String(formData?.get("customerAvailable") || "false") === "true";
  const adminAvailable = String(formData?.get("adminAvailable") || "true") !== "false";
  const defaultColor = String(formData?.get("defaultColor") || "").trim().slice(0, 32);

  let buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImageType(buffer, true);
  if (sniffed.ok === false) return Response.json({ ok: false, error: sniffed.error }, { status: 400 });

  let tintable = false;
  let variants: AssetVariants;

  // All variant generation goes through the shared module, so the upload path,
  // the repair path and the repair script cannot drift apart.
  try {
    if (sniffed.mime === "image/svg+xml") {
      const sanitized = sanitizeSvg(buffer.toString("utf8"));
      if (sanitized.ok === false) return Response.json({ ok: false, error: sanitized.error }, { status: 400 });
      buffer = Buffer.from(sanitized.svg, "utf8");
      tintable = detectTintable(sanitized.svg);
      variants = await buildSvgVariants(buffer);
    } else {
      variants = await buildRasterVariants(buffer);
    }
  } catch (cause) {
    const message = (cause as Error).message || "";
    const tooLarge = message.includes("no larger than");
    return Response.json(
      { ok: false, error: tooLarge ? message : "This file could not be safely decoded or optimized." },
      { status: 400 },
    );
  }

  const { editorBuffer, thumbnailBuffer, editorMime, editorExtension, width, height } = variants;

  const checksum = createHash("sha256").update(buffer).digest("hex");
  const supabase = createServiceRoleClient();
  const { data: duplicate } = await supabase
    .from("customizer_assets")
    .select("*")
    .eq("checksum", checksum)
    .in("status", ["ready", "archived"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (duplicate) {
    let reusable = duplicate;
    if (
      (customerAvailable && !duplicate.customer_available)
      || (adminAvailable && !duplicate.admin_available)
      || duplicate.archived
      || duplicate.status === "archived"
    ) {
      const { data: updated } = await supabase
        .from("customizer_assets")
        .update({
          customer_available: customerAvailable || duplicate.customer_available,
          admin_available: adminAvailable || duplicate.admin_available,
          archived: false,
          active: true,
          status: "ready",
        })
        .eq("id", duplicate.id)
        .select("*")
        .single();
      if (updated) reusable = updated;
    }

    // Reusing the record must not mean reusing bad files. A stored variant can
    // exist and decode yet still be wrong: a legacy 480px editor for a 1254px
    // original is exactly the blur this guards against. Judge each variant
    // against the size it SHOULD be for this source, and rebuild if it falls
    // short — otherwise a re-upload can never repair the asset.
    const bucket = reusable.bucket || ADMIN_ASSET_BUCKET;
    const vector = sniffed.mime === "image/svg+xml";
    const [editor, thumbnail] = await Promise.all([
      inspectStoredVariant({
        supabase, bucket, storagePath: reusable.editor_path, variant: "editor",
        sourceWidth: width, sourceHeight: height, vector,
      }),
      inspectStoredVariant({
        supabase, bucket, storagePath: reusable.thumbnail_path, variant: "thumbnail",
        sourceWidth: width, sourceHeight: height,
      }),
    ]);
    if (!editor.ok || !thumbnail.ok) {
      console.warn(
        `Rebuilding customizer asset variants [asset=${reusable.id}] `
        + `[editor=${editor.reason}${editor.width ? ` ${editor.width}x${editor.height}` : ""}] `
        + `[thumbnail=${thumbnail.reason}${thumbnail.width ? ` ${thumbnail.width}x${thumbnail.height}` : ""}]`,
      );
      const repaired = await repairAssetVariants(supabase, reusable, buffer, sniffed.mime);
      if (repaired) reusable = repaired;
    }

    const asset = await signAdminAssetRow(supabase, reusable);
    return Response.json({ ok: true, duplicate: true, asset, message: `This file already exists as “${asset.title}”.` });
  }

  const assetId = randomUUID();
  const cleanName = safeFileName(file.name, "asset");
  const basePath = `assets/${assetId}`;
  const originalPath = `${basePath}/original/${cleanName}`;
  // Content-addressed so a later repair lands on a new URL instead of trying to
  // replace bytes behind a one-year cache header.
  const editorPath = variantStoragePath(assetId, "editor", editorBuffer, editorExtension);
  const thumbnailPath = variantStoragePath(assetId, "thumbnail", thumbnailBuffer);
  const uploads = [
    { path: originalPath, data: buffer, contentType: sniffed.mime },
    { path: editorPath, data: editorBuffer, contentType: editorMime },
    { path: thumbnailPath, data: thumbnailBuffer, contentType: "image/webp" },
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
      return Response.json({ ok: false, error: `Upload failed: ${error.message}` }, { status: 500 });
    }
    uploadedPaths.push(item.path);
  }

  const { data, error } = await supabase
    .from("customizer_assets")
    .insert({
      id: assetId,
      category_id: categoryId || null,
      folder_id: folderId || null,
      title,
      original_filename: file.name.slice(0, 300),
      asset_type: sniffed.mime === "image/svg+xml" && parsedAssetType.data === "element" ? "svg" : parsedAssetType.data,
      tags,
      keywords,
      bucket: ADMIN_ASSET_BUCKET,
      path: originalPath,
      public_url: null,
      thumbnail_path: thumbnailPath,
      editor_path: editorPath,
      mime_type: sniffed.mime,
      file_size_bytes: buffer.byteLength,
      width,
      height,
      tintable,
      default_color: defaultColor || null,
      customer_available: customerAvailable,
      admin_available: adminAvailable,
      active: true,
      archived: false,
      status: "ready",
      checksum,
      usage_count: 0,
      metadata: variantMetadata(variants, { originalMimeType: sniffed.mime }),
      created_by: admin.admin?.id || null,
    })
    .select("*")
    .single();
  if (error || !data) {
    await supabase.storage.from(ADMIN_ASSET_BUCKET).remove(uploadedPaths);
    console.error("Create customizer asset failed:", error);
    return Response.json({ ok: false, error: "The file uploaded, but its asset record could not be saved. The uploaded files were rolled back." }, { status: 500 });
  }

  const asset = await signAdminAssetRow(supabase, data);
  return Response.json({ ok: true, duplicate: false, asset }, { status: 201 });
}
