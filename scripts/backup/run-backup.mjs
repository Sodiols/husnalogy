#!/usr/bin/env node
/**
 * One backup run — the ONLY entry point that makes backups:
 *
 *   1 identity      static checks + live database↔Storage cross-check
 *                   (lib/source.mjs); nothing is created before it passes
 *   2 database      one exported snapshot, archives row-count verified (db-backup.mjs)
 *   3 storage       every object, encrypted, opaque names (storage-backup.mjs)
 *   4 verification  without restoring (verify-backup.mjs)
 *   5 upload        to BACKUP_DESTINATION, verified, then COMPLETE.json (lib/destination.mjs)
 *   6 retention     planned; applied only when configured AND approved (lib/retention.mjs)
 *
 *   node scripts/backup/run-backup.mjs [--source-env <file>] --backup-root <folder>
 *   node scripts/backup/run-backup.mjs --check --backup-root <folder> [--max-age-hours 26]
 *
 * Settings (process environment, or the --source-env file; the same name set
 * to two different values is refused as ambiguous):
 *   BACKUP_ENVIRONMENT            production | staging | local
 *   BACKUP_EXPECTED_PROJECT_REF   the approved project ref
 *   BACKUP_DATABASE_URL           direct or SESSION-pooler connection string
 *   NEXT_PUBLIC_SUPABASE_URL      (or SUPABASE_URL) the same project's API URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   BACKUP_ENCRYPTION_KEY         32 bytes hex/base64 — required, always
 *   BACKUP_DESTINATION            file:///… or s3://bucket/prefix — required for production
 *   BACKUP_S3_ENDPOINT            non-AWS S3 endpoint (optional)
 *   BACKUP_RETENTION              e.g. daily=14,weekly=8,monthly=12 (optional)
 *   BACKUP_RETENTION_APPROVED     "yes" to actually delete per the policy
 *
 * Outcome: <root>/last-run.json (every run) and <root>/last-success.json
 * (recovery-grade runs only) — operational fields only, no paths, no row
 * counts. A run whose database or Storage step failed leaves only FAILED.json
 * in its folder. Exit code ≠ 0 whenever the run is not recovery-grade.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { parseEncryptionKey } from "./lib/crypto.mjs";
import { connection } from "./lib/pg-tools.mjs";
import { BackupIdentityError, resolveBackupSource, verifyLiveIdentity } from "./lib/source.mjs";
import { DestinationError, deleteRun, listRuns, parseDestination, readLatestSuccess, readRunMarker, uploadRun } from "./lib/destination.mjs";
import { PROPOSED_RETENTION, parseRetentionPolicy, planRetention, runTime } from "./lib/retention.mjs";
import { argValue, isMain, pickOne, readEnvFile } from "./lib/target.mjs";
import { BackupStageError, backupDatabase } from "./db-backup.mjs";
import { backupStorage, serviceClient } from "./storage-backup.mjs";
import { verifyBackup } from "./verify-backup.mjs";

export const stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** Error text safe for plaintext status files: no ids, hashes or object paths. */
export function redact(message) {
  return String(message || "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/[0-9a-f]{32,}/gi, "<hash>")
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "<database-url>")
    .slice(0, 400);
}

export function readStatus(root, name) {
  const path = join(root, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export async function runBackup({
  environment,
  expectedRef,
  databaseUrl,
  supabaseUrl,
  serviceRoleKey,
  backupRoot,
  encryptionKey,
  destination = null,
  retentionPolicy = null,
  retentionApproved = false,
  now = new Date(),
  root = process.cwd(),
  log = (entry) => console.log(JSON.stringify(entry)),
}) {
  mkdirSync(backupRoot, { recursive: true });
  const runId = stamp(now);
  const runDir = join(backupRoot, runId);
  const started = Date.now();
  const status = { runId, environment: environment || null, project: null, startedAt: now.toISOString(), status: "failed", stage: "configuration", steps: {} };
  let artifactsCreated = false;
  try {
    if (!encryptionKey) throw new BackupStageError("failed", "BACKUP_ENCRYPTION_KEY is required: backups are always encrypted.");
    if (environment === "production" && !destination) throw new BackupStageError("failed", "a production backup must be uploaded off-site: set BACKUP_DESTINATION.");

    status.stage = "identity";
    let source;
    try {
      source = resolveBackupSource({ environment, expectedRef, databaseUrl, supabaseUrl, serviceRoleKey, root });
      status.project = source.ref;
      const storage = serviceClient(supabaseUrl, serviceRoleKey).storage;
      const client = new pg.Client({ ...connection(databaseUrl).pgConfig, application_name: "husnalogy-backup-identity" });
      client.on("error", () => undefined);
      await client.connect();
      try {
        status.steps.identity = { ok: true, customDomain: source.customDomain, ...(await verifyLiveIdentity({ client, storage })) };
      } finally {
        await client.end().catch(() => undefined);
      }
      source.storage = storage;
    } catch (error) {
      throw error instanceof BackupIdentityError
        ? Object.assign(error, { status: "identity-mismatch" })
        : Object.assign(new BackupIdentityError(`identity could not be verified (${error.message})`), { status: "identity-unverified" });
    }
    log({ identity: "verified", project: source.ref, environment, evidence: status.steps.identity });

    if (existsSync(runDir)) throw new BackupStageError("failed", `run ${runId} already exists locally`);
    artifactsCreated = true;
    status.stage = "database";
    const database = await backupDatabase({ databaseUrl, outDir: join(runDir, "database"), encryptionKey, source, log });
    status.steps.database = { ok: true, snapshotAt: database.snapshotAt, consistency: database.consistency, tables: database.totals.tables, encryptedBytes: database.files.reduce((sum, file) => sum + file.bytes, 0) };

    status.stage = "storage";
    const previous = readStatus(backupRoot, "last-success.json");
    const previousDir = previous?.runId && existsSync(join(backupRoot, previous.runId, "storage")) ? join(backupRoot, previous.runId, "storage") : null;
    try {
      const storage = await backupStorage({ storage: source.storage, source, outDir: join(runDir, "storage"), encryptionKey, previousDir, log });
      status.steps.storage = { ok: true, objects: storage.totals.objects, encryptedBytes: storage.encryptedBytes, downloaded: storage.downloaded, reused: storage.reused };
    } catch (error) {
      throw Object.assign(new BackupStageError("incomplete", redact(error.message)), { cause: error });
    }

    status.stage = "verification";
    const verification = await verifyBackup(runDir, encryptionKey);
    writeFileSync(join(runDir, "verification.json"), JSON.stringify(verification, null, 2));
    status.steps.verification = { ok: verification.ok, problems: (verification.database?.problems.length || 0) + (verification.storage?.problemCount || 0) };
    if (!verification.ok) throw new BackupStageError("incomplete", `verification failed: ${[...(verification.database?.problems || []), ...(verification.storage?.problems || [])].slice(0, 3).join("; ")}`);

    const summary = { runId, environment, project: source.ref, snapshotAt: database.snapshotAt, status: "recovery-grade", databaseBytes: status.steps.database.encryptedBytes, storageObjects: status.steps.storage.objects, storageBytes: status.steps.storage.encryptedBytes };
    if (destination) {
      status.stage = "upload";
      try {
        status.steps.upload = { ok: true, destination: destination.label, ...(await uploadRun(destination, runDir, runId, summary)) };
      } catch (error) {
        throw Object.assign(new BackupStageError("upload-failed", `off-site upload failed: ${redact(error.message)}`), { cause: error });
      }
      status.stage = "retention";
      try {
        const runs = await listRuns(destination);
        const policy = retentionPolicy || PROPOSED_RETENTION;
        const plan = planRetention(runs, policy, now.getTime());
        const apply = Boolean(retentionPolicy && retentionApproved);
        if (apply) for (const old of plan.remove) await deleteRun(destination, old);
        status.steps.retention = { mode: apply ? "applied" : "dry-run", policy, kept: plan.keep.length, removable: plan.remove.length, deleted: apply ? plan.remove.length : 0 };
      } catch (error) {
        // A retention problem never invalidates the backup that was just verified.
        status.steps.retention = { mode: "error", error: redact(error.message) };
      }
    } else {
      status.steps.upload = { ok: false, skipped: "no BACKUP_DESTINATION (local-only run; not off-site)" };
    }
    status.status = "recovery-grade";
    status.stage = "done";
    status.ok = true;
    status.offSite = Boolean(destination);
  } catch (error) {
    status.ok = false;
    status.status = error?.status || "failed";
    status.error = redact(error?.message || error);
    if (artifactsCreated && ["database", "storage", "verification"].includes(status.stage)) {
      // Partial artifacts are never left looking like a backup.
      rmSync(join(runDir, "database"), { recursive: true, force: true });
      rmSync(join(runDir, "storage"), { recursive: true, force: true });
      rmSync(join(runDir, "verification.json"), { force: true });
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "FAILED.json"), JSON.stringify({ runId, stage: status.stage, status: status.status, error: status.error }, null, 2));
    }
  }
  status.finishedAt = new Date().toISOString();
  status.durationMs = Date.now() - started;
  writeFileSync(join(backupRoot, "last-run.json"), JSON.stringify(status, null, 2));
  if (status.ok) writeFileSync(join(backupRoot, "last-success.json"), JSON.stringify(status, null, 2));
  log({ backupRun: status.ok ? "recovery-grade" : status.status, runId, stage: status.stage, durationMs: status.durationMs, offSite: Boolean(status.offSite), error: status.error });
  if (!status.ok) throw Object.assign(new Error(`backup ${status.status} at ${status.stage}: ${status.error}`), { status: status.status, stage: status.stage });
  return status;
}

/**
 * Monitoring. Problems: no recovery-grade backup; latest one too old; latest
 * run failed (any stage: identity, database, storage, encryption, upload…);
 * destination unreachable (or credentials rejected); off-site marker stale;
 * a sudden size drop (< 50 % of the previous complete run); partial uploads
 * older than 48 h.
 */
export async function checkBackupStatus({ backupRoot = null, destination = null, maxAgeHours = 26, now = Date.now() } = {}) {
  const problems = [];
  const warnings = [];
  const result = { checkedAt: new Date(now).toISOString() };
  const stale = (iso) => !iso || now - Date.parse(iso) > maxAgeHours * 3_600_000;
  if (backupRoot) {
    const last = readStatus(backupRoot, "last-run.json");
    const success = readStatus(backupRoot, "last-success.json");
    result.local = { latestRun: last?.finishedAt || null, latestRunStatus: last?.status || null, latestSuccess: success?.finishedAt || null };
    if (last && !last.ok) problems.push(`latest run ${last.status} at ${last.stage}: ${last.error}`);
    if (!destination) {
      if (!success) problems.push("no recovery-grade backup recorded");
      else if (stale(success.finishedAt)) problems.push(`latest recovery-grade backup is older than ${maxAgeHours} h (${success.finishedAt})`);
    }
  }
  if (destination) {
    try {
      const latest = await readLatestSuccess(destination);
      const runs = await listRuns(destination);
      const complete = runs.filter((run) => run.complete);
      result.offSite = { latestSuccess: latest?.uploadedAt || null, completeRuns: complete.length, partialRuns: runs.length - complete.length };
      if (!latest) problems.push("no off-site backup recorded");
      else if (stale(latest.uploadedAt)) problems.push(`latest off-site backup is older than ${maxAgeHours} h (${latest.uploadedAt})`);
      if (complete.length >= 2) {
        const [previous, newest] = await Promise.all(complete.slice(-2).map((run) => run.marker || readRunMarker(destination, run.runId)));
        if (previous?.bytes && newest?.bytes && newest.bytes < previous.bytes * 0.5) problems.push(`unexpected backup size: ${newest.bytes} bytes vs ${previous.bytes} previously`);
      }
      const oldPartial = runs.filter((run) => !run.complete && now - runTime(run.runId) > 48 * 3_600_000);
      if (oldPartial.length) warnings.push(`${oldPartial.length} partial upload(s) older than 48 h`);
    } catch (error) {
      problems.push(`backup destination unavailable: ${redact(error.message)}`);
    }
  }
  if (!backupRoot && !destination) problems.push("nothing to check: give --backup-root and/or BACKUP_DESTINATION");
  return { ok: problems.length === 0, ...result, problems, warnings };
}

export function readSettings(argv, processEnv = process.env) {
  const file = argValue(argv, "--source-env");
  const env = file ? readEnvFile(file) : {};
  const sources = [processEnv, env];
  return {
    environment: pickOne(sources, ["BACKUP_ENVIRONMENT"]),
    expectedRef: pickOne(sources, ["BACKUP_EXPECTED_PROJECT_REF"]),
    databaseUrl: pickOne(sources, ["BACKUP_DATABASE_URL"]),
    supabaseUrl: pickOne(sources, ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"], "Supabase URL"),
    serviceRoleKey: pickOne(sources, ["SUPABASE_SERVICE_ROLE_KEY"]),
    encryptionKey: parseEncryptionKey(processEnv.BACKUP_ENCRYPTION_KEY),
    destination: parseDestination(pickOne(sources, ["BACKUP_DESTINATION"])),
    retentionPolicy: parseRetentionPolicy(pickOne(sources, ["BACKUP_RETENTION"])),
    retentionApproved: pickOne(sources, ["BACKUP_RETENTION_APPROVED"]) === "yes",
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const backupRoot = argValue(argv, "--backup-root");
  if (argv.includes("--check")) {
    const destination = parseDestination(process.env.BACKUP_DESTINATION || "");
    const result = await checkBackupStatus({ backupRoot: backupRoot || null, destination, maxAgeHours: Number(argValue(argv, "--max-age-hours") || 26) });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (!backupRoot) throw new Error("usage: run-backup.mjs [--source-env <file>] --backup-root <folder> | --check [--backup-root <folder>] [--max-age-hours 26]");
  await runBackup({ ...readSettings(argv), backupRoot });
}

if (isMain("scripts/backup/run-backup.mjs")) {
  main().catch((error) => {
    console.error(redact(error?.message || error));
    process.exitCode = 1;
  });
}
