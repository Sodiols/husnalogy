/**
 * BACKUP → OFF-SITE → ISOLATED RESTORE DRILL on real PostgreSQL 17 with
 * synthetic data only. It runs the production tools (scripts/backup/*)
 * exactly as an operator or the scheduled workflow would, and proves:
 *
 *   identity      a database and a Storage API of DIFFERENT projects are refused
 *                 before anything is written; a wrong expected ref is refused
 *   encryption    no artifact (local or off-site) contains a path, file name,
 *                 user id, order id, phone, e-mail or content hash in plaintext
 *   consistency   a backup taken while writes continue is ONE point in time
 *                 (archive row counts = snapshot counts); a snapshot that cannot
 *                 be exported, or a connection killed mid-backup, FAILS the run
 *                 and leaves no artifact that looks like a backup
 *   off-site      upload verified file by file; upload errors, silent partial
 *                 uploads, rejected credentials and an unreachable destination
 *                 are detected; retention is dry-run unless approved
 *   restore       from the OFF-SITE copy into a NEW database built from the
 *                 migrations and a NEW Storage: rows, relationships, checksums,
 *                 RLS, Storage privacy, URL rewrite — and the real production
 *                 worker renders a restored order from restored files only
 *   compatibility a backup in the previous format (v1) still verifies and restores
 *
 * Storage is a local stand-in of the Storage HTTP API (metadata in the real
 * storage.objects table); S3 is a CLI test double. A green run proves the
 * tools and procedure, NOT Supabase's hosted services or a real provider.
 * Needs pg_dump/pg_restore/psql ≥ 17 (HUSNALOGY_PG_BIN or PATH), otherwise
 * SKIPPED with that reason. Timings: test-results/backup-restore-drill.json.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { startPostgres, type PostgresServer, type RoleClient } from "@/lib/testing/postgres-server";
import { startStorageStandIn, type StorageStandIn } from "@/lib/testing/storage-api-standin";
import { createProductionTestClient } from "@/lib/testing/pglite-production-client";
import { placeAutomaticOrder } from "@/lib/testing/production-orders";
import { IDS, USERS, callCheckoutRpc, orderPayload, seedCheckoutFixtures, type SqlDatabase } from "@/lib/testing/checkout-fixtures";
import { productionWorkerSubsystems } from "@/lib/outbox/supabase-tasks";
import { runWorkerPass } from "@/lib/worker/production-worker";
import { applyMigrations, migrationPlan } from "../../../scripts/staging/apply-migrations.mjs";
import { pgBin } from "../../../scripts/backup/lib/pg-tools.mjs";
import { assertRestoreTarget, databaseTargetId, supabaseTargetId } from "../../../scripts/backup/lib/target.mjs";
import { parseDestination, listRuns, downloadRun } from "../../../scripts/backup/lib/destination.mjs";
import { openDatabaseBackup, openStorageBackup } from "../../../scripts/backup/lib/formats.mjs";
import { checkBackupStatus, runBackup } from "../../../scripts/backup/run-backup.mjs";
import { restoreDatabase } from "../../../scripts/backup/db-restore.mjs";
import { restoreStorage } from "../../../scripts/backup/storage-restore.mjs";
import { inventoryStorage, serviceClient } from "../../../scripts/backup/storage-backup.mjs";
import { verifyBackup } from "../../../scripts/backup/verify-backup.mjs";
import { readSourcesViaPg, reconcile, storageFromBackup } from "../../../scripts/backup/reconcile-storage.mjs";
import { rewriteStorageUrls } from "../../../scripts/backup/rewrite-storage-urls.mjs";
import { verifyLiveIdentity } from "../../../scripts/backup/lib/source.mjs";

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => { throw new Error("Drill uses its injected SQL client"); } }));

const toolsReady = ["pg_dump", "pg_restore", "psql"].every((tool) => {
  const run = spawnSync(pgBin(tool), ["--version"], { encoding: "utf8" });
  return run.status === 0 && Number((run.stdout.match(/(\d+)/) || [])[1]) >= 17;
});

const A = USERS.customerA;
const B = USERS.customerB;
const SOURCE_KEY = "drill-source-service-role-key";
const TARGET_KEY = "drill-target-service-role-key";
const FAKE_AWS = resolve("lib/testing/fake-aws-cli.mjs");
const quiet = () => undefined;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const dbUrl = (server: PostgresServer, user = "postgres", password = "postgres") => `postgresql://${user}:${password}@127.0.0.1:${(server.owner as any).port}/postgres`;
const localId = (server: PostgresServer) => databaseTargetId(dbUrl(server));
const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)) : []);
const runDirs = (root: string) => (existsSync(root) ? readdirSync(root).filter((name) => /^\d{8}T\d{6}Z$/.test(name)) : []);

describe.skipIf(!toolsReady)(`backup → off-site → isolated restore drill (real PostgreSQL 17${toolsReady ? "" : " — SKIPPED: pg_dump/pg_restore/psql 17+ not found; set HUSNALOGY_PG_BIN"})`, () => {
  const work = mkdtempSync(join(tmpdir(), "husnalogy-drill-"));
  const key = randomBytes(32);
  const backupRoot = join(work, "backups");
  const destinationDir = join(work, "offsite");
  const destination = () => parseDestination(pathToFileURL(destinationDir).href);
  const evidence: Record<string, any> = { startedAt: new Date().toISOString(), synthetic: true };
  let clock = Date.parse("2026-10-10T02:00:00Z");
  const nextNow = () => new Date((clock += 60_000));
  let source: PostgresServer;
  let target: PostgresServer;
  let sourceStorage: StorageStandIn;
  let targetStorage: StorageStandIn;
  let orderId = "";
  let auto: Awaited<ReturnType<typeof placeAutomaticOrder>>;
  let mainRun: Awaited<ReturnType<typeof runBackup>>;
  const synthetic: Record<string, { bucket: string; path: string; bytes: Buffer; type: string }> = {};
  const secrets: string[] = [];

  const options = (overrides: Record<string, unknown> = {}) => ({
    environment: "local",
    expectedRef: localId(source),
    databaseUrl: dbUrl(source),
    supabaseUrl: sourceStorage.url,
    serviceRoleKey: SOURCE_KEY,
    backupRoot,
    encryptionKey: key,
    destination: destination(),
    now: nextNow(),
    log: quiet,
    ...overrides,
  });

  async function migrated() {
    const server = await startPostgres(undefined, { migrate: false });
    expect((await applyMigrations(server.owner, migrationPlan(), quiet)).failed).toBeNull();
    return server;
  }

  beforeAll(async () => {
    [source, target] = await Promise.all([migrated(), migrated()]);
    sourceStorage = await startStorageStandIn({ db: source.owner, dir: join(work, "source-storage"), serviceKey: SOURCE_KEY });
    targetStorage = await startStorageStandIn({ db: target.owner, dir: join(work, "target-storage"), serviceKey: TARGET_KEY });
    const service = await source.connect();
    await service.as("service_role");
    const t: SqlDatabase = { db: source.owner, asService: (work) => work(service) };
    await seedCheckoutFixtures(t);
    const payload = await orderPayload(t);
    const placed = await callCheckoutRpc(t, payload);
    expect(placed.status).toBe("created");
    orderId = String(placed.order_id || payload.order.id);

    // A real automatic-production order: its pinned image, font and licence
    // become Storage objects of the source project.
    const production = createProductionTestClient(t as any);
    auto = await placeAutomaticOrder(t as any, production);
    for (const row of (await source.owner.query("select bucket, path, mime_type from public.order_production_assets where order_id = $1", [auto.orderId])).rows) {
      await sourceStorage.put(row.bucket, row.path, production.blobs.get(`${row.bucket}/${row.path}`)!, row.mime_type);
    }

    const png = (color: string) => sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).png().toBuffer();
    const webp = (color: string) => sharp({ create: { width: 32, height: 24, channels: 3, background: color } }).webp().toBuffer();
    const productionBytes = await png("#334455");
    Object.assign(synthetic, {
      aOriginal: { bucket: "customer-uploads", path: `${A.id}/drill/wedding-photo-original.png`, bytes: await png("#aa2233"), type: "image/png" },
      aEditor: { bucket: "customer-uploads", path: `${A.id}/drill/wedding-photo-editor.webp`, bytes: await webp("#aa2233"), type: "image/webp" },
      aThumb: { bucket: "customer-uploads", path: `${A.id}/drill/wedding-photo-thumb.webp`, bytes: await webp("#bb3344"), type: "image/webp" },
      bOriginal: { bucket: "customer-uploads", path: `${B.id}/drill/private-portrait.png`, bytes: await png("#2233aa"), type: "image/png" },
      avatar: { bucket: "customer-avatars", path: `${A.id}/avatar.webp`, bytes: await webp("#ffcc00"), type: "image/webp" },
      adminSvg: { bucket: "customizer-elements", path: "library/drill/heart-ornament.svg", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M5 9 1 4a2 2 0 0 1 4-2 2 2 0 0 1 4 2z" fill="#c33"/></svg>'), type: "image/svg+xml" },
      background: { bucket: "customizer-elements", path: "library/drill/floral-background.webp", bytes: await webp("#e8dcc8"), type: "image/webp" },
      product: { bucket: "product-images", path: "drill/pearl-invitation.png", bytes: await png("#eeeeee"), type: "image/png" },
      render: { bucket: "customizer-renders", path: `previews/${IDS.customizationA2}/front.png`, bytes: await png("#123123"), type: "image/png" },
      production: { bucket: "order-production", path: `orders/${orderId}/assets/${sha(productionBytes)}`, bytes: productionBytes, type: "image/png" },
    });
    const storage = serviceClient(sourceStorage.url, SOURCE_KEY).storage;
    for (const file of Object.values(synthetic)) {
      const { error } = await storage.from(file.bucket).upload(file.path, file.bytes, { contentType: file.type, upsert: false });
      expect(error, `${file.bucket}/${file.path}`).toBeNull();
    }

    const owner = source.owner;
    const libraryId = (await owner.query("insert into public.customer_asset_library (user_id, bucket, path, editor_path, thumbnail_path, file_name, mime_type, size_bytes, width, height, status, checksum) values ($1, 'customer-uploads', $2, $3, $4, 'wedding-photo.png', 'image/png', $5, 64, 48, 'ready', $6) returning id", [A.id, synthetic.aOriginal.path, synthetic.aEditor.path, synthetic.aThumb.path, synthetic.aOriginal.bytes.length, sha(synthetic.aOriginal.bytes)])).rows[0].id;
    await owner.query("insert into public.customer_uploads (user_id, bucket, path, file_name, mime_type, size_bytes) values ($1, 'customer-uploads', $2, 'private-portrait.png', 'image/png', $3)", [B.id, synthetic.bOriginal.path, synthetic.bOriginal.bytes.length]);
    const reference = { version: 1, assetId: libraryId, ownerId: A.id, bucket: "customer-uploads", storagePath: synthetic.aOriginal.path, editorStoragePath: synthetic.aEditor.path, thumbnailStoragePath: synthetic.aThumb.path, originalFileName: "wedding-photo.png", mimeType: "image/png", fileSize: synthetic.aOriginal.bytes.length, width: 64, height: 48, createdAt: new Date().toISOString() };
    const background = { kind: "image", asset: { bucket: "customizer-elements", path: synthetic.background.path } };
    await owner.query("update public.product_customizations set asset_references = $2::jsonb, values = values || $3::jsonb where id = $1", [IDS.customizationA2, JSON.stringify([reference]), JSON.stringify({ photo: { assetReference: reference, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, mask: { kind: "ellipse" } }, background })]);
    await owner.query("update public.profiles set avatar_path = $2, phone = '+8801700000000' where id = $1", [A.id, synthetic.avatar.path]);
    await owner.query("insert into public.customer_addresses (user_id, full_name, phone, address_line1, city, is_default) values ($1, 'Synthetic A', '+8801700000000', 'House 1', 'Dhaka', true)", [A.id]);
    for (const asset of [synthetic.adminSvg, synthetic.background]) {
      await owner.query("insert into public.customizer_assets (title, bucket, path, mime_type, original_filename, asset_type, status) values ('Drill asset', 'customizer-elements', $1, $2, 'asset', 'image', 'ready')", [asset.path, asset.type]);
    }
    const productUrl = `${sourceStorage.url}/storage/v1/object/public/product-images/${synthetic.product.path}`;
    await owner.query("update public.products set thumbnail = $1 where id = 'product-active'", [productUrl]);
    await owner.query("insert into public.product_images (product_id, image_url, sort_order) values ('product-active', $1, 0)", [productUrl]);
    const collection = (await owner.query("insert into public.product_collections (name, slug) values ('Drill collection', 'drill-collection') returning id")).rows[0].id;
    await owner.query("insert into public.product_collection_products (product_id, collection_id) values ('product-active', $1)", [collection]);
    // Template version 2 is published AFTER customer A's design was saved on v1.
    await owner.query("insert into public.customizer_template_versions (template_id, product_id, version, major_version, minor_revision, document) select template_id, product_id, 2, major_version + 1, 0, document || '{\"notes\":\"v2\"}'::jsonb from public.customizer_template_versions where id = $1", [IDS.versionActive]);
    const job = (await owner.query("insert into public.customizer_render_jobs (customization_id, job_type, status, input_hash) values ($1, 'preview', 'completed', 'drill-hash') returning id", [IDS.customizationA2])).rows[0].id;
    await owner.query("insert into public.customizer_render_outputs (job_id, customization_id, page_id, format, bucket, path, status) values ($1, $2, 'front', 'png', 'customizer-renders', $3, 'ready')", [job, IDS.customizationA2, synthetic.render.path]);
    const snapshotId = (await owner.query("select id from public.order_design_snapshots where order_id = $1", [orderId])).rows[0].id;
    await owner.query("insert into public.order_production_assets (snapshot_id, order_id, asset_key, bucket, path, checksum, size_bytes, mime_type, kind) values ($1, $2, $3, 'order-production', $4, $3, $5, 'image/png', 'image')", [snapshotId, orderId, sha(productionBytes), synthetic.production.path, productionBytes.length]);

    secrets.push(A.id, B.id, orderId, auto.orderId, "wedding-photo", "private-portrait", "heart-ornament", "floral-background", "pearl-invitation", "Synthetic A", "+8801700000000", USERS.customerA.email, sha(synthetic.aOriginal.bytes), sha(productionBytes));
  }, 600_000);

  afterAll(async () => {
    evidence.finishedAt = new Date().toISOString();
    mkdirSync(join(process.cwd(), "test-results"), { recursive: true });
    writeFileSync(join(process.cwd(), "test-results", "backup-restore-drill.json"), JSON.stringify(evidence, null, 2));
    await sourceStorage?.close();
    await targetStorage?.close();
    await source?.stop();
    await target?.stop();
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }, 120_000);

  it("identity: a database and a Storage API of different projects are refused before any artifact exists", async () => {
    const before = runDirs(backupRoot);
    await expect(runBackup(options({ supabaseUrl: targetStorage.url }))).rejects.toMatchObject({ status: "identity-mismatch" });
    await expect(runBackup(options({ databaseUrl: dbUrl(target), expectedRef: localId(target) }))).rejects.toMatchObject({ status: "identity-mismatch" });
    await expect(runBackup(options({ expectedRef: localId(target) }))).rejects.toThrow(/BACKUP_EXPECTED_PROJECT_REF is .* but the database is/);
    await expect(runBackup(options({ environment: "production" }))).rejects.toMatchObject({ status: "identity-mismatch" });
    await expect(runBackup(options({ encryptionKey: null }))).rejects.toThrow(/BACKUP_ENCRYPTION_KEY is required/);
    expect(runDirs(backupRoot)).toEqual(before);
    expect(JSON.parse(readFileSync(join(backupRoot, "last-run.json"), "utf8"))).toMatchObject({ ok: false });
    expect(existsSync(join(backupRoot, "last-success.json"))).toBe(false);
    // The same check passes for the right pair (bucket creation times + object ids).
    const client = await source.connect();
    expect(await verifyLiveIdentity({ client, storage: serviceClient(sourceStorage.url, SOURCE_KEY).storage })).toMatchObject({ objectsMatched: 5 });
  }, 120_000);

  it("backup while writes continue: recovery-grade, one point in time, encrypted everywhere, uploaded and verified off-site", async () => {
    const writer = await source.connect();
    let stop = false;
    let written = 0;
    const writing = (async () => {
      while (!stop) {
        await writer.query("insert into public.newsletter_subscribers (email) values ($1)", [`drill-${randomUUID()}@example.test`]);
        written += 1;
      }
    })();
    const started = Date.now();
    try {
      mainRun = await runBackup(options());
    } finally {
      stop = true;
      await writing;
    }
    evidence.backupMs = Date.now() - started;
    expect(mainRun).toMatchObject({ ok: true, status: "recovery-grade", offSite: true, steps: { identity: { ok: true }, database: { ok: true, consistency: "exported-snapshot+archive-row-counts-verified" }, storage: { ok: true }, verification: { ok: true }, upload: { ok: true } } });
    const runDir = join(backupRoot, mainRun.runId);
    const { manifest } = openDatabaseBackup(join(runDir, "database"), key);
    const atSnapshot = manifest.tables["public.newsletter_subscribers"];
    const finalCount = Number((await source.owner.query("select count(*) from public.newsletter_subscribers")).rows[0].count);
    expect(written).toBeGreaterThan(10);
    expect(finalCount).toBeGreaterThan(atSnapshot); // writes landed after the snapshot…
    expect(manifest.consistentSnapshot).toBe(true); // …yet the archives hold exactly the snapshot (verified inside the run)
    expect(manifest.tables["public.orders"]).toBe(2);
    expect(manifest.tables["public.customizer_template_versions"]).toBe(5);
    const storage = openStorageBackup(join(runDir, "storage"), key);
    expect(storage.objects).toHaveLength(Object.keys(synthetic).length + 3);
    // Control: the identifiers searched for below DO exist inside the encrypted data.
    expect(JSON.stringify(storage.objects)).toContain(A.id);
    expect(JSON.stringify(storage.objects)).toContain("wedding-photo");

    // Nothing identifying in plaintext — locally or off-site.
    const artifacts = [...files(backupRoot), ...files(destinationDir)];
    expect(artifacts.length).toBeGreaterThan(10);
    for (const file of artifacts) {
      const text = readFileSync(file).toString("latin1");
      for (const secret of secrets) expect(text.includes(secret), `${secret} appears in ${file.slice(work.length)}`).toBe(false);
    }
    expect(artifacts.some((file) => file.endsWith("storage-objects.jsonl") || file.endsWith("manifest.json"))).toBe(false);
    // Off-site copy is complete and byte-identical.
    const runs = await listRuns(destination()!);
    expect(runs).toEqual([expect.objectContaining({ runId: mainRun.runId, complete: true })]);
    for (const file of files(runDir)) {
      const remote = join(destinationDir, mainRun.runId, file.slice(runDir.length + 1));
      expect(sha(readFileSync(remote))).toBe(sha(readFileSync(file)));
    }
    evidence.backup = { status: mainRun.status, tables: manifest.totals.tables, writesDuringBackup: written, objects: storage.objects.length, encryptedBytes: mainRun.steps.database.encryptedBytes + mainRun.steps.storage.encryptedBytes, snapshotAt: manifest.snapshotAt };
  }, 300_000);

  it("consistency unavailable: a snapshot that cannot be exported fails the run; nothing looks like a backup", async () => {
    await source.owner.query(`
      do $$ begin create role drill_backup_ro login bypassrls password 'drill-ro-password'; exception when duplicate_object then null; end $$;
      grant usage on schema public, auth, storage, husnalogy_ops to drill_backup_ro;
      grant select on all tables in schema public, auth, storage, husnalogy_ops to drill_backup_ro;
      revoke execute on function pg_catalog.pg_export_snapshot() from public;`);
    try {
      const success = readFileSync(join(backupRoot, "last-success.json"), "utf8");
      const failed = await runBackup(options({ databaseUrl: dbUrl(source, "drill_backup_ro", "drill-ro-password") })).catch((error) => error);
      expect(failed).toMatchObject({ status: "consistency-unavailable", stage: "database" });
      const runDir = join(backupRoot, runDirs(backupRoot).sort().pop()!);
      expect(readdirSync(runDir)).toEqual(["FAILED.json"]);
      expect(readFileSync(join(backupRoot, "last-success.json"), "utf8")).toBe(success);
    } finally {
      await source.owner.query("grant execute on function pg_catalog.pg_export_snapshot() to public");
    }
  }, 120_000);

  it("interruption: a connection killed in the middle of the backup fails it; no partial artifact survives", async () => {
    const locker = await source.connect();
    await locker.query("begin");
    await locker.query("lock table public.orders in access exclusive mode");
    const outcome = runBackup(options()).catch((error) => error);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const waiting = Number((await source.owner.query("select count(*) from pg_stat_activity where wait_event_type = 'Lock' and application_name in ('husnalogy-backup', 'pg_dump')")).rows[0].count);
      if (waiting) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    await source.owner.query("select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('husnalogy-backup', 'pg_dump') and pid <> pg_backend_pid()");
    await locker.query("rollback");
    const failed = await outcome;
    expect(failed).toBeInstanceOf(Error);
    expect(failed).toMatchObject({ stage: "database" });
    const runDir = join(backupRoot, runDirs(backupRoot).sort().pop()!);
    expect(readdirSync(runDir)).toEqual(["FAILED.json"]);
    expect((await listRuns(destination()!)).filter((run) => run.complete)).toHaveLength(1);
  }, 180_000);

  it("restore from the OFF-SITE copy into a new isolated project: rows, relationships, checksums, URLs — and the worker renders a restored order", async () => {
    const restoreDir = join(work, "from-offsite");
    await downloadRun(destination()!, mainRun.runId, restoreDir);
    expect((await verifyBackup(restoreDir, key)).ok).toBe(true);
    const started = Date.now();
    const targetId = databaseTargetId(dbUrl(target));
    const db = await restoreDatabase({ backupDir: join(restoreDir, "database"), databaseUrl: dbUrl(target), confirm: targetId, encryptionKey: key, log: quiet });
    evidence.dbRestoreMs = Date.now() - started;
    expect(db).toMatchObject({ status: "restored", mismatches: [], policyFingerprintMatches: true });
    const api = serviceClient(targetStorage.url, TARGET_KEY).storage;
    const identity = await target.connect();
    await verifyLiveIdentity({ client: identity, storage: api }); // the target API and database are one project
    const storageStarted = Date.now();
    const storage = await restoreStorage({ storage: api, backupDir: join(restoreDir, "storage"), targetId: supabaseTargetId(targetStorage.url), encryptionKey: key, log: quiet });
    evidence.storageRestoreMs = Date.now() - storageStarted;
    expect(storage).toMatchObject({ status: "restored", bucketsCreated: [], failures: [] });
    const rewrite = await rewriteStorageUrls({ client: target.owner, from: sourceStorage.url, to: targetStorage.url, apply: true });
    expect(rewrite.columns.map((column: any) => `${column.table}.${column.column}`)).toEqual(expect.arrayContaining(["products.thumbnail", "product_images.image_url"]));
    evidence.totalRestoreMs = Date.now() - started;

    const q = async (sql: string, params: unknown[] = []) => (await target.owner.query(sql, params)).rows;
    expect((await q("select template_version from public.product_customizations where id = $1", [IDS.customizationA]))[0].template_version).toBe(1);
    expect((await q("select version from public.customizer_template_versions where template_id = $1 order by version", [IDS.templateActive])).map((row) => row.version)).toEqual([1, 2]);
    expect(await q("select integrity_hash, snapshot::text as s from public.order_design_snapshots order by id")).toEqual((await source.owner.query("select integrity_hash, snapshot::text as s from public.order_design_snapshots order by id")).rows);
    expect(await q("select id, email from auth.users order by id")).toEqual((await source.owner.query("select id, email from auth.users order by id")).rows);
    expect(await q("select id, role from public.profiles order by id")).toEqual((await source.owner.query("select id, role from public.profiles order by id")).rows);
    expect((await q("select count(*)::int as n from public.product_collection_products"))[0].n).toBe(1);
    expect((await q("select values->'background' as b from public.product_customizations where id = $1", [IDS.customizationA2]))[0].b).toEqual({ kind: "image", asset: { bucket: "customizer-elements", path: synthetic.background.path } });
    expect((await q("select thumbnail from public.products where id = 'product-active'"))[0].thumbnail.startsWith(`${targetStorage.url}/storage/v1/`)).toBe(true);

    const live = await inventoryStorage(api);
    const report = reconcile({ buckets: live.buckets, objects: live.objects, rowsBySource: await readSourcesViaPg(target.owner), manifestChecksums: storageFromBackup(join(restoreDir, "storage"), key).checksums });
    expect(report.skippedSources).toEqual([]);
    expect(report.totals).toMatchObject({ missing: 0, missingCritical: 0, checksumMismatch: 0, orphanObjects: 0 });
    for (const kind of ["production-asset", "customer-original", "customer-editor", "customer-thumbnail", "avatar", "admin-original", "render-output", "product-catalogue", "saved-design"]) expect(report.byKind[kind]?.missing, kind).toBe(0);

    // The real production worker, given ONLY the restored database and files,
    // renders the restored automatic order from its snapshot.
    const service = await target.connect();
    await service.as("service_role");
    const production = createProductionTestClient({ db: target.owner, asService: (work: any) => work(service) } as any);
    for (const object of live.objects) {
      const { data } = await api.from(object.bucket).download(object.name);
      production.blobs.set(`${object.bucket}/${object.name}`, Buffer.from(await data!.arrayBuffer()));
    }
    await runWorkerPass(productionWorkerSubsystems({ renderLimit: 10, supabase: production.client, notifications: { transport: null, adminRecipient: "orders@husnalogy.test", loadOrder: async () => null } }), { totalBudgetMs: 240_000 });
    expect((await q("select status from public.production_tasks where snapshot_id = $1", [auto.snapshot.id]))[0]?.status).toBe("completed");
    expect((await q("select status from public.customizer_render_jobs where snapshot_id = $1", [auto.snapshot.id]))[0]?.status).toBe("completed");
    const outputs = await q("select bucket, path, checksum from public.customizer_render_outputs where snapshot_id = $1 and status = 'ready'", [auto.snapshot.id]);
    expect(outputs.length).toBeGreaterThan(0);
    expect(sha(production.blobs.get(`${outputs[0].bucket}/${outputs[0].path}`)!)).toBe(outputs[0].checksum);
    evidence.restore = { tables: db.tables, objects: storage.objects, urlRewrites: rewrite.rows, reconciliation: report.totals, renderedFromRestore: outputs.length };
  }, 400_000);

  it("the restored project enforces the same RLS and Storage privacy", async () => {
    const as = async (role: "anon" | "authenticated", user?: { id: string; email: string }) => {
      const client: RoleClient = await target.connect();
      await client.as(role, user ? { sub: user.id, email: user.email } : {});
      return client;
    };
    const [anon, a, b] = await Promise.all([as("anon"), as("authenticated", A), as("authenticated", B)]);
    const rows = async (client: RoleClient, sql: string, params: unknown[] = []) => client.query(sql, params).then((result) => result.rows.length, () => 0);
    for (const [label, sql, params] of [
      ["order", "select 1 from public.orders where id = $1", [orderId]],
      ["saved design", "select 1 from public.product_customizations where id = $1", [IDS.customizationA2]],
      ["address", "select 1 from public.customer_addresses where user_id = $1", [A.id]],
      ["photo library", "select 1 from public.customer_asset_library where user_id = $1", [A.id]],
      ["private photo object", "select 1 from storage.objects where bucket_id = 'customer-uploads' and name like $1", [`${A.id}/%`]],
    ] as Array<[string, string, unknown[]]>) {
      expect(await rows(a, sql, params), `A: ${label}`).toBeGreaterThan(0);
      expect(await rows(b, sql, params), `B: ${label}`).toBe(0);
      expect(await rows(anon, sql, params), `guest: ${label}`).toBe(0);
    }
    for (const bucket of ["customer-avatars", "order-production", "customizer-elements", "customizer-renders"]) expect(await rows(a, "select 1 from storage.objects where bucket_id = $1", [bucket]), bucket).toBe(0);
    await expect(b.query("update public.profiles set role = 'admin' where id = $1", [B.id])).rejects.toThrow();
    expect((await target.owner.query("select id, public from storage.buckets order by id")).rows).toEqual((await source.owner.query("select id, public from storage.buckets order by id")).rows);
  }, 120_000);

  it("refuses unsafe restores and damaged backups", async () => {
    const runDir = join(backupRoot, mainRun.runId);
    const targetId = databaseTargetId(dbUrl(target));
    await expect(restoreDatabase({ backupDir: join(runDir, "database"), databaseUrl: "postgresql://postgres.aehdzcpxdxpdjikdmdpf:x@aws-0-ap-south-1.pooler.supabase.com:5432/postgres", confirm: "aehdzcpxdxpdjikdmdpf", encryptionKey: key, log: quiet })).rejects.toThrow(/production/);
    expect(() => assertRestoreTarget({ supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co", databaseUrl: "postgresql://postgres.zyxwvutsrqponmlkjihg:x@aws-0-eu.pooler.supabase.com:5432/postgres", confirm: "abcdefghijklmnopqrst" })).toThrow(/different targets/);
    await expect(restoreDatabase({ backupDir: join(runDir, "database"), databaseUrl: dbUrl(target), confirm: "something-else", encryptionKey: key, log: quiet })).rejects.toThrow(/RESTORE_CONFIRM_TARGET/);
    await expect(restoreDatabase({ backupDir: join(runDir, "database"), databaseUrl: dbUrl(target), confirm: targetId, encryptionKey: key, log: quiet })).rejects.toThrow(/already holds/);
    await target.owner.query("alter table public.orders add column drill_extra text");
    await expect(restoreDatabase({ backupDir: join(runDir, "database"), databaseUrl: dbUrl(target), confirm: targetId, encryptionKey: key, replaceExistingData: true, log: quiet })).rejects.toThrow(/schema drift[\s\S]*orders\.drill_extra/);
    await target.owner.query("alter table public.orders drop column drill_extra");
    expect((await verifyBackup(runDir, randomBytes(32))).ok).toBe(false);
    await expect(restoreDatabase({ backupDir: join(runDir, "database"), databaseUrl: dbUrl(target), confirm: targetId, encryptionKey: randomBytes(32), replaceExistingData: true, log: quiet })).rejects.toThrow();

    const damaged = (name: string, edit: (dir: string) => void) => {
      const dir = join(work, `damaged-${name}`);
      cpSync(runDir, dir, { recursive: true });
      edit(dir);
      return dir;
    };
    const flip = (path: string, offset = 40) => {
      const bytes = readFileSync(path);
      bytes[bytes.length - offset] ^= 0xff;
      writeFileSync(path, bytes);
    };
    const tamperedArchive = damaged("archive", (dir) => flip(join(dir, "database", "public.dump.enc")));
    expect((await verifyBackup(tamperedArchive, key)).database!.problems.join(" ")).toMatch(/checksum mismatch/);
    const truncated = damaged("truncated", (dir) => writeFileSync(join(dir, "database", "public.dump.enc"), readFileSync(join(dir, "database", "public.dump.enc")).subarray(0, 1000)));
    expect((await verifyBackup(truncated, key)).database!.ok).toBe(false);
    const tamperedManifest = damaged("manifest", (dir) => flip(join(dir, "database", "manifest.enc"), 20));
    expect((await verifyBackup(tamperedManifest, key)).database!.problems.join(" ")).toMatch(/does not match status\.json/);
    const tamperedIndex = damaged("index", (dir) => flip(join(dir, "storage", "index.enc"), 20));
    expect((await verifyBackup(tamperedIndex, key)).storage!.ok).toBe(false);
    const tamperedBlob = damaged("blob", (dir) => flip(files(join(dir, "storage", "blobs"))[0], 20));
    const blobResult = (await verifyBackup(tamperedBlob, key)).storage!;
    expect(blobResult).toMatchObject({ ok: false, problemCount: 1 });
    for (const secret of secrets) expect(JSON.stringify(blobResult).includes(secret)).toBe(false);
  }, 240_000);

  it("compatibility: a backup in the previous (v1) format still verifies and restores", async () => {
    const runDir = join(backupRoot, mainRun.runId);
    const legacy = join(work, "legacy-v1");
    mkdirSync(join(legacy, "database"), { recursive: true });
    const { manifest } = openDatabaseBackup(join(runDir, "database"), key);
    for (const file of manifest.files) copyFileSync(join(runDir, "database", file.name), join(legacy, "database", file.name));
    writeFileSync(join(legacy, "database", "manifest.json"), JSON.stringify({ ...manifest, format: "husnalogy-db-backup/1" }));
    const storage = openStorageBackup(join(runDir, "storage"), key);
    cpSync(join(runDir, "storage", "blobs"), join(legacy, "storage", "blobs"), { recursive: true });
    writeFileSync(join(legacy, "storage", "storage-manifest.json"), JSON.stringify({ ...storage.manifest, format: "husnalogy-storage-backup/1" }));
    writeFileSync(join(legacy, "storage", "storage-objects.jsonl"), storage.objects.map((object: unknown) => JSON.stringify(object)).join("\n") + "\n");

    expect(await verifyBackup(legacy, key)).toMatchObject({ ok: true, database: { format: "v1" }, storage: { format: "v1" } });
    const db = await restoreDatabase({ backupDir: join(legacy, "database"), databaseUrl: dbUrl(target), confirm: databaseTargetId(dbUrl(target)), encryptionKey: key, replaceExistingData: true, log: quiet });
    expect(db.mismatches).toEqual([]);
    const restored = await restoreStorage({ storage: serviceClient(targetStorage.url, TARGET_KEY).storage, backupDir: join(legacy, "storage"), targetId: supabaseTargetId(targetStorage.url), encryptionKey: key, skipExisting: true, log: quiet });
    expect(restored.status).toBe("restored");
    expect(restored.existing + restored.uploaded).toBe(storage.objects.length);
    expect(restored.verifiedByDownload).toBe(storage.objects.length);
  }, 240_000);

  it("--mode full rebuilds the public schema from the archive alone (fallback when the migrations do not match)", async () => {
    const bare = await startPostgres(undefined, { migrate: false });
    try {
      const report = await restoreDatabase({ backupDir: join(backupRoot, mainRun.runId, "database"), databaseUrl: dbUrl(bare), confirm: databaseTargetId(dbUrl(bare)), encryptionKey: key, mode: "full", log: quiet });
      expect(report.mismatches).toEqual([]);
      expect((await bare.owner.query("select count(*)::int as n from pg_policies where schemaname = 'public'")).rows[0].n).toBe((await source.owner.query("select count(*)::int as n from pg_policies where schemaname = 'public'")).rows[0].n);
      evidence.fullModeMs = report.durationMs;
    } finally {
      await bare.stop();
    }
  }, 240_000);

  it("off-site failures are detected: upload error, silent partial upload, rejected credentials, unreachable destination; retention only when approved", async () => {
    const s3Root = join(work, "fake-s3");
    mkdirSync(join(s3Root, "husnalogy-backups"), { recursive: true });
    const saved = { cli: process.env.HUSNALOGY_AWS_CLI, root: process.env.FAKE_S3_ROOT, fail: process.env.FAKE_S3_FAIL };
    process.env.HUSNALOGY_AWS_CLI = FAKE_AWS;
    process.env.FAKE_S3_ROOT = s3Root;
    const s3 = parseDestination("s3://husnalogy-backups/production");
    const s3Options = (now = nextNow()) => options({ destination: s3, now });
    try {
      const success = readFileSync(join(backupRoot, "last-success.json"), "utf8");
      for (const fault of ["cp", "partial", "auth"]) {
        process.env.FAKE_S3_FAIL = fault;
        await expect(runBackup(s3Options()), fault).rejects.toMatchObject({ status: "upload-failed", stage: "upload" });
        expect(readFileSync(join(backupRoot, "last-success.json"), "utf8")).toBe(success);
      }
      process.env.FAKE_S3_FAIL = "";
      const partial = await listRuns(s3!);
      expect(partial.filter((run) => run.complete)).toHaveLength(0);
      expect(partial.length).toBeGreaterThanOrEqual(1); // the silent partial upload is visible as incomplete

      const first = await runBackup(s3Options());
      expect(first).toMatchObject({ status: "recovery-grade", steps: { upload: { ok: true }, retention: { mode: "dry-run", deleted: 0 } } });
      const second = await runBackup({ ...s3Options(), retentionPolicy: { daily: 1, weekly: 0, monthly: 0 }, retentionApproved: false });
      expect(second.steps.retention).toMatchObject({ mode: "dry-run", deleted: 0 });
      expect((await listRuns(s3!)).filter((run) => run.complete)).toHaveLength(2);
      const third = await runBackup({ ...s3Options(), retentionPolicy: { daily: 1, weekly: 0, monthly: 0 }, retentionApproved: true });
      expect(third.steps.retention).toMatchObject({ mode: "applied" });
      const after = await listRuns(s3!);
      expect(after.filter((run) => run.complete).map((run) => run.runId)).toEqual([third.runId]); // newest healthy kept
      expect(await checkBackupStatus({ destination: s3 })).toMatchObject({ ok: true, offSite: { completeRuns: 1 } });
      expect(await checkBackupStatus({ destination: s3, now: Date.now() + 27 * 3_600_000 })).toMatchObject({ ok: false, problems: [expect.stringMatching(/older than 26 h/)] });
      process.env.FAKE_S3_FAIL = "list";
      expect((await checkBackupStatus({ destination: s3 })).problems.join(" ")).toMatch(/destination unavailable/);
      process.env.FAKE_S3_FAIL = "auth";
      expect((await checkBackupStatus({ destination: s3 })).problems.join(" ")).toMatch(/destination unavailable/);
      for (const file of files(s3Root)) {
        const text = readFileSync(file).toString("latin1");
        for (const secret of secrets) expect(text.includes(secret), `${secret} off-site`).toBe(false);
      }
    } finally {
      for (const [name, value] of [["HUSNALOGY_AWS_CLI", saved.cli], ["FAKE_S3_ROOT", saved.root], ["FAKE_S3_FAIL", saved.fail]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }, 600_000);

  it("monitoring: stale, missing and failed local backups are reported", async () => {
    expect(await checkBackupStatus({ backupRoot: join(work, "no-backups") })).toMatchObject({ ok: false, problems: ["no recovery-grade backup recorded"] });
    const status = await checkBackupStatus({ backupRoot, now: Date.now() + 27 * 3_600_000 });
    expect(status.ok).toBe(false);
    expect(status.problems.join(" ")).toMatch(/older than 26 h/);
  });
});
