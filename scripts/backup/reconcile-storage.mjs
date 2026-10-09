#!/usr/bin/env node
/**
 * READ-ONLY database ↔ Storage reconciliation. Finds database references to
 * files that do not exist (missing originals, editor variants, thumbnails,
 * avatars, render outputs, production assets pinned by order snapshots, files
 * referenced inside designs/snapshots/settings JSON) and objects nothing
 * references (orphans). It never deletes, moves or rewrites anything:
 * orphans are only counted for review.
 *
 *   node scripts/backup/reconcile-storage.mjs --source-env <file> --out <report.json>
 *       [--storage-backup <folder>]   compare with a backup's manifest instead of live
 *                                     Storage, and verify pinned production checksums
 *
 * Database rows are read through PostgREST with the service role (or a pg
 * client in tests). Stdout carries aggregate counts only; the detailed report
 * (which contains storage paths, i.e. user ids) goes to --out — keep it out of
 * the repository.
 */
import { writeFileSync } from "node:fs";
import { parseEncryptionKey, writeEncryptedJson } from "./lib/crypto.mjs";
import { openStorageBackup } from "./lib/formats.mjs";
import { argValue, describeTarget, isMain, pick, readEnvFile, supabaseTargetId } from "./lib/target.mjs";
import { inventoryStorage, objectKey, serviceClient } from "./storage-backup.mjs";

/** Columns that name a Storage object directly. `critical` = an order cannot be produced without it. */
export const COLUMN_SOURCES = [
  { table: "customer_asset_library", select: "id,bucket,path,editor_path,thumbnail_path,status", refs: (r) => [[r.bucket, r.path, "customer-original"], [r.bucket, r.editor_path, "customer-editor"], [r.bucket, r.thumbnail_path, "customer-thumbnail"]] },
  { table: "customer_uploads", select: "id,bucket,path", refs: (r) => [[r.bucket, r.path, "customer-upload"]] },
  { table: "customizer_assets", select: "id,bucket,path,editor_path,thumbnail_path,status,archived", refs: (r) => [[r.bucket, r.path, "admin-original"], [r.bucket, r.editor_path, "admin-editor"], [r.bucket, r.thumbnail_path, "admin-thumbnail"]] },
  { table: "customizer_render_outputs", select: "id,bucket,path,status,order_id", refs: (r) => [[r.bucket, r.path, r.order_id ? "order-render-output" : "render-output"]], critical: (r) => Boolean(r.order_id) },
  { table: "order_production_assets", select: "snapshot_id,order_id,bucket,path,checksum,size_bytes", refs: (r) => [[r.bucket, r.path, "production-asset"]], critical: () => true },
  { table: "profiles", select: "id,avatar_path", refs: (r) => [["customer-avatars", r.avatar_path, "avatar"]] },
  { table: "product_images", select: "id,image_url", urls: (r) => [[r.image_url, "product-image"]] },
  { table: "product_mockups", select: "id,mockup_url", urls: (r) => [[r.mockup_url, "product-mockup"]] },
  { table: "product_videos", select: "id,video_url", urls: (r) => [[r.video_url, "product-video"]] },
  { table: "hero_collections", select: "id,main_image,thumbnail_one,thumbnail_two,thumbnail_three", urls: (r) => [[r.main_image, "hero-image"], [r.thumbnail_one, "hero-image"], [r.thumbnail_two, "hero-image"], [r.thumbnail_three, "hero-image"]] },
  { table: "customizer_mockup_views", select: "id,base_image_url", urls: (r) => [[r.base_image_url, "mockup-base"]] },
  { table: "customizer_mockup_overlays", select: "id,src", urls: (r) => [[r.src, "mockup-overlay"]] },
];

/** JSON documents that embed file references (designs, templates, snapshots, settings). */
export const JSON_SOURCES = [
  { table: "product_customizations", select: "id,values,uploaded_files,preview_images,render_data,print_files,asset_references", kind: "saved-design" },
  { table: "customizer_template_versions", select: "id,document", kind: "published-template" },
  { table: "product_customizer_templates", select: "id,pages,layers,assets,settings", kind: "template-draft" },
  { table: "order_design_snapshots", select: "id,snapshot,preview_files,print_files", kind: "order-snapshot", critical: true },
  { table: "order_items", select: "id,uploaded_files,customization_values,preview_data", kind: "order-item" },
  { table: "site_settings", select: "id,settings", kind: "site-settings" },
  // Catalogue rows keep image URLs in plain columns and in `data` JSON: walk the whole row.
  { table: "products", select: "*", kind: "product-catalogue" },
  { table: "categories", select: "*", kind: "catalogue-category" },
  { table: "product_collections", select: "*", kind: "catalogue-collection" },
];

const PATH_KEYS = ["storagePath", "originalStoragePath", "originalPath", "path", "editorStoragePath", "editorPath", "thumbnailStoragePath", "thumbnailPath"];

/** bucket/path of a Supabase Storage URL (public, signed or render), else null. */
export function parseStorageUrl(value) {
  if (typeof value !== "string" || !value.includes("/storage/v1/")) return null;
  try {
    const url = new URL(value, "https://placeholder.invalid");
    const match = url.pathname.match(/\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return { bucket: decodeURIComponent(match[1]), path: match[2].split("/").map(decodeURIComponent).join("/") };
  } catch {
    return null;
  }
}

/** Every {bucket, path} a JSON value mentions: reference objects and Storage URLs. */
export function jsonReferences(value, buckets, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) jsonReferences(item, buckets, found);
  } else if (value && typeof value === "object") {
    if (typeof value.bucket === "string" && buckets.has(value.bucket)) {
      for (const key of PATH_KEYS) {
        if (typeof value[key] === "string" && value[key] && !value[key].includes("://")) found.push({ bucket: value.bucket, path: value[key] });
      }
    }
    for (const item of Object.values(value)) jsonReferences(item, buckets, found);
  } else if (typeof value === "string") {
    const parsed = parseStorageUrl(value);
    if (parsed) found.push(parsed);
  }
  return found;
}

export function reconcile({ buckets, objects, rowsBySource, manifestChecksums = null }) {
  const bucketIds = new Set(buckets.map((bucket) => bucket.id));
  const present = new Map(objects.map((object) => [objectKey(object.bucket, object.name), object]));
  const referenced = new Set();
  const references = [];
  const skipped = [];
  const external = { count: 0 };
  const add = (source, row, bucket, path, kind, critical) => {
    if (!path) return;
    references.push({ table: source.table, id: row.id ?? row.snapshot_id ?? null, bucket, path, kind, critical: Boolean(critical), checksum: row.checksum || null, size: row.size_bytes ?? null });
  };
  for (const source of [...COLUMN_SOURCES, ...JSON_SOURCES]) {
    const rows = rowsBySource[source.table];
    if (!rows) {
      skipped.push({ table: source.table, reason: "not read" });
      continue;
    }
    if (rows.error) {
      skipped.push({ table: source.table, reason: rows.error });
      continue;
    }
    for (const row of rows) {
      if (source.refs) for (const [bucket, path, kind] of source.refs(row)) add(source, row, bucket, path, kind, source.critical?.(row));
      if (source.urls) {
        for (const [url, kind] of source.urls(row)) {
          if (!url) continue;
          const parsed = parseStorageUrl(url);
          if (parsed) add(source, row, parsed.bucket, parsed.path, kind, false);
          else external.count += 1;
        }
      }
      if (source.kind) {
        const unique = new Map();
        const values = source.select === "*" ? [row] : source.select.split(",").slice(1).map((column) => row[column]);
        for (const value of values) {
          for (const found of jsonReferences(value, bucketIds)) unique.set(objectKey(found.bucket, found.path), found);
        }
        for (const found of unique.values()) add(source, row, found.bucket, found.path, source.kind, source.critical);
      }
    }
  }
  const missing = [];
  const checksumMismatch = [];
  for (const reference of references) {
    const key = objectKey(reference.bucket, reference.path);
    referenced.add(key);
    const object = present.get(key);
    if (!object) {
      missing.push(reference);
      continue;
    }
    if (reference.kind === "production-asset" && manifestChecksums) {
      const stored = manifestChecksums.get(key);
      if (stored && reference.checksum && stored !== reference.checksum) checksumMismatch.push({ ...reference, stored });
    }
  }
  const orphans = {};
  const orphanObjects = [];
  for (const object of objects) {
    if (referenced.has(objectKey(object.bucket, object.name))) continue;
    orphans[object.bucket] = (orphans[object.bucket] || 0) + 1;
    orphanObjects.push({ bucket: object.bucket, name: object.name, size: object.size, contentType: object.contentType, updatedAt: object.updatedAt });
  }
  const byKind = {};
  for (const reference of references) {
    const entry = (byKind[reference.kind] ||= { references: 0, missing: 0 });
    entry.references += 1;
  }
  for (const reference of missing) byKind[reference.kind].missing += 1;
  return {
    totals: {
      references: references.length,
      distinctObjectsReferenced: referenced.size,
      objects: objects.length,
      missing: missing.length,
      missingCritical: missing.filter((reference) => reference.critical).length,
      checksumMismatch: checksumMismatch.length,
      orphanObjects: Object.values(orphans).reduce((sum, value) => sum + value, 0),
      externalUrls: external.count,
    },
    byKind,
    orphansByBucket: orphans,
    skippedSources: skipped,
    missing,
    checksumMismatch,
    orphanObjects,
  };
}

/** Read every source table through PostgREST (service role, SELECT only, paged). */
export async function readSourcesViaRest(client) {
  const rowsBySource = {};
  for (const source of [...COLUMN_SOURCES, ...JSON_SOURCES]) {
    const rows = [];
    let failed = null;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(source.table).select(source.select).range(from, from + 999);
      if (error) {
        failed = error.message;
        break;
      }
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    rowsBySource[source.table] = failed ? { error: failed } : rows;
  }
  return rowsBySource;
}

/** Same, through a pg client (local drills, recovery databases). */
export async function readSourcesViaPg(client) {
  const rowsBySource = {};
  for (const source of [...COLUMN_SOURCES, ...JSON_SOURCES]) {
    try {
      const columns = source.select === "*" ? "*" : source.select.split(",").map((column) => `"${column}"`).join(", ");
      rowsBySource[source.table] = (await client.query(`select ${columns} from public."${source.table}"`)).rows;
    } catch (error) {
      rowsBySource[source.table] = { error: String(error.message || error) };
    }
  }
  return rowsBySource;
}

/** Inventory of a Storage backup (any supported format; v2 needs the key). */
export function storageFromBackup(backupDir, encryptionKey = null) {
  const { manifest, objects } = openStorageBackup(backupDir, encryptionKey);
  return { buckets: manifest.buckets, objects, checksums: new Map(objects.map((object) => [objectKey(object.bucket, object.name), object.sha256])) };
}

/** The report without anything that names a file (safe to keep unencrypted). */
export function aggregateReport(report) {
  return { totals: report.totals, byKind: report.byKind, orphansByBucket: report.orphansByBucket, skippedSources: report.skippedSources };
}

async function main() {
  const argv = process.argv.slice(2);
  const sourceEnv = argValue(argv, "--source-env");
  const out = argValue(argv, "--out");
  if (!sourceEnv) throw new Error("usage: reconcile-storage.mjs --source-env <file> [--out <report>] [--storage-backup <folder>]");
  const env = readEnvFile(sourceEnv);
  const url = pick([env], ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]);
  const key = pick([env], ["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!url || !key) throw new Error(`BLOCKED: ${sourceEnv} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  const encryptionKey = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
  const source = describeTarget(supabaseTargetId(url));
  console.log(JSON.stringify({ operation: "storage-reconcile", source: source.id, kind: source.kind, readOnly: true }));
  const client = serviceClient(url, key);
  const backupDir = argValue(argv, "--storage-backup");
  const storage = backupDir ? storageFromBackup(backupDir, encryptionKey) : await inventoryStorage(client.storage);
  const report = reconcile({ buckets: storage.buckets, objects: storage.objects, rowsBySource: await readSourcesViaRest(client), manifestChecksums: storage.checksums || null });
  const document = { format: "husnalogy-storage-reconciliation/2", generatedAt: new Date().toISOString(), source, storage: backupDir ? "backup" : "live" };
  if (out) {
    // The detailed lists name private files (user ids in paths): encrypted, or left out.
    if (encryptionKey) writeEncryptedJson(out, { ...document, ...report }, encryptionKey);
    else writeFileSync(out, JSON.stringify({ ...document, ...aggregateReport(report), note: "details omitted: set BACKUP_ENCRYPTION_KEY to store them encrypted" }, null, 2));
  }
  console.log(JSON.stringify(aggregateReport(report)));
  if (report.totals.missingCritical || report.totals.checksumMismatch) process.exitCode = 2;
}

if (isMain("scripts/backup/reconcile-storage.mjs")) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
