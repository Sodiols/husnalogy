// What went wrong with a studio upload, in words the designer can act on.
// The asset route already explains refusals it understands (type, size,
// decode); this adds the cases it cannot speak for — no connection, a lapsed
// session, a server or storage outage — and says whether trying the same
// file again could help.

export type UploadFailureKind =
  | "unsupported-format"
  | "too-large"
  | "invalid-image"
  | "network"
  | "auth"
  | "storage"
  | "server"
  | "cancelled";

export type UploadFailure = { kind: UploadFailureKind; message: string; retryable: boolean };

/** Raster formats the asset route accepts for a page background. */
export const BACKGROUND_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const BACKGROUND_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Refuses a file before any bytes are sent when it obviously cannot become a
 * background; null when it may go to the server (which checks it again).
 */
export function precheckBackgroundFile(file: { type?: string; size: number; name?: string }): UploadFailure | null {
  const type = String(file.type || "").toLowerCase();
  if (type && !(BACKGROUND_UPLOAD_TYPES as readonly string[]).includes(type)) {
    return { kind: "unsupported-format", message: "That file type can't be a background. Use a JPG, PNG or WebP image.", retryable: false };
  }
  if (file.size > BACKGROUND_UPLOAD_MAX_BYTES) {
    return { kind: "too-large", message: "That image is larger than 25 MB. Use a smaller or compressed copy.", retryable: false };
  }
  if (file.size === 0) return { kind: "invalid-image", message: "That file is empty.", retryable: false };
  return null;
}

/**
 * Classifies a finished request. `status` 0 means the request never reached
 * the server (offline, DNS, CORS, dropped connection).
 */
export function describeUploadFailure(input: { status: number; serverMessage?: string; aborted?: boolean }): UploadFailure {
  const said = String(input.serverMessage || "").trim();
  if (input.aborted) return { kind: "cancelled", message: "Upload cancelled.", retryable: true };
  if (input.status === 0) {
    return { kind: "network", message: "Upload failed: no connection to the server. Check your connection and try again.", retryable: true };
  }
  if (input.status === 401 || input.status === 403) {
    return { kind: "auth", message: "Your session has expired or lacks permission to upload. Sign in again, then retry.", retryable: false };
  }
  if (input.status === 413) {
    return { kind: "too-large", message: said || "That image is too large to upload.", retryable: false };
  }
  if (input.status === 400 || input.status === 415 || input.status === 422) {
    if (/unsupported|file type|asset type/i.test(said)) return { kind: "unsupported-format", message: said, retryable: false };
    if (/25\s*MB|too large|smaller|pixels|dimensions/i.test(said)) return { kind: "too-large", message: said, retryable: false };
    return { kind: "invalid-image", message: said || "That file couldn't be read as an image.", retryable: false };
  }
  if (/storage|upload failed:|rolled back|could not be verified/i.test(said)) {
    return { kind: "storage", message: said, retryable: true };
  }
  return { kind: "server", message: said || `The server couldn't process the image (error ${input.status}). Try again.`, retryable: true };
}

/** A failed studio upload, carrying its classification. */
export class AssetUploadError extends Error {
  readonly failure: UploadFailure;
  constructor(failure: UploadFailure) {
    super(failure.message);
    this.name = "AssetUploadError";
    this.failure = failure;
  }
}

/** The classification of anything an upload threw. */
export function uploadFailureOf(error: unknown): UploadFailure {
  if (error instanceof AssetUploadError) return error.failure;
  const message = error instanceof Error && error.message ? error.message : "Upload failed.";
  return { kind: "server", message, retryable: true };
}
