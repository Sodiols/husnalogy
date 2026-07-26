// Diagnoses admin customizer asset delivery end to end against the real
// project: reads recent asset rows, signs each stored variant, fetches it over
// HTTP, and decodes the bytes.
//
// Answers the questions that source-level tests cannot: do the Storage objects
// exist, do the signed URLs return 200 with image bytes, and do those bytes
// decode at the expected resolution?
//
//   node scripts/diagnose-customizer-assets.mjs [limit]
//   node scripts/diagnose-customizer-assets.mjs [limit] --repair
//
// With --repair, any asset whose editor or thumbnail bytes fail to decode is
// rebuilt from its stored original. Originals are never modified, and an asset
// with an unreadable original is reported and skipped.
//
// Never prints keys or full signed tokens.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

function loadEnv() {
  let raw = "";
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const args = process.argv.slice(2);
const repair = args.includes("--repair");
const limit = Number(args.find((value) => /^\d+$/.test(value))) || 5;
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const EDITOR_MAX_PX = 2400;
const THUMB_MAX_PX = 480;

async function rebuildVariants(row) {
  const bucket = row.bucket || "customizer-elements";
  const { data, error } = await supabase.storage.from(bucket).download(row.path);
  if (error || !data) return `original unreadable (${error?.message || "missing"})`;

  const source = Buffer.from(await data.arrayBuffer());
  if (String(row.mime_type) === "image/svg+xml") return "skipped (svg keeps its source as the editor variant)";

  let editor;
  let thumbnail;
  try {
    editor = await sharp(source)
      .rotate()
      .resize(EDITOR_MAX_PX, EDITOR_MAX_PX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();
    thumbnail = await sharp(source)
      .rotate()
      .resize(THUMB_MAX_PX, THUMB_MAX_PX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    // Never publish bytes that cannot be read back.
    await sharp(editor).metadata();
    await sharp(thumbnail).metadata();
  } catch (cause) {
    return `regeneration failed (${cause.message})`;
  }

  const editorPath = row.editor_path || `assets/${row.id}/editor/editor.webp`;
  const thumbnailPath = row.thumbnail_path || `assets/${row.id}/thumbnail/thumbnail.webp`;
  for (const [storagePath, bytes] of [[editorPath, editor], [thumbnailPath, thumbnail]]) {
    const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, bytes, {
      contentType: "image/webp",
      upsert: true,
      cacheControl: "31536000",
    });
    if (uploadError) return `upload failed (${uploadError.message})`;
  }

  const meta = await sharp(source).metadata();
  await supabase
    .from("customizer_assets")
    .update({ editor_path: editorPath, thumbnail_path: thumbnailPath, width: meta.width, height: meta.height })
    .eq("id", row.id);

  const em = await sharp(editor).metadata();
  const tm = await sharp(thumbnail).metadata();
  return `repaired (editor ${em.width}x${em.height}, thumbnail ${tm.width}x${tm.height})`;
}

// Signed URLs carry a token in the query string; keep it out of the output.
const redact = (signed) => String(signed).split("?")[0] + "?token=<redacted>";

async function probe(bucket, storagePath, label) {
  if (!storagePath) return { label, status: "no path recorded" };

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl) {
    return { label, storagePath, status: `SIGN FAILED: ${error?.message || "no url"}` };
  }

  let response;
  try {
    response = await fetch(data.signedUrl);
  } catch (cause) {
    return { label, storagePath, url: redact(data.signedUrl), status: `FETCH FAILED: ${cause.message}` };
  }

  const contentType = response.headers.get("content-type") || "";
  const cors = response.headers.get("access-control-allow-origin") || "(none)";
  if (!response.ok) {
    const body = (await response.text()).slice(0, 160);
    return { label, storagePath, url: redact(data.signedUrl), status: `HTTP ${response.status}`, contentType, cors, body };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  let decoded = "DECODE FAILED";
  let stdev = 0;
  try {
    const meta = await sharp(bytes).metadata();
    decoded = `${meta.width}x${meta.height} ${meta.format} alpha=${Boolean(meta.hasAlpha)}`;
    const stats = await sharp(bytes).stats();
    stdev = Math.max(...stats.channels.map((channel) => channel.stdev));
  } catch (cause) {
    decoded = `DECODE FAILED: ${cause.message}`;
  }

  return {
    label,
    storagePath,
    url: redact(data.signedUrl),
    status: `HTTP ${response.status}`,
    contentType,
    cors,
    bytes: bytes.byteLength,
    decoded,
    // A flat image (blank tile) has ~zero spread.
    contentSpread: stdev.toFixed(2),
  };
}

const { data: rows, error } = await supabase
  .from("customizer_assets")
  .select("id,title,bucket,path,editor_path,thumbnail_path,mime_type,width,height,status,created_at")
  .order("created_at", { ascending: false })
  .limit(limit);

if (error) {
  console.error("Could not read customizer_assets:", error.message);
  process.exit(1);
}
if (!rows?.length) {
  console.log("No customizer_assets rows found.");
  process.exit(0);
}

for (const row of rows) {
  console.log("\n================================================================");
  console.log(`ASSET  ${row.title || "(untitled)"}  [${row.id}]`);
  console.log(`  status=${row.status}  mime=${row.mime_type}  recorded=${row.width}x${row.height}  bucket=${row.bucket}`);

  let broken = false;
  for (const [label, storagePath] of [
    ["original ", row.path],
    ["editor   ", row.editor_path],
    ["thumbnail", row.thumbnail_path],
  ]) {
    const result = await probe(row.bucket, storagePath, label);
    console.log(`  ${result.label}  ${result.status}`);
    if (result.storagePath) console.log(`             path=${result.storagePath}`);
    if (result.contentType !== undefined) console.log(`             content-type=${result.contentType}  CORS=${result.cors}`);
    if (result.decoded) console.log(`             bytes=${result.bytes}  decoded=${result.decoded}  spread=${result.contentSpread}`);
    if (result.body) console.log(`             body=${result.body}`);
    if (label.trim() !== "original" && String(result.decoded || "").includes("FAILED")) broken = true;
  }

  if (broken) {
    console.log(repair ? "  -> variants unusable, repairing…" : "  -> variants unusable. Re-run with --repair to rebuild them.");
    if (repair) console.log(`     ${await rebuildVariants(row)}`);
  }
}

console.log("\nDone.");
