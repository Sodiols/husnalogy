import sharp from "sharp";
import type { Metadata } from "sharp";
import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { sniffImageType, safeFileName } from "@/lib/customizer/v2/uploads";
import { resolvePrivateAssetUrl } from "@/lib/customizer/server/private-assets";

const MAX_SIZE = 15 * 1024 * 1024;
const MAX_DIMENSION = 12000; // hard pixel-bomb guard
const EDITOR_MAX_PX = 1600;
const THUMB_PX = 384;

// POST /api/customizer/upload — authenticated photo upload for image fields
// and the customer asset library (spec §15).
// - File type verified by magic bytes, never the browser MIME type.
// - Metadata (EXIF/GPS) is stripped from derived versions.
// - Generates an optimized editor version + thumbnail alongside the original.
// - Records the upload in customer_asset_library for reuse across products.
export async function POST(request: Request) {
  const limited = rateLimit(request, { name: "customizer-upload", limit: 40, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file") as File | null;
  const folder = String(formData?.get("folder") || "customizer").replace(/[^a-z0-9/_-]/gi, "").slice(0, 120);

  if (!file) return Response.json({ ok: false, error: "No file provided." }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ ok: false, error: "Image must be 15MB or smaller." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const sniffed = sniffImageType(buffer, false);
  if (sniffed.ok === false) return Response.json({ ok: false, error: sniffed.error }, { status: 400 });

  // Decode guard: dimensions + decompression limits (spec §15, §33).
  let meta: Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION }).metadata();
  } catch {
    return Response.json({ ok: false, error: "This image could not be read. Try another file." }, { status: 400 });
  }
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return Response.json({ ok: false, error: "This image could not be read." }, { status: 400 });
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return Response.json({ ok: false, error: `Images larger than ${MAX_DIMENSION}px are not supported.` }, { status: 400 });
  }

  const stamp = Date.now();
  const cleanName = safeFileName(file.name, "photo");
  const basePath = `${user.id}/${folder}/${stamp}-${cleanName.replace(/\.[a-z0-9]+$/, "")}`;
  const originalPath = `${basePath}/original-${cleanName}`;
  const editorPath = `${basePath}/editor.webp`;
  const thumbPath = `${basePath}/thumb.webp`;

  // Derived versions: rotated per EXIF, metadata stripped, size-capped.
  let editorBuffer: Buffer;
  let thumbBuffer: Buffer;
  try {
    editorBuffer = await sharp(buffer, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION })
      .rotate()
      .resize(EDITOR_MAX_PX, EDITOR_MAX_PX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();
    thumbBuffer = await sharp(buffer, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION })
      .rotate()
      .resize(THUMB_PX, THUMB_PX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    return Response.json({ ok: false, error: "This image could not be processed. Try another file." }, { status: 400 });
  }

  const uploads: Array<{ path: string; data: Buffer | File; contentType: string }> = [
    { path: originalPath, data: buffer, contentType: sniffed.mime },
    { path: editorPath, data: editorBuffer, contentType: "image/webp" },
    { path: thumbPath, data: thumbBuffer, contentType: "image/webp" },
  ];
  const uploadedPaths: string[] = [];
  for (const item of uploads) {
    const { error: uploadError } = await supabase.storage
      .from("customer-uploads")
      .upload(item.path, item.data, { contentType: item.contentType, upsert: false });
    if (uploadError) {
      if (uploadedPaths.length) await supabase.storage.from("customer-uploads").remove(uploadedPaths);
      return Response.json({ ok: false, error: uploadError.message }, { status: 500 });
    }
    uploadedPaths.push(item.path);
  }

  // Library record (reused across products) + legacy audit row.
  const { data: libraryRow, error: libraryError } = await supabase
    .from("customer_asset_library")
    .insert({
      user_id: user.id,
      bucket: "customer-uploads",
      path: originalPath,
      editor_path: editorPath,
      thumbnail_path: thumbPath,
      file_name: file.name.slice(0, 300),
      mime_type: sniffed.mime,
      size_bytes: file.size,
      width,
      height,
      checksum,
      status: "ready",
      metadata: { folder },
    })
    .select("id")
    .maybeSingle();
  if (libraryError || !libraryRow?.id) {
    await supabase.storage.from("customer-uploads").remove(uploadedPaths);
    return Response.json({ ok: false, error: "The upload could not be committed to the secure asset library." }, { status: 500 });
  }

  await supabase.from("customer_uploads").insert({
    user_id: user.id,
    bucket: "customer-uploads",
    path: originalPath,
    file_name: file.name,
    mime_type: sniffed.mime,
    size_bytes: file.size,
    metadata: { folder, context: "customizer", assetId: libraryRow?.id || "" },
  });

  const assetReference = {
    version: 1 as const,
    assetId: libraryRow.id,
    ownerId: user.id,
    bucket: "customer-uploads",
    storagePath: originalPath,
    editorStoragePath: editorPath,
    thumbnailStoragePath: thumbPath,
    originalFileName: file.name,
    mimeType: sniffed.mime,
    fileSize: file.size,
    width,
    height,
    checksum,
    createdAt: new Date(stamp).toISOString(),
  };
  const [signedEditor, signedThumb] = await Promise.all([
    resolvePrivateAssetUrl({ reference: assetReference, actor: { userId: user.id }, variant: "editor", supabase }),
    resolvePrivateAssetUrl({ reference: assetReference, actor: { userId: user.id }, variant: "thumbnail", supabase }),
  ]);

  return Response.json({
    ok: true,
    file: {
      assetId: libraryRow?.id || "",
      ownerId: user.id,
      bucket: "customer-uploads",
      // The editor works with the optimized version; the original is kept for
      // production rendering.
      path: editorPath,
      originalPath,
      thumbnailPath: thumbPath,
      name: file.name,
      type: sniffed.mime,
      size: file.size,
      width,
      height,
      checksum,
      createdAt: new Date(stamp).toISOString(),
      assetReference,
      url: signedEditor.signedUrl,
      signedUrl: signedEditor.signedUrl,
      thumbnailUrl: signedThumb.signedUrl,
    },
  });
}
