/**
 * /api/account/* — saved addresses, profile and profile photo — end to end:
 * the REAL route handlers, the REAL schema + migrations (PGlite), queries run
 * as the signed-in customer's `authenticated` role so Row Level Security is
 * what decides, and real Sharp for the photo pipeline.
 *
 * Shared-browser threat model: customer A and customer B use the same
 * browser one after the other. Nothing of A's may ever be readable or
 * changeable by B.
 */
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { createRestClient } from "@/lib/testing/pglite-rest-client";
import { USERS } from "@/lib/testing/checkout-fixtures";

const A = USERS.customerA;
const B = USERS.customerB;

const env = vi.hoisted(() => ({ t: null as any, session: null as null | { id: string; email: string }, objects: new Map<string, { data: Buffer; contentType: string }>() }));

vi.mock("@/lib/supabase/server", async () => {
  const { createRestClient: rest } = await import("@/lib/testing/pglite-rest-client");
  return {
    createClient: async () => {
      const user = env.session;
      const client = user ? rest(env.t, { kind: "user", id: user.id, email: user.email }, env.objects) : null;
      return {
        auth: { getUser: async () => ({ data: { user: user ? { id: user.id, email: user.email } : null }, error: null }) },
        from: (table: string) => {
          if (!client) throw new Error("anonymous query in an account route");
          return client.from(table);
        },
      };
    },
    createServiceRoleClient: () => rest(env.t, { kind: "service" }, env.objects),
  };
});

const addresses = await import("@/app/api/account/addresses/route");
const address = await import("@/app/api/account/addresses/[id]/route");
const profile = await import("@/app/api/account/profile/route");
const avatar = await import("@/app/api/account/avatar/route");

const SAME_ORIGIN = { origin: "http://localhost", host: "localhost" };
const json = (method: string, url: string, body?: unknown, headers: Record<string, string> = SAME_ORIGIN) =>
  new Request(`http://localhost${url}`, { method, headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (user: { id: string; email: string } | null) => {
  env.session = user;
};
const read = async (response: Response) => ({ status: response.status, body: await response.json() });

const A_ADDRESS = { fullName: "Ayesha Rahman", phone: "+8801711000001", addressLine1: "House 12, Road 5, Banani", city: "Dhaka", area: "Banani", postalCode: "1213" };

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  env.t = t;
  for (const user of Object.values(USERS)) {
    await t.db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [user.id, user.email]);
  }
}, 120_000);
afterAll(() => t?.close());
beforeEach(() => as(null));

describe("saved addresses belong to one account", () => {
  let aAddressId = "";

  it("A saves an address; it becomes A's default", async () => {
    as(A);
    const created = await read(await addresses.POST(json("POST", "/api/account/addresses", A_ADDRESS)));
    expect(created.status).toBe(201);
    expect(created.body.address).toMatchObject({ fullName: "Ayesha Rahman", city: "Dhaka", isDefault: true });
    aAddressId = created.body.address.id;
    const listed = await read(await addresses.GET());
    expect(listed.body.addresses.map((entry: any) => entry.id)).toEqual([aAddressId]);
  });

  it("B on the same browser sees none of A's addresses, and cannot edit or delete them", async () => {
    as(B);
    expect((await read(await addresses.GET())).body.addresses).toEqual([]);
    expect((await read(await address.PATCH(json("PATCH", `/api/account/addresses/${aAddressId}`, { phone: "+8801999999999" }), params(aAddressId)))).status).toBe(404);
    expect((await read(await address.PATCH(json("PATCH", `/api/account/addresses/${aAddressId}`, { isDefault: true }), params(aAddressId)))).status).toBe(404);
    expect((await read(await address.DELETE(json("DELETE", `/api/account/addresses/${aAddressId}`), params(aAddressId)))).status).toBe(404);
    const row = (await t.db.query<any>("select phone, is_default from public.customer_addresses where id = $1", [aAddressId])).rows[0];
    expect(row).toEqual({ phone: "+8801711000001", is_default: true });
  });

  it("B cannot plant an address in A's account by sending an owner", async () => {
    as(B);
    const created = await read(await addresses.POST(json("POST", "/api/account/addresses", { ...A_ADDRESS, userId: A.id, user_id: A.id })));
    expect(created.status).toBe(201);
    const owner = (await t.db.query<any>("select user_id from public.customer_addresses where id = $1", [created.body.address.id])).rows[0].user_id;
    expect(owner).toBe(B.id);
    as(A);
    expect((await read(await addresses.GET())).body.addresses).toHaveLength(1);
  });

  it("A edits, adds a second address, moves the default, and deletes — keeping one default", async () => {
    as(A);
    expect((await read(await address.PATCH(json("PATCH", `/api/account/addresses/${aAddressId}`, { city: "Chattogram" }), params(aAddressId)))).body.address.city).toBe("Chattogram");
    const second = (await read(await addresses.POST(json("POST", "/api/account/addresses", { ...A_ADDRESS, addressLine1: "Flat 3B, Gulshan 2" })))).body.address;
    expect(second.isDefault).toBe(false);
    await address.PATCH(json("PATCH", `/api/account/addresses/${second.id}`, { isDefault: true }), params(second.id));
    let list = (await read(await addresses.GET())).body.addresses;
    expect(list.filter((entry: any) => entry.isDefault).map((entry: any) => entry.id)).toEqual([second.id]);
    expect((await read(await address.DELETE(json("DELETE", `/api/account/addresses/${second.id}`), params(second.id)))).status).toBe(200);
    list = (await read(await addresses.GET())).body.addresses;
    expect(list.map((entry: any) => [entry.id, entry.isDefault])).toEqual([[aAddressId, true]]);
  });

  it("refuses signed-out callers, cross-site requests and invalid input", async () => {
    expect((await addresses.GET()).status).toBe(401);
    expect((await addresses.POST(json("POST", "/api/account/addresses", A_ADDRESS))).status).toBe(401);
    as(A);
    expect((await addresses.POST(json("POST", "/api/account/addresses", A_ADDRESS, { origin: "https://evil.test", host: "localhost" }))).status).toBe(403);
    expect((await addresses.POST(json("POST", "/api/account/addresses", { ...A_ADDRESS, fullName: "" }))).status).toBe(400);
    expect((await addresses.POST(json("POST", "/api/account/addresses", { ...A_ADDRESS, phone: "<script>" }))).status).toBe(400);
    expect((await address.PATCH(json("PATCH", "/api/account/addresses/not-a-uuid", { city: "x" }), params("not-a-uuid"))).status).toBe(404);
  });
});

describe("profile data belongs to one account", () => {
  it("A's phone and name are stored on A's account and never shown to B", async () => {
    as(A);
    const saved = await read(await profile.PATCH(json("PATCH", "/api/account/profile", { name: "Ayesha Rahman", phone: "+8801711000001" })));
    expect(saved.status).toBe(200);
    expect(saved.body.profile).toMatchObject({ name: "Ayesha Rahman", phone: "+8801711000001", email: A.email });

    as(B);
    const other = (await read(await profile.GET())).body.profile;
    expect(other.phone).toBe("");
    expect(other.name).not.toBe("Ayesha Rahman");
    expect(other.email).toBe(B.email);

    // A, from any device: the server copy.
    as(A);
    expect((await read(await profile.GET())).body.profile.phone).toBe("+8801711000001");
  });

  it("only name and phone are writable through the profile route (role and email are not)", async () => {
    as(B);
    await profile.PATCH(json("PATCH", "/api/account/profile", { name: "B", role: "admin", email: "x@y.z", avatar_url: "javascript:alert(1)" }));
    const row = (await t.db.query<any>("select role, email, avatar_url, full_name from public.profiles where id = $1", [B.id])).rows[0];
    expect(row).toMatchObject({ role: "customer", email: B.email, full_name: "B" });
    expect(row.avatar_url ?? "").not.toContain("javascript");
  });

  it("refuses invalid values, signed-out callers and cross-site writes", async () => {
    expect((await profile.GET()).status).toBe(401);
    as(A);
    expect((await profile.PATCH(json("PATCH", "/api/account/profile", { phone: "call me <b>" }))).status).toBe(400);
    expect((await profile.PATCH(json("PATCH", "/api/account/profile", { name: "x".repeat(121) }))).status).toBe(400);
    expect((await profile.PATCH(json("PATCH", "/api/account/profile", { name: "A" }, { origin: "https://evil.test", host: "localhost" }))).status).toBe(403);
  });
});

describe("profile photo upload", () => {
  const upload = async (bytes: Buffer, name = "me.jpg", type = "image/jpeg", headers = SAME_ORIGIN) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], name, { type }));
    return read(await avatar.POST(new Request("http://localhost/api/account/avatar", { method: "POST", headers, body: form })));
  };
  const portrait = () =>
    sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#7FA38B" } })
      .jpeg()
      .withExif({ IFD0: { Make: "PrivatePhone", ImageDescription: "GPS 23.8N 90.4E" } })
      .toBuffer();

  it("stores a validated, re-encoded 512px WebP in A's own private folder and returns a signed URL", async () => {
    as(A);
    const result = await upload(await portrait());
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.avatarUrl).toMatch(/^https:\/\/signed\.test\/customer-avatars\//);
    const path = (await t.db.query<any>("select avatar_path from public.profiles where id = $1", [A.id])).rows[0].avatar_path;
    expect(path.startsWith(`${A.id}/`)).toBe(true);
    const stored = env.objects.get(`customer-avatars/${path}`)!;
    expect(stored.contentType).toBe("image/webp");
    const meta = await sharp(stored.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);
    expect(meta.exif).toBeUndefined();
    expect(stored.data.includes(Buffer.from("PrivatePhone"))).toBe(false);

    // The photo persists: a later visit (any device) gets it back from the account.
    expect((await read(await profile.GET())).body.profile.avatarUrl).toContain(path);
  });

  it("replacing the photo removes the previous file", async () => {
    as(A);
    const before = (await t.db.query<any>("select avatar_path from public.profiles where id = $1", [A.id])).rows[0].avatar_path;
    expect((await upload(await sharp({ create: { width: 600, height: 600, channels: 3, background: "#303839" } }).png().toBuffer(), "me.png", "image/png")).status).toBe(200);
    const after = (await t.db.query<any>("select avatar_path from public.profiles where id = $1", [A.id])).rows[0].avatar_path;
    expect(after).not.toBe(before);
    expect(env.objects.has(`customer-avatars/${before}`)).toBe(false);
    expect(env.objects.has(`customer-avatars/${after}`)).toBe(true);
  });

  it("B never receives A's photo", async () => {
    as(B);
    expect((await read(await profile.GET())).body.profile.avatarUrl).toBe("");
  });

  it("refuses spoofed, truncated, oversized and bomb images, signed-out and cross-site uploads", async () => {
    as(A);
    expect((await upload(Buffer.from("<svg onload=alert(1)>"), "me.jpg", "image/jpeg")).status).toBe(400);
    const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#fff" } }).png().toBuffer();
    expect((await upload(png.subarray(0, 120), "cut.png", "image/png")).status).toBe(400);
    const bomb = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
    bomb.writeUInt32BE(30000, 16);
    bomb.writeUInt32BE(30000, 20);
    const { crc32 } = await import("node:zlib");
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)) >>> 0, 29);
    expect((await upload(bomb, "bomb.png", "image/png")).status).toBe(400);
    expect((await upload(Buffer.alloc(9 * 1024 * 1024, 1), "huge.jpg")).status).toBe(413);
    expect((await upload(await portrait(), "me.jpg", "image/jpeg", { origin: "https://evil.test", host: "localhost" })).status).toBe(403);
    as(null);
    expect((await upload(await portrait())).status).toBe(401);
  });

  it("removing the photo clears it from the account and Storage", async () => {
    as(A);
    const path = (await t.db.query<any>("select avatar_path from public.profiles where id = $1", [A.id])).rows[0].avatar_path;
    expect((await read(await avatar.DELETE(json("DELETE", "/api/account/avatar")))).status).toBe(200);
    expect((await t.db.query<any>("select avatar_path from public.profiles where id = $1", [A.id])).rows[0].avatar_path).toBeNull();
    expect(env.objects.has(`customer-avatars/${path}`)).toBe(false);
  });

  it("the database refuses a profile photo path outside the account's own folder", async () => {
    await expect(t.asUser(A.id, A.email, (db) => db.query("update public.profiles set avatar_path = $1 where id = $2", [`${B.id}/stolen.webp`, A.id]))).rejects.toThrow(/profiles_avatar_path_own_folder/);
    await expect(t.asUser(A.id, A.email, (db) => db.query("update public.profiles set avatar_url = 'javascript:alert(1)' where id = $1", [A.id]))).rejects.toThrow(/profiles_avatar_url_https/);
  });
});
