import { createServiceRoleClient } from "@/lib/supabase/server";

const PUBLIC_BUCKET_BY_FOLDER = {
  "product-images": "product-images",
  "product-mockups": "product-mockups",
  "product-videos": "product-videos",
  "settings-logo": "site-assets",
  "settings-favicon": "site-assets",
  "hero-collection": "site-assets",
};

export function canUseSupabaseStorage() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function getBucketForFolder(folder) {
  return PUBLIC_BUCKET_BY_FOLDER[String(folder || "")] || "admin-assets";
}

export async function uploadToSupabaseStorage({ buffer, fileName, folder, contentType }) {
  const supabase = createServiceRoleClient();
  const bucket = getBucketForFolder(folder);
  const safeFolder = String(folder || "uploads").replace(/^\/+|\/+$/g, "") || "uploads";
  const path = `${safeFolder}/${fileName}`;
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: contentType || "application/octet-stream",
    upsert: false,
  });

  if (error) throw error;

  if (Object.values(PUBLIC_BUCKET_BY_FOLDER).includes(bucket)) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  const { data, error: signedError } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signedError) throw signedError;
  return data.signedUrl;
}
