/**
 * POST /api/admin/uploads through the REAL admin-mutation wrapper: the limit
 * the route declares is the limit it enforces (Phase 8), and every file is
 * identified, decoded and re-encoded from its bytes (Phase 9).
 */
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySupabase, type MemorySupabase } from "@/lib/testing/memory-supabase";
import { ADMIN_MEDIA_MAX_REQUEST_BYTES, ADMIN_VIDEO_MAX_BYTES } from "@/lib/uploads/admin-media";

let store: MemorySupabase;
const session: { role: "admin" | "designer" | "customer" | null } = { role: "admin" };

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => store.client, createClient: async () => store.client }));
vi.mock("@/lib/auth/roles", async (importOriginal) => {
  const original: any = await importOriginal();
  const actor = () => (session.role ? { id: "11111111-1111-4111-8111-111111111111", email: "", name: "", role: session.role } : null);
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

let POST: (request: Request) => Promise<Response>;
beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role";
  POST = (await import("@/app/api/admin/uploads/route")).POST;
});

beforeEach(() => {
  store = createMemorySupabase();
  session.role = "admin";
});

const box = (type: string, payload: Buffer) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
};
const mp4OfSize = (total: number) => {
  const head = Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0isomiso2", "latin1")), box("moov", Buffer.alloc(64, 1))]);
  return Buffer.concat([head, box("mdat", Buffer.alloc(total - head.length - 8, 7))]);
};

function upload(folder: string, files: Array<{ bytes: Buffer; name: string; type: string }>) {
  const form = new FormData();
  form.set("folder", folder);
  for (const file of files) form.append("files", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  return POST(new Request("http://localhost/api/admin/uploads", { method: "POST", headers: { origin: "http://localhost", host: "localhost" }, body: form }));
}

describe("declared and enforced limits agree", () => {
  it("accepts a video just under the declared video limit", async () => {
    const response = await upload("product-videos", [{ bytes: mp4OfSize(ADMIN_VIDEO_MAX_BYTES - 1024), name: "teaser.mp4", type: "video/mp4" }]);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const [stored] = [...store.objects.values()];
    expect(stored.contentType).toBe("video/mp4");
  }, 60_000);

  it("refuses a video over the declared limit with that limit in the message", async () => {
    const response = await upload("product-videos", [{ bytes: mp4OfSize(ADMIN_VIDEO_MAX_BYTES + 1024), name: "long.mp4", type: "video/mp4" }]);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("30 MB");
    expect(store.objects.size).toBe(0);
  }, 60_000);

  it("refuses a request over the request limit with a message that states the real limits", async () => {
    const response = await upload("product-videos", [{ bytes: Buffer.alloc(ADMIN_MEDIA_MAX_REQUEST_BYTES + 1024, 1), name: "huge.mp4", type: "video/mp4" }]);
    expect(response.status).toBe(413);
    const { error } = await response.json();
    expect(error).toContain("35 MB");
    expect(error).toContain("30 MB");
    expect(error).not.toMatch(/120|150/);
  }, 60_000);
});

describe("media is identified by its bytes", () => {
  it("a PNG sent as photo.jpg / image/jpeg is stored as PNG, re-encoded, with a .png name", async () => {
    const png = await sharp({ create: { width: 640, height: 480, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
    const response = await upload("product-images", [{ bytes: png, name: "photo.jpg", type: "image/jpeg" }]);
    expect(response.status).toBe(200);
    const [[key, stored]] = [...store.objects.entries()];
    expect(stored.contentType).toBe("image/png");
    expect(key.endsWith(".png")).toBe(true);
    expect((await sharp(stored.data).metadata()).format).toBe("png");
  });

  it("an HTML or SVG payload named like an image or video is refused and nothing is stored", async () => {
    for (const [folder, name, type, body] of [
      ["product-images", "x.jpg", "image/jpeg", "<html><script>alert(1)</script></html>"],
      ["product-mockups", "x.png", "image/png", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'],
      ["product-videos", "x.mp4", "video/mp4", "<html><script>alert(1)</script></html>"],
    ] as const) {
      const response = await upload(folder, [{ bytes: Buffer.from(body.padEnd(64, " ")), name, type }]);
      expect(response.status, `${folder}/${name}`).toBe(400);
    }
    expect(store.objects.size).toBe(0);
  });

  it("one bad file in a batch stores nothing at all", async () => {
    const good = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const response = await upload("product-mockups", [
      { bytes: good, name: "a.jpg", type: "image/jpeg" },
      { bytes: Buffer.from("not an image at all, just text padding....."), name: "b.jpg", type: "image/jpeg" },
    ]);
    expect(response.status).toBe(400);
    expect(store.objects.size).toBe(0);
  });

  it("designers may upload product media; customers may not", async () => {
    const good = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    session.role = "designer";
    expect((await upload("product-images", [{ bytes: good, name: "a.jpg", type: "image/jpeg" }])).status).toBe(200);
    session.role = "customer";
    expect((await upload("product-images", [{ bytes: good, name: "a.jpg", type: "image/jpeg" }])).status).toBe(403);
    session.role = null;
    expect((await upload("product-images", [{ bytes: good, name: "a.jpg", type: "image/jpeg" }])).status).toBe(401);
  });
});
