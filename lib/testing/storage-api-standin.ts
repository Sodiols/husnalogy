/**
 * A LOCAL stand-in for the subset of the Supabase Storage HTTP API that the
 * backup/restore tools call through supabase-js (test-only): list buckets,
 * get/create a bucket, list a folder, download and upload an object. Object
 * metadata lives in the REAL `storage.objects` / `storage.buckets` tables of
 * the test PostgreSQL server (so the restored database's Storage RLS can be
 * exercised), bytes in a temporary folder.
 *
 * It enforces what the backup tools rely on — the service-role key, bucket
 * existence, the bucket's size limit and allowed MIME types, and no silent
 * overwrite (409 unless x-upsert) — but it is NOT Supabase Storage: signed
 * URLs, image transformation and per-user JWT access are absent. A green drill
 * against it proves the tools' logic, not the hosted service.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

type Sql = { query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };

export type StorageStandIn = {
  url: string;
  serviceKey: string;
  /** Place an object directly (test seeding of files another harness pinned). */
  put(bucket: string, name: string, bytes: Buffer, contentType: string): Promise<void>;
  close(): Promise<void>;
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const fail = (res: ServerResponse, status: number, error: string, message: string) => json(res, status, { statusCode: String(status), error, message });

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function startStorageStandIn({ db: connection, dir, serviceKey }: { db: Sql; dir: string; serviceKey: string }): Promise<StorageStandIn> {
  mkdirSync(dir, { recursive: true });
  // One pg connection serves concurrent HTTP requests: run its queries one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };
  const db: Sql = { query: (sql, params) => serial(() => connection.query(sql, params)) as any };
  await db.query(`
    alter table storage.objects add column if not exists metadata jsonb;
    alter table storage.objects add column if not exists updated_at timestamptz not null default now();
    alter table storage.objects add column if not exists created_at timestamptz not null default now();
    alter table storage.buckets add column if not exists created_at timestamptz not null default clock_timestamp();
    create unique index if not exists storage_standin_bucket_name on storage.objects (bucket_id, name);
  `);
  const blob = (bucket: string, name: string) => join(dir, bucket, createHash("sha256").update(name).digest("hex"));

  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${serviceKey}`) return fail(res, 403, "Unauthorized", "invalid signature");
      const url = new URL(req.url || "/", "http://standin.local");
      const parts = url.pathname.replace(/^\/storage\/v1\//, "").split("/").map(decodeURIComponent);
      const method = req.method || "GET";

      if (parts[0] === "bucket") {
        if (method === "GET" && parts.length === 1) {
          return json(res, 200, (await db.query("select id, id as name, public, file_size_limit, allowed_mime_types, created_at from storage.buckets order by id")).rows);
        }
        if (method === "GET") {
          const row = (await db.query("select id, id as name, public, file_size_limit, allowed_mime_types, created_at from storage.buckets where id = $1", [parts[1]])).rows[0];
          return row ? json(res, 200, row) : fail(res, 404, "Bucket not found", "Bucket not found");
        }
        if (method === "POST") {
          const input = JSON.parse((await body(req)).toString("utf8") || "{}");
          await db.query("insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ($1, $1, $2, $3, $4)", [input.id || input.name, Boolean(input.public), input.file_size_limit ?? null, input.allowed_mime_types ?? null]);
          return json(res, 200, { name: input.id || input.name });
        }
      }

      if (parts[0] === "object" && parts[1] === "list" && method === "POST") {
        const bucket = parts[2];
        const input = JSON.parse((await body(req)).toString("utf8") || "{}");
        const prefix = String(input.prefix || "").replace(/^\/+|\/+$/g, "");
        const rows = (await db.query<any>("select id, name, metadata, created_at, updated_at from storage.objects where bucket_id = $1 and ($2 = '' or name like $2 || '/%') order by name", [bucket, prefix])).rows;
        const entries = new Map<string, any>();
        for (const row of rows) {
          const rest = prefix ? row.name.slice(prefix.length + 1) : row.name;
          const [head, ...tail] = rest.split("/");
          if (tail.length) entries.set(head, entries.get(head) || { name: head, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
          else entries.set(head, { name: head, id: row.id, updated_at: row.updated_at, created_at: row.created_at, last_accessed_at: row.updated_at, metadata: row.metadata });
        }
        const search = String(input.search || "");
        const sorted = [...entries.values()].filter((entry) => !search || entry.name.startsWith(search)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const offset = Number(input.offset || 0);
        return json(res, 200, sorted.slice(offset, offset + Number(input.limit || 100)));
      }

      if (parts[0] === "object") {
        const rest = parts[1] === "authenticated" ? parts.slice(2) : parts.slice(1);
        const [bucket, ...nameParts] = rest;
        const name = nameParts.join("/");
        if (method === "GET") {
          const row = (await db.query<any>("select metadata from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).rows[0];
          if (!row || !existsSync(blob(bucket, name))) return fail(res, 404, "not_found", "Object not found");
          res.writeHead(200, { "content-type": row.metadata?.mimetype || "application/octet-stream" });
          return res.end(readFileSync(blob(bucket, name)));
        }
        if (method === "POST" || method === "PUT") {
          const bucketRow = (await db.query<any>("select file_size_limit, allowed_mime_types from storage.buckets where id = $1", [bucket])).rows[0];
          if (!bucketRow) return fail(res, 404, "Bucket not found", "Bucket not found");
          const bytes = await body(req);
          const mimetype = String(req.headers["content-type"] || "application/octet-stream").split(";")[0];
          if (bucketRow.file_size_limit && bytes.length > Number(bucketRow.file_size_limit)) return fail(res, 413, "Payload too large", "The object exceeded the maximum allowed size");
          if (bucketRow.allowed_mime_types?.length && !bucketRow.allowed_mime_types.includes(mimetype)) return fail(res, 415, "invalid_mime_type", `mime type ${mimetype} is not supported`);
          const exists = (await db.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).rows.length > 0;
          if (exists && req.headers["x-upsert"] !== "true") return fail(res, 409, "Duplicate", "The resource already exists");
          mkdirSync(join(dir, bucket), { recursive: true });
          writeFileSync(blob(bucket, name), bytes);
          const metadata = { eTag: `"${createHash("md5").update(bytes).digest("hex")}"`, size: bytes.length, mimetype, cacheControl: String(req.headers["cache-control"] || "max-age=3600"), lastModified: new Date().toISOString(), contentLength: bytes.length, httpStatusCode: 200 };
          const id = exists
            ? (await db.query<any>("update storage.objects set metadata = $3, updated_at = now() where bucket_id = $1 and name = $2 returning id", [bucket, name, metadata])).rows[0].id
            : (await db.query<any>("insert into storage.objects (id, bucket_id, name, metadata) values ($1, $2, $3, $4) returning id", [randomUUID(), bucket, name, metadata])).rows[0].id;
          return json(res, 200, { Id: id, Key: `${bucket}/${name}` });
        }
      }
      return fail(res, 404, "not_found", `no stand-in route for ${method} ${url.pathname}`);
    } catch (error) {
      return fail(res, 500, "internal", (error as Error).message);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const put = async (bucket: string, name: string, bytes: Buffer, contentType: string) => {
    mkdirSync(join(dir, bucket), { recursive: true });
    writeFileSync(blob(bucket, name), bytes);
    const metadata = { eTag: `"${createHash("md5").update(bytes).digest("hex")}"`, size: bytes.length, mimetype: contentType, cacheControl: "max-age=3600", lastModified: new Date().toISOString(), contentLength: bytes.length, httpStatusCode: 200 };
    // Seeding only: the row may already exist AND be pinned by an order (its
    // guard trigger refuses updates), so metadata is written with triggers
    // suspended, in one serialized transaction.
    await serial(async () => {
      await connection.query("begin");
      try {
        await connection.query("set local session_replication_role = replica");
        await connection.query(
          "insert into storage.objects (id, bucket_id, name, metadata) values ($1, $2, $3, $4) on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()",
          [randomUUID(), bucket, name, metadata],
        );
        await connection.query("commit");
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    });
  };
  return {
    url: `http://127.0.0.1:${port}`,
    serviceKey,
    put,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
