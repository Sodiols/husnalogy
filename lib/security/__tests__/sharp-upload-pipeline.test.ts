/**
 * Sharp security upgrade (GHSA-wq5f-xc86-pv6w, fixed in sharp 0.35.5) — proof
 * that the patched build is the one installed AND that Husnalogy's real image
 * pipelines still work on it.
 *
 * This drives the two production upload routes end to end with real Sharp:
 *   - POST /api/customizer/upload        (customer photos: JPEG, PNG, WebP)
 *   - POST /api/admin/customizer/assets  (studio library: raster + SVG)
 * Only Supabase is replaced (an in-memory store that keeps real bytes, so each
 * route's own read-back verification decodes what it actually stored).
 */
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { join } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySupabase, type MemorySupabase } from "@/lib/testing/memory-supabase";

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let store: MemorySupabase;
const session: { userId: string | null; role: "customer" | "designer" | "admin" } = { userId: CUSTOMER_ID, role: "customer" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: session.userId ? { id: session.userId, email: "c@example.test" } : null }, error: null }) },
    from: (table: string) => store.client.from(table),
  }),
  createServiceRoleClient: () => store.client,
}));

vi.mock("@/lib/auth/roles", async (importOriginal) => {
  const original: any = await importOriginal();
  const actor = () => (session.userId ? { id: session.userId, email: "", name: "", role: session.role } : null);
  return {
    ...original,
    getCurrentActor: async () => actor(),
    requireDesignerOrAdmin: async () => {
      const current = actor();
      if (!current) return { ok: false, response: Response.json({ ok: false }, { status: 401 }) };
      if (current.role === "customer") return { ok: false, response: Response.json({ ok: false }, { status: 403 }) };
      return { ok: true, actor: current };
    },
  };
});

const customerUpload = (await import("@/app/api/customizer/upload/route")).POST;
const adminAssetUpload = (await import("@/app/api/admin/customizer/assets/route")).POST;

function semver(value: string): number[] {
  return value.split(".").map((part) => Number.parseInt(part, 10) || 0);
}
function atLeast(value: string, minimum: string): boolean {
  const [a, b] = [semver(value), semver(minimum)];
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
  }
  return true;
}

function multipart(url: string, file: File, fields: Record<string, string> = {}): Request {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request(url, { method: "POST", headers: { origin: "http://localhost", host: "localhost" }, body: form });
}

async function photo(format: "jpeg" | "png" | "webp", width = 2400, height = 1600): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 4, background: { r: 30, g: 120, b: 200, alpha: format === "png" ? 0.6 : 1 } } }).composite([
    { input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><circle cx="${width / 2}" cy="${height / 2}" r="${height / 3}" fill="#D4AF37"/></svg>`), top: 0, left: 0 },
  ]);
  if (format === "jpeg") {
    // Carry real EXIF (camera + GPS-style comment) so stripping can be proven.
    return base.jpeg({ quality: 90 }).withExif({ IFD0: { Make: "PrivateCam", ImageDescription: "GPS 23.81N 90.41E" } }).toBuffer();
  }
  return format === "png" ? base.png().toBuffer() : base.webp({ quality: 90 }).toBuffer();
}

describe("sharp is the patched release everywhere", () => {
  it("the installed and loaded sharp is 0.35.5 or newer", () => {
    const installed = JSON.parse(readFileSync(join(process.cwd(), "node_modules/sharp/package.json"), "utf8")).version;
    expect(atLeast(installed, "0.35.5")).toBe(true);
    expect(atLeast(String((sharp.versions as Record<string, string>).sharp), "0.35.5")).toBe(true);
  });

  it("the lockfile holds no sharp or @img/sharp-* package below 0.35.5", () => {
    const lock = JSON.parse(readFileSync(join(process.cwd(), "package-lock.json"), "utf8"));
    const entries = Object.entries<Record<string, string>>(lock.packages || {}).filter(([path]) => /(^|\/)node_modules\/(sharp|@img\/sharp-(?!libvips)[^/]+)$/.test(path));
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, meta] of entries) expect(atLeast(meta.version, "0.35.5"), `${path}@${meta.version}`).toBe(true);
    expect(lock.packages[""].dependencies.sharp).toMatch(/^\^?0\.35\.(5|[6-9]|\d{2,})/);
  });
});

describe("customer upload pipeline on patched sharp", () => {
  beforeEach(() => {
    store = createMemorySupabase();
    session.userId = CUSTOMER_ID;
    session.role = "customer";
  });

  for (const [format, mime, extension] of [["jpeg", "image/jpeg", "jpg"], ["png", "image/png", "png"], ["webp", "image/webp", "webp"]] as const) {
    it(`accepts a ${format.toUpperCase()} photo and stores a decodable original, editor and thumbnail`, async () => {
      const bytes = await photo(format);
      const response = await customerUpload(multipart("http://localhost/api/customizer/upload", new File([new Uint8Array(bytes)], `holiday.${extension}`, { type: mime })));
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.file.assetId).toBeTruthy();

      const stored = [...store.objects.entries()];
      expect(stored).toHaveLength(3);
      const original = stored.find(([key]) => key.endsWith(`/original.${extension}`))![1];
      const editor = stored.find(([key]) => key.endsWith("/editor.webp"))![1];
      const thumb = stored.find(([key]) => key.endsWith("/thumb.webp"))![1];
      expect(stored.every(([key]) => key.startsWith(`customer-uploads/${CUSTOMER_ID}/`))).toBe(true);

      const [originalMeta, editorMeta, thumbMeta] = await Promise.all([sharp(original.data).metadata(), sharp(editor.data).metadata(), sharp(thumb.data).metadata()]);
      expect(originalMeta.format).toBe(format);
      expect([originalMeta.width, originalMeta.height]).toEqual([2400, 1600]);
      expect(editorMeta.format).toBe("webp");
      expect(Math.max(editorMeta.width!, editorMeta.height!)).toBe(1600);
      expect(Math.max(thumbMeta.width!, thumbMeta.height!)).toBe(384);
      // Metadata (camera, GPS) is removed from the stored original.
      expect(originalMeta.exif).toBeUndefined();
      expect(original.data.includes(Buffer.from("PrivateCam"))).toBe(false);
      // The variants carry real artwork, not a flat tile.
      const stats = await sharp(editor.data).stats();
      expect(Math.max(...stats.channels.map((channel) => channel.stdev))).toBeGreaterThan(1);
      // Signed URLs are returned for display, but the durable paths are what is recorded.
      expect(store.table("customer_asset_library")[0]).toMatchObject({ user_id: CUSTOMER_ID, editor_path: expect.stringMatching(/editor\.webp$/), thumbnail_path: expect.stringMatching(/thumb\.webp$/) });
    });
  }

  it("applies EXIF orientation before building the variants", async () => {
    const rotated = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#336699" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const response = await customerUpload(multipart("http://localhost/api/customizer/upload", new File([new Uint8Array(rotated)], "portrait.jpg", { type: "image/jpeg" })));
    expect(response.status).toBe(200);
    const editor = [...store.objects.entries()].find(([key]) => key.endsWith("/editor.webp"))![1];
    const meta = await sharp(editor.data).metadata();
    expect([meta.width, meta.height]).toEqual([400, 800]);
  });

  it("rejects a non-image disguised with an image name and MIME type", async () => {
    const response = await customerUpload(multipart("http://localhost/api/customizer/upload", new File(["<html><script>alert(1)</script></html>"], "photo.jpg", { type: "image/jpeg" })));
    expect(response.status).toBe(400);
    expect(store.objects.size).toBe(0);
  });

  it("rejects an SVG on the customer path (raster only)", async () => {
    const response = await customerUpload(multipart("http://localhost/api/customizer/upload", new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'], "art.png", { type: "image/png" })));
    expect(response.status).toBe(400);
  });

  it("rejects a truncated image that has valid magic bytes", async () => {
    const full = await photo("png", 600, 600);
    const response = await customerUpload(multipart("http://localhost/api/customizer/upload", new File([new Uint8Array(full.subarray(0, 400))], "cut.png", { type: "image/png" })));
    expect(response.status).toBe(400);
    expect(store.objects.size).toBe(0);
  });

  it("refuses a decompression bomb by its declared dimensions before decoding pixels", async () => {
    // A tiny PNG whose header declares 20000 x 20000 (400 MP): the shape of a
    // compression bomb. It must be refused from the header alone.
    const bomb = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ffffff" } }).png().toBuffer();
    bomb.writeUInt32BE(20000, 16);
    bomb.writeUInt32BE(20000, 20);
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)) >>> 0, 29);
    const response = await customerUpload(multipart("http://localhost/api/customizer/upload", new File([new Uint8Array(bomb)], "bomb.png", { type: "image/png" })));
    expect(response.status).toBe(400);
    expect(store.objects.size).toBe(0);
  });
});

describe("studio asset pipeline (SVG + raster) on patched sharp", () => {
  beforeEach(() => {
    store = createMemorySupabase();
    session.userId = ADMIN_ID;
    session.role = "admin";
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><defs><linearGradient id="g"><stop offset="0" stop-color="#303839"/><stop offset="1" stop-color="#D4AF37"/></linearGradient></defs><rect width="200" height="100" fill="url(#g)"/><path d="M10 90 L100 10 L190 90 Z" fill="#ffffff"/></svg>`;

  it("sanitizes an SVG and rasterizes decodable editor and thumbnail variants", async () => {
    const response = await adminAssetUpload(multipart("http://localhost/api/admin/customizer/assets", new File([svg], "ornament.svg", { type: "image/svg+xml" }), { assetType: "element" }));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body.asset).toBeTruthy();
    const row = store.table("customizer_assets")[0];
    expect(row.mime_type).toBe("image/svg+xml");
    expect(row.asset_type).toBe("svg");

    const objects = [...store.objects.entries()];
    const original = objects.find(([key]) => key.includes("/original/"))![1];
    expect(original.contentType).toBe("image/svg+xml");
    const thumbnail = objects.find(([key]) => key === `customizer-elements/${row.thumbnail_path}` || key.endsWith(row.thumbnail_path))![1];
    const thumbMeta = await sharp(thumbnail.data).metadata();
    expect(thumbMeta.format).toBe("webp");
    expect(thumbMeta.width).toBeGreaterThan(0);
    const editor = objects.find(([key]) => key.endsWith(row.editor_path))![1];
    // The SVG editor variant decodes (vector source rendered by librsvg in sharp).
    expect((await sharp(editor.data).metadata()).width).toBeGreaterThan(0);
  });

  for (const [label, hostile] of [
    ["a script", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`],
    ["an event handler", `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" onload="alert(1)"/></svg>`],
    ["an external image", `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://evil.test/x.png" width="5" height="5"/></svg>`],
    ["an external stylesheet url()", `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" style="fill:url(https://evil.test/a)"/></svg>`],
    ["an XML entity", `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>`],
  ] as const) {
    it(`rejects an SVG carrying ${label} before anything is stored`, async () => {
      const response = await adminAssetUpload(multipart("http://localhost/api/admin/customizer/assets", new File([hostile], "bad.svg", { type: "image/svg+xml" })));
      expect(response.status).toBe(400);
      expect(store.objects.size).toBe(0);
    });
  }

  for (const format of ["jpeg", "png", "webp"] as const) {
    it(`builds studio variants for a ${format.toUpperCase()} asset`, async () => {
      const bytes = await photo(format, 3000, 1500);
      const response = await adminAssetUpload(multipart("http://localhost/api/admin/customizer/assets", new File([new Uint8Array(bytes)], `bg.${format}`, { type: `image/${format}` }), { assetType: "background" }));
      expect(response.status).toBe(201);
      const row = store.table("customizer_assets")[0];
      const editor = [...store.objects.entries()].find(([key]) => key.endsWith(row.editor_path))![1];
      const thumb = [...store.objects.entries()].find(([key]) => key.endsWith(row.thumbnail_path))![1];
      expect((await sharp(editor.data).metadata()).width).toBe(2400);
      expect((await sharp(thumb.data).metadata()).width).toBe(480);
    });
  }

  it("refuses the studio library to a customer", async () => {
    session.role = "customer";
    const response = await adminAssetUpload(multipart("http://localhost/api/admin/customizer/assets", new File([svg], "ornament.svg", { type: "image/svg+xml" })));
    expect(response.status).toBe(403);
    expect(store.objects.size).toBe(0);
  });
});
