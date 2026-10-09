/**
 * Off-site backup destinations. A run is uploaded to <destination>/<runId>/,
 * then EVERY file is verified at the destination (key and size; for file://
 * also sha256), and only then are <runId>/COMPLETE.json and, last,
 * latest-success.json written. A run without COMPLETE.json is a partial
 * upload and is never treated as a backup (restore, monitoring, retention).
 *
 *   file:///absolute/path          a mounted, encrypted, access-controlled volume
 *   s3://bucket/optional/prefix    any S3-compatible service through the AWS CLI
 *                                  (preinstalled on GitHub runners): credentials
 *                                  from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 *                                  (/ AWS_SESSION_TOKEN, AWS_REGION); a non-AWS
 *                                  endpoint in BACKUP_S3_ENDPOINT. HUSNALOGY_AWS_CLI
 *                                  overrides the executable.
 *
 * Everything uploaded is already client-side encrypted (format v2), so the
 * destination never sees plaintext. Credentials are never printed.
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { privateWorkDir, removeWorkDir, sha256File } from "./crypto.mjs";

export class DestinationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DestinationError";
    this.stage = "upload";
  }
}

export function parseDestination(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new DestinationError("BACKUP_DESTINATION must be file:///absolute/path or s3://bucket/prefix");
  }
  if (url.protocol === "file:") return { kind: "file", root: fileURLToPath(url), label: "file" };
  if (url.protocol === "s3:") {
    if (!url.hostname) throw new DestinationError("BACKUP_DESTINATION s3:// needs a bucket");
    return { kind: "s3", bucket: url.hostname, prefix: url.pathname.replace(/^\/+|\/+$/g, ""), label: `s3://${url.hostname}` };
  }
  throw new DestinationError("BACKUP_DESTINATION must be file:///absolute/path or s3://bucket/prefix");
}

/** Every file under `dir`, as forward-slash paths relative to it. */
export function localFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push({ key: relative(dir, full).split("\\").join("/"), size: statSync(full).size, full });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function awsCommand() {
  const configured = process.env.HUSNALOGY_AWS_CLI || "aws";
  return /\.(c|m)?js$/.test(configured) ? [process.execPath, configured] : [configured];
}

function aws(args, { input } = {}) {
  const [command, ...prefix] = awsCommand();
  const endpoint = process.env.BACKUP_S3_ENDPOINT ? ["--endpoint-url", process.env.BACKUP_S3_ENDPOINT] : [];
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...prefix, ...args, ...endpoint, "--output", "json"], { windowsHide: true, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(new DestinationError(`the AWS CLI could not start (${error.message}); install it or set HUSNALOGY_AWS_CLI`)));
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new DestinationError(`destination command failed (${args.slice(0, 2).join(" ")}, exit ${code}): ${stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300)}`))));
    child.stdin.end(input ?? undefined);
  });
}

const s3Key = (destination, ...parts) => [destination.prefix, ...parts].filter(Boolean).join("/");

async function s3List(destination, prefix) {
  const out = await aws(["s3api", "list-objects-v2", "--bucket", destination.bucket, "--prefix", prefix]);
  const parsed = out.trim() ? JSON.parse(out) : {};
  return (parsed.Contents || []).map((item) => ({ key: item.Key, size: Number(item.Size) }));
}

async function s3PutJson(destination, key, value) {
  const work = privateWorkDir("husnalogy-marker-");
  try {
    const file = join(work, "marker.json");
    writeFileSync(file, JSON.stringify(value, null, 2));
    await aws(["s3", "cp", file, `s3://${destination.bucket}/${key}`, "--only-show-errors"]);
  } finally {
    removeWorkDir(work);
  }
}

async function s3GetJson(destination, key) {
  const work = privateWorkDir("husnalogy-marker-");
  try {
    const file = join(work, "marker.json");
    try {
      await aws(["s3", "cp", `s3://${destination.bucket}/${key}`, file, "--only-show-errors"]);
    } catch (error) {
      if (/404|Not Found|NoSuchKey|does not exist/i.test(error.message)) return null;
      throw error;
    }
    return JSON.parse(readFileSync(file, "utf8"));
  } finally {
    removeWorkDir(work);
  }
}

/**
 * Upload a finished run and prove it arrived. Returns { files, bytes }.
 * `summary` (operational, no paths) is stored in COMPLETE.json / latest-success.json.
 */
export async function uploadRun(destination, runDir, runId, summary) {
  const files = localFiles(runDir);
  if (!files.length) throw new DestinationError("nothing to upload");
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const marker = { runId, uploadedAt: new Date().toISOString(), files: files.length, bytes, ...summary };
  if (destination.kind === "file") {
    const target = join(destination.root, runId);
    if (existsSync(join(target, "COMPLETE.json"))) throw new DestinationError(`run ${runId} already exists at the destination`);
    for (const file of files) {
      const to = join(target, file.key);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(file.full, to);
    }
    for (const file of files) {
      const to = join(target, file.key);
      if (!existsSync(to) || statSync(to).size !== file.size || (await sha256File(to)) !== (await sha256File(file.full))) {
        throw new DestinationError("upload verification failed: a file is missing or differs at the destination (partial upload)");
      }
    }
    writeFileSync(join(target, "COMPLETE.json"), JSON.stringify(marker, null, 2));
    writeFileSync(join(destination.root, "latest-success.json"), JSON.stringify(marker, null, 2));
    return { files: files.length, bytes };
  }
  const base = s3Key(destination, runId);
  if ((await s3List(destination, `${base}/COMPLETE.json`)).length) throw new DestinationError(`run ${runId} already exists at the destination`);
  await aws(["s3", "cp", runDir, `s3://${destination.bucket}/${base}/`, "--recursive", "--only-show-errors"]);
  const remote = new Map((await s3List(destination, `${base}/`)).map((item) => [item.key, item.size]));
  for (const file of files) {
    if (remote.get(`${base}/${file.key}`) !== file.size) throw new DestinationError("upload verification failed: a file is missing or has a different size at the destination (partial upload)");
  }
  await s3PutJson(destination, `${base}/COMPLETE.json`, marker);
  await s3PutJson(destination, s3Key(destination, "latest-success.json"), marker);
  return { files: files.length, bytes };
}

/** Runs at the destination: [{ runId, complete, marker? }], oldest first. */
export async function listRuns(destination) {
  const RUN = /^\d{8}T\d{6}Z$/;
  if (destination.kind === "file") {
    if (!existsSync(destination.root)) throw new DestinationError("the backup destination is not reachable");
    return readdirSync(destination.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && RUN.test(entry.name))
      .map((entry) => {
        const markerPath = join(destination.root, entry.name, "COMPLETE.json");
        return { runId: entry.name, complete: existsSync(markerPath), marker: existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, "utf8")) : null };
      })
      .sort((a, b) => a.runId.localeCompare(b.runId));
  }
  const items = await s3List(destination, destination.prefix ? `${destination.prefix}/` : "");
  const runs = new Map();
  for (const item of items) {
    const rest = destination.prefix ? item.key.slice(destination.prefix.length + 1) : item.key;
    const [runId, file] = rest.split("/");
    if (!RUN.test(runId)) continue;
    const run = runs.get(runId) || { runId, complete: false };
    if (file === "COMPLETE.json") run.complete = true;
    runs.set(runId, run);
  }
  return [...runs.values()].sort((a, b) => a.runId.localeCompare(b.runId));
}

export async function readLatestSuccess(destination) {
  if (destination.kind === "file") {
    const path = join(destination.root, "latest-success.json");
    if (!existsSync(destination.root)) throw new DestinationError("the backup destination is not reachable");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  }
  return s3GetJson(destination, s3Key(destination, "latest-success.json"));
}

export async function readRunMarker(destination, runId) {
  if (destination.kind === "file") {
    const path = join(destination.root, runId, "COMPLETE.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  }
  return s3GetJson(destination, s3Key(destination, runId, "COMPLETE.json"));
}

export async function deleteRun(destination, runId) {
  if (!/^\d{8}T\d{6}Z$/.test(runId)) throw new DestinationError(`refusing to delete a non-run path: ${runId}`);
  if (destination.kind === "file") {
    rmSync(join(destination.root, runId), { recursive: true, force: true });
    return;
  }
  await aws(["s3", "rm", `s3://${destination.bucket}/${s3Key(destination, runId)}/`, "--recursive", "--only-show-errors"]);
}

/** Download a complete run (for a restore) into `targetDir`. */
export async function downloadRun(destination, runId, targetDir) {
  if (!(await readRunMarker(destination, runId))) throw new DestinationError(`run ${runId} is not complete at the destination`);
  if (destination.kind === "file") {
    for (const file of localFiles(join(destination.root, runId))) {
      const to = join(targetDir, file.key);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(file.full, to);
    }
    return;
  }
  await aws(["s3", "cp", `s3://${destination.bucket}/${s3Key(destination, runId)}/`, targetDir, "--recursive", "--only-show-errors"]);
}
