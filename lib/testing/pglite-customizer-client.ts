/**
 * A Supabase-shaped client over the real-schema PGlite database, limited to
 * the customizer TEMPLATE tables: the mutable draft
 * (`product_customizer_templates`), the immutable published versions
 * (`customizer_template_versions`, written only through the real
 * `publish_customizer_template_version` RPC) and the admin asset library
 * (`customizer_assets`).
 *
 * Test-only. It lets the persistence round-trip suite run the production
 * modules (`lib/customizer/store.ts`, `lib/customizer/versions.ts`) unchanged
 * against real SQL, triggers and constraints.
 *
 * Signed URLs are fake and SINGLE-USE: every signing returns a new token, so a
 * test can prove that nothing persisted depends on an earlier (expired) URL.
 */

import type { TestDatabase } from "@/lib/testing/pglite-supabase";

const TABLES = new Set(["product_customizer_templates", "customizer_template_versions", "customizer_assets", "product_customizations"]);
const JSON_COLUMNS = new Set(["pages", "fields", "layers", "safe_area", "bleed", "assets", "settings", "document", "font_dependencies", "metadata"]);

// PostgREST returns timestamps as ISO strings with microseconds; PGlite would
// return Date objects (millisecond precision). Keep the database's text.
const TIMESTAMP_PARSERS = {
  1184: (value: string) => value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"),
  1114: (value: string) => value.replace(" ", "T"),
};

export const SIGNED_URL_HOST = "https://signed.test";

export function createCustomizerTestClient(t: TestDatabase) {
  let signatures = 0;
  const identifier = (value: string) => {
    if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
    return value;
  };
  const execute = async (sql: string, args: unknown[]) => {
    try {
      const result = await t.asService((db) => db.query<any>(sql, args, { parsers: TIMESTAMP_PARSERS }));
      return { data: result.rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  const client: any = {
    from(table: string) {
      if (!TABLES.has(table)) throw new Error(`Unexpected table in customizer test client: ${table}`);
      let action: "select" | "upsert" | "update" = "select";
      let rows: any[] = [];
      let conflict = "";
      let columns = "*";
      let single = false;
      let limit = "";
      const sorts: string[] = [];
      const clauses: string[] = [];
      const args: unknown[] = [];
      const bind = (value: unknown, column = "") => {
        args.push(JSON_COLUMNS.has(column) && value !== null && value !== undefined ? JSON.stringify(value) : value);
        return `$${args.length}`;
      };
      const builder: any = {
        select(value = "*") {
          columns = value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => (part === "*" ? "*" : identifier(part))).join(", ");
          return builder;
        },
        eq(key: string, value: unknown) {
          clauses.push(`${identifier(key)} = ${bind(value)}`);
          return builder;
        },
        in(key: string, values: unknown[]) {
          clauses.push(`${identifier(key)}::text = any(${bind(values.map(String))}::text[])`);
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
          single = true;
          return builder;
        },
        single() {
          single = true;
          return builder;
        },
        update(value: any) {
          action = "update";
          rows = [value];
          return builder;
        },
        upsert(value: any, options: { onConflict?: string } = {}) {
          action = "upsert";
          rows = Array.isArray(value) ? value : [value];
          conflict = identifier(options.onConflict || "id");
          return builder;
        },
        async then(resolve: any) {
          const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
          let sql: string;
          if (action === "upsert") {
            const keys = Object.keys(rows[0]);
            const values = rows.map((row) => `(${keys.map((key) => bind(row[key], key)).join(", ")})`).join(", ");
            const updates = keys.filter((key) => key !== conflict).map((key) => `${identifier(key)} = excluded.${identifier(key)}`).join(", ");
            sql = `insert into public.${table} (${keys.map(identifier).join(", ")}) values ${values} on conflict (${conflict}) do update set ${updates} returning ${columns}`;
          } else if (action === "update") {
            // Bind the SET values first: the where clause placeholders were
            // numbered when eq() ran, so renumber them after the SET list.
            const keys = Object.keys(rows[0]);
            const whereArgs = args.splice(0, args.length);
            const sets = keys.map((key) => `${identifier(key)} = ${bind(rows[0][key], key)}`).join(", ");
            const offset = keys.length;
            const renumbered = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
            args.push(...whereArgs);
            sql = `update public.${table} set ${sets}${renumbered} returning ${columns}`;
          } else {
            sql = `select ${columns} from public.${table}${where}${sorts.length ? ` order by ${sorts.join(", ")}` : ""}${limit}`;
          }
          const result = await execute(sql, args);
          resolve({ ...result, data: single ? result.data?.[0] ?? null : result.data });
        },
      };
      return builder;
    },
    async rpc(name: string, params: Record<string, unknown> = {}) {
      if (name !== "publish_customizer_template_version") throw new Error(`Unexpected RPC in customizer test client: ${name}`);
      const entries = Object.entries(params);
      const call = `public.${identifier(name)}(${entries.map(([key], index) => `${identifier(key)} => $${index + 1}`).join(", ")})`;
      const values = entries.map(([, value]) => (value && typeof value === "object" ? JSON.stringify(value) : value));
      const result = await execute(`select to_jsonb(${call}) as result`, values);
      return { data: result.data?.[0]?.result ?? null, error: result.error };
    },
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(path: string, ttlSeconds: number) {
            signatures += 1;
            return { data: { signedUrl: `${SIGNED_URL_HOST}/${bucket}/${path}?ttl=${ttlSeconds}&token=sig${signatures}` }, error: null };
          },
        };
      },
    },
  };
  return { client, signatureCount: () => signatures };
}
