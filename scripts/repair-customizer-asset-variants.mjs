// Scans customizer_assets and repairs editor/thumbnail variants that are
// missing, corrupt, or too small for their source image.
//
// The classic failure this fixes is a legacy editor variant generated at
// thumbnail size (e.g. 480x480 for a 1254x1254 original). It decodes perfectly,
// so a decodability check passes it, and the canvas stretches 480px across a
// full-size artboard.
//
//   node scripts/repair-customizer-asset-variants.mjs --dry-run
//   node scripts/repair-customizer-asset-variants.mjs
//   node scripts/repair-customizer-asset-variants.mjs --limit 100
//
// Originals are never modified or deleted. Repaired variants are written to
// content-addressed paths so they cannot be masked by a stale cache.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const EDITOR_MAX_PX = 2400;
const THUMB_MAX_PX = 480;
const SIZE_TOLERANCE_RATIO = 0.98;
const VARIANT_GENERATION_VERSION = 2;

function loadEnv() {
  let raw = "";
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment or .env.local.");
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 500 : 500;

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

function expectedSize(width, height, maxPx) {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxPx) return { width, height };
  const scale = maxPx / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function orientedDimensions(buffer) {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const swap = typeof meta.orientation === "number" && meta.orientation >= 5 && meta.orientation <= 8;
  return swap ? { width: height, height: width } : { width, height };
}

async function download(bucket, storagePath) {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function inspectVariant(bytes, variant, sourceWidth, sourceHeight, vector) {
  if (!bytes?.byteLength) return { ok: false, reason: "missing" };
  if (vector) return { ok: true, reason: "ok" };
  let meta;
  try {
    meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return { ok: false, reason: "undecodable" };
  } catch {
    return { ok: false, reason: "undecodable" };
  }
  if (!sourceWidth || !sourceHeight) return { ok: true, reason: "ok", width: meta.width, height: meta.height };

  const expected = expectedSize(sourceWidth, sourceHeight, variant === "editor" ? EDITOR_MAX_PX : THUMB_MAX_PX);
  const ok = Math.max(meta.width, meta.height) >= Math.floor(Math.max(expected.width, expected.height) * SIZE_TOLERANCE_RATIO);
  return {
    ok,
    reason: ok ? "ok" : "too-small",
    width: meta.width,
    height: meta.height,
    expected: `${expected.width}x${expected.height}`,
  };
}

const hash = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 16);

const summary = { scanned: 0, healthy: 0, editorRepaired: 0, thumbnailRepaired: 0, failed: 0, skipped: 0 };

const { data: rows, error } = await supabase
  .from("customizer_assets")
  .select("id,title,bucket,path,editor_path,thumbnail_path,mime_type,width,height,status,metadata")
  .in("status", ["ready", "archived"])
  .order("created_at", { ascending: false })
  .limit(limit);

if (error) {
  console.error("Could not read customizer_assets:", error.message);
  process.exit(1);
}

console.log(`${dryRun ? "DRY RUN — no changes will be written" : "REPAIR MODE"} · scanning ${rows.length} asset(s)\n`);

for (const row of rows) {
  summary.scanned += 1;
  const bucket = row.bucket || "customizer-elements";
  const vector = String(row.mime_type) === "image/svg+xml";
  const label = `${row.title || "(untitled)"} [${row.id}]`;

  const original = await download(bucket, row.path);
  if (!original) {
    summary.failed += 1;
    console.log(`FAILED   ${label}\n         original is missing or unreadable — cannot repair`);
    continue;
  }

  let source;
  try {
    source = vector ? { width: row.width || 0, height: row.height || 0 } : await orientedDimensions(original);
  } catch {
    summary.failed += 1;
    console.log(`FAILED   ${label}\n         original could not be decoded`);
    continue;
  }

  const [editorBytes, thumbnailBytes] = await Promise.all([
    download(bucket, row.editor_path),
    download(bucket, row.thumbnail_path),
  ]);
  const editor = await inspectVariant(editorBytes, "editor", source.width, source.height, vector);
  const thumbnail = await inspectVariant(thumbnailBytes, "thumbnail", source.width, source.height, false);

  if (editor.ok && thumbnail.ok) {
    summary.healthy += 1;
    continue;
  }

  const describe = (name, result) =>
    `${name}=${result.reason}${result.width ? ` ${result.width}x${result.height}` : ""}${result.expected ? ` (expected ~${result.expected})` : ""}`;
  console.log(`REPAIR   ${label}`);
  console.log(`         source ${source.width}x${source.height} · ${describe("editor", editor)} · ${describe("thumbnail", thumbnail)}`);

  if (vector) {
    summary.skipped += 1;
    console.log("         skipped — svg editor variants are vector and resolution independent");
    continue;
  }
  if (dryRun) {
    if (!editor.ok) summary.editorRepaired += 1;
    if (!thumbnail.ok) summary.thumbnailRepaired += 1;
    console.log("         would regenerate from the original");
    continue;
  }

  try {
    const update = { metadata: { ...(row.metadata || {}) } };

    if (!editor.ok) {
      const bytes = await sharp(original)
        .rotate()
        .resize(EDITOR_MAX_PX, EDITOR_MAX_PX, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
      const meta = await sharp(bytes).metadata();
      const path = `assets/${row.id}/editor/editor-${hash(bytes)}.webp`;
      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, bytes, {
        contentType: "image/webp", upsert: true, cacheControl: "31536000",
      });
      if (uploadError) throw new Error(`editor upload: ${uploadError.message}`);
      update.editor_path = path;
      update.metadata.editorWidth = meta.width;
      update.metadata.editorHeight = meta.height;
      update.metadata.editorFormat = "image/webp";
      summary.editorRepaired += 1;
      console.log(`         editor -> ${meta.width}x${meta.height}  ${path}`);
    }

    if (!thumbnail.ok) {
      const bytes = await sharp(original)
        .rotate()
        .resize(THUMB_MAX_PX, THUMB_MAX_PX, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const meta = await sharp(bytes).metadata();
      const path = `assets/${row.id}/thumbnail/thumbnail-${hash(bytes)}.webp`;
      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, bytes, {
        contentType: "image/webp", upsert: true, cacheControl: "31536000",
      });
      if (uploadError) throw new Error(`thumbnail upload: ${uploadError.message}`);
      update.thumbnail_path = path;
      update.metadata.thumbnailWidth = meta.width;
      update.metadata.thumbnailHeight = meta.height;
      update.metadata.thumbnailFormat = "image/webp";
      summary.thumbnailRepaired += 1;
      console.log(`         thumbnail -> ${meta.width}x${meta.height}  ${path}`);
    }

    // Keep recorded dimensions consistent with the (orientation-corrected) source.
    update.width = source.width;
    update.height = source.height;
    update.metadata.sourceWidth = source.width;
    update.metadata.sourceHeight = source.height;
    update.metadata.variantGenerationVersion = VARIANT_GENERATION_VERSION;
    update.metadata.variantGeneratedAt = new Date().toISOString();

    const { error: updateError } = await supabase.from("customizer_assets").update(update).eq("id", row.id);
    if (updateError) throw new Error(`record update: ${updateError.message}`);
  } catch (cause) {
    summary.failed += 1;
    console.log(`         FAILED — ${cause.message}`);
  }
}

console.log("\n----------------------------------------");
console.log(`Scanned:            ${summary.scanned}`);
console.log(`Healthy:            ${summary.healthy}`);
console.log(`Editor repaired:    ${summary.editorRepaired}`);
console.log(`Thumbnail repaired: ${summary.thumbnailRepaired}`);
console.log(`Skipped (svg):      ${summary.skipped}`);
console.log(`Failed:             ${summary.failed}`);
if (dryRun) console.log("\nDry run only. Re-run without --dry-run to apply.");
