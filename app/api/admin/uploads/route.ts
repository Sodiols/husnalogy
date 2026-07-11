import path from "node:path";
import { requireAdmin } from "@/lib/auth/admin-server";
import { canUseSupabaseStorage, uploadToSupabaseStorage } from "@/lib/storage/supabase-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 20;
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_VIDEO_SIZE = 120 * 1024 * 1024;

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

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/mov",
  "video/x-msvideo",
]);

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".avi"]);

function normalizeFolder(value) {
  return FOLDERS[String(value || "").trim()] || "";
}

function safeFileName(name) {
  const originalName = String(name || "file");
  const ext = path.extname(originalName).toLowerCase();
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${base || "file"}${ext}`;
}

function startsWith(bytes, signature) {
  if (!bytes || bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes, start, end) {
  return bytes.subarray(start, end).toString("ascii");
}

function hasValidImageSignature(ext, bytes) {
  if (ext === ".jpg" || ext === ".jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (ext === ".png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === ".gif") return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a";
  if (ext === ".webp") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  if (ext === ".avif") return ascii(bytes, 4, 8) === "ftyp" && ascii(bytes, 8, 32).includes("avif");
  return false;
}

function hasValidVideoSignature(ext, bytes) {
  if (ext === ".webm") return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  if (ext === ".avi") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "AVI ";
  if (ext === ".mp4" || ext === ".mov") return ascii(bytes, 4, 8) === "ftyp";
  return false;
}

function isValidUpload(file, folder, bytes) {
  const fileName = file?.name || "";
  const fileType = file?.type || "";
  const fileSize = Number(file?.size || 0);
  const ext = path.extname(fileName).toLowerCase();

  if (folder === "product-videos") {
    const typeOk = !fileType || VIDEO_MIME_TYPES.has(fileType);
    return VIDEO_EXTENSIONS.has(ext) && typeOk && fileSize > 0 && fileSize <= MAX_VIDEO_SIZE && hasValidVideoSignature(ext, bytes);
  }

  const typeOk = !fileType || IMAGE_MIME_TYPES.has(fileType);
  return IMAGE_EXTENSIONS.has(ext) && typeOk && fileSize > 0 && fileSize <= MAX_IMAGE_SIZE && hasValidImageSignature(ext, bytes);
}

async function parseUploadForm(request) {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

export async function POST(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const formData = await parseUploadForm(request);

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
    .filter((file) => file && typeof file === "object" && typeof file.arrayBuffer === "function");

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

  try {
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

    const urls = [];

    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());

      if (!isValidUpload(file, folder, bytes)) {
        const maxSize = folder === "product-videos" ? "120MB" : "15MB";
        return Response.json(
          {
            ok: false,
            success: false,
            error: `File type or size is not allowed. Maximum size is ${maxSize}.`,
          },
          { status: 400 }
        );
      }

      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${safeFileName(file.name)}`;
      const url = await uploadToSupabaseStorage({
        buffer: bytes,
        fileName: uniqueName,
        folder,
        contentType: file.type,
      });
      urls.push(url);
    }

    return Response.json({ ok: true, success: true, urls });
  } catch (error) {
    console.error("Admin upload error:", error);

    return Response.json(
      {
        ok: false,
        success: false,
        error: error?.message || "Upload failed.",
      },
      { status: 500 }
    );
  }
}
