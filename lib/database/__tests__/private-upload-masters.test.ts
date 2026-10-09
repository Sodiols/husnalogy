/**
 * Upload masters are server-only (supabase/migrations/20261010120000_private_upload_masters.sql).
 *
 * Runs the real schema + migrations twice: stopped just BEFORE the migration
 * (proving the gap: a customer could read their own master and an
 * administrator any studio master straight from Storage), and with it
 * (proving the fix, and that every other permission is unchanged).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { USERS, seedCheckoutFixtures } from "@/lib/testing/checkout-fixtures";

const MIGRATION = "20261010120000_private_upload_masters.sql";
const A = USERS.customerA;
const B = USERS.customerB;
const DESIGNER = USERS.designer;
const ADMIN = USERS.admin;
type Actor = "anon" | "A" | "B" | "designer" | "admin" | "service";

const customerFolder = `${A.id}/customizer/card/1760000000000-photo`;
const OBJECTS = {
  customerOriginal: ["customer-uploads", `${customerFolder}/original.jpg`],
  customerEditor: ["customer-uploads", `${customerFolder}/editor.webp`],
  customerMaster: ["customer-uploads", `${customerFolder}/master.jpg`],
  // A customer photo literally named "master" is not a master.
  customerNamedMaster: ["customer-uploads", `${A.id}/customizer/card/1760000000001-master/original.jpg`],
  studioOriginal: ["customizer-elements", "assets/7d7d7d7d-0000-4000-8000-000000000001/original/couple.jpg"],
  studioEditor: ["customizer-elements", "assets/7d7d7d7d-0000-4000-8000-000000000001/editor/editor-abc.webp"],
  studioMaster: ["customizer-elements", "assets/7d7d7d7d-0000-4000-8000-000000000001/master/couple.jpg"],
} as const;

async function database(stopBefore?: string) {
  const t = await createTestDatabase(process.cwd(), stopBefore);
  await seedCheckoutFixtures(t);
  for (const [bucket, name] of Object.values(OBJECTS)) {
    await t.db.query("insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)", [bucket, name, bucket === "customer-uploads" ? A.id : ADMIN.id]);
  }
  return t;
}

function as<T>(t: TestDatabase, actor: Actor, work: (db: TestDatabase["db"]) => Promise<T>) {
  if (actor === "anon") return t.asAnon(work);
  if (actor === "service") return t.asService(work);
  const user = { A, B, designer: DESIGNER, admin: ADMIN }[actor];
  return t.asUser(user.id, user.email, work);
}

async function canRead(t: TestDatabase, actor: Actor, key: keyof typeof OBJECTS): Promise<boolean> {
  const [bucket, name] = OBJECTS[key];
  try {
    const result = await as(t, actor, (db) => db.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name]));
    return result.rows.length === 1;
  } catch {
    return false;
  }
}

async function canDelete(t: TestDatabase, actor: Actor, key: keyof typeof OBJECTS): Promise<boolean> {
  const [bucket, name] = OBJECTS[key];
  try {
    const result: any = await as(t, actor, (db) => db.query("delete from storage.objects where bucket_id = $1 and name = $2 returning 1", [bucket, name]));
    return result.rows.length === 1;
  } catch {
    return false;
  }
}

let before: TestDatabase;
let after: TestDatabase;
beforeAll(async () => {
  [before, after] = await Promise.all([database(MIGRATION), database()]);
}, 240_000);
afterAll(async () => {
  await Promise.all([before?.close(), after?.close()]);
});

describe("before the migration (the gap)", () => {
  it("a customer can read their own master, an administrator any studio master", async () => {
    expect(await canRead(before, "A", "customerMaster")).toBe(true);
    expect(await canRead(before, "admin", "customerMaster")).toBe(true);
    expect(await canRead(before, "admin", "studioMaster")).toBe(true);
  });
});

describe("after the migration", () => {
  it("no browser role can read a master; the server (service role) can", async () => {
    for (const actor of ["anon", "A", "B", "designer", "admin"] as const) {
      expect(await canRead(after, actor, "customerMaster"), `${actor} customer master`).toBe(false);
      expect(await canRead(after, actor, "studioMaster"), `${actor} studio master`).toBe(false);
    }
    expect(await canRead(after, "service", "customerMaster")).toBe(true);
    expect(await canRead(after, "service", "studioMaster")).toBe(true);
  });

  it("every other read is exactly as before", async () => {
    for (const actor of ["anon", "A", "B", "designer", "admin"] as const) {
      for (const key of ["customerOriginal", "customerEditor", "customerNamedMaster", "studioOriginal", "studioEditor"] as const) {
        expect(await canRead(after, actor, key), `${actor} ${key}`).toBe(await canRead(before, actor, key));
      }
    }
    // Spot-check the expected shape of that unchanged matrix.
    expect(await canRead(after, "A", "customerOriginal")).toBe(true);
    expect(await canRead(after, "B", "customerOriginal")).toBe(false);
    expect(await canRead(after, "admin", "studioOriginal")).toBe(true);
    expect(await canRead(after, "designer", "studioOriginal")).toBe(false);
  });

  it("administrators can no longer delete or overwrite a studio master from the browser", async () => {
    expect(await canDelete(after, "admin", "studioMaster")).toBe(false);
    const [, name] = OBJECTS.studioMaster;
    let inserted = true;
    try {
      await as(after, "admin", (db) => db.query("insert into storage.objects (bucket_id, name, owner) values ('customizer-elements', $1, $2)", [name.replace("couple", "other"), ADMIN.id]));
    } catch {
      inserted = false;
    }
    expect(inserted).toBe(false);
    // Non-master studio objects are still theirs to manage.
    expect(await canDelete(after, "admin", "studioEditor")).toBe(true);
  });

  it("recognises master paths precisely", async () => {
    const check = async (bucket: string, name: string) =>
      (await after.db.query<{ m: boolean }>("select public.is_private_upload_master($1, $2) as m", [bucket, name])).rows[0].m;
    expect(await check("customer-uploads", `${customerFolder}/master.jpg`)).toBe(true);
    expect(await check("customer-uploads", `${customerFolder}/master.webp`)).toBe(true);
    expect(await check("customer-uploads", `${customerFolder}/original.jpg`)).toBe(false);
    expect(await check("customer-uploads", `${A.id}/x/1-master/original.jpg`)).toBe(false);
    expect(await check("customizer-elements", "assets/abc/master/x.jpg")).toBe(true);
    expect(await check("customizer-elements", "assets/abc/original/master.jpg")).toBe(false);
    expect(await check("order-production", `${customerFolder}/master.jpg`)).toBe(false);
  });
});
