/**
 * A disposable, in-process Postgres (PGlite) loaded with the REAL Husnalogy
 * schema and every migration, plus the minimum Supabase scaffolding those
 * files assume (the anon/authenticated/service_role roles, `auth.uid()`,
 * `auth.role()`, `auth.jwt()`, `auth.users` and the storage tables).
 *
 * Test-only. It lets the database integration suite exercise RLS policies,
 * column guards, triggers, constraints and the checkout transaction exactly as
 * they are written in `supabase/`, without touching any real project and
 * without a Docker/Postgres install.
 *
 * Limitation (stated so nobody over-reads a green run): PGlite is a single
 * connection. Two transactions can never interleave inside it, so it proves
 * the idempotency LOGIC (lock → lookup → replay, unique index backstop) but not
 * true multi-connection lock contention; that needs a staging Postgres.
 */

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPABASE_SCAFFOLD, migrationFiles } from "./supabase-scaffold.mjs";

export { SUPABASE_SCAFFOLD, migrationFiles };

export type TestDatabase = {
  db: PGlite;
  /** Run as the PostgREST `authenticated` role for this user id/email. */
  asUser<T>(userId: string, email: string, work: (db: PGlite) => Promise<T>): Promise<T>;
  /** Run as the PostgREST `service_role` (what the Next.js server uses). */
  asService<T>(work: (db: PGlite) => Promise<T>): Promise<T>;
  /** Run as the PostgREST `anon` role. */
  asAnon<T>(work: (db: PGlite) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

async function withRole<T>(db: PGlite, role: string, claims: Record<string, unknown>, work: (db: PGlite) => Promise<T>): Promise<T> {
  const sub = String(claims.sub || "");
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false), set_config('request.jwt.claims', $3, false)", [
    sub,
    role,
    JSON.stringify({ ...claims, role }),
  ]);
  await db.exec(`set role ${role}`);
  try {
    return await work(db);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claims', '', false)");
  }
}

export async function createTestDatabase(root = process.cwd(), stopBeforeMigration?: string): Promise<TestDatabase> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_SCAFFOLD);
  await db.exec(readFileSync(join(root, "supabase/schema.sql"), "utf8"));
  for (const file of migrationFiles(root)) {
    if (stopBeforeMigration && file.endsWith(stopBeforeMigration)) break;
    await db.exec(readFileSync(file, "utf8"));
  }
  return {
    db,
    asUser: (userId, email, work) => withRole(db, "authenticated", { sub: userId, email }, work),
    asService: (work) => withRole(db, "service_role", {}, work),
    asAnon: (work) => withRole(db, "anon", {}, work),
    close: () => db.close(),
  };
}
