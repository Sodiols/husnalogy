// The safe legacy-asset repair workflow behind
// scripts/repair-customizer-asset-variants.mjs, as an importable module so it
// is unit tested against an in-memory Storage/database (the CLI only wires a
// real Supabase client to it).
//
// It repairs the classic cause of the "suddenly blurry photo": an editor
// variant generated at thumbnail size (480px for a 2400px+ source), which
// decodes perfectly and is then stretched across the artboard. It also finds
// missing or corrupt editor and thumbnail files.
//
// Safety, in order — no step is skipped:
//   A. DRY RUN by default in the CLI: scan and report, write nothing.
//   B. Before any change, back up the metadata of every row it will touch.
//   C. Regenerate a defective editor variant FROM THE ORIGINAL only — never
//      from a thumbnail or another variant.
//   D. Regenerate a defective thumbnail separately, also from the original.
//   E. Verify each generated file (decodes, right size) BEFORE uploading it,
//      then read it back from Storage and verify again.
//   F. Only then update the database record.
//   G. Never modify or delete an original. New variants go to NEW
//      content-addressed paths; the old files are left in place.
//   H. Report everything; an asset without a usable original is reported for
//      manual recovery and its record is left exactly as it was.

import { createHash } from "node:crypto";
import sharp from "sharp";

export const EDITOR_MAX_PX = 2400;
export const THUMB_MAX_PX = 480;
const SIZE_TOLERANCE_RATIO = 0.98;
export const VARIANT_GENERATION_VERSION = 2;

/** The two asset tables and how their rows are read. */
export const TABLES = {
  library: {
    table: "customizer_assets",
    columns: "id,title,bucket,path,editor_path,thumbnail_path,mime_type,width,height,status,metadata",
    statuses: ["ready", "archived"],
    defaultBucket: "customizer-elements",
    label: (row) => `${row.title || "(untitled)"} [${row.id}]`,
    /** Library variants live under assets/<id>/<variant>/. */
    variantPath: (row, variant, hash) => `assets/${row.id}/${variant}/${variant}-${hash}.webp`,
  },
  customer: {
    table: "customer_asset_library",
    columns: "id,user_id,bucket,path,editor_path,thumbnail_path,mime_type,width,height,status,metadata",
    statuses: ["ready"],
    defaultBucket: "customer-uploads",
    label: (row) => `customer upload [${row.id}] owner ${row.user_id}`,
    /** Customer variants stay beside the original, inside the owner's folder. */
    variantPath: (row, variant, hash) => `${String(row.path).split("/").slice(0, -1).join("/")}/${variant}-${hash}.webp`,
  },
};

export function expectedSize(width, height, maxPx) {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxPx) return { width, height };
  const scale = maxPx / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(bytes) {
  if (!bytes?.byteLength) return null;
  try {
    const meta = await sharp(bytes).metadata();
    return meta.width && meta.height ? meta : null;
  } catch {
    return null;
  }
}

async function orientedDimensions(bytes) {
  const meta = await decode(bytes);
  if (!meta) return null;
  const swap = typeof meta.orientation === "number" && meta.orientation >= 5 && meta.orientation <= 8;
  return swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

/** Is this file an acceptable `variant` for a source of the given size? */
export async function inspectVariant(bytes, variant, source, vector = false) {
  if (!bytes?.byteLength) return { ok: false, reason: "missing" };
  if (vector) return { ok: true, reason: "ok" };
  const meta = await decode(bytes);
  if (!meta) return { ok: false, reason: "corrupt" };
  const expected = expectedSize(source.width, source.height, variant === "editor" ? EDITOR_MAX_PX : THUMB_MAX_PX);
  const ok = Math.max(meta.width, meta.height) >= Math.floor(Math.max(expected.width, expected.height) * SIZE_TOLERANCE_RATIO);
  return { ok, reason: ok ? "ok" : "too-small", width: meta.width, height: meta.height, expected: `${expected.width}x${expected.height}` };
}

async function download(supabase, bucket, path) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

const hash = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 16);

async function generate(original, variant) {
  const max = variant === "editor" ? EDITOR_MAX_PX : THUMB_MAX_PX;
  return sharp(original)
    .rotate()
    .resize(max, max, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: variant === "editor" ? 88 : 80 })
    .toBuffer();
}

/** Every row of a table, page by page — a library larger than one page is scanned in full. */
async function readRows(supabase, spec, limit) {
  const rows = [];
  const pageSize = 200;
  for (let offset = 0; rows.length < limit; offset += pageSize) {
    const { data, error } = await supabase
      .from(spec.table)
      .select(spec.columns)
      .in("status", spec.statuses)
      .order("created_at", { ascending: false })
      .range(offset, Math.min(offset + pageSize, limit) - 1);
    if (error) throw new Error(`Could not read ${spec.table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows.slice(0, limit);
}

export function emptySummary() {
  return {
    scanned: 0,
    healthy: 0,
    missingEditor: 0,
    tooSmallEditor: 0,
    corruptEditor: 0,
    missingThumbnail: 0,
    defectiveThumbnail: 0,
    missingOriginal: 0,
    invalidMetadata: 0,
    repairable: 0,
    unrepairable: 0,
    repaired: 0,
    failed: 0,
    skippedVector: 0,
  };
}

/**
 * Scan (and, unless dryRun, repair) the asset tables.
 *
 * @param {object} options
 * @param {any} options.supabase   a Supabase client (service role) — or a test double
 * @param {boolean} options.dryRun  scan and report only
 * @param {Array<"library"|"customer">} [options.tables]
 * @param {number} [options.limit]  rows per table
 * @param {(line: string) => void} [options.log]
 * @param {(backup: object) => Promise<string> | string} [options.writeBackup]  step B; must succeed before any change
 * @returns {Promise<{ summary: ReturnType<typeof emptySummary>, findings: object[], backupPath: string }>}
 */
export async function runVariantRepair(options) {
  const { supabase, dryRun, tables = ["library", "customer"], limit = 100_000, log = () => {}, writeBackup } = options;
  const summary = emptySummary();
  const findings = [];

  // Pass 1 — scan. Nothing is written in this pass, in either mode.
  for (const tableName of tables) {
    const spec = TABLES[tableName];
    const rows = await readRows(supabase, spec, limit);
    for (const row of rows) {
      summary.scanned += 1;
      const bucket = row.bucket || spec.defaultBucket;
      const vector = String(row.mime_type) === "image/svg+xml";
      const original = await download(supabase, bucket, row.path);
      const source = original ? (vector ? { width: Number(row.width) || 0, height: Number(row.height) || 0 } : await orientedDimensions(original)) : null;
      if (!original || !source) {
        summary.missingOriginal += 1;
        summary.unrepairable += 1;
        findings.push({ table: tableName, row, bucket, status: "unrepairable", reason: original ? "original undecodable" : "original missing" });
        log(`UNREPAIRABLE ${spec.label(row)} — ${original ? "original cannot be decoded" : "original is missing"}; record left untouched for manual recovery`);
        continue;
      }
      const [editorBytes, thumbnailBytes] = await Promise.all([download(supabase, bucket, row.editor_path), download(supabase, bucket, row.thumbnail_path)]);
      const editor = await inspectVariant(editorBytes, "editor", source, vector);
      const thumbnail = await inspectVariant(thumbnailBytes, "thumbnail", source);
      // Recorded dimensions that disagree with the original mislead every size check downstream.
      const metadataInvalid = !vector && (Number(row.width) !== source.width || Number(row.height) !== source.height);
      if (metadataInvalid) summary.invalidMetadata += 1;
      if (!editor.ok) summary[editor.reason === "missing" ? "missingEditor" : editor.reason === "too-small" ? "tooSmallEditor" : "corruptEditor"] += 1;
      if (!thumbnail.ok) summary[thumbnail.reason === "missing" ? "missingThumbnail" : "defectiveThumbnail"] += 1;
      if (editor.ok && thumbnail.ok && !metadataInvalid) {
        summary.healthy += 1;
        continue;
      }
      summary.repairable += 1;
      findings.push({ table: tableName, row, bucket, status: "repairable", source, editor, thumbnail, metadataInvalid, vector, original });
      const describe = (name, result) => `${name}=${result.reason}${result.width ? ` ${result.width}x${result.height}` : ""}${result.expected ? ` (expected ~${result.expected})` : ""}`;
      log(`REPAIRABLE ${spec.label(row)} · source ${source.width}x${source.height} · ${describe("editor", editor)} · ${describe("thumbnail", thumbnail)}${metadataInvalid ? ` · recorded ${row.width}x${row.height}` : ""}`);
    }
  }

  const repairable = findings.filter((finding) => finding.status === "repairable");
  if (dryRun || !repairable.length) {
    return { summary, findings: findings.map(({ original, ...rest }) => rest), backupPath: "" };
  }

  // Step B — back up exactly what will change, before changing anything.
  if (typeof writeBackup !== "function") throw new Error("Refusing to repair without a metadata backup (writeBackup).");
  const backupPath = await writeBackup({
    createdAt: new Date().toISOString(),
    rows: repairable.map(({ table, row }) => ({ table: TABLES[table].table, id: row.id, editor_path: row.editor_path, thumbnail_path: row.thumbnail_path, width: row.width, height: row.height, metadata: row.metadata })),
  });
  if (!backupPath) throw new Error("The metadata backup was not written; no changes made.");
  log(`Backup of ${repairable.length} record(s) written to ${backupPath}`);

  // Pass 2 — repair, one asset at a time; a failure never affects another asset.
  for (const finding of repairable) {
    const spec = TABLES[finding.table];
    const { row, bucket, source, original } = finding;
    try {
      const update = { metadata: { ...(row.metadata || {}) } };
      for (const variant of ["editor", "thumbnail"]) {
        if (finding[variant].ok || (variant === "editor" && finding.vector)) continue;
        // C/D — from the original, never from another variant.
        const bytes = await generate(original, variant);
        // E — verify before upload…
        const fresh = await inspectVariant(bytes, variant, source);
        if (!fresh.ok) throw new Error(`generated ${variant} failed verification (${fresh.reason})`);
        // G — a new content-addressed path; nothing existing is overwritten.
        const path = spec.variantPath(row, variant, hash(bytes));
        const { error: uploadError } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
        if (uploadError && !/exists|duplicate/i.test(String(uploadError.message))) throw new Error(`${variant} upload: ${uploadError.message}`);
        // …and after: read it back from Storage.
        const readBack = await inspectVariant(await download(supabase, bucket, path), variant, source);
        if (!readBack.ok) throw new Error(`stored ${variant} failed read-back verification (${readBack.reason})`);
        update[`${variant}_path`] = path;
        update.metadata[`${variant}Width`] = readBack.width;
        update.metadata[`${variant}Height`] = readBack.height;
        update.metadata[`${variant}Format`] = "image/webp";
      }
      if (!finding.vector) {
        update.width = source.width;
        update.height = source.height;
      }
      update.metadata.sourceWidth = source.width;
      update.metadata.sourceHeight = source.height;
      update.metadata.variantGenerationVersion = VARIANT_GENERATION_VERSION;
      update.metadata.variantRepairedAt = new Date().toISOString();
      // F — only now does the record change.
      const { error: updateError } = await supabase.from(spec.table).update(update).eq("id", row.id);
      if (updateError) throw new Error(`record update: ${updateError.message}`);
      summary.repaired += 1;
      log(`REPAIRED   ${spec.label(row)}${update.editor_path ? ` · editor -> ${update.editor_path}` : ""}${update.thumbnail_path ? ` · thumbnail -> ${update.thumbnail_path}` : ""}`);
    } catch (cause) {
      summary.failed += 1;
      log(`FAILED     ${spec.label(row)} — ${cause.message}; record left unchanged, original untouched`);
    }
  }
  return { summary, findings: findings.map(({ original, ...rest }) => rest), backupPath };
}

export function formatSummary(summary, dryRun) {
  return [
    "----------------------------------------",
    `Mode:                 ${dryRun ? "DRY RUN (nothing written)" : "REPAIR"}`,
    `Assets scanned:       ${summary.scanned}`,
    `Healthy:              ${summary.healthy}`,
    `Missing editor:       ${summary.missingEditor}`,
    `Too-small editor:     ${summary.tooSmallEditor}`,
    `Corrupt editor:       ${summary.corruptEditor}`,
    `Missing thumbnail:    ${summary.missingThumbnail}`,
    `Defective thumbnail:  ${summary.defectiveThumbnail}`,
    `Missing original:     ${summary.missingOriginal}`,
    `Invalid metadata:     ${summary.invalidMetadata}`,
    `Repairable:           ${summary.repairable}`,
    `Unrepairable:         ${summary.unrepairable}`,
    ...(dryRun ? [] : [`Repaired:             ${summary.repaired}`, `Failed:               ${summary.failed}`]),
  ].join("\n");
}
