import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireDesignerOrAdmin } from "@/lib/auth/roles";
import { canUseSupabaseStorage, uploadToSupabaseStorage } from "@/lib/storage/supabase-storage";
import { readFormData } from "@/lib/http/read-body";
import {
  ADMIN_IMAGE_MAX_BYTES,
  ADMIN_MEDIA_MAX_REQUEST_BYTES,
  ADMIN_VIDEO_MAX_BYTES,
  MediaRejected,
  formatMegabytes,
  normalizeAdminImage,
  validateAdminVideo,
} from "@/lib/uploads/admin-media";
import { logEvent, requestIdFrom } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 20;

const FOLDERS = {
  images: "product-images",
  image: "product-images",
  "product-images": "product-images",
  mockups: "product-mockups",
  mockup: "product-mockups",
  "product-mockups": "product-mockups",
  videos: "product-videos",
  video: "product-videos",
  "product-videos": "product-videos",
  logo: "settings-logo",
  "settings-logo": "settings-logo",
  favicon: "settings-favicon",
  "settings-favicon": "settings-favicon",
  profile: "admin-profile",
  "admin-profile": "admin-profile",
  "hero-collection": "hero-collection",
  hero: "hero-collection",
};

function normalizeFolder(value) {
  return FOLDERS[String(value || "").trim()] || "";
}

/** A readable, safe base name from the uploader's file name; the EXTENSION always comes from the verified content. */
function safeBaseName(name: string) {
  const base = String(name || "file")
    .replace(/\.[^.]*$/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return base || "file";
}

const TOO_LARGE = `This upload is too large. Each upload request may be up to ${formatMegabytes(ADMIN_MEDIA_MAX_REQUEST_BYTES)} (images up to ${formatMegabytes(ADMIN_IMAGE_MAX_BYTES)} each, videos up to ${formatMegabytes(ADMIN_VIDEO_MAX_BYTES)}).`;

/**
 * Product media for admins and designers. One request carries several images
 * or one video, bounded by ADMIN_MEDIA_MAX_REQUEST_BYTES — the same limit the
 * request wrapper streams the body with, so the declared and enforced limits
 * cannot disagree (lib/uploads/admin-media.ts).
 *
 * Every file is identified by its bytes, never by name or Content-Type; images
 * are decoded and re-encoded (metadata and appended bytes removed); videos
 * must be a complete MP4/MOV/WebM/AVI container. The stored Content-Type and
 * extension come from that verification.
 */
export const POST = withAdminMutation(async function POST(request) {
  // Designers upload their own product media; the storage path is derived server side.
  const session = await requireDesignerOrAdmin();
  if (!session.ok) return session.response;

  const upload = await readFormData(request, ADMIN_MEDIA_MAX_REQUEST_BYTES);
  if (upload.response?.status === 413) {
    return Response.json({ ok: false, success: false, error: TOO_LARGE }, { status: 413 });
  }
  const formData = upload.form;

  if (!formData) {
    return Response.json(
      {
        ok: false,
        success: false,
        error: "Upload request must be sent as FormData. Do not set Content-Type manually in fetch.",
      },
      { status: 400 }
    );
  }

  const folder = normalizeFolder(formData.get("folder") || formData.get("type"));
  const files = formData
    .getAll("files")
    .filter((file): file is File => file instanceof File);

  if (!folder) {
    return Response.json(
      { ok: false, success: false, error: "Invalid upload folder." },
      { status: 400 }
    );
  }

  if (!files.length) {
    return Response.json(
      { ok: false, success: false, error: "Choose at least one file." },
      { status: 400 }
    );
  }

  if (files.length > MAX_FILES) {
    return Response.json(
      { ok: false, success: false, error: "You can upload a maximum of 20 files at a time." },
      { status: 400 }
    );
  }

  if (!canUseSupabaseStorage()) {
    return Response.json(
      {
        ok: false,
        success: false,
        error: "Supabase Storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 500 }
    );
  }

  // Verify EVERY file before storing ANY, so a bad file never leaves half an upload behind.
  const prepared: Array<{ buffer: Buffer; contentType: string; fileName: string }> = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    try {
      if (folder === "product-videos") {
        const video = validateAdminVideo(bytes);
        prepared.push({ buffer: bytes, contentType: video.contentType, fileName: `${safeBaseName(file.name)}.${video.extension}` });
      } else {
        const image = await normalizeAdminImage(bytes);
        prepared.push({ buffer: image.data, contentType: image.contentType, fileName: `${safeBaseName(file.name)}.${image.extension}` });
      }
    } catch (error) {
      if (error instanceof MediaRejected) {
        return Response.json({ ok: false, success: false, error: `${String(file.name || "This file").slice(0, 120)}: ${error.message}` }, { status: 400 });
      }
      throw error;
    }
  }

  try {
    const urls = [];
    for (const item of prepared) {
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${item.fileName}`;
      urls.push(await uploadToSupabaseStorage({ buffer: item.buffer, fileName: uniqueName, folder, contentType: item.contentType }));
    }
    return Response.json({ ok: true, success: true, urls });
  } catch (error) {
    logEvent("error", "admin.upload_failed", { requestId: requestIdFrom(request), folder, error });
    return Response.json({ ok: false, success: false, error: "The upload could not be stored. Please try again." }, { status: 500 });
  }
}, { maxBytes: ADMIN_MEDIA_MAX_REQUEST_BYTES, studio: true, tooLargeMessage: TOO_LARGE });
