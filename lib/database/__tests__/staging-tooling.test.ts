/**
 * The staging tooling itself: the production guard, and the migration runner
 * proven on a REAL PostgreSQL 17 that starts like a fresh Supabase project
 * (roles, auth and storage scaffolding, nothing else).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadStagingEnv, PRODUCTION_PROJECT_REFS } from "../../../scripts/staging/staging-env.mjs";
import { applyMigrations, migrationPlan } from "../../../scripts/staging/apply-migrations.mjs";
import { startPostgres, type PostgresServer } from "@/lib/testing/postgres-server";

const STAGING_REF = "stagingrefabcdefghij";
const base = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
  STAGING_DATABASE_URL: `postgresql://postgres.${STAGING_REF}:pw@pooler.example:5432/postgres`,
  STAGING_CONFIRM_PROJECT_REF: STAGING_REF,
};
function workspace(staging: Record<string, string> | null, local?: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "husnalogy-staging-env-"));
  const write = (file: string, values: Record<string, string>) => writeFileSync(join(dir, file), Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"));
  if (staging) write(".env.staging", staging);
  if (local) write(".env.local", local);
  return dir;
}

describe("staging environment guard", () => {
  it("accepts a confirmed, separate staging project", () => {
    expect(loadStagingEnv(workspace(base, { NEXT_PUBLIC_SUPABASE_URL: "https://otherproject.supabase.co" })).ref).toBe(STAGING_REF);
  });
  it("is BLOCKED without .env.staging and never falls back to .env.local", () => {
    expect(() => loadStagingEnv(workspace(null, { ...base }))).toThrow(/BLOCKED: \.env\.staging not found/);
  });
  it("refuses the production project, the .env.local project, an unconfirmed ref and a foreign database URL", () => {
    const production = PRODUCTION_PROJECT_REFS[0];
    expect(() => loadStagingEnv(workspace({ ...base, NEXT_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co`, STAGING_CONFIRM_PROJECT_REF: production, STAGING_DATABASE_URL: `postgresql://x.${production}:p@h/postgres` }))).toThrow(/REFUSED: .* is a production project/);
    expect(() => loadStagingEnv(workspace(base, { NEXT_PUBLIC_SUPABASE_URL: base.NEXT_PUBLIC_SUPABASE_URL }))).toThrow(/same project as \.env\.local/);
    expect(() => loadStagingEnv(workspace({ ...base, STAGING_CONFIRM_PROJECT_REF: "something-else" }))).toThrow(/STAGING_CONFIRM_PROJECT_REF/);
    expect(() => loadStagingEnv(workspace({ ...base, STAGING_DATABASE_URL: "postgresql://postgres.anotherref:pw@pooler.example:5432/postgres" }))).toThrow(/STAGING_DATABASE_URL does not belong/);
    expect(() => loadStagingEnv(workspace({ ...base, SUPABASE_SERVICE_ROLE_KEY: "" }))).toThrow(/missing SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("staging migration runner on real PostgreSQL (fresh Supabase-like database)", () => {
  let server: PostgresServer;
  beforeAll(async () => { server = await startPostgres(undefined, { migrate: false }); }, 240_000);
  afterAll(async () => server?.stop());

  it("applies schema.sql, hero_collections.sql and every migration in order; the runbook check passes", async () => {
    const plan = migrationPlan();
    expect(plan.slice(0, 2).map((entry) => entry.name)).toEqual(["schema.sql", "hero_collections.sql"]);
    expect(plan.slice(2).map((entry) => entry.name)).toEqual([...plan.slice(2).map((entry) => entry.name)].sort());
    const log: unknown[] = [];
    const result = await applyMigrations(server.owner, plan, (entry) => log.push(entry));
    expect(result.failed).toBeNull();
    expect(result.applied).toEqual(plan.map((entry) => entry.name));
    const doc = readFileSync(join(process.cwd(), "HOSTINGER_DEPLOYMENT.md"), "utf8").replace(/\r\n/g, "\n");
    const query = doc.match(/```sql\n(select \* from \(values[\s\S]*?\) as checks\(migration, applied\);)\n```/)![1];
    const rows = (await server.owner.query<{ migration: string; applied: boolean }>(query)).rows;
    expect(rows.filter((row) => !row.applied).map((row) => row.migration)).toEqual([]);
  }, 240_000);

  it("a re-run applies nothing, and an edited already-applied migration is REFUSED", async () => {
    const plan = migrationPlan();
    const again = await applyMigrations(server.owner, plan, () => undefined);
    expect(again).toMatchObject({ applied: [], failed: null });
    expect(again.skipped).toHaveLength(plan.length);
    const tampered = plan.map((entry, index) => (index === plan.length - 1 ? { ...entry, sha256: "0".repeat(64) } : entry));
    await expect(applyMigrations(server.owner, tampered, () => undefined)).rejects.toThrow(/REFUSED: .* already applied with different contents/);
  }, 120_000);

  it("a failing migration is reported by name and leaves nothing of itself behind", async () => {
    const broken = { name: "20991231235959_broken.sql", path: "", sql: "create table public.half_applied (id int);\ninsert into public.half_applied values (1);\nselect 1/0;", sha256: "b".repeat(64) };
    const result = await applyMigrations(server.owner, [...migrationPlan(), broken], () => undefined);
    expect(result.failed).toMatchObject({ migration: "20991231235959_broken.sql", error: expect.stringMatching(/division by zero/) });
    expect((await server.owner.query("select to_regclass('public.half_applied') as t")).rows[0].t).toBeNull();
    expect((await server.owner.query("select 1 from husnalogy_ops.applied_migrations where name=$1", [broken.name])).rows).toHaveLength(0);
  }, 120_000);
});
