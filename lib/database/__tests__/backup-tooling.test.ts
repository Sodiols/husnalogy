/**
 * The backup / restore tooling's own logic (no database needed): target
 * identification and the production guard, encryption at rest, Storage URL
 * parsing, database ↔ Storage reconciliation and schema-drift detection.
 * The end-to-end drill is backup-restore-drill.test.ts.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { assertRestoreTarget, databaseTargetId, describeTarget, productionIdentities, supabaseTargetId } from "../../../scripts/backup/lib/target.mjs";
import { decryptBuffer, encryptBuffer, parseEncryptionKey } from "../../../scripts/backup/lib/crypto.mjs";
import { connection } from "../../../scripts/backup/lib/pg-tools.mjs";
import { jsonReferences, parseStorageUrl, reconcile } from "../../../scripts/backup/reconcile-storage.mjs";
import { columnDrift } from "../../../scripts/backup/db-restore.mjs";
import { storagePrefix } from "../../../scripts/backup/rewrite-storage-urls.mjs";
import { PRODUCTION_PROJECT_REFS } from "../../../scripts/staging/staging-env.mjs";
import { compareSchemas } from "../../../scripts/staging/probe-schema.mjs";

const PROD = PRODUCTION_PROJECT_REFS[0];
const RECOVERY = "recoveryrefabcdefghi";

function workspace(localUrl?: string) {
  const dir = mkdtempSync(join(tmpdir(), "husnalogy-backup-"));
  if (localUrl) writeFileSync(join(dir, ".env.local"), `NEXT_PUBLIC_SUPABASE_URL=${localUrl}\n`);
  return dir;
}

describe("target identity", () => {
  it("reads the project ref from API URLs and from direct / pooler connection strings", () => {
    expect(supabaseTargetId(`https://${RECOVERY}.supabase.co`)).toBe(RECOVERY);
    expect(supabaseTargetId("http://127.0.0.1:54321")).toBe("local:127.0.0.1:54321");
    expect(databaseTargetId(`postgresql://postgres:pw@db.${RECOVERY}.supabase.co:5432/postgres`)).toBe(RECOVERY);
    expect(databaseTargetId(`postgresql://postgres.${RECOVERY}:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`)).toBe(RECOVERY);
    expect(databaseTargetId("postgresql://postgres:pw@127.0.0.1:55432/postgres")).toBe("local:127.0.0.1:55432");
    expect(databaseTargetId("postgresql://u:pw@db.example.com:5432/x")).toBe("host:db.example.com");
  });

  it("treats the known production refs AND the .env.local project as production", () => {
    const root = workspace(`https://${RECOVERY}.supabase.co`);
    expect(productionIdentities(root).has(PROD)).toBe(true);
    expect(productionIdentities(root).has(RECOVERY)).toBe(true);
    expect(describeTarget(RECOVERY, root).kind).toBe("production");
    expect(describeTarget("otherrefabcdefghijkl", root).kind).toBe("remote");
  });

  it("keeps the database password out of the command-line arguments", () => {
    const { args, env } = connection(`postgresql://postgres.${RECOVERY}:s3cret%21@aws-0-eu.pooler.supabase.com:5432/postgres`);
    expect(args.join(" ")).not.toContain("s3cret");
    expect(env.PGPASSWORD).toBe("s3cret!");
    expect(env.PGSSLMODE).toBe("require");
  });
});

describe("restore guard", () => {
  const root = workspace("https://liveappprojectrefab.supabase.co");
  it("refuses production, the .env.local project, mismatched URLs and unconfirmed targets", () => {
    expect(() => assertRestoreTarget({ supabaseUrl: `https://${PROD}.supabase.co`, confirm: PROD, root })).toThrow(/production/);
    expect(() => assertRestoreTarget({ databaseUrl: `postgresql://postgres.${PROD}:x@aws-0-eu.pooler.supabase.com:5432/postgres`, confirm: PROD, root })).toThrow(/production/);
    expect(() => assertRestoreTarget({ supabaseUrl: "https://liveappprojectrefab.supabase.co", confirm: "liveappprojectrefab", root })).toThrow(/production/);
    expect(() => assertRestoreTarget({ supabaseUrl: `https://${RECOVERY}.supabase.co`, databaseUrl: `postgresql://postgres:x@db.otherrefabcdefghijkl.supabase.co:5432/postgres`, confirm: RECOVERY, root })).toThrow(/different targets/);
    expect(() => assertRestoreTarget({ supabaseUrl: `https://${RECOVERY}.supabase.co`, confirm: "", root })).toThrow(/RESTORE_CONFIRM_TARGET=recoveryrefabcdefghi/);
    expect(() => assertRestoreTarget({ root, confirm: "x" })).toThrow(/no restore target/);
  });
  it("accepts a confirmed, isolated recovery project", () => {
    expect(assertRestoreTarget({ supabaseUrl: `https://${RECOVERY}.supabase.co`, databaseUrl: `postgresql://postgres:x@db.${RECOVERY}.supabase.co:5432/postgres`, confirm: RECOVERY, root })).toBe(RECOVERY);
  });
});

describe("encryption at rest", () => {
  const key = randomBytes(32);
  it("round-trips, and a wrong key or a flipped byte is detected", () => {
    const plain = Buffer.from("customer photo bytes");
    const sealed = encryptBuffer(plain, key);
    expect(sealed.includes(plain)).toBe(false);
    expect(decryptBuffer(sealed, key)).toEqual(plain);
    expect(() => decryptBuffer(sealed, randomBytes(32))).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 20] ^= 1;
    expect(() => decryptBuffer(tampered, key)).toThrow();
    expect(() => decryptBuffer(sealed, null)).toThrow(/BACKUP_ENCRYPTION_KEY/);
  });
  it("accepts 32-byte hex or base64 keys only", () => {
    expect(parseEncryptionKey("ab".repeat(32))!.length).toBe(32);
    expect(parseEncryptionKey(randomBytes(32).toString("base64"))!.length).toBe(32);
    expect(parseEncryptionKey("")).toBeNull();
    expect(() => parseEncryptionKey("short")).toThrow(/32 bytes/);
  });
});

describe("database ↔ Storage reconciliation", () => {
  const buckets = ["customer-uploads", "order-production", "product-images"].map((id) => ({ id }));
  it("finds references in Storage URLs and in design JSON", () => {
    expect(parseStorageUrl(`https://${PROD}.supabase.co/storage/v1/object/public/product-images/a/b%20c.png?v=1`)).toEqual({ bucket: "product-images", path: "a/b c.png" });
    expect(parseStorageUrl("/images/local.png")).toBeNull();
    const found = jsonReferences({ layers: [{ assetReference: { bucket: "customer-uploads", storagePath: "u/o.png", editorStoragePath: "u/e.webp", thumbnailStoragePath: "u/t.webp" } }, { src: `https://x.supabase.co/storage/v1/object/public/product-images/p.png` }], other: { bucket: "unknown-bucket", path: "x" } }, new Set(buckets.map((b) => b.id)));
    expect(found).toEqual(expect.arrayContaining([{ bucket: "customer-uploads", path: "u/o.png" }, { bucket: "customer-uploads", path: "u/e.webp" }, { bucket: "customer-uploads", path: "u/t.webp" }, { bucket: "product-images", path: "p.png" }]));
    expect(found).toHaveLength(4);
  });
  it("reports missing originals/variants, critical production files, checksum drift and orphans — and deletes nothing", () => {
    const objects = [
      { bucket: "customer-uploads", name: "u/o.png", size: 1 },
      { bucket: "order-production", name: "orders/1/a", size: 1 },
      { bucket: "product-images", name: "orphan.png", size: 1 },
    ];
    const report = reconcile({
      buckets,
      objects,
      rowsBySource: {
        customer_asset_library: [{ id: "l1", bucket: "customer-uploads", path: "u/o.png", editor_path: "u/e.webp", thumbnail_path: null }],
        order_production_assets: [
          { snapshot_id: "s1", bucket: "order-production", path: "orders/1/a", checksum: "aaa" },
          { snapshot_id: "s1", bucket: "order-production", path: "orders/1/gone", checksum: "bbb" },
        ],
        products: { error: "permission denied" },
      },
      manifestChecksums: new Map([["order-production\norders/1/a", "zzz"]]),
    });
    expect(report.totals).toMatchObject({ missing: 2, missingCritical: 1, checksumMismatch: 1, orphanObjects: 1 });
    expect(report.missing.map((item: any) => item.kind).sort()).toEqual(["customer-editor", "production-asset"]);
    expect(report.orphansByBucket).toEqual({ "product-images": 1 });
    expect(report.skippedSources).toEqual(expect.arrayContaining([{ table: "products", reason: "permission denied" }]));
  });
});

describe("restore preconditions", () => {
  it("lists schema drift in both directions", () => {
    expect(columnDrift(["orders.id:text:NO", "orders.total:numeric:YES"], ["orders.id:text:NO", "orders.extra:text:YES"])).toEqual({ missingInTarget: ["orders.total:numeric:YES"], extraInTarget: ["orders.extra:text:YES"] });
  });
  it("rewrites only the Storage prefix of the old project", () => {
    expect(storagePrefix(`https://${PROD}.supabase.co/rest/v1`)).toBe(`https://${PROD}.supabase.co/storage/v1/`);
  });
});

describe("schema drift probe", () => {
  it("names missing tables, columns, RPCs and bucket settings; extra tables are informational", () => {
    const expected = {
      tables: { orders: ["id", "total"], customer_addresses: ["id"] },
      rpcs: ["create_checkout_order", "customizer_template_is_public"],
      buckets: [{ id: "customer-uploads", public: false, file_size_limit: 10, allowed_mime_types: ["image/png"] }],
    };
    const actual = {
      tables: { orders: ["id"], legacy: ["id"] },
      rpcs: ["create_checkout_order"],
      buckets: [{ id: "customer-uploads", public: true, file_size_limit: 10, allowed_mime_types: ["image/png"] }],
    };
    expect(compareSchemas(expected, actual)).toMatchObject({
      ok: false,
      missingTables: ["customer_addresses"],
      missingColumns: ["orders.total"],
      missingRpcs: ["customizer_template_is_public"],
      bucketDiffs: ["customer-uploads: public=true, expected false"],
      extraTables: ["legacy"],
    });
    expect(compareSchemas(expected, { ...expected, tables: { ...expected.tables } }).ok).toBe(true);
  });
});
