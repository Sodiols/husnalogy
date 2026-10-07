/**
 * The signed-in customer's profile (name, phone, photo), stored on
 * `public.profiles` — never in browser storage.
 *
 * Reads and name/phone writes use the SESSION-scoped client, so RLS
 * (id = auth.uid()) is the enforcement. Profile photos are written by the
 * server with the service role after the session has been verified, into the
 * account's own folder of the private `customer-avatars` bucket.
 */
import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { z } from "zod";
import { sniffImageType } from "@/lib/customizer/v2/uploads";

export const AVATAR_BUCKET = "customer-avatars";
export const AVATAR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const AVATAR_MAX_DIMENSION = 8000;
export const AVATAR_MAX_PIXELS = 40_000_000;
export const AVATAR_SIZE_PX = 512;
const AVATAR_SIGNED_URL_TTL_SECONDS = 60 * 60;

export const profilePatchSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name.").max(120, "Your name is too long."),
    phone: z
      .string()
      .trim()
      .max(30, "Enter a valid phone number.")
      .regex(/^[0-9+()\-. ]*$/, "Enter a valid phone number."),
  })
  .partial();

export type CustomerProfile = { name: string; email: string; phone: string; avatarUrl: string };

export class ProfileError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProfileError";
  }
}

/** A path inside this account's own avatar folder. */
export const isOwnAvatarPath = (userId: string, path: unknown): path is string =>
  typeof path === "string" && path.startsWith(`${userId}/`) && !path.includes("..") && path.length <= 200;

async function avatarUrlFor(service: any, userId: string, row: any): Promise<string> {
  if (isOwnAvatarPath(userId, row?.avatar_path)) {
    const { data } = await service.storage.from(AVATAR_BUCKET).createSignedUrl(row.avatar_path, AVATAR_SIGNED_URL_TTL_SECONDS);
    if (data?.signedUrl) return data.signedUrl;
  }
  // A sign-in provider's photo (e.g. Google) is an https URL.
  const provider = String(row?.avatar_url || "");
  return provider.startsWith("https://") ? provider : "";
}

export async function readProfile(supabase: any, service: any, user: { id: string; email?: string | null }): Promise<CustomerProfile> {
  const { data, error } = await supabase.from("profiles").select("full_name,email,phone,avatar_url,avatar_path").eq("id", user.id).maybeSingle();
  if (error) throw new ProfileError("Your profile could not be loaded.", 500);
  return {
    name: String(data?.full_name || ""),
    email: String(data?.email || user.email || ""),
    phone: String(data?.phone || ""),
    avatarUrl: await avatarUrlFor(service, user.id, data),
  };
}

export async function updateProfile(supabase: any, userId: string, patch: z.infer<typeof profilePatchSchema>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.full_name = patch.name;
  if (patch.phone !== undefined) row.phone = patch.phone || null;
  if (!Object.keys(row).length) return;
  const { data, error } = await supabase.from("profiles").update(row).eq("id", userId).select("id").maybeSingle();
  if (error) throw new ProfileError("Your profile could not be saved.", 500);
  if (!data) throw new ProfileError("Your profile could not be found.", 404);
}

/**
 * Validate and normalise an uploaded profile photo: the type comes from the
 * bytes (never the name or Content-Type), the image must fully decode within
 * the dimension and pixel limits, and the stored file is a freshly encoded
 * square WebP — orientation applied, all metadata (EXIF/GPS) and any appended
 * bytes gone.
 */
export async function normaliseAvatar(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > AVATAR_MAX_UPLOAD_BYTES) throw new ProfileError("Photos must be 8 MB or smaller.", 400);
  const sniffed = sniffImageType(bytes, false);
  if (sniffed.ok === false) throw new ProfileError("Upload a JPG, PNG or WebP photo.", 400);
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: AVATAR_MAX_PIXELS }).metadata();
  } catch {
    throw new ProfileError("This photo could not be read. Try another file.", 400);
  }
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height || width > AVATAR_MAX_DIMENSION || height > AVATAR_MAX_DIMENSION || width * height > AVATAR_MAX_PIXELS) {
    throw new ProfileError("This photo is too large. Use one under 8000 pixels per side.", 400);
  }
  try {
    return await sharp(bytes, { limitInputPixels: AVATAR_MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: "cover", position: "attention" })
      .webp({ quality: 86 })
      .toBuffer();
  } catch {
    throw new ProfileError("This photo could not be processed. Try another file.", 400);
  }
}

/** Store a new profile photo for `userId` and point the profile at it. Returns a signed URL. */
export async function replaceAvatar(service: any, userId: string, bytes: Buffer): Promise<string> {
  const image = await normaliseAvatar(bytes);
  const path = `${userId}/${Date.now()}-${createHash("sha256").update(image).digest("hex").slice(0, 16)}.webp`;
  const { data: previous } = await service.from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
  const { error: uploadError } = await service.storage.from(AVATAR_BUCKET).upload(path, image, { contentType: "image/webp", upsert: false, cacheControl: "3600" });
  if (uploadError) throw new ProfileError("Your photo could not be stored. Please try again.", 500);
  const { data: updated, error: updateError } = await service.from("profiles").update({ avatar_path: path }).eq("id", userId).select("id").maybeSingle();
  if (updateError || !updated) {
    await service.storage.from(AVATAR_BUCKET).remove([path]);
    throw new ProfileError("Your photo could not be saved. Please try again.", 500);
  }
  if (isOwnAvatarPath(userId, previous?.avatar_path) && previous.avatar_path !== path) {
    await service.storage.from(AVATAR_BUCKET).remove([previous.avatar_path]);
  }
  const { data: signed } = await service.storage.from(AVATAR_BUCKET).createSignedUrl(path, AVATAR_SIGNED_URL_TTL_SECONDS);
  return String(signed?.signedUrl || "");
}

/** Remove the uploaded profile photo (a provider photo, if any, shows again). */
export async function removeAvatar(service: any, userId: string): Promise<void> {
  const { data: previous } = await service.from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
  const { error } = await service.from("profiles").update({ avatar_path: null }).eq("id", userId);
  if (error) throw new ProfileError("Your photo could not be removed. Please try again.", 500);
  if (isOwnAvatarPath(userId, previous?.avatar_path)) await service.storage.from(AVATAR_BUCKET).remove([previous.avatar_path]);
}
