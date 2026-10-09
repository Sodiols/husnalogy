// Original-image preservation policy, shared by customer and studio uploads.
//
// Every raster upload is kept twice, each with its own SHA-256:
//
//   MASTER    the exact uploaded bytes. Immutable, private, server-only: no
//             code path ever signs it for a browser (its path lives only in
//             the row's metadata, never in a path column that delivery reads).
//             It is the archive that proves what was uploaded.
//   ORIGINAL  the full-resolution, sanitized file every consumer uses —
//             production rendering, order snapshots, the owner's own
//             download, studio staff. Camera/GPS metadata and any bytes
//             hidden after the image are gone; the picture is not degraded:
//               * JPEG — the compressed picture copied byte for byte, colour
//                 profile and orientation kept (lossless, verified to decode
//                 to identical pixels; re-encoded at q95 only if that check
//                 fails);
//               * PNG / WebP — re-encoded losslessly with the colour profile
//                 and 16-bit depth kept, orientation applied.
//
// SVG is the exception: unsafe markup is never stored, so its master is the
// sanitized document (and there is nothing private to strip from it).

import { createHash } from "node:crypto";
import sharp from "sharp";
import { stripJpegMetadataVerified } from "./jpeg-lossless";

export const ORIGINAL_POLICY_VERSION = 2;

export type OriginalMethod = "jpeg-scan-preserved" | "lossless-reencode" | "jpeg-reencode-q95";

export type MasterRecord = {
  path: string;
  checksum: string;
  size: number;
  mimeType: string;
};

export const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

export async function sanitizedOriginal(buffer: Buffer, mime: string, limitInputPixels: number): Promise<{ buffer: Buffer; method: OriginalMethod }> {
  if (mime === "image/jpeg") {
    const preserved = await stripJpegMetadataVerified(buffer, limitInputPixels);
    if (preserved) return { buffer: preserved, method: "jpeg-scan-preserved" };
    const reencoded = await sharp(buffer, { limitInputPixels, failOn: "error" })
      .rotate()
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
    return { buffer: reencoded, method: "jpeg-reencode-q95" };
  }
  const meta = await sharp(buffer, { limitInputPixels }).metadata();
  let pipeline = sharp(buffer, { limitInputPixels, failOn: "error" }).rotate().keepIccProfile();
  if (mime === "image/png") {
    if (meta.depth === "ushort") pipeline = pipeline.toColourspace((meta.channels || 3) >= 3 ? "rgb16" : "grey16");
    return { buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer(), method: "lossless-reencode" };
  }
  if (mime === "image/webp") return { buffer: await pipeline.webp({ lossless: true }).toBuffer(), method: "lossless-reencode" };
  throw new Error(`No original policy for ${mime}.`);
}

/** The master's storage path: beside the original, in the same private folder. */
export function masterPathFor(originalPath: string, extension: string): string {
  const slash = originalPath.lastIndexOf("/");
  const folder = slash >= 0 ? originalPath.slice(0, slash) : "";
  return `${folder ? `${folder}/` : ""}master.${extension}`;
}

/**
 * A master path recorded in a row's metadata, accepted only when it sits in
 * the asset's own folder tree (so tampered metadata can never point a delete
 * at someone else's file).
 */
export function trustedMasterPath(row: { path?: string | null; metadata?: any }): string | null {
  const master = row?.metadata?.master;
  const path = typeof master?.path === "string" ? master.path : "";
  const original = String(row?.path || "");
  if (!path || !original || path.includes("..") || path.includes("//")) return null;
  const root = original.split("/").slice(0, -1).join("/");
  const parent = root.split("/").slice(0, -1).join("/");
  // Customer: beside the original. Studio: <asset>/master/<name>.
  const inOwnFolder = Boolean(root) && path.startsWith(`${root}/`) && !path.slice(root.length + 1).includes("/");
  const inStudioMaster = Boolean(parent) && path.startsWith(`${parent}/master/`) && !path.slice(parent.length + 8).includes("/");
  return (inOwnFolder || inStudioMaster) && path !== original ? path : null;
}
