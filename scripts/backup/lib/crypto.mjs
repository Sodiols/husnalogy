/**
 * Backup encryption at rest: AES-256-GCM with a 32-byte key from
 * BACKUP_ENCRYPTION_KEY (64 hex characters or base64). The key lives in the
 * operator's password manager / vault, never next to the backups.
 *
 * File layout: "HUSNBK1\n" (8 bytes) | IV (12) | ciphertext | auth tag (16).
 * A wrong key or any modified byte fails decryption (GCM authentication).
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { chmodSync, createReadStream, createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("HUSNBK1\n");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;

export function parseEncryptionKey(value) {
  if (!value) return null;
  const text = String(value).trim();
  const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64).");
  return key;
}

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

export async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export function isEncrypted(buffer) {
  return buffer.length >= HEADER_BYTES + TAG_BYTES && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptBuffer(plain, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

export function decryptBuffer(sealed, key) {
  if (!isEncrypted(sealed)) throw new Error("not a Husnalogy encrypted backup file");
  if (!key) throw new Error("BACKUP_ENCRYPTION_KEY is required to read this backup");
  const iv = sealed.subarray(MAGIC.length, HEADER_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(HEADER_BYTES, sealed.length - TAG_BYTES)), decipher.final()]);
}

/** Stream-encrypt `source` into `target` (large database archives). */
export async function encryptFile(source, target, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = createWriteStream(target);
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(createReadStream(source), cipher, out, { end: false });
  await new Promise((resolve, reject) => out.end(cipher.getAuthTag(), (error) => (error ? reject(error) : resolve())));
}

/** Stream-decrypt; throws (and leaves no trusted output) on a wrong key or tampering. */
export async function decryptFile(source, target, key) {
  if (!key) throw new Error("BACKUP_ENCRYPTION_KEY is required to read this backup");
  const { size } = await stat(source);
  if (size < HEADER_BYTES + TAG_BYTES) throw new Error(`${source} is incomplete (shorter than an encrypted backup header)`);
  const handle = await open(source, "r");
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await handle.read(header, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(`${source} is not a Husnalogy encrypted backup file`);
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(source, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }), decipher, createWriteStream(target));
}

/**
 * Opaque, key-dependent blob name for a file's content hash: identical files
 * still deduplicate under one key, but the stored names do not reveal content
 * hashes (which would let someone confirm that a known photo is in a backup).
 */
export function blobId(key, contentSha256) {
  return createHmac("sha256", key).update(`husnalogy-blob:${contentSha256}`).digest("hex");
}

/** Write a JSON document encrypted (manifests, object indexes, reports). */
export function writeEncryptedJson(path, value, key) {
  if (!key) throw new Error("BACKUP_ENCRYPTION_KEY is required");
  writeFileSync(path, encryptBuffer(Buffer.from(JSON.stringify(value), "utf8"), key));
}

export function readEncryptedJson(path, key) {
  return JSON.parse(decryptBuffer(readFileSync(path), key).toString("utf8"));
}

/**
 * A private scratch folder for plaintext that must never land in a backup
 * destination (decrypted archives, pg_restore SQL). Owner-only on POSIX;
 * under the user's profile on Windows. Always removed by the caller.
 */
export function privateWorkDir(prefix = "husnalogy-backup-") {
  const dir = mkdtempSync(join(process.env.HUSNALOGY_BACKUP_TMP || tmpdir(), prefix));
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Windows: ACLs of the user profile apply
  }
  return dir;
}

export function removeWorkDir(dir) {
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
