import sharp from "sharp";
import { assertVariantsDecodable, assertVariantsSized, verifyStoredEditorVariant } from "@/lib/customizer/server/asset-variants";
import type { Metadata } from "sharp";
import { createHash } from "crypto";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { bodyErrorResponse, readFormDataBody } from "@/lib/http/read-body";
import { sniffImageType, safeFileName } from "@/lib/customizer/v2/uploads";
import { resolvePrivateAssetUrl } from "@/lib/customizer/server/private-assets";
import { logEvent, requestIdFrom } from "@/lib/observability/logger";
import { stripJpegMetadataVerified } from "@/lib/uploads/jpeg-lossless";

const MAX_SIZE = 15 * 1024 * 1024;
const MAX_DIMENSION = 12000; // per side
const MAX_PIXELS = 60_000_000; // decompression-bomb guard (~60 MP)
const EDITOR_MAX_PX = 1600;
const THUMB_PX = 384;
// Customer variants are smaller than the studio library's; they are verified
// against THESE bounds (judging them by the studio's 2400px rejected every
// photo larger than ~1600px).
const CUSTOMER_VARIANT_BOUNDS = { editor: EDITOR_MAX_PX, thumbnail: THUMB_PX };
const BUCKET = "customer-uploads";

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

function isPdf(buffer: Buffer): boolean {
  return buffer.length > 8 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

// POST /api/customizer/upload — THE customer upload path (customizer photos,
// the customer asset library and the product page's file fields).
//
//  * Type decided by magic bytes, never the file name, extension or
//    Content-Type. Images must also fully decode.
//  * Size, per-side dimension and total pixel count are capped.
//  * The stored ORIGINAL loses its EXIF/GPS metadata and any bytes appended
//    after the image (polyglot payloads). A JPEG's compressed picture is kept
//    byte for byte (no re-compression); other formats are re-encoded
//    losslessly.
//  * File names are generated server side; the path is always inside the
//    caller's own folder; the write uses the service role only after the
//    session has been verified (customers can no longer write to the bucket
//    directly).
export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const limited = await rateLimitDistributed(request, { name: "customizer-upload", limit: 40, windowMs: 10 * 60 * 1000, identity: user.id });
  if (limited) return limited;

  let formData: FormData;
  try {
    formData = await readFormDataBody(request, MAX_SIZE + 256 * 1024);
  } catch (error) {
    return bodyErrorResponse(error) || Response.json({ ok: false, error: "The upload could not be read." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, error: "No file provided." }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ ok: false, error: "Files must be 15MB or smaller." }, { status: 400 });
  const folder = String(formData.get("folder") || "customizer").replace(/[^a-z0-9/_-]/gi, "").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "").slice(0, 120) || "customizer";
  const allowDocuments = String(formData.get("purpose") || "") === "field-file";

  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const stamp = Date.now();
  const displayName = String(file.name || "upload").slice(0, 200);
  const service = createServiceRoleClient();

  /* ------------------------------------------------------------ documents */
  if (isPdf(buffer)) {
    if (!allowDocuments) return Response.json({ ok: false, error: "Upload a JPG, PNG or WebP image." }, { status: 400 });
    const path = `${user.id}/${folder}/${stamp}-${checksum.slice(0, 12)}/document.pdf`;
    const { error: uploadError } = await service.storage.from(BUCKET).upload(path, buffer, { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      logEvent("error", "upload.storage_failed", { requestId, userId: user.id, error: uploadError });
      return Response.json({ ok: false, error: "The file could not be stored. Please try again." }, { status: 500 });
    }
    const { error: rowError } = await service.from("customer_uploads").insert({
      user_id: user.id,
      bucket: BUCKET,
      path,
      file_name: displayName,
      mime_type: "application/pdf",
      size_bytes: buffer.length,
      metadata: { folder, context: "field-file", checksum },
    });
    if (rowError) {
      await service.storage.from(BUCKET).remove([path]);
      return Response.json({ ok: false, error: "The file could not be recorded. Please try again." }, { status: 500 });
    }
    return Response.json({ ok: true, file: { bucket: BUCKET, path, originalPath: path, name: displayName, type: "application/pdf", size: buffer.length, checksum } });
  }

  /* --------------------------------------------------------------- images */
  const sniffed = sniffImageType(buffer, false);
  if (sniffed.ok === false) return Response.json({ ok: false, error: sniffed.error }, { status: 400 });

  let meta: Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    return Response.json({ ok: false, error: "This image could not be read. Try another file." }, { status: 400 });
  }
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return Response.json({ ok: false, error: "This image could not be read." }, { status: 400 });
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    return Response.json({ ok: false, error: `Images larger than ${MAX_DIMENSION}px or 60 megapixels are not supported.` }, { status: 400 });
  }

  let originalBuffer: Buffer;
  let editorBuffer: Buffer;
  let thumbBuffer: Buffer;
  try {
    const decode = () => sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate();
    // Full resolution, metadata removed, nothing appended after the image.
    // A JPEG keeps its compressed picture byte for byte (only metadata
    // segments are dropped; the colour profile and orientation stay) — proven
    // to decode to identical pixels, else re-encoded as before. PNG and WebP
    // are re-encoded losslessly (orientation applied, metadata dropped).
    const losslessJpeg = sniffed.mime === "image/jpeg" ? await stripJpegMetadataVerified(buffer, MAX_PIXELS) : null;
    originalBuffer =
      losslessJpeg
        ? losslessJpeg
        : sniffed.mime === "image/png"
        ? await decode().png({ compressionLevel: 9 }).toBuffer()
        : sniffed.mime === "image/webp"
          ? await decode().webp({ lossless: true }).toBuffer()
          : await decode().jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
    editorBuffer = await decode().resize(EDITOR_MAX_PX, EDITOR_MAX_PX, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
    thumbBuffer = await decode().resize(THUMB_PX, THUMB_PX, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  } catch {
    return Response.json({ ok: false, error: "This image could not be processed. Try another file." }, { status: 400 });
  }
  // The variants must decode AND be the right size for this photo (EXIF
  // orientation applied): a thumbnail-sized editor image is never stored.
  const swapped = typeof meta.orientation === "number" && meta.orientation >= 5 && meta.orientation <= 8;
  // Every stored file is upright, so the photo's size is reported upright too
  // (a portrait phone photo is taller than wide, whatever its raw pixel order).
  const orientedWidth = swapped ? height : width;
  const orientedHeight = swapped ? width : height;
  try {
    await assertVariantsDecodable(editorBuffer, thumbBuffer);
    await assertVariantsSized(editorBuffer, thumbBuffer, swapped ? height : width, swapped ? width : height, CUSTOMER_VARIANT_BOUNDS);
  } catch (cause) {
    logEvent("error", "upload.variant_invalid", { requestId, userId: user.id, error: cause });
    return Response.json({ ok: false, error: "This image could not be processed. Try another file." }, { status: 400 });
  }

  const extension = EXTENSION[sniffed.mime];
  const basePath = `${user.id}/${folder}/${stamp}-${safeFileName(displayName, "photo").replace(/\.[a-z0-9]+$/, "").slice(0, 40)}`;
  const originalPath = `${basePath}/original.${extension}`;
  const editorPath = `${basePath}/editor.webp`;
  const thumbPath = `${basePath}/thumb.webp`;

  const uploads = [
    { path: originalPath, data: originalBuffer, contentType: sniffed.mime },
    { path: editorPath, data: editorBuffer, contentType: "image/webp" },
    { path: thumbPath, data: thumbBuffer, contentType: "image/webp" },
  ];
  const uploadedPaths: string[] = [];
  for (const item of uploads) {
    const { error: uploadError } = await service.storage.from(BUCKET).upload(item.path, item.data, { contentType: item.contentType, upsert: false });
    if (uploadError) {
      if (uploadedPaths.length) await service.storage.from(BUCKET).remove(uploadedPaths);
      logEvent("error", "upload.storage_failed", { requestId, userId: user.id, error: uploadError });
      return Response.json({ ok: false, error: "The image could not be stored. Please try again." }, { status: 500 });
    }
    uploadedPaths.push(item.path);
  }

  // Read the editor variant back: the stored object must exist and be right
  // before the photo is offered to the canvas.
  const stored = await verifyStoredEditorVariant({
    supabase: service,
    bucket: BUCKET,
    storagePath: editorPath,
    sourceWidth: swapped ? height : width,
    sourceHeight: swapped ? width : height,
    maxPx: EDITOR_MAX_PX,
  });
  if (!stored.ok) {
    await service.storage.from(BUCKET).remove(uploadedPaths);
    logEvent("error", "upload.variant_unverified", { requestId, userId: user.id, error: new Error(`editor ${stored.reason}`) });
    return Response.json({ ok: false, error: "The image could not be stored. Please try again." }, { status: 500 });
  }

  // Library record (reused across products) + audit row.
  const { data: libraryRow, error: libraryError } = await service
    .from("customer_asset_library")
    .insert({
      user_id: user.id,
      bucket: BUCKET,
      path: originalPath,
      editor_path: editorPath,
      thumbnail_path: thumbPath,
      file_name: displayName,
      mime_type: sniffed.mime,
      size_bytes: originalBuffer.length,
      width: orientedWidth,
      height: orientedHeight,
      checksum,
      status: "ready",
      metadata: { folder },
    })
    .select("id")
    .maybeSingle();
  if (libraryError || !libraryRow?.id) {
    await service.storage.from(BUCKET).remove(uploadedPaths);
    logEvent("error", "upload.library_record_failed", { requestId, userId: user.id, error: libraryError });
    return Response.json({ ok: false, error: "The upload could not be committed to the secure asset library." }, { status: 500 });
  }

  const { error: auditError } = await service.from("customer_uploads").insert({
    user_id: user.id,
    bucket: BUCKET,
    path: originalPath,
    file_name: displayName,
    mime_type: sniffed.mime,
    size_bytes: originalBuffer.length,
    metadata: { folder, context: "customizer", assetId: libraryRow.id },
  });
  if (auditError) logEvent("warn", "upload.audit_row_failed", { requestId, userId: user.id, error: auditError });

  const assetReference = {
    version: 1 as const,
    assetId: libraryRow.id,
    ownerId: user.id,
    bucket: BUCKET,
    storagePath: originalPath,
    editorStoragePath: editorPath,
    thumbnailStoragePath: thumbPath,
    originalFileName: displayName,
    mimeType: sniffed.mime,
    fileSize: originalBuffer.length,
    width: orientedWidth,
    height: orientedHeight,
    checksum,
    createdAt: new Date(stamp).toISOString(),
  };
  const [signedEditor, signedThumb] = await Promise.all([
    resolvePrivateAssetUrl({ reference: assetReference, actor: { userId: user.id }, variant: "editor", supabase: service }),
    resolvePrivateAssetUrl({ reference: assetReference, actor: { userId: user.id }, variant: "thumbnail", supabase: service }),
  ]);

  return Response.json({
    ok: true,
    file: {
      assetId: libraryRow.id,
      ownerId: user.id,
      bucket: BUCKET,
      // The editor works with the optimized version; the original is kept for
      // production rendering.
      path: editorPath,
      originalPath,
      thumbnailPath: thumbPath,
      name: displayName,
      type: sniffed.mime,
      size: originalBuffer.length,
      width: orientedWidth,
      height: orientedHeight,
      checksum,
      createdAt: new Date(stamp).toISOString(),
      assetReference,
      url: signedEditor.signedUrl,
      signedUrl: signedEditor.signedUrl,
      thumbnailUrl: signedThumb.signedUrl,
    },
  });
}
