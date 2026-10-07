/**
 * A Supabase-shaped client over the real-schema PGlite database that runs
 * every query AS a given PostgREST role: `authenticated` with a user's
 * auth.uid() (so Row Level Security is genuinely enforced), or `service_role`.
 *
 * Test-only. It implements the builder subset the account routes use:
 * select / insert / update / delete, eq / neq / is / in, order, limit,
 * maybeSingle / single, and `.select()` after a mutation for RETURNING.
 * Storage is an in-memory byte store (no policies — server code reaches it
 * with the service role only).
 */
import type { TestDatabase } from "@/lib/testing/pglite-supabase";

export type RestActor = { kind: "user"; id: string; email: string } | { kind: "service" };

const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
};

export function createRestClient(t: TestDatabase, actor: RestActor, objects = new Map<string, { data: Buffer; contentType: string }>()) {
  const run = <T>(work: (db: TestDatabase["db"]) => Promise<T>) =>
    actor.kind === "user" ? t.asUser(actor.id, actor.email, work) : t.asService(work);

  function from(table: string) {
    let action: "select" | "insert" | "update" | "delete" = "select";
    let columns = "*";
    let returning = false;
    let single: "none" | "maybe" | "strict" = "none";
    let rows: Record<string, unknown>[] = [];
    let patch: Record<string, unknown> = {};
    let limit = "";
    const where: string[] = [];
    const sorts: string[] = [];
    const args: unknown[] = [];
    const bind = (value: unknown) => {
      args.push(value !== null && typeof value === "object" && !(value instanceof Date) ? JSON.stringify(value) : value);
      return `$${args.length}`;
    };
    const columnList = (value: string) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => (part === "*" ? "*" : identifier(part)))
        .join(", ");

    const builder: any = {
      select(value = "*") {
        if (action === "select") columns = columnList(value);
        else {
          returning = true;
          columns = columnList(value);
        }
        return builder;
      },
      insert(value: Record<string, unknown> | Record<string, unknown>[]) {
        action = "insert";
        rows = Array.isArray(value) ? value : [value];
        return builder;
      },
      update(value: Record<string, unknown>) {
        action = "update";
        patch = value;
        return builder;
      },
      delete() {
        action = "delete";
        return builder;
      },
      eq(key: string, value: unknown) {
        where.push(`${identifier(key)} = ${bind(value)}`);
        return builder;
      },
      neq(key: string, value: unknown) {
        where.push(`${identifier(key)} is distinct from ${bind(value)}`);
        return builder;
      },
      is(key: string, value: unknown) {
        where.push(value === null ? `${identifier(key)} is null` : `${identifier(key)} is ${value ? "true" : "false"}`);
        return builder;
      },
      in(key: string, values: unknown[]) {
        where.push(`${identifier(key)}::text = any(${bind(values.map(String))}::text[])`);
        return builder;
      },
      order(key: string, options?: { ascending?: boolean }) {
        sorts.push(`${identifier(key)} ${options?.ascending === false ? "desc" : "asc"}`);
        return builder;
      },
      limit(value: number) {
        limit = ` limit ${Math.max(1, Math.floor(value))}`;
        return builder;
      },
      maybeSingle() {
        single = "maybe";
        return builder;
      },
      single() {
        single = "strict";
        return builder;
      },
      then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
        execute().then(resolve, reject);
      },
    };

    async function execute() {
      const filter = where.length ? ` where ${where.join(" and ")}` : "";
      let sql: string;
      if (action === "insert") {
        const keys = Object.keys(rows[0] || {});
        const values = rows.map((row) => `(${keys.map((key) => bind(row[key])).join(", ")})`).join(", ");
        sql = `insert into public.${identifier(table)} (${keys.map(identifier).join(", ")}) values ${values}${returning || single !== "none" ? ` returning ${columns}` : ""}`;
      } else if (action === "update") {
        const sets = Object.entries(patch).map(([key, value]) => `${identifier(key)} = ${bind(value)}`).join(", ");
        sql = `update public.${identifier(table)} set ${sets}${filter}${returning || single !== "none" ? ` returning ${columns}` : ""}`;
      } else if (action === "delete") {
        sql = `delete from public.${identifier(table)}${filter}${returning || single !== "none" ? ` returning ${columns}` : ""}`;
      } else {
        sql = `select ${columns} from public.${identifier(table)}${filter}${sorts.length ? ` order by ${sorts.join(", ")}` : ""}${limit}`;
      }
      try {
        const result = await run((db) => db.query<any>(sql, args));
        const data = result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])));
        if (single === "none") return { data: action === "select" || returning ? data : null, error: null };
        if (single === "strict" && data.length !== 1) return { data: null, error: { message: `Expected one row, found ${data.length}.` } };
        return { data: data[0] ?? null, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    }

    return builder;
  }

  const storage = {
    from(bucket: string) {
      return {
        async upload(path: string, data: Buffer | Uint8Array, options: { contentType?: string; upsert?: boolean } = {}) {
          const key = `${bucket}/${path}`;
          if (objects.has(key) && !options.upsert) return { data: null, error: { message: "The resource already exists" } };
          objects.set(key, { data: Buffer.from(data), contentType: options.contentType || "application/octet-stream" });
          return { data: { path }, error: null };
        },
        async remove(paths: string[]) {
          paths.forEach((path) => objects.delete(`${bucket}/${path}`));
          return { data: paths.map((name) => ({ name })), error: null };
        },
        async createSignedUrl(path: string, ttlSeconds: number) {
          return objects.has(`${bucket}/${path}`)
            ? { data: { signedUrl: `https://signed.test/${bucket}/${path}?ttl=${ttlSeconds}` }, error: null }
            : { data: null, error: { message: "Object not found" } };
        },
      };
    },
  };

  return { from, storage, objects };
}
