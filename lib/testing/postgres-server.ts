/**
 * A REAL, multi-connection PostgreSQL 17 server for the concurrency suite
 * (test-only), loaded with the same Supabase scaffolding, schema and every
 * migration as the PGlite harness.
 *
 * PGlite is one connection, so it cannot prove what happens when two
 * transactions truly interleave (row locks, advisory locks, SKIP LOCKED,
 * unique-index races). This harness can: every `connect()` is a separate
 * backend. It is still NOT Supabase — PostgREST, GoTrue and the Storage API
 * are absent — so it complements, and never replaces, a staging project.
 */

import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUPABASE_SCAFFOLD, migrationFiles } from "@/lib/testing/pglite-supabase";

export type RoleClient = pg.Client & {
  /** Switch this connection to a PostgREST role with JWT claims. */
  as(role: "service_role" | "authenticated" | "anon", claims?: { sub?: string; email?: string }): Promise<void>;
};

export type PostgresServer = {
  connect(): Promise<RoleClient>;
  /** Owner connection (like the SQL editor / migrations). */
  owner: pg.Client;
  stop(): Promise<void>;
};

export async function startPostgres(port = 55000 + Math.floor(Math.random() * 5000), options: { migrate?: boolean } = {}): Promise<PostgresServer> {
  const dir = mkdtempSync(join(tmpdir(), "husnalogy-pg-"));
  // UTF-8 like Supabase (Windows would otherwise default to a code page).
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => undefined, onError: () => undefined });
  await server.initialise();
  await server.start();
  const clients: pg.Client[] = [];
  const connect = async (): Promise<RoleClient> => {
    const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" }) as RoleClient;
    await client.connect();
    client.as = async (role, claims = {}) => {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false), set_config('request.jwt.claims', $3, false)", [claims.sub || "", role, JSON.stringify({ ...claims, role })]);
      await client.query(`set role ${role}`);
    };
    clients.push(client);
    return client;
  };
  const owner = await connect();
  await owner.query(SUPABASE_SCAFFOLD);
  // `migrate: false` leaves only the Supabase scaffolding (like a fresh
  // Supabase project), for tests of the migration tooling itself.
  if (options.migrate !== false) {
    await owner.query(readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8"));
    for (const file of migrationFiles()) await owner.query(readFileSync(file, "utf8"));
  }
  return {
    connect,
    owner,
    async stop() {
      for (const client of clients) await client.end().catch(() => undefined);
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
