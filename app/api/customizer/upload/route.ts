import { createClient } from "@/lib/supabase/server";

const MAX_SIZE = 15 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeName(name: string) {
  const parts = String(name || "photo").split(".");
  const ext = parts.length > 1 ? `.${parts.pop()}` : "";
  const base = parts.join(".").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${base || "photo"}${ext.toLowerCase()}`;
}

// POST /api/customizer/upload — authenticated photo upload for image fields.
// Stored under `${uid}/...` so the customer-uploads storage RLS policy allows it.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file") as File | null;
  const folder = String(formData?.get("folder") || "customizer");

  if (!file) return Response.json({ ok: false, error: "No file provided." }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ ok: false, error: "Image must be 15MB or smaller." }, { status: 400 });
  if (file.type && !ALLOWED.has(file.type)) {
    return Response.json({ ok: false, error: "Use a JPG, PNG, or WebP image." }, { status: 400 });
  }

  const path = `${user.id}/${folder}/${Date.now()}-${safeName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from("customer-uploads").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploadError) return Response.json({ ok: false, error: uploadError.message }, { status: 500 });

  const { data: signed } = await supabase.storage.from("customer-uploads").createSignedUrl(path, 60 * 60 * 24 * 7);

  await supabase.from("customer_uploads").insert({
    user_id: user.id,
    bucket: "customer-uploads",
    path,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size || null,
    metadata: { folder, context: "customizer" },
  });

  return Response.json({
    ok: true,
    file: {
      bucket: "customer-uploads",
      path,
      name: file.name,
      type: file.type,
      size: file.size,
      url: signed?.signedUrl || "",
      signedUrl: signed?.signedUrl || "",
    },
  });
}
