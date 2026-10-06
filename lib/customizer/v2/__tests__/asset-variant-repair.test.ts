// The legacy asset repair workflow (scripts/repair-customizer-asset-variants.mjs),
// against an in-memory Storage and database.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { runVariantRepair } from "../../../../scripts/lib/asset-variant-repair.mjs";

type Row = Record<string, any>;

async function png(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#7a5c3e" } }).png().toBuffer();
}

/** Just enough of the Supabase client for the repair workflow, recording every write. */
function fakeSupabase(tables: Record<string, Row[]>, files: Map<string, Buffer>, options: { failUploads?: boolean } = {}) {
  const writes: string[] = [];
  const query = (table: string) => {
    const rows = tables[table] || [];
    let filtered = rows;
    const chain: any = {
      select: () => chain,
      in: (column: string, values: unknown[]) => {
        filtered = filtered.filter((row) => values.includes(row[column]));
        return chain;
      },
      order: () => chain,
      range: async (from: number, to: number) => ({ data: filtered.slice(from, to + 1), error: null }),
      update: (patch: Row) => ({
        eq: async (_column: string, id: string) => {
          writes.push(`update ${table}:${id}`);
          const row = rows.find((entry) => entry.id === id);
          Object.assign(row!, patch);
          return { error: null };
        },
      }),
    };
    return chain;
  };
  return {
    writes,
    client: {
      from: query,
      storage: {
        from: (bucket: string) => ({
          download: async (path: string) => {
            const bytes = files.get(`${bucket}/${path}`);
            return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: "not found" } };
          },
          upload: async (path: string, bytes: Buffer) => {
            writes.push(`upload ${bucket}/${path}`);
            if (options.failUploads) return { error: { message: "storage unavailable" } };
            files.set(`${bucket}/${path}`, bytes);
            return { error: null };
          },
          remove: async (paths: string[]) => {
            writes.push(`remove ${paths.join(",")}`);
            return { error: null };
          },
        }),
      },
    },
  };
}

async function legacyLibrary() {
  const files = new Map<string, Buffer>();
  const original = await png(3000, 2000);
  files.set("customizer-elements/assets/a1/original/photo.png", original);
  // The legacy defect: an "editor" that is really a 480px thumbnail.
  files.set("customizer-elements/assets/a1/editor/editor-old.webp", await sharp(original).resize(480).webp().toBuffer());
  files.set("customizer-elements/assets/a1/thumbnail/thumb.webp", await sharp(original).resize(480).webp().toBuffer());
  // A healthy asset.
  const good = await png(1200, 800);
  files.set("customizer-elements/assets/a2/original/photo.png", good);
  files.set("customizer-elements/assets/a2/editor/editor.webp", await sharp(good).webp().toBuffer());
  files.set("customizer-elements/assets/a2/thumbnail/thumb.webp", await sharp(good).resize(480).webp().toBuffer());
  const rows: Row[] = [
    { id: "a1", title: "Legacy", bucket: "customizer-elements", path: "assets/a1/original/photo.png", editor_path: "assets/a1/editor/editor-old.webp", thumbnail_path: "assets/a1/thumbnail/thumb.webp", mime_type: "image/png", width: 3000, height: 2000, status: "ready", metadata: { note: "keep me" } },
    { id: "a2", title: "Healthy", bucket: "customizer-elements", path: "assets/a2/original/photo.png", editor_path: "assets/a2/editor/editor.webp", thumbnail_path: "assets/a2/thumbnail/thumb.webp", mime_type: "image/png", width: 1200, height: 800, status: "ready", metadata: {} },
    // No original at all: unrepairable, must be left alone.
    { id: "a3", title: "Lost", bucket: "customizer-elements", path: "assets/a3/original/gone.png", editor_path: "assets/a3/editor/e.webp", thumbnail_path: "assets/a3/thumbnail/t.webp", mime_type: "image/png", width: 900, height: 900, status: "ready", metadata: {} },
  ];
  return { files, rows, original };
}

describe("legacy asset variant repair", () => {
  it("a dry run reports every category and writes nothing — not a byte, not a row", async () => {
    const { files, rows } = await legacyLibrary();
    const before = JSON.stringify(rows);
    const fake = fakeSupabase({ customizer_assets: rows }, files);
    const { summary } = await runVariantRepair({ supabase: fake.client, dryRun: true, tables: ["library"] });
    expect(summary).toMatchObject({ scanned: 3, healthy: 1, tooSmallEditor: 1, missingOriginal: 1, repairable: 1, unrepairable: 1, repaired: 0 });
    expect(fake.writes).toEqual([]);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("refuses to repair without a metadata backup", async () => {
    const { files, rows } = await legacyLibrary();
    const fake = fakeSupabase({ customizer_assets: rows }, files);
    await expect(runVariantRepair({ supabase: fake.client, dryRun: false, tables: ["library"] })).rejects.toThrow(/backup/);
    expect(fake.writes).toEqual([]);
  });

  it("repairs from the original: a verified full-size editor at a new path, the original untouched", async () => {
    const { files, rows, original } = await legacyLibrary();
    const fake = fakeSupabase({ customizer_assets: rows }, files);
    const backups: any[] = [];
    const { summary } = await runVariantRepair({
      supabase: fake.client,
      dryRun: false,
      tables: ["library"],
      writeBackup: (backup: any) => {
        backups.push(backup);
        return "memory://backup";
      },
    });
    expect(summary).toMatchObject({ repaired: 1, failed: 0, unrepairable: 1 });
    // B: the record's previous state was backed up before anything changed.
    expect(backups[0].rows).toEqual([expect.objectContaining({ id: "a1", editor_path: "assets/a1/editor/editor-old.webp", metadata: { note: "keep me" } })]);
    const repaired = rows.find((row) => row.id === "a1")!;
    expect(repaired.editor_path).toMatch(/^assets\/a1\/editor\/editor-[0-9a-f]{16}\.webp$/);
    const editor = await sharp(files.get(`customizer-elements/${repaired.editor_path}`)!).metadata();
    expect([editor.width, editor.height]).toEqual([2400, 1600]);
    expect(repaired.metadata).toMatchObject({ note: "keep me", editorWidth: 2400, editorHeight: 1600, sourceWidth: 3000 });
    // G: the original and the old variant are still there, byte for byte.
    expect(files.get("customizer-elements/assets/a1/original/photo.png")!.equals(original)).toBe(true);
    expect(files.has("customizer-elements/assets/a1/editor/editor-old.webp")).toBe(true);
    expect(fake.writes.some((write) => write.startsWith("remove"))).toBe(false);
    // The unrepairable asset's record was not touched.
    expect(rows.find((row) => row.id === "a3")!.editor_path).toBe("assets/a3/editor/e.webp");
    expect(fake.writes).not.toContain("update customizer_assets:a3");
  });

  it("a failed repair destroys nothing: the record and the original stay exactly as they were", async () => {
    const { files, rows, original } = await legacyLibrary();
    const before = JSON.stringify(rows.find((row) => row.id === "a1"));
    const fake = fakeSupabase({ customizer_assets: rows }, files, { failUploads: true });
    const { summary } = await runVariantRepair({ supabase: fake.client, dryRun: false, tables: ["library"], writeBackup: () => "memory://backup" });
    expect(summary).toMatchObject({ repaired: 0, failed: 1 });
    expect(JSON.stringify(rows.find((row) => row.id === "a1"))).toBe(before);
    expect(files.get("customizer-elements/assets/a1/original/photo.png")!.equals(original)).toBe(true);
    expect(fake.writes.filter((write) => write.startsWith("update"))).toEqual([]);
  });

  it("repairs customer uploads inside the owner's own folder", async () => {
    const files = new Map<string, Buffer>();
    const original = await png(2600, 2600);
    files.set("customer-uploads/user-1/customizer/p/original.png", original);
    files.set("customer-uploads/user-1/customizer/p/editor.webp", await sharp(original).resize(400).webp().toBuffer());
    files.set("customer-uploads/user-1/customizer/p/thumb.webp", await sharp(original).resize(480).webp().toBuffer());
    const rows = [{ id: "u1", user_id: "user-1", bucket: "customer-uploads", path: "user-1/customizer/p/original.png", editor_path: "user-1/customizer/p/editor.webp", thumbnail_path: "user-1/customizer/p/thumb.webp", mime_type: "image/png", width: 2600, height: 2600, status: "ready", metadata: {} }];
    const fake = fakeSupabase({ customer_asset_library: rows }, files);
    const { summary } = await runVariantRepair({ supabase: fake.client, dryRun: false, tables: ["customer"], writeBackup: () => "memory://backup" });
    expect(summary.repaired).toBe(1);
    expect(rows[0].editor_path).toMatch(/^user-1\/customizer\/p\/editor-[0-9a-f]{16}\.webp$/);
  });
});
