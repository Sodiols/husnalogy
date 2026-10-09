#!/usr/bin/env node
/**
 * Supabase STORAGE backup (read-only on the source), format v2. Database
 * backups do NOT contain Storage file bytes, so every bucket is copied here.
 * Backups are made by run-backup.mjs (which first proves the database and
 * Storage are the approved project); this file's CLI only takes inventories:
 *
 *   node scripts/backup/storage-backup.mjs --source-env <file> --inventory-only [--out <file.enc>]
 *
 * --inventory-only lists every bucket and object WITHOUT downloading a file;
 * stdout carries aggregates only. --out writes the full object list
 * ENCRYPTED (needs BACKUP_ENCRYPTION_KEY) — object paths contain user ids.
 *
 * A backup downloads every object, checks its size against Storage's
 * metadata and stores it AES-256-GCM encrypted under an opaque, key-derived
 * name (blobs/<id[0..2]>/<id>.enc, id = HMAC(key, sha256)). Paths, file
 * names, content types, eTags, sha256s, bucket settings and failure details
 * exist ONLY in the encrypted index.enc. status.json (plaintext) holds just
 * the format, status, finish time, object/blob counts, encrypted size, the
 * index's ciphertext hash and the number of failed objects. Unchanged
 * objects of the previous complete backup are copied locally instead of
 * downloaded. Any failed object fails the run (status "incomplete").
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { blobId, encryptBuffer, parseEncryptionKey, sha256, writeEncryptedJson } from "./lib/crypto.mjs";
import { openStorageBackup } from "./lib/formats.mjs";
import { argValue, describeTarget, isMain, pick, readEnvFile, supabaseTargetId } from "./lib/target.mjs";

export const STORAGE_BACKUP_FORMAT = "husnalogy-storage-backup/2";
const PAGE = 1000;

export function serviceClient(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const objectKey = (bucket, name) => `${bucket}\n${name}`;

/** Every object of a bucket (folders are walked; `id === null` entries are folders). */
export async function listBucketObjects(storage, bucket) {
  const objects = [];
  const folders = [""];
  while (folders.length) {
    const folder = folders.shift();
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await storage.from(bucket).list(folder, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
      // The folder name is left out: folders are user ids.
      if (error) throw new Error(`listing a folder of ${bucket} failed: ${error.message}`);
      for (const entry of data || []) {
        const name = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.id === null || entry.id === undefined) {
          folders.push(name);
          continue;
        }
        const meta = entry.metadata || {};
        objects.push({
          bucket,
          name,
          size: Number(meta.size ?? meta.contentLength ?? 0),
          contentType: String(meta.mimetype || ""),
          cacheControl: String(meta.cacheControl || ""),
          eTag: String(meta.eTag || ""),
          createdAt: entry.created_at || "",
          updatedAt: entry.updated_at || "",
        });
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return objects;
}

export async function inventoryStorage(storage) {
  const { data, error } = await storage.listBuckets();
  if (error) throw new Error(`listing buckets failed: ${error.message}`);
  const buckets = (data || []).map((bucket) => ({
    id: bucket.id,
    public: Boolean(bucket.public),
    fileSizeLimit: bucket.file_size_limit ?? null,
    allowedMimeTypes: bucket.allowed_mime_types ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const objects = [];
  for (const bucket of buckets) objects.push(...(await listBucketObjects(storage, bucket.id)));
  return { buckets, objects };
}

export function summarize(buckets, objects) {
  const summary = buckets.map((bucket) => {
    const own = objects.filter((object) => object.bucket === bucket.id);
    const contentTypes = {};
    for (const object of own) contentTypes[object.contentType || "unknown"] = (contentTypes[object.contentType || "unknown"] || 0) + 1;
    const times = own.map((object) => object.updatedAt || object.createdAt).filter(Boolean).sort();
    return { ...bucket, objects: own.length, bytes: own.reduce((sum, object) => sum + object.size, 0), contentTypes, oldest: times[0] || null, newest: times[times.length - 1] || null };
  });
  return { buckets: summary, totals: { buckets: summary.length, objects: objects.length, bytes: objects.reduce((sum, object) => sum + object.size, 0) } };
}

async function downloadObject(storage, object, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { data, error } = await storage.from(object.bucket).download(object.name);
      if (error) throw new Error(error.message || String(error));
      const bytes = Buffer.from(await data.arrayBuffer());
      if (object.size && bytes.length !== object.size) throw new Error(`size mismatch: Storage reports ${object.size} bytes, downloaded ${bytes.length}`);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
}

export async function backupStorage({
  storage,
  source,
  outDir,
  encryptionKey,
  previousDir = null,
  concurrency = 4,
  log = (entry) => console.log(JSON.stringify(entry)),
}) {
  if (!encryptionKey) throw new Error("BACKUP_ENCRYPTION_KEY is required: backups are always encrypted.");
  const startedAt = new Date();
  if (existsSync(outDir) && readdirSync(outDir).length) throw new Error(`REFUSED: ${outDir} is not empty. Use a new folder per backup.`);
  mkdirSync(join(outDir, "blobs"), { recursive: true });
  log({ operation: "storage-backup", source: source.ref, environment: source.environment, readOnly: true });

  const { buckets, objects } = await inventoryStorage(storage);
  // Incremental: unchanged objects (same eTag, size, update time) of the
  // previous COMPLETE backup are copied locally instead of downloaded again.
  const previous = new Map();
  if (previousDir) {
    try {
      for (const line of openStorageBackup(previousDir, encryptionKey).objects) previous.set(objectKey(line.bucket, line.name), line);
    } catch (error) {
      log({ notice: "previous-backup-not-reused", reason: String(error?.message || error).slice(0, 120) });
    }
  }
  const lines = new Array(objects.length);
  const failures = [];
  let downloaded = 0;
  let reused = 0;
  let next = 0;
  const blobPath = (contentSha256) => {
    const id = blobId(encryptionKey, contentSha256);
    return join("blobs", id.slice(0, 2), `${id}.enc`).split("\\").join("/");
  };

  async function worker() {
    while (next < objects.length) {
      const index = next;
      next += 1;
      const object = objects[index];
      try {
        const prior = previous.get(objectKey(object.bucket, object.name));
        if (prior && prior.encrypted && prior.eTag === object.eTag && prior.size === object.size && prior.updatedAt === object.updatedAt) {
          const relative = blobPath(prior.sha256);
          if (relative === prior.blob && existsSync(join(previousDir, prior.blob))) {
            const target = join(outDir, relative);
            if (!existsSync(target)) {
              mkdirSync(dirname(target), { recursive: true });
              copyFileSync(join(previousDir, prior.blob), target);
            }
            lines[index] = { ...object, sha256: prior.sha256, blob: relative, encrypted: true };
            reused += 1;
            continue;
          }
        }
        const bytes = await downloadObject(storage, object);
        const hash = sha256(bytes);
        const relative = blobPath(hash);
        const target = join(outDir, relative);
        if (!existsSync(target)) {
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, encryptBuffer(bytes, encryptionKey));
        }
        lines[index] = { ...object, size: bytes.length, sha256: hash, blob: relative, encrypted: true };
        downloaded += 1;
      } catch (error) {
        failures.push({ index, bucket: object.bucket, name: object.name, error: String(error?.message || error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  const stored = lines.filter(Boolean);
  const complete = failures.length === 0;
  const manifest = {
    format: STORAGE_BACKUP_FORMAT,
    status: complete ? "complete" : "incomplete",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    source: { id: source.ref, environment: source.environment },
    encrypted: true,
    ...summarize(buckets, stored),
    listed: objects.length,
    downloaded,
    reused,
    failures,
  };
  // Paths, file names, buckets and failures live ONLY inside the encrypted index.
  writeEncryptedJson(join(outDir, "index.enc"), { manifest, objects: stored }, encryptionKey);
  const blobs = new Set(stored.map((line) => line.blob));
  const status = {
    format: STORAGE_BACKUP_FORMAT,
    status: manifest.status,
    finishedAt: manifest.finishedAt,
    objects: stored.length,
    blobs: blobs.size,
    encryptedBytes: [...blobs].reduce((sum, blob) => sum + statSync(join(outDir, blob)).size, 0),
    indexSha256: sha256(readFileSync(join(outDir, "index.enc"))),
    failedObjects: failures.length,
  };
  writeFileSync(join(outDir, "status.json"), JSON.stringify(status, null, 2));
  log({ status: manifest.status, source: source.ref, objects: stored.length, encryptedBytes: status.encryptedBytes, downloaded, reused, failures: failures.length, ms: manifest.durationMs });
  if (!complete) throw new Error(`Storage backup INCOMPLETE: ${failures.length} of ${objects.length} object(s) failed (details only in the encrypted index).`);
  return { ...manifest, encryptedBytes: status.encryptedBytes };
}

async function main() {
  const argv = process.argv.slice(2);
  const sourceEnv = argValue(argv, "--source-env");
  const out = argValue(argv, "--out");
  if (!sourceEnv || !argv.includes("--inventory-only")) {
    throw new Error("usage: storage-backup.mjs --source-env <file> --inventory-only [--out <file.enc>]. Backups are made with `npm run backup:run` (project identity is verified there).");
  }
  const env = readEnvFile(sourceEnv);
  const url = pick([env], ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]);
  const key = pick([env], ["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!url || !key) throw new Error(`BLOCKED: ${sourceEnv} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  const encryptionKey = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
  if (out && !encryptionKey) throw new Error("REFUSED: --out writes object paths; set BACKUP_ENCRYPTION_KEY so the list is stored encrypted.");
  const source = describeTarget(supabaseTargetId(url));
  console.log(JSON.stringify({ operation: "storage-inventory", source: source.id, kind: source.kind, readOnly: true, downloads: 0 }));
  const { buckets, objects } = await inventoryStorage(serviceClient(url, key).storage);
  const summary = summarize(buckets, objects);
  for (const bucket of summary.buckets) console.log(JSON.stringify({ bucket: bucket.id, public: bucket.public, objects: bucket.objects, bytes: bucket.bytes, contentTypes: bucket.contentTypes, oldest: bucket.oldest, newest: bucket.newest }));
  console.log(JSON.stringify({ totals: summary.totals, inventoriedAt: new Date().toISOString() }));
  if (out) writeEncryptedJson(out, { format: "husnalogy-storage-inventory/2", source, inventoriedAt: new Date().toISOString(), ...summary, objects }, encryptionKey);
}

if (isMain("scripts/backup/storage-backup.mjs")) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
