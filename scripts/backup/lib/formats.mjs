/**
 * Reading backups of every supported format behind one interface, so restore,
 * verification, reconciliation and incremental copies never parse layouts
 * themselves.
 *
 *   database v2  status.json (plaintext, operational) + manifest.enc + *.dump.enc
 *   database v1  manifest.json (plaintext) + *.dump(.enc)              [read-only support]
 *   storage  v2  status.json (plaintext, operational) + index.enc + blobs/
 *   storage  v1  storage-manifest.json + storage-objects.jsonl (plaintext) + blobs/
 *
 * v1 backups (made before 2026-10-10) stay restorable; nothing writes v1 any
 * more. Opening a v2 backup needs BACKUP_ENCRYPTION_KEY; a wrong key or a
 * modified file fails here (AES-256-GCM authentication), before any restore.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readEncryptedJson, sha256 } from "./crypto.mjs";

export const DB_FORMATS = { v1: "husnalogy-db-backup/1", v2: "husnalogy-db-backup/2" };
export const STORAGE_FORMATS = { v1: "husnalogy-storage-backup/1", v2: "husnalogy-storage-backup/2" };

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export function databaseBackupFormat(dir) {
  if (existsSync(join(dir, "manifest.enc")) && existsSync(join(dir, "status.json"))) return "v2";
  if (existsSync(join(dir, "manifest.json"))) return "v1";
  return null;
}

export function storageBackupFormat(dir) {
  if (existsSync(join(dir, "index.enc")) && existsSync(join(dir, "status.json"))) return "v2";
  if (existsSync(join(dir, "storage-manifest.json"))) return "v1";
  return null;
}

/** { format, status, manifest } of a database backup (manifest has tables, schema, files…). */
export function openDatabaseBackup(dir, key) {
  const format = databaseBackupFormat(dir);
  if (!format) throw new Error("not a database backup (no manifest) — it failed or is incomplete");
  if (format === "v1") {
    const manifest = readJson(join(dir, "manifest.json"));
    if (manifest.format !== DB_FORMATS.v1) throw new Error(`unsupported database backup format ${manifest.format}`);
    return { format, status: { status: "legacy-v1", consistency: manifest.consistentSnapshot ? "exported-snapshot" : "not-guaranteed" }, manifest };
  }
  const status = readJson(join(dir, "status.json"));
  if (status.format !== DB_FORMATS.v2) throw new Error(`unsupported database backup format ${status.format}`);
  if (status.status !== "recovery-grade") throw new Error(`database backup status is "${status.status}", not recovery-grade`);
  const encrypted = readFileSync(join(dir, "manifest.enc"));
  if (sha256(encrypted) !== status.manifestSha256) throw new Error("manifest.enc does not match status.json (modified or incomplete)");
  const manifest = readEncryptedJson(join(dir, "manifest.enc"), key);
  if (manifest.format !== DB_FORMATS.v2) throw new Error("manifest format mismatch");
  return { format, status, manifest };
}

/** { format, status, manifest, objects } of a Storage backup. objects[i].blob is relative to dir. */
export function openStorageBackup(dir, key) {
  const format = storageBackupFormat(dir);
  if (!format) throw new Error("not a Storage backup (no index) — it failed or is incomplete");
  if (format === "v1") {
    const manifest = readJson(join(dir, "storage-manifest.json"));
    if (manifest.format !== STORAGE_FORMATS.v1) throw new Error(`unsupported Storage backup format ${manifest.format}`);
    const objects = readFileSync(join(dir, "storage-objects.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    if (objects.length !== manifest.totals.objects) throw new Error(`storage-objects.jsonl lists ${objects.length} objects, the manifest ${manifest.totals.objects}`);
    return { format, status: { status: manifest.status }, manifest, objects };
  }
  const status = readJson(join(dir, "status.json"));
  if (status.format !== STORAGE_FORMATS.v2) throw new Error(`unsupported Storage backup format ${status.format}`);
  if (status.status !== "complete") throw new Error(`Storage backup status is "${status.status}", not complete`);
  const encrypted = readFileSync(join(dir, "index.enc"));
  if (sha256(encrypted) !== status.indexSha256) throw new Error("index.enc does not match status.json (modified or incomplete)");
  const index = readEncryptedJson(join(dir, "index.enc"), key);
  if (index.manifest?.format !== STORAGE_FORMATS.v2) throw new Error("index format mismatch");
  if (index.objects.length !== status.objects) throw new Error(`index lists ${index.objects.length} objects, status.json ${status.objects}`);
  return { format, status, manifest: index.manifest, objects: index.objects };
}
