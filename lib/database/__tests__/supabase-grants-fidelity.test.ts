/**
 * SECURITY POSTURE under Supabase's REAL default privileges, on real
 * PostgreSQL 17.
 *
 * A Supabase project grants anon, authenticated and service_role ALL on every
 * table, sequence and function created in `public` (its default privileges
 * for the postgres role). Row Level Security is therefore the ONLY barrier
 * for table access, and a function is callable by anon unless a migration
 * revokes it from anon explicitly — revoking from PUBLIC is not enough. The
 * plain test scaffold does not reproduce those grants, so a "refused" there
 * may be a missing grant rather than a policy. This suite applies the
 * Supabase defaults BEFORE the migrations and then proves, with real roles and
 * JWT claims:
 *
 *   - every public table has RLS enabled;
 *   - every SECURITY DEFINER function pins search_path, and the ones anon or
 *     authenticated can execute are an explicit, reviewed allowlist;
 *   - anon / customers / designers change NO row they do not own in ANY
 *     table (updates and deletes affect 0 rows; forged inserts are refused);
 *   - the Storage write/read matrix per bucket and role matches the design.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type PostgresServer, type RoleClient } from "@/lib/testing/postgres-server";
import { IDS, USERS, callCheckoutRpc, orderPayload, seedCheckoutFixtures, type SqlDatabase } from "@/lib/testing/checkout-fixtures";
import { applyMigrations, migrationPlan } from "../../../scripts/staging/apply-migrations.mjs";

const SUPABASE_DEFAULT_PRIVILEGES = `
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
`;

/**
 * SECURITY DEFINER functions anon/authenticated may execute, and why each is safe.
 * Trigger functions are excluded automatically (they cannot be called directly).
 */
const CALLABLE_DEFINER_ALLOWLIST: Record<string, { roles: Array<"anon" | "authenticated">; why: string }> = {
  current_user_role: { roles: ["anon", "authenticated"], why: "returns the caller's own role (read-only)" },
  is_admin: { roles: ["anon", "authenticated"], why: "boolean about the caller (read-only), used by policies" },
  is_designer: { roles: ["anon", "authenticated"], why: "boolean about the caller (read-only), used by policies" },
  customizer_template_is_public: { roles: ["anon", "authenticated"], why: "boolean: is a template published (read-only), used by policies" },
  upsert_customizer_mockup: { roles: ["authenticated"], why: "raises unless service_role or is_admin()" },
};

const A = USERS.customerA;
const B = USERS.customerB;
const DESIGNER = USERS.designer;
const ADMIN = USERS.admin;
type Actor = "anon" | "A" | "B" | "designer" | "admin";

let server: PostgresServer;
const clients: Partial<Record<Actor, RoleClient>> = {};
let orderId = "";

beforeAll(async () => {
  server = await startPostgres(undefined, { migrate: false });
  await server.owner.query(SUPABASE_DEFAULT_PRIVILEGES);
  const migrated = await applyMigrations(server.owner, migrationPlan(), () => undefined);
  expect(migrated.failed).toBeNull();
  const service = await server.connect();
  await service.as("service_role");
  const t: SqlDatabase = { db: server.owner, asService: (work) => work(service) };
  await seedCheckoutFixtures(t);
  const payload = await orderPayload(t);
  orderId = String((await callCheckoutRpc(t, payload)).order_id || payload.order.id);
  await server.owner.query("insert into public.customer_addresses (user_id, full_name, phone, address_line1, city, is_default) values ($1, 'Synthetic', '+8801700000000', 'House 1', 'Dhaka', true)", [A.id]);
  await server.owner.query(
    "insert into storage.objects (bucket_id, name) select b.id, $1 || '/seed.png' from storage.buckets b",
    [A.id],
  );
  for (const [actor, user] of [["anon", null], ["A", A], ["B", B], ["designer", DESIGNER], ["admin", ADMIN]] as const) {
    const client = await server.connect();
    await client.as(user ? "authenticated" : "anon", user ? { sub: user.id, email: user.email } : {});
    clients[actor] = client;
  }
}, 300_000);
afterAll(async () => server?.stop());

const as = (actor: Actor) => clients[actor]!;

describe("Supabase default privileges + migrations: database posture", () => {
  it("every public table has row level security enabled", async () => {
    const rows = (await server.owner.query("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity")).rows;
    expect(rows.map((row) => row.relname)).toEqual([]);
    // Control: the Supabase defaults are in force, so grants alone stop nothing.
    // (Some tables revoke further, e.g. customer_addresses from anon — extra layers, not counted on.)
    const grants = (await server.owner.query("select has_table_privilege('anon', 'public.orders', 'insert') as i, has_table_privilege('anon', 'public.orders', 'update') as u, has_table_privilege('anon', 'public.orders', 'delete') as d")).rows[0];
    expect(grants).toEqual({ i: true, u: true, d: true });
  });

  it("every SECURITY DEFINER function pins search_path; anon/authenticated can execute only the reviewed allowlist", async () => {
    const functions = (await server.owner.query(`
      select p.proname, p.proconfig, p.prorettype = 'trigger'::regtype as is_trigger,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef`)).rows;
    expect(functions.length).toBeGreaterThan(20);
    expect(functions.filter((fn) => !(fn.proconfig || []).some((setting: string) => setting.startsWith("search_path="))).map((fn) => fn.proname)).toEqual([]);
    const exposed: string[] = [];
    for (const fn of functions.filter((candidate) => !candidate.is_trigger)) {
      for (const role of ["anon", "authenticated"] as const) {
        if (fn[role] && !CALLABLE_DEFINER_ALLOWLIST[fn.proname]?.roles.includes(role)) exposed.push(`${fn.proname} → ${role}`);
      }
    }
    expect(exposed).toEqual([]);
  });
});

describe("Supabase default privileges + migrations: no actor changes rows it does not own", () => {
  it("anon, customer B and a designer update or delete NO row they do not own, in EVERY table (RLS is the only barrier here)", async () => {
    const tables = (await server.owner.query(`
      select c.relname, (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped order by a.attnum limit 1) as first_column
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows;
    const ownerId: Record<string, string> = { anon: "", B: B.id, designer: DESIGNER.id };
    const owns = (table: string, row: Record<string, unknown>, id: string) =>
      Boolean(id) && (row.user_id === id || row.customer_id === id || (table === "profiles" && row.id === id));
    const violations: string[] = [];
    let populated = 0;
    for (const table of tables) {
      if (Number((await server.owner.query(`select count(*) as n from public."${table.relname}"`)).rows[0].n) > 0) populated += 1;
      for (const actor of ["anon", "B", "designer"] as const) {
        for (const sql of [
          `update public."${table.relname}" t set "${table.first_column}" = t."${table.first_column}" returning to_jsonb(t.*) as r`,
          `delete from public."${table.relname}" t returning to_jsonb(t.*) as r`,
        ]) {
          try {
            await as(actor).query("begin");
            const foreign = (await as(actor).query(sql)).rows.filter((row) => !owns(table.relname, row.r, ownerId[actor]));
            if (foreign.length) violations.push(`${actor}: ${sql.split(" ")[0]} ${table.relname} → ${foreign.length} row(s) of others`);
          } catch {
            // refused by a policy or a guard trigger: nothing changed
          } finally {
            await as(actor).query("rollback");
          }
        }
      }
    }
    expect(violations).toEqual([]);
    // Control: the same statements DO reach rows the actor owns.
    await as("A").query("begin");
    const own = await as("A").query("update public.cart_items t set quantity = t.quantity returning to_jsonb(t.*) as r");
    await as("A").query("rollback");
    expect(own.rows.length).toBeGreaterThan(0);
    expect(own.rows.every((row) => row.r.user_id === A.id)).toBe(true);
    // Coverage: the matrix ran against populated tables, not only empty ones.
    expect(populated).toBeGreaterThanOrEqual(15);
  }, 240_000);

  it("forged inserts are refused: orders, order assets, tasks, template versions, products, settings, another customer's rows, a privileged profile", async () => {
    const forged: Array<[Actor, string, unknown[]]> = [
      ["A", "insert into public.orders (id, customer_id, customer_name, customer_email, total, status) values ('order-forged', $1, 'x', 'x@example.com', 1, 'pending')", [A.id]],
      ["A", "insert into public.order_production_assets (snapshot_id, order_id, asset_key, bucket, path, checksum, size_bytes, mime_type, kind) select id, order_id, repeat('a', 64), 'order-production', 'p', repeat('a', 64), 1, 'image/png', 'image' from public.order_design_snapshots limit 1", []],
      ["A", "insert into public.production_tasks (order_id) values ($1)", [orderId]],
      ["designer", "insert into public.customizer_template_versions (template_id, product_id, version, major_version, minor_revision, document) values ($1, 'product-active', 99, 99, 0, '{}')", [IDS.templateActive]],
      ["designer", "insert into public.products (id, slug, title, status) values ('forged', 'forged', 'Forged', 'active')", []],
      ["A", "insert into public.site_settings (id, settings) values ('forged', '{}')", []],
      ["B", "insert into public.customer_addresses (user_id, full_name, phone, address_line1, city) values ($1, 'x', 'x', 'x', 'x')", [A.id]],
      ["B", "insert into public.product_customizations (user_id, product_id, template_id, template_version, status) values ($1, 'product-active', $2, 1, 'draft')", [A.id, IDS.templateActive]],
      ["anon", "insert into public.profiles (id, email, role) values (gen_random_uuid(), 'x@example.com', 'admin')", []],
      ["B", "insert into public.profiles (id, email, role) values (gen_random_uuid(), 'x@example.com', 'admin')", []],
      ["anon", "insert into public.cart_items (user_id, product_id, product_slug, product_title, quantity, unit_price) values ($1, 'product-active', 'p', 'p', 1, 1)", [A.id]],
    ];
    const accepted: string[] = [];
    for (const [actor, sql, params] of forged) {
      try {
        await as(actor).query("begin");
        await as(actor).query(sql, params);
        accepted.push(`${actor}: ${sql.slice(0, 70)}`);
      } catch {
        // refused
      } finally {
        await as(actor).query("rollback");
      }
    }
    expect(accepted).toEqual([]);
  });
});

describe("Supabase Storage policies (storage.objects RLS) per bucket and role", () => {
  const PUBLIC_MEDIA = ["product-images", "product-mockups", "product-videos", "site-assets"];
  const ADMIN_ONLY = ["admin-assets", "customizer-elements"];
  const SERVICE_ONLY = ["customer-avatars", "customizer-renders", "order-production"];

  async function can(actor: Actor, sql: string, params: unknown[]): Promise<boolean> {
    try {
      await as(actor).query("begin");
      const result = await as(actor).query(sql, params);
      return (result.rowCount || 0) > 0;
    } catch {
      return false;
    } finally {
      await as(actor).query("rollback");
    }
  }
  const read = (actor: Actor, bucket: string) => can(actor, "select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, `${A.id}/seed.png`]);
  const write = (actor: Actor, bucket: string, owner = A.id) => can(actor, "insert into storage.objects (bucket_id, name) values ($1, $2) returning 1", [bucket, `${owner}/new-${Math.random()}.png`]);
  const change = (actor: Actor, bucket: string) => can(actor, "update storage.objects set name = name where bucket_id = $1 and name = $2 returning 1", [bucket, `${A.id}/seed.png`]);
  const remove = (actor: Actor, bucket: string) => can(actor, "delete from storage.objects where bucket_id = $1 and name = $2 returning 1", [bucket, `${A.id}/seed.png`]);

  it("public catalogue media: everyone reads, only admins write, change or delete", async () => {
    for (const bucket of PUBLIC_MEDIA) {
      for (const actor of ["anon", "A", "B", "designer", "admin"] as const) expect(await read(actor, bucket), `${actor} reads ${bucket}`).toBe(true);
      for (const actor of ["anon", "A", "B", "designer"] as const) {
        expect(await write(actor, bucket), `${actor} uploads to ${bucket}`).toBe(false);
        expect(await change(actor, bucket), `${actor} overwrites in ${bucket}`).toBe(false);
        expect(await remove(actor, bucket), `${actor} deletes from ${bucket}`).toBe(false);
      }
      expect(await write("admin", bucket)).toBe(true);
    }
  });

  it("admin asset buckets: admins only — not customers, guests or designers", async () => {
    for (const bucket of ADMIN_ONLY) {
      for (const actor of ["anon", "A", "B", "designer"] as const) {
        expect([await read(actor, bucket), await write(actor, bucket), await change(actor, bucket), await remove(actor, bucket)], `${actor} on ${bucket}`).toEqual([false, false, false, false]);
      }
      expect([await read("admin", bucket), await write("admin", bucket)]).toEqual([true, true]);
    }
  });

  it("avatars, renders and production files: no browser role at all (server/service role only)", async () => {
    for (const bucket of SERVICE_ONLY) {
      for (const actor of ["anon", "A", "B", "designer", "admin"] as const) {
        expect([await read(actor, bucket), await write(actor, bucket), await change(actor, bucket), await remove(actor, bucket)], `${actor} on ${bucket}`).toEqual([false, false, false, false]);
      }
    }
  });

  it("customer uploads: the owner (and an admin) read their folder; nobody uploads directly; other customers and guests see nothing", async () => {
    expect(await read("A", "customer-uploads")).toBe(true);
    expect(await read("admin", "customer-uploads")).toBe(true);
    for (const actor of ["anon", "B", "designer"] as const) expect(await read(actor, "customer-uploads"), `${actor} reads A's photo`).toBe(false);
    for (const actor of ["anon", "A", "B", "designer"] as const) {
      expect(await write(actor, "customer-uploads", A.id), `${actor} uploads into A's folder`).toBe(false);
      expect(await change(actor, "customer-uploads"), `${actor} rewrites A's photo`).toBe(false);
    }
    for (const actor of ["anon", "B", "designer"] as const) expect(await remove(actor, "customer-uploads"), `${actor} deletes A's photo`).toBe(false);
    // The owner may delete their own upload record (production uses pinned copies in order-production).
    expect(await remove("A", "customer-uploads")).toBe(true);
  });
});
