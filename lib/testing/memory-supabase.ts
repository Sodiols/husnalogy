/**
 * A tiny in-memory, Supabase-shaped client for ROUTE tests.
 *
 * Test-only. It answers the PostgREST builder chains the upload and account
 * routes use (select / eq / in / is / order / limit / range / maybeSingle /
 * single / insert / update / upsert / delete) over plain arrays, and keeps
 * Storage objects as real bytes so a route's read-back verification runs
 * against what it actually wrote. It enforces nothing — RLS is exercised
 * against the real migrations in the PGlite suites, not here.
 */

type Row = Record<string, any>;
type StoredObject = { data: Buffer; contentType: string };

export type MemorySupabase = {
  client: any;
  tables: Map<string, Row[]>;
  objects: Map<string, StoredObject>;
  table(name: string): Row[];
};

let sequence = 0;
const newId = () => {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
};

export function createMemorySupabase(seed: Record<string, Row[]> = {}): MemorySupabase {
  const tables = new Map<string, Row[]>(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const objects = new Map<string, StoredObject>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };

  const from = (name: string) => {
    type Action = "select" | "insert" | "update" | "upsert" | "delete";
    let action: Action = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let single: "none" | "maybe" | "strict" = "none";
    let limit = Infinity;
    let offset = 0;
    let returning = false;
    let onConflict = "id";
    const filters: Array<(row: Row) => boolean> = [];
    const sorts: Array<{ key: string; ascending: boolean }> = [];

    const builder: any = {
      select() {
        if (action !== "select") returning = true;
        return builder;
      },
      eq(key: string, value: unknown) {
        filters.push((row) => String(row[key]) === String(value));
        return builder;
      },
      neq(key: string, value: unknown) {
        filters.push((row) => String(row[key]) !== String(value));
        return builder;
      },
      in(key: string, values: unknown[]) {
        const set = new Set(values.map(String));
        filters.push((row) => set.has(String(row[key])));
        return builder;
      },
      is(key: string, value: unknown) {
        filters.push((row) => (row[key] ?? null) === value);
        return builder;
      },
      or() {
        return builder;
      },
      order(key: string, options?: { ascending?: boolean }) {
        sorts.push({ key, ascending: options?.ascending !== false });
        return builder;
      },
      limit(value: number) {
        limit = value;
        return builder;
      },
      range(from: number, to: number) {
        offset = from;
        limit = to - from + 1;
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
      insert(value: Row | Row[]) {
        action = "insert";
        payload = Array.isArray(value) ? value : [value];
        return builder;
      },
      upsert(value: Row | Row[], options: { onConflict?: string } = {}) {
        action = "upsert";
        payload = Array.isArray(value) ? value : [value];
        onConflict = options.onConflict || "id";
        return builder;
      },
      update(value: Row) {
        action = "update";
        patch = value;
        return builder;
      },
      delete() {
        action = "delete";
        return builder;
      },
      then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
        try {
          resolve(run());
        } catch (error) {
          if (reject) reject(error);
          else throw error;
        }
      },
    };

    const matching = () => table(name).filter((row) => filters.every((test) => test(row)));
    const shape = (rows: Row[]) => {
      if (single === "none") return { data: rows, error: null };
      if (single === "strict" && rows.length !== 1) return { data: null, error: { message: `Expected one row, found ${rows.length}.` } };
      return { data: rows[0] ? { ...rows[0] } : null, error: null };
    };

    function run() {
      const now = new Date().toISOString();
      if (action === "insert" || action === "upsert") {
        const written: Row[] = [];
        for (const value of payload) {
          const keys = onConflict.split(",").map((key) => key.trim());
          const existing = action === "upsert" ? table(name).find((row) => keys.every((key) => String(row[key]) === String(value[key]))) : undefined;
          if (existing) {
            Object.assign(existing, value, { updated_at: now });
            written.push(existing);
          } else {
            const row = { id: newId(), created_at: now, updated_at: now, ...value };
            table(name).push(row);
            written.push(row);
          }
        }
        return returning || single !== "none" ? shape(written.map((row) => ({ ...row }))) : { data: null, error: null };
      }
      if (action === "update") {
        const rows = matching();
        rows.forEach((row) => Object.assign(row, patch));
        return returning || single !== "none" ? shape(rows.map((row) => ({ ...row }))) : { data: null, error: null };
      }
      if (action === "delete") {
        const rows = matching();
        tables.set(name, table(name).filter((row) => !rows.includes(row)));
        return returning ? shape(rows) : { data: null, error: null };
      }
      let rows = matching();
      for (const sort of [...sorts].reverse()) {
        rows = [...rows].sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : a[sort.key] < b[sort.key] ? -1 : 0) * (sort.ascending ? 1 : -1));
      }
      rows = rows.slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
      return { ...shape(rows.map((row) => ({ ...row }))), count: matching().length };
    }

    return builder;
  };

  const client: any = {
    from,
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, data: Buffer | Uint8Array, options: { contentType?: string; upsert?: boolean } = {}) {
            const key = `${bucket}/${path}`;
            if (objects.has(key) && !options.upsert) return { data: null, error: { message: "The resource already exists" } };
            objects.set(key, { data: Buffer.from(data), contentType: options.contentType || "application/octet-stream" });
            return { data: { path }, error: null };
          },
          async download(path: string) {
            const object = objects.get(`${bucket}/${path}`);
            if (!object) return { data: null, error: { message: "Object not found" } };
            return { data: new Blob([new Uint8Array(object.data)], { type: object.contentType }), error: null };
          },
          async remove(paths: string[]) {
            paths.forEach((path) => objects.delete(`${bucket}/${path}`));
            return { data: paths.map((path) => ({ name: path })), error: null };
          },
          async createSignedUrl(path: string, ttlSeconds: number) {
            return { data: { signedUrl: `https://signed.test/${bucket}/${path}?ttl=${ttlSeconds}&token=t${newId().slice(-6)}` }, error: null };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://public.test/${bucket}/${path}` } };
          },
        };
      },
    },
  };

  return { client, tables, objects, table };
}
