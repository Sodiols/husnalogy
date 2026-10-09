/**
 * Backup hardening (2026-10-10), without a database: source identity (static
 * checks — the live database↔Storage cross-check runs in the drill), refusal
 * of ambiguous settings, format-v2 metadata protection, the pg_restore COPY
 * parser behind the row-count verification, retention planning, and the
 * file:// destination with monitoring. End to end: backup-restore-drill.test.ts.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { pickOne } from "../../../scripts/backup/lib/target.mjs";
import { blobId, readEncryptedJson, writeEncryptedJson } from "../../../scripts/backup/lib/crypto.mjs";
import { resolveBackupSource } from "../../../scripts/backup/lib/source.mjs";
import { parseRetentionPolicy, planRetention } from "../../../scripts/backup/lib/retention.mjs";
import { listRuns, parseDestination, uploadRun } from "../../../scripts/backup/lib/destination.mjs";
import { openDatabaseBackup, openStorageBackup } from "../../../scripts/backup/lib/formats.mjs";
import { copyTarget } from "../../../scripts/backup/db-backup.mjs";
import { checkBackupStatus, readSettings, redact } from "../../../scripts/backup/run-backup.mjs";
import { PRODUCTION_PROJECT_REFS } from "../../../scripts/staging/staging-env.mjs";

const PROD = PRODUCTION_PROJECT_REFS[0];
const STAGING = "stagingprojectabcdef";

function workspace(localUrl: string) {
  const dir = mkdtempSync(join(tmpdir(), "husnalogy-hardening-"));
  writeFileSync(join(dir, ".env.local"), `NEXT_PUBLIC_SUPABASE_URL=${localUrl}\n`);
  return dir;
}

describe("backup source identity (static checks)", () => {
  const root = workspace("https://liveappprojectrefab.supabase.co");
  const valid = {
    environment: "production",
    expectedRef: PROD,
    databaseUrl: `postgresql://postgres.${PROD}:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
    supabaseUrl: `https://${PROD}.supabase.co`,
    serviceRoleKey: "sb_secret_abcdefghijklmnopqrstuvwxyz",
    root,
  };
  const jwt = (claims: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2lnbmF0dXJlc2lnbmF0dXJl`;

  it("accepts the approved project through the session pooler AND the direct connection", () => {
    expect(resolveBackupSource(valid)).toMatchObject({ ref: PROD, environment: "production", customDomain: false });
    expect(resolveBackupSource({ ...valid, databaseUrl: `postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres` })).toMatchObject({ ref: PROD });
  });

  it("a custom API domain is accepted only as 'to be proven by the live cross-check'", () => {
    expect(resolveBackupSource({ ...valid, supabaseUrl: "https://api.husnalogy.com" })).toMatchObject({ customDomain: true });
  });

  it("refuses a database and an API of different projects", () => {
    expect(() => resolveBackupSource({ ...valid, supabaseUrl: `https://${STAGING}.supabase.co` })).toThrow(/ONE project/);
    expect(() => resolveBackupSource({ ...valid, databaseUrl: `postgresql://postgres.${STAGING}:pw@aws-0-eu.pooler.supabase.com:5432/postgres` })).toThrow(/ONE project|BACKUP_EXPECTED_PROJECT_REF/);
  });

  it("refuses a missing or wrong expected ref and an unknown environment", () => {
    expect(() => resolveBackupSource({ ...valid, expectedRef: "" })).toThrow(/BACKUP_EXPECTED_PROJECT_REF is not set/);
    expect(() => resolveBackupSource({ ...valid, expectedRef: STAGING })).toThrow(/BACKUP_EXPECTED_PROJECT_REF is .* but the database is/);
    expect(() => resolveBackupSource({ ...valid, environment: "prod" })).toThrow(/BACKUP_ENVIRONMENT must be/);
  });

  it("refuses unrecognized connection formats and malformed credentials", () => {
    expect(() => resolveBackupSource({ ...valid, databaseUrl: "postgresql://admin:pw@db.example.com:5432/postgres" })).toThrow(/does not identify a Supabase project/);
    expect(() => resolveBackupSource({ ...valid, databaseUrl: "not a url" })).toThrow(/BACKUP_DATABASE_URL is missing or is not a valid URL/);
    expect(() => resolveBackupSource({ ...valid, databaseUrl: `mysql://u:p@db.${PROD}.supabase.co/x` })).toThrow(/postgresql/);
    expect(() => resolveBackupSource({ ...valid, serviceRoleKey: "short" })).toThrow(/malformed/);
    expect(() => resolveBackupSource({ ...valid, serviceRoleKey: jwt({ role: "anon", ref: PROD }) })).toThrow(/not a service-role key/);
    expect(() => resolveBackupSource({ ...valid, serviceRoleKey: jwt({ role: "service_role", ref: STAGING }) })).toThrow(/key belongs to/);
    expect(resolveBackupSource({ ...valid, serviceRoleKey: jwt({ role: "service_role", ref: PROD }) }).ref).toBe(PROD);
  });

  it("a production project is never 'staging', and a staging project is never 'production'", () => {
    expect(() => resolveBackupSource({ ...valid, environment: "staging" })).toThrow(/cannot be backed up as "staging"/);
    const staging = { ...valid, expectedRef: STAGING, databaseUrl: `postgresql://postgres.${STAGING}:pw@aws-0-eu.pooler.supabase.com:5432/postgres`, supabaseUrl: `https://${STAGING}.supabase.co` };
    expect(() => resolveBackupSource(staging)).toThrow(/not a registered production project/);
    expect(resolveBackupSource({ ...staging, environment: "staging" }).ref).toBe(STAGING);
    expect(() => resolveBackupSource({ ...staging, environment: "local" })).toThrow(/accepts only local/);
  });

  it("settings given twice with different values are refused, never guessed", () => {
    expect(() => pickOne([{ RESTORE_DATABASE_URL: "postgresql://a" }, { STAGING_DATABASE_URL: "postgresql://b" }], ["RESTORE_DATABASE_URL", "STAGING_DATABASE_URL"])).toThrow(/ambiguous/);
    expect(pickOne([{ A: "x" }, { A: "x" }], ["A"])).toBe("x");
    expect(() => readSettings([], { BACKUP_ENVIRONMENT: "production", BACKUP_DESTINATION: "ftp://nope" } as unknown as NodeJS.ProcessEnv)).toThrow(/BACKUP_DESTINATION must be/);
  });
});

describe("format v2 metadata protection", () => {
  const key = randomBytes(32);

  it("blob names are key-derived, never the content hash", () => {
    const content = "a".repeat(64);
    expect(blobId(key, content)).not.toBe(content);
    expect(blobId(key, content)).toBe(blobId(key, content));
    expect(blobId(randomBytes(32), content)).not.toBe(blobId(key, content));
  });

  it("encrypted documents: the right key reads; a wrong key, tampering or truncation fail", () => {
    const dir = mkdtempSync(join(tmpdir(), "husnalogy-enc-"));
    const path = join(dir, "index.enc");
    writeEncryptedJson(path, { objects: [{ name: "user-id/photo.png" }] }, key);
    expect(readFileSync(path).toString("latin1")).not.toContain("photo.png");
    expect(readEncryptedJson(path, key)).toEqual({ objects: [{ name: "user-id/photo.png" }] });
    expect(() => readEncryptedJson(path, randomBytes(32))).toThrow();
    const bytes = readFileSync(path);
    bytes[bytes.length - 5] ^= 1;
    writeFileSync(path, bytes);
    expect(() => readEncryptedJson(path, key)).toThrow();
    writeFileSync(path, bytes.subarray(0, 10));
    expect(() => readEncryptedJson(path, key)).toThrow();
  });

  it("a folder without a recovery-grade status is never opened as a backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "husnalogy-fmt-"));
    expect(() => openDatabaseBackup(dir, key)).toThrow(/not a database backup/);
    expect(() => openStorageBackup(dir, key)).toThrow(/not a Storage backup/);
    writeFileSync(join(dir, "status.json"), JSON.stringify({ format: "husnalogy-db-backup/2", status: "incomplete" }));
    writeFileSync(join(dir, "manifest.enc"), "x");
    expect(() => openDatabaseBackup(dir, key)).toThrow(/not recovery-grade/);
  });

  it("plaintext status errors never carry ids, hashes or connection strings", () => {
    const text = redact(`listing 00000000-0000-4000-8000-00000000000a/x failed for ${"ab".repeat(32)} via postgresql://postgres:secret@db.example.co/postgres`);
    expect(text).not.toMatch(/00000000-0000|abab|secret/);
  });

  it("pg_restore COPY lines are parsed exactly (quoted names, no false matches)", () => {
    expect(copyTarget("COPY public.orders (id, total) FROM stdin;")).toBe("public.orders");
    expect(copyTarget('COPY public."values" (a) FROM stdin;')).toBe("public.values");
    expect(copyTarget("COPY publicXorders (id) FROM stdin;")).toBeNull();
    expect(copyTarget("SELECT pg_catalog.setval('x', 1);")).toBeNull();
  });
});

describe("retention", () => {
  const id = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const run = (iso: string, complete = true) => ({ runId: id(iso), complete });
  const now = Date.parse("2026-12-31T12:00:00Z");

  it("parses only explicit, non-empty policies", () => {
    expect(parseRetentionPolicy("")).toBeNull();
    expect(parseRetentionPolicy("daily=14,weekly=8,monthly=12")).toEqual({ daily: 14, weekly: 8, monthly: 12 });
    expect(() => parseRetentionPolicy("daily=0")).toThrow(/keeps nothing/);
    expect(() => parseRetentionPolicy("hourly=5")).toThrow(/BACKUP_RETENTION must look like/);
  });

  it("keeps the newest of each day and month, the newest complete backup, and young partial uploads", () => {
    const runs = [
      run("2026-12-31T02:00:00Z"), run("2026-12-31T01:00:00Z"), run("2026-12-30T02:00:00Z"),
      run("2026-12-01T02:00:00Z"), run("2026-11-01T02:00:00Z"),
      run("2026-12-31T11:00:00Z", false), run("2026-12-20T02:00:00Z", false),
    ];
    const plan = planRetention(runs, { daily: 2, weekly: 0, monthly: 2 }, now);
    expect(plan.keep).toEqual(expect.arrayContaining([id("2026-12-31T02:00:00Z"), id("2026-12-30T02:00:00Z"), id("2026-11-01T02:00:00Z"), id("2026-12-31T11:00:00Z")]));
    expect(plan.remove).toEqual([id("2026-12-01T02:00:00Z"), id("2026-12-20T02:00:00Z"), id("2026-12-31T01:00:00Z")].sort());
  });

  it("deletes nothing when no complete backup exists, and always keeps the newest complete one", () => {
    expect(planRetention([run("2026-12-01T02:00:00Z", false)], { daily: 1, weekly: 0, monthly: 0 }, now).remove).toEqual([]);
    expect(planRetention([run("2026-01-01T02:00:00Z")], { daily: 1, weekly: 0, monthly: 0 }, now).keep).toEqual([id("2026-01-01T02:00:00Z")]);
  });
});

describe("off-site destination (file://) and monitoring", () => {
  function runFolder(bytes = 2048) {
    const dir = mkdtempSync(join(tmpdir(), "husnalogy-run-"));
    mkdirSync(join(dir, "database"));
    writeFileSync(join(dir, "database", "status.json"), "{}");
    writeFileSync(join(dir, "database", "public.dump.enc"), randomBytes(bytes));
    return dir;
  }

  it("parses only file:// and s3:// destinations", () => {
    expect(parseDestination("")).toBeNull();
    expect(parseDestination("s3://bucket/a/b/")).toMatchObject({ kind: "s3", bucket: "bucket", prefix: "a/b" });
    expect(() => parseDestination("https://example.com")).toThrow(/must be file/);
  });

  it("uploads, verifies, marks complete; refuses to overwrite; reports a size drop, staleness and an unreachable destination", async () => {
    const root = mkdtempSync(join(tmpdir(), "husnalogy-dest-"));
    const destination = parseDestination(pathToFileURL(root).href)!;
    await uploadRun(destination, runFolder(), "20261001T020000Z", { status: "recovery-grade" });
    expect(existsSync(join(root, "20261001T020000Z", "COMPLETE.json"))).toBe(true);
    await expect(uploadRun(destination, runFolder(), "20261001T020000Z", {})).rejects.toThrow(/already exists/);
    await uploadRun(destination, runFolder(10), "20261002T020000Z", { status: "recovery-grade" });
    expect((await listRuns(destination)).map((entry) => entry.complete)).toEqual([true, true]);
    expect((await checkBackupStatus({ destination })).problems.join(" ")).toMatch(/unexpected backup size/);
    expect((await checkBackupStatus({ destination, now: Date.now() + 30 * 3_600_000 })).problems.join(" ")).toMatch(/older than 26 h/);
    expect((await checkBackupStatus({ destination: parseDestination(pathToFileURL(join(root, "missing")).href) })).problems.join(" ")).toMatch(/destination unavailable/);
  });
});
