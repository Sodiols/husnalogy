import { notFound, redirect } from "next/navigation";
import { canAccessStudio, getCurrentActor } from "@/lib/auth/roles";
import UploadFromPhoneClient from "./upload-from-phone-client";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = privatePageMetadata("Upload from your phone");

/**
 * The phone end of the Design Studio's "Upload from your phone": opened by
 * scanning the studio's QR code. Every photo sent here lands in the same image
 * library the studio's Uploads panel shows.
 *
 * Outside /admin on purpose: the admin area answers a signed-out visitor with
 * a 404, which a phone could never get past. Here a signed-out phone is sent to
 * sign in and straight back (proxy.js); anyone who cannot use the studio gets
 * a 404, and the upload API keeps its own admin/designer checks regardless.
 */
export default async function UploadFromPhonePage() {
  const actor = await getCurrentActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent("/upload-from-phone")}`);
  if (!canAccessStudio(actor)) notFound();
  return <UploadFromPhoneClient />;
}
