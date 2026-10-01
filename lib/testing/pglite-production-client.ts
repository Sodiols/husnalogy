/** Real SQL/RPCs with a storage stand-in; rejects all mutable production lookups. */
import type { TestDatabase } from "@/lib/testing/pglite-supabase";

export function createProductionTestClient(t: TestDatabase) {
  const blobs = new Map<string, Buffer>();
  const calls: string[] = [];
  /** Fault injection for outage tests. */
  const faults: {
    remove?: (bucket: string, path: string) => boolean;
    download?: (bucket: string, path: string) => boolean;
    rpc?: (name: string) => boolean;
  } = {};
  const identifier = (value: string) => { if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("Unsafe test identifier"); return value; };
  const execute = async (sql: string, args: unknown[]) => {
    try { return { data: (await t.asService((db) => db.query<any>(sql, args))).rows, error: null }; }
    catch (error) { return { data: null, error }; }
  };
  const client: any = {
    from(table: string) {
      calls.push(table);
      if (!["order_design_snapshots", "customizer_render_jobs", "customizer_render_outputs", "order_production_assets"].includes(table)) throw new Error(`Mutable production lookup forbidden: ${table}`);
      let action = "select"; let patch: any = null; let columns = "*"; let single = false; let limit = ""; const sorts: string[] = [];
      const clauses: string[] = []; const args: unknown[] = [];
      const bind = (value: unknown) => { args.push(value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value) : value); return `$${args.length}`; };
      const builder: any = {
        select(value = "*") { columns = value; return builder; },
        update(value: any) { action = "update"; patch = value; return builder; },
        delete() { action = "delete"; return builder; },
        insert(value: any) { action = "insert"; patch = value; return builder; },
        eq(key: string, value: unknown) { clauses.push(`${identifier(key)}=${bind(value)}`); return builder; },
        not(key:string,op:string,value:unknown){ if(op!=="is"||value!==null)throw new Error("Unsupported test filter");clauses.push(`${identifier(key)} is not null`);return builder; },
        in(key: string, values: unknown[]) { clauses.push(`${identifier(key)}=any(${bind(values)})`); return builder; },
        // PostgREST `or=(col.op.value,...)` for the operators the worker uses.
        or(expression: string) {
          const operators: Record<string, string> = { eq: "=", lt: "<", lte: "<=", gt: ">", gte: ">=" };
          const parts = expression.split(",").map((part) => {
            const [key, op, ...rest] = part.split(".");
            const value = rest.join(".");
            if (op === "is" && value === "null") return `${identifier(key)} is null`;
            if (!operators[op]) throw new Error(`Unsupported test or-filter: ${part}`);
            return `${identifier(key)}${operators[op]}${bind(value)}`;
          });
          clauses.push(`(${parts.join(" or ")})`);
          return builder;
        },
        limit(value: number) { limit = ` limit ${Math.max(1, Math.floor(value))}`; return builder; },
        order(key: string, options?: { ascending?: boolean }) { sorts.push(`${identifier(key)} ${options?.ascending === false ? "desc" : "asc"}`); return builder; },
        maybeSingle() { single = true; return builder; }, single() { single = true; return builder; },
        async then(resolve: any, reject: any) {
          let sql: string;
          const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
          if (action === "update") sql = `update public.${identifier(table)} set ${Object.entries(patch).map(([key, value]) => `${identifier(key)}=${bind(value)}`).join(",")}${where} returning ${columns}`;
          else if (action === "delete") sql = `delete from public.${identifier(table)}${where} returning ${columns}`;
          else if (action === "insert") {
            const rows = Array.isArray(patch) ? patch : [patch]; const keys = Object.keys(rows[0]);
            sql = `insert into public.${identifier(table)}(${keys.map(identifier).join(",")}) values ${rows.map((row: any) => `(${keys.map((key) => bind(row[key])).join(",")})`).join(",")} returning ${columns}`;
          } else sql = `select ${columns} from public.${identifier(table)}${where}${sorts.length ? ` order by ${sorts.join(",")}` : ""}${limit}`;
          const result = await execute(sql, args); resolve({ ...result, data: single ? result.data?.[0] || null : result.data });
          return undefined;
        },
      };
      return builder;
    },
    async rpc(name: string, params: Record<string, unknown> = {}) {
      calls.push(`rpc:${name}`);
      const entries = Object.entries(params);
      const call = `public.${identifier(name)}(${entries.map(([key], index) => `${identifier(key)}=>$${index + 1}`).join(",")})`;
      const composite = ["enqueue_snapshot_render_job", "claim_customizer_render_job", "commit_snapshot_render_result", "fail_snapshot_render_job"].includes(name);
      if (faults.rpc?.(name)) return { data: null, error: { message: `Injected failure: ${name}`, code: "XX000" } };
      // Set-returning functions come back as rows, exactly like PostgREST.
      if (["production_storage_cleanup_candidates", "claim_production_tasks", "claim_notification_tasks", "claim_storage_cleanup_items"].includes(name)) {
        return execute(`select * from ${call}`, entries.map(([, value]) => value && typeof value === "object" ? JSON.stringify(value) : value));
      }
      const result = await execute(`select ${composite ? `to_jsonb(${call})` : call} as result`, entries.map(([, value]) => value && typeof value === "object" ? JSON.stringify(value) : value));
      return { data: result.data?.[0]?.result ?? null, error: result.error };
    },
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, bytes: Buffer, options: any) {
            const key = `${bucket}/${path}`;
            if (blobs.has(key) && !options?.upsert) return { error: { message: "already exists", statusCode: "409" } };
            blobs.set(key, Buffer.from(bytes));
            await t.asService((db)=>db.query("insert into storage.objects(bucket_id,name) select $1,$2 where not exists(select 1 from storage.objects where bucket_id=$1 and name=$2)",[bucket,path]));
            return { data: { path }, error: null };
          },
          async download(path: string) {
            if (faults.download?.(bucket, path)) return { data: null, error: { message: "Injected storage outage", statusCode: "503" } };
            const bytes = blobs.get(`${bucket}/${path}`); return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: "not found" } };
          },
          // Like the Storage API: the object row is deleted through the
          // database, so the committed-asset guard applies.
          async remove(paths: string[]) {
            const removed: Array<{ name: string }> = [];
            for (const path of paths) {
              if (faults.remove?.(bucket, path)) return { data: null, error: { message: "Injected storage failure", statusCode: "500" } };
              try { await t.asService((db) => db.query("delete from storage.objects where bucket_id=$1 and name=$2", [bucket, path])); }
              catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : String(error), statusCode: "400" } }; }
              if (blobs.delete(`${bucket}/${path}`)) removed.push({ name: path });
            }
            return { data: removed, error: null };
          },
        };
      },
    },
  };
  return { client, blobs, calls, faults };
}
