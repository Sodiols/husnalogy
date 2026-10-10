import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/roles";
import { privatePageMetadata } from "@/lib/seo/metadata";
import UploadPhotosClient from "./upload-photos-client";

export const dynamic = "force-dynamic";

export const metadata = privatePageMetadata("Upload photos from your phone");

/**
 * The phone end of the customizer's "Upload from your phone": opened by
 * scanning the QR code in the Photos panel. Every photo sent here lands in the
 * customer's own photo library, which the customizer is watching.
 *
 * Under /account, so a signed-out phone is sent to sign in and straight back
 * (proxy.js); the upload API checks the session again on every photo.
 */
export default async function UploadPhotosPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent("/account/upload-photos")}`);
  return <UploadPhotosClient />;
}
