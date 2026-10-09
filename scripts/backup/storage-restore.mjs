#!/usr/bin/env node
/**
 * Restore a storage-backup.mjs backup into an ISOLATED recovery project —
 * never production (lib/target.mjs: production refs and the .env.local project
 * are refused; RESTORE_CONFIRM_TARGET=<project ref> is required).
 *
 *   node scripts/backup/storage-restore.mjs --backup <folder> --target-env <file> [--skip-existing]
 *
 * The target env file gives NEXT_PUBLIC_SUPABASE_URL (or RESTORE_SUPABASE_URL),
 * SUPABASE_SERVICE_ROLE_KEY and RESTORE_CONFIRM_TARGET.
 *
 * - Buckets missing in the target are created with the backed-up settings. A
 *   bucket that exists with a DIFFERENT public flag is refused: private
 *   customer files are never restored into a public bucket.
 * - Every blob's sha256 is checked before upload; objects are uploaded with
 *   their original path, content type and cache control, never overwriting
 *   (an existing object is a failure unless --skip-existing, which then
 *   verifies the existing bytes instead).
 * - Afterwards the target is listed and EVERY restored object is downloaded
 *   again and compared by sha256 (--no-verify-download skips that read-back).
 * Storage policies key on the path (<user id>/...), not on the uploader, so a
 * service-role upload keeps every customer's access exactly as before.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { decryptBuffer, parseEncryptionKey, sha256 } from "./lib/crypto.mjs";
import { openStorageBackup } from "./lib/formats.mjs";
import { connection } from "./lib/pg-tools.mjs";
import { verifyLiveIdentity } from "./lib/source.mjs";
import { argValue, assertRestoreTarget, isMain, pickOne, readEnvFile } from "./lib/target.mjs";
import { inventoryStorage, objectKey, serviceClient } from "./storage-backup.mjs";

/** { manifest, objects } of a Storage backup of any supported format (v2 needs the key). */
export function readStorageBackup(backupDir, encryptionKey = null) {
  const { manifest, objects } = openStorageBackup(backupDir, encryptionKey);
  return { manifest, objects };
}

/** The verified plaintext bytes of one backed-up object. */
export function readBlob(backupDir, object, encryptionKey) {
  const stored = readFileSync(join(backupDir, object.blob));
  const bytes = object.encrypted ? decryptBuffer(stored, encryptionKey) : stored;
  if (sha256(bytes) !== object.sha256) throw new Error(`checksum mismatch: a backed-up file in ${object.bucket} is corrupted`);
  return bytes;
}

const cacheSeconds = (value) => (String(value || "").match(/max-age=(\d+)/) || [])[1];

export async function restoreStorage({
  storage,
  backupDir,
  targetId,
  encryptionKey = null,
  skipExisting = false,
  verifyDownload = true,
  concurrency = 4,
  log = (entry) => console.log(JSON.stringify(entry)),
}) {
  const startedAt = Date.now();
  const { manifest, objects } = readStorageBackup(backupDir, encryptionKey);
  log({ operation: "storage-restore", target: targetId, backupSource: manifest.source?.id, objects: objects.length, buckets: manifest.buckets.length });

  const bucketsCreated = [];
  for (const bucket of manifest.buckets) {
    const { data, error } = await storage.getBucket(bucket.id);
    if (error || !data) {
      if (error && !/not.?found/i.test(error.message || "")) throw new Error(`reading bucket ${bucket.id} failed: ${error.message}`);
      const created = await storage.createBucket(bucket.id, { public: bucket.public, fileSizeLimit: bucket.fileSizeLimit ?? undefined, allowedMimeTypes: bucket.allowedMimeTypes ?? undefined });
      if (created.error) throw new Error(`creating bucket ${bucket.id} failed: ${created.error.message}`);
      bucketsCreated.push(bucket.id);
    } else if (Boolean(data.public) !== Boolean(bucket.public)) {
      throw new Error(`REFUSED: bucket ${bucket.id} is ${data.public ? "PUBLIC" : "private"} in the target but ${bucket.public ? "public" : "PRIVATE"} in the backup. Fix the target bucket first; private files are never restored into a public bucket.`);
    }
  }

  const failures = [];
  let uploaded = 0;
  let existing = 0;
  let next = 0;
  async function worker() {
    while (next < objects.length) {
      const object = objects[next];
      next += 1;
      try {
        const bytes = readBlob(backupDir, object, encryptionKey);
        const { error } = await storage.from(object.bucket).upload(object.name, bytes, {
          contentType: object.contentType || "application/octet-stream",
          cacheControl: cacheSeconds(object.cacheControl),
          upsert: false,
        });
        if (!error) {
          uploaded += 1;
          continue;
        }
        if (skipExisting && /exist|duplicate/i.test(error.message || "")) {
          const current = await storage.from(object.bucket).download(object.name);
          if (current.error) throw new Error(`existing object unreadable: ${current.error.message}`);
          if (sha256(Buffer.from(await current.data.arrayBuffer())) !== object.sha256) throw new Error("an object already exists at this path with DIFFERENT content");
          existing += 1;
          continue;
        }
        throw new Error(error.message || String(error));
      } catch (error) {
        failures.push({ bucket: object.bucket, name: object.name, error: String(error?.message || error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  // Read-back verification against the target itself.
  const after = await inventoryStorage(storage);
  const present = new Map(after.objects.map((object) => [objectKey(object.bucket, object.name), object]));
  const missing = objects.filter((object) => !present.has(objectKey(object.bucket, object.name))).map((object) => `${object.bucket}/${object.name}`);
  const bucketPrivacy = manifest.buckets.filter((bucket) => {
    const target = after.buckets.find((candidate) => candidate.id === bucket.id);
    return !target || target.public !== bucket.public;
  }).map((bucket) => bucket.id);
  const mismatched = [];
  if (verifyDownload) {
    for (const object of objects) {
      if (!present.has(objectKey(object.bucket, object.name))) continue;
      const { data, error } = await storage.from(object.bucket).download(object.name);
      if (error || sha256(Buffer.from(await data.arrayBuffer())) !== object.sha256) mismatched.push(`${object.bucket}/${object.name}`);
    }
  }
  const report = {
    status: failures.length || missing.length || mismatched.length || bucketPrivacy.length ? "FAILED" : "restored",
    target: targetId,
    durationMs: Date.now() - startedAt,
    objects: objects.length,
    uploaded,
    existing,
    bucketsCreated,
    failures,
    missingAfterRestore: missing,
    checksumMismatchAfterRestore: mismatched,
    bucketPrivacyMismatch: bucketPrivacy,
    verifiedByDownload: verifyDownload ? objects.length - missing.length : 0,
  };
  log({ ...report, failures: failures.length, missingAfterRestore: missing.length, checksumMismatchAfterRestore: mismatched.length });
  if (report.status !== "restored") throw new Error(`Storage restore verification FAILED (failures ${failures.length}, missing ${missing.length}, checksum ${mismatched.length}, privacy ${bucketPrivacy.length})`);
  return report;
}

async function main() {
  const argv = process.argv.slice(2);
  const backupDir = argValue(argv, "--backup");
  const targetEnv = argValue(argv, "--target-env");
  if (!backupDir || !targetEnv) throw new Error("usage: storage-restore.mjs --backup <folder> --target-env <file> [--skip-existing] [--no-verify-download]");
  const env = readEnvFile(targetEnv);
  const url = pickOne([process.env, env], ["RESTORE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"], "restore Supabase URL");
  const key = pickOne([process.env, env], ["RESTORE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"], "restore service-role key");
  const databaseUrl = pickOne([process.env, env], ["RESTORE_DATABASE_URL", "STAGING_DATABASE_URL"], "restore database");
  if (!url || !key || !databaseUrl) throw new Error(`BLOCKED: ${targetEnv} needs the target's NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and RESTORE_DATABASE_URL (both are needed to prove they are one project).`);
  const targetId = assertRestoreTarget({ supabaseUrl: url, databaseUrl, confirm: pickOne([process.env, env], ["RESTORE_CONFIRM_TARGET"]) });
  const storage = serviceClient(url, key).storage;
  // The Storage API must be the same project as the target database (custom domains included).
  const client = new pg.Client(connection(databaseUrl).pgConfig);
  await client.connect();
  try {
    await verifyLiveIdentity({ client, storage });
  } finally {
    await client.end();
  }
  await restoreStorage({
    storage,
    backupDir,
    targetId,
    encryptionKey: parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY),
    skipExisting: argv.includes("--skip-existing"),
    verifyDownload: !argv.includes("--no-verify-download"),
  });
}

if (isMain("scripts/backup/storage-restore.mjs")) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
