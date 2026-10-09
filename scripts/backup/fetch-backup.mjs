#!/usr/bin/env node
/**
 * Download a COMPLETE backup run from the off-site destination (the first
 * step of a recovery), then verify it without restoring. Runs without
 * COMPLETE.json (partial uploads) are refused.
 *
 *   BACKUP_DESTINATION=s3://bucket/prefix node scripts/backup/fetch-backup.mjs --list
 *   BACKUP_DESTINATION=… BACKUP_ENCRYPTION_KEY=… node scripts/backup/fetch-backup.mjs --run <runId|latest> --out <new private folder>
 */
import { existsSync, readdirSync } from "node:fs";
import { parseEncryptionKey } from "./lib/crypto.mjs";
import { downloadRun, listRuns, parseDestination, readLatestSuccess } from "./lib/destination.mjs";
import { argValue, isMain } from "./lib/target.mjs";
import { verifyBackup } from "./verify-backup.mjs";

async function main() {
  const argv = process.argv.slice(2);
  const destination = parseDestination(process.env.BACKUP_DESTINATION || "");
  if (!destination) throw new Error("BLOCKED: set BACKUP_DESTINATION (file:///… or s3://bucket/prefix).");
  if (argv.includes("--list")) {
    for (const run of await listRuns(destination)) console.log(JSON.stringify({ runId: run.runId, complete: run.complete }));
    return;
  }
  let runId = argValue(argv, "--run");
  const out = argValue(argv, "--out");
  if (!runId || !out) throw new Error("usage: fetch-backup.mjs --list | --run <runId|latest> --out <new folder>");
  if (existsSync(out) && readdirSync(out).length) throw new Error(`REFUSED: ${out} is not empty.`);
  if (runId === "latest") runId = (await readLatestSuccess(destination))?.runId;
  if (!runId) throw new Error("no complete backup at the destination");
  await downloadRun(destination, runId, out);
  const result = await verifyBackup(out, parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY));
  console.log(JSON.stringify({ runId, downloadedTo: out, verified: result.ok, database: result.database && { ok: result.database.ok, snapshotAt: result.database.snapshotAt }, storage: result.storage && { ok: result.storage.ok, objects: result.storage.objects } }));
  if (!result.ok) process.exitCode = 1;
}

if (isMain("scripts/backup/fetch-backup.mjs")) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
