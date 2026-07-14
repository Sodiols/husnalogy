import sharp from "sharp";
import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sniffImageType, sanitizeSvg, detectTintable, safeFileName } from "@/lib/customizer/v2/uploads";
import { assetFromRow } from "@/lib/customizer/assets";

const MAX_SIZE = 10 * 1024 * 1024;

// GET /api/admin/customizer/assets — list/search elements (admin view).
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").trim().slice(0, 120);
  const categoryId = (url.searchParams.get("category") || "").trim();
  const includeArchived = url.searchParams.get("archived") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Math.min(60, Number(url.searchParams.get("pageSize")) || 40));

  const supabase = createServiceRoleClient();
  let query = supabase
    .from("customizer_assets")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (!includeArchived) query = query.eq("archived", false);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (search) query = query.or(`title.ilike.%${search}%,keywords.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) {
    console.error("List customizer assets failed:", error);
    return Response.json({ ok: false, error: "Could not load elements." }, { status: 500 });
  }
  return Response.json({ ok: true, assets: (data || []).map(assetFromRow), total: count || 0, page, pageSize });
}

// POST /api/admin/customizer/assets — upload a new element (SVG/PNG/JPG/WebP).
// SVGs are sanitized before storage; scripts and external references are
// rejected (spec §14, §33).
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file") as File | null;
  if (!file) return Response.json({ ok: false, error: "No file provided." }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ ok: false, error: "Elements must be 10MB or smaller." }, { status: 400 });

  const title = String(formData?.get("title") || "").trim().slice(0, 200) || file.name.replace(/\.[^.]+$/, "");
  const categoryId = String(formData?.get("categoryId") || "").trim().slice(0, 80);
  const tags = String(formData?.get("tags") || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
  const keywords = String(formData?.get("keywords") || "").trim().slice(0, 500);
  const customerAvailable = String(formData?.get("customerAvailable") || "true") !== "false";
  const defaultColor = String(formData?.get("defaultColor") || "").trim().slice(0, 32);

  let buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImageType(buffer, true);
  if (sniffed.ok === false) return Response.json({ ok: false, error: sniffed.error }, { status: 400 });

  let width = 0;
  let height = 0;
  let tintable = false;

  if (sniffed.mime === "image/svg+xml") {
    const sanitized = sanitizeSvg(buffer.toString("utf8"));
    if (sanitized.ok === false) return Response.json({ ok: false, error: sanitized.error }, { status: 400 });
    buffer = Buffer.from(sanitized.svg, "utf8");
    tintable = detectTintable(sanitized.svg);
    const viewBox = sanitized.svg.match(/viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (viewBox) {
      width = Math.round(Number(viewBox[1]) || 0);
      height = Math.round(Number(viewBox[2]) || 0);
    }
  } else {
    try {
      const meta = await sharp(buffer, { limitInputPixels: 8000 * 8000 }).metadata();
      width = meta.width || 0;
      height = meta.height || 0;
    } catch {
      return Response.json({ ok: false, error: "This image could not be read." }, { status: 400 });
    }
  }

  const supabase = createServiceRoleClient();
  const path = `elements/${Date.now()}-${safeFileName(file.name, "element")}`;
  const { error: uploadError } = await supabase.storage.from("customizer-elements").upload(path, buffer, {
    contentType: sniffed.mime,
    upsert: false,
  });
  if (uploadError) return Response.json({ ok: false, error: uploadError.message }, { status: 500 });

  const { data: publicUrl } = supabase.storage.from("customizer-elements").getPublicUrl(path);

  const { data, error } = await supabase
    .from("customizer_assets")
    .insert({
      category_id: categoryId || null,
      title,
      tags,
      keywords,
      bucket: "customizer-elements",
      path,
      public_url: publicUrl?.publicUrl || "",
      mime_type: sniffed.mime,
      file_size_bytes: buffer.byteLength,
      width,
      height,
      tintable,
      default_color: defaultColor || null,
      customer_available: customerAvailable,
      active: true,
      archived: false,
      created_by: admin.admin?.id || null,
    })
    .select("*")
    .single();
  if (error) {
    console.error("Create customizer asset failed:", error);
    return Response.json({ ok: false, error: "Could not save the element." }, { status: 500 });
  }

  return Response.json({ ok: true, asset: assetFromRow(data) }, { status: 201 });
}
