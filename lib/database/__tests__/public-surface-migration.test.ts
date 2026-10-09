/**
 * Migration 20261007150000_rls_public_surface_hardening.sql — the security
 * migration MISSING in production (probe of 2026-10-09). Real PostgreSQL 17
 * with Supabase's default privileges (anon/authenticated hold ALL on public
 * tables, so RLS and explicit revokes are the only barriers), and the schema
 * as production has it: every migration BEFORE this one.
 *
 *   before   reproduces the production finding (the public key reads the
 *            unreviewed customizer drafts; contact/newsletter accept direct
 *            anonymous inserts that bypass the API's validation)
 *   apply    the file as-is, then AGAIN (idempotent)
 *   after    drafts unreadable by guests, customers and designers through the
 *            public API; published versions still readable for public active
 *            products only; admins keep drafts and versions; the service role
 *            (every server path: product pages, studio, customizer, contact,
 *            newsletter) is unaffected; no data changed
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { startPostgres, type PostgresServer, type RoleClient } from "@/lib/testing/postgres-server";
import { IDS, USERS, seedCheckoutFixtures, type SqlDatabase } from "@/lib/testing/checkout-fixtures";
import { applyMigrations, migrationPlan } from "../../../scripts/staging/apply-migrations.mjs";

const MIGRATION = "20261007150000_rls_public_surface_hardening.sql";
const SUPABASE_DEFAULT_PRIVILEGES = `
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
`;

type Actor = "anon" | "customer" | "designer" | "admin" | "service";
let server: PostgresServer;
const clients = {} as Record<Actor, RoleClient>;
let snapshotBefore = "";

const rows = async (actor: Actor, sql: string, params: unknown[] = []) => clients[actor].query(sql, params).then((result) => result.rows.length, () => -1);
async function attempt(actor: Actor, sql: string, params: unknown[] = []) {
  const client = clients[actor];
  await client.query("begin");
  try {
    await client.query(sql, params);
    return "accepted";
  } catch {
    return "refused";
  } finally {
    await client.query("rollback");
  }
}
const dataFingerprint = async () => (await server.owner.query(`
  select md5(string_agg(t::text, '|' order by t::text)) as h from (
    select 'tpl:' || id || enabled from public.product_customizer_templates
    union all select 'ver:' || id || version from public.customizer_template_versions
    union all select 'msg:' || count(*) from public.contact_messages
    union all select 'news:' || count(*) from public.newsletter_subscribers
  ) as x(t)`)).rows[0].h;

beforeAll(async () => {
  server = await startPostgres(undefined, { migrate: false });
  await server.owner.query(SUPABASE_DEFAULT_PRIVILEGES);
  const plan = migrationPlan();
  const index = plan.findIndex((entry) => entry.name === MIGRATION);
  expect(index).toBeGreaterThan(0);
  expect((await applyMigrations(server.owner, plan.slice(0, index), () => undefined)).failed).toBeNull();
  const service = await server.connect();
  await service.as("service_role");
  const t: SqlDatabase = { db: server.owner, asService: (work) => work(service) };
  await seedCheckoutFixtures(t);
  for (const [actor, role, user] of [
    ["anon", "anon", null], ["customer", "authenticated", USERS.customerA], ["designer", "authenticated", USERS.designer], ["admin", "authenticated", USERS.admin], ["service", "service_role", null],
  ] as const) {
    const client = await server.connect();
    await client.as(role, user ? { sub: user.id, email: user.email } : {});
    clients[actor] = client;
  }
}, 300_000);
afterAll(async () => server?.stop());

describe(`${MIGRATION}`, () => {
  it("BEFORE: reproduces the production finding (drafts readable with the public key; anonymous direct inserts)", async () => {
    expect(await rows("anon", "select id from public.product_customizer_templates")).toBeGreaterThan(0);
    expect(await rows("customer", "select id from public.product_customizer_templates")).toBeGreaterThan(0);
    expect(await attempt("anon", "insert into public.contact_messages (name, email, message) values ('x', 'x@example.test', 'direct')")).toBe("accepted");
    expect(await attempt("anon", "insert into public.newsletter_subscribers (email) values ('direct@example.test')")).toBe("accepted");
    expect((await server.owner.query("select to_regprocedure('public.customizer_template_is_public(uuid)') as f")).rows[0].f).toBeNull();
    snapshotBefore = await dataFingerprint();
  });

  it("applies cleanly, and a second application changes nothing (idempotent)", async () => {
    const sql = readFileSync(`supabase/migrations/${MIGRATION}`, "utf8");
    await server.owner.query(sql);
    await server.owner.query(sql);
    expect((await server.owner.query("select to_regprocedure('public.customizer_template_is_public(uuid)') is not null as f")).rows[0].f).toBe(true);
    expect(await dataFingerprint()).toBe(snapshotBefore);
  });

  it("AFTER: no guest, customer or designer reads a draft through the public API", async () => {
    for (const actor of ["anon", "customer", "designer"] as const) {
      expect(await rows(actor, "select id from public.product_customizer_templates"), actor).toBeLessThanOrEqual(0);
    }
  });

  it("AFTER: published versions stay readable — for public, active, enabled products only", async () => {
    for (const actor of ["anon", "customer", "designer"] as const) {
      expect(await rows(actor, "select id from public.customizer_template_versions where id = $1", [IDS.versionActive]), `${actor}: active product`).toBe(1);
      expect(await rows(actor, "select id from public.customizer_template_versions where id = $1", [IDS.versionDraft]), `${actor}: draft product`).toBe(0);
    }
    await server.owner.query("update public.products set visibility = 'hidden' where id = 'product-second'");
    expect(await rows("anon", "select id from public.customizer_template_versions where id = $1", [IDS.versionSecond])).toBe(0);
    await server.owner.query("update public.products set visibility = 'public' where id = 'product-second'");
    expect(await rows("anon", "select id from public.customizer_template_versions where id = $1", [IDS.versionSecond])).toBe(1);
    // The helper answers only yes/no; it exposes no draft content.
    expect((await clients.anon.query("select public.customizer_template_is_public($1) as ok", [IDS.templateActive])).rows[0].ok).toBe(true);
    expect((await clients.anon.query("select public.customizer_template_is_public($1) as ok", [IDS.templateDraft])).rows[0].ok).toBe(false);
  });

  it("AFTER: administrators keep drafts and every version; the service role (all server paths) is unaffected", async () => {
    const drafts = Number((await server.owner.query("select count(*) from public.product_customizer_templates")).rows[0].count);
    const versions = Number((await server.owner.query("select count(*) from public.customizer_template_versions")).rows[0].count);
    expect(await rows("admin", "select id from public.product_customizer_templates")).toBe(drafts);
    expect(await rows("admin", "select id from public.customizer_template_versions")).toBe(versions);
    expect(await rows("service", "select id from public.product_customizer_templates")).toBe(drafts);
    expect(await attempt("service", "update public.product_customizer_templates set enabled = enabled where id = $1", [IDS.templateActive])).toBe("accepted");
    expect(await attempt("service", "insert into public.contact_messages (name, email, message) values ('x', 'x@example.test', 'via /api/contact')")).toBe("accepted");
    expect(await attempt("service", "insert into public.newsletter_subscribers (email) values ('api@example.test')")).toBe("accepted");
    expect(await attempt("admin", "update public.product_customizer_templates set enabled = enabled where id = $1", [IDS.templateActive])).toBe("accepted");
  });

  it("AFTER: direct anonymous or customer inserts into contact messages and newsletter are refused", async () => {
    for (const actor of ["anon", "customer"] as const) {
      expect(await attempt(actor, "insert into public.contact_messages (name, email, message) values ('x', 'x@example.test', 'direct')"), actor).toBe("refused");
      expect(await attempt(actor, "insert into public.newsletter_subscribers (email) values ('direct2@example.test')"), actor).toBe("refused");
    }
  });
});
