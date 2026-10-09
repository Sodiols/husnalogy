/**
 * Backup SOURCE identity: proves that the database and the Storage API a
 * backup reads belong to ONE Supabase project — the one the operator approved
 * — before any backup artifact is created. There is deliberately no switch
 * that disables these checks.
 *
 * 1. Static checks (resolveBackupSource): BACKUP_ENVIRONMENT is production,
 *    staging or local; BACKUP_EXPECTED_PROJECT_REF is set; the database
 *    connection string resolves to a project ref (direct db.<ref>.supabase.co
 *    or pooler user postgres.<ref>), equal to the expected ref; the API URL
 *    resolves to the same ref (or is a custom domain, see 2); a legacy JWT
 *    service key, when used, names the same ref and the service_role; the
 *    environment matches the project (a production ref is never "staging", a
 *    non-production ref is never "production").
 *
 * 2. Live cross-check (verifyLiveIdentity), always: the Storage buckets seen
 *    through PostgreSQL (storage.buckets) and through the Storage API must be
 *    the same set with the same public flags and creation times, and a sample
 *    of the newest objects (storage.objects ids) must be served by the API
 *    under the same ids. Two projects built from the same migrations still
 *    differ in those timestamps and ids. If neither signal is available the
 *    identity is "not established" and the backup is refused.
 */
import { databaseTargetId, productionIdentities, supabaseTargetId } from "./target.mjs";

export const BACKUP_ENVIRONMENTS = ["production", "staging", "local"];
const PROJECT_REF = /^[a-z0-9]{20}$/;

export class BackupIdentityError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupIdentityError";
    this.stage = "identity";
  }
}

function parseUrl(value, label) {
  try {
    const url = new URL(String(value || ""));
    if (!url.hostname) throw new Error("no host");
    return url;
  } catch {
    throw new BackupIdentityError(`BLOCKED: ${label} is missing or is not a valid URL.`);
  }
}

/** Claims of a legacy JWT key (never the key itself); null for sb_secret_ keys. */
function jwtClaims(key) {
  const parts = String(key).split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Static validation. Returns { environment, ref, databaseId, apiId, customDomain }.
 * Throws BackupIdentityError (never printing secrets) on any doubt.
 */
export function resolveBackupSource({ environment, expectedRef, databaseUrl, supabaseUrl, serviceRoleKey, root = process.cwd() }) {
  if (!BACKUP_ENVIRONMENTS.includes(environment)) throw new BackupIdentityError(`BLOCKED: BACKUP_ENVIRONMENT must be one of ${BACKUP_ENVIRONMENTS.join(", ")}.`);
  if (!expectedRef) throw new BackupIdentityError("BLOCKED: BACKUP_EXPECTED_PROJECT_REF is not set. Set it to the project ref you approved for this backup.");
  const db = parseUrl(databaseUrl, "BACKUP_DATABASE_URL");
  if (!/^postgres(ql)?:$/.test(db.protocol)) throw new BackupIdentityError("BLOCKED: BACKUP_DATABASE_URL must be a postgresql:// connection string.");
  if (!db.username) throw new BackupIdentityError("BLOCKED: BACKUP_DATABASE_URL has no user name (malformed credentials).");
  parseUrl(supabaseUrl, "the Supabase project URL");
  const key = String(serviceRoleKey || "");
  if (key.length < 20 || /\s/.test(key)) throw new BackupIdentityError("BLOCKED: the service-role key is missing or malformed.");

  const databaseId = databaseTargetId(databaseUrl);
  const apiId = supabaseTargetId(supabaseUrl);
  let customDomain = false;
  if (environment === "local") {
    if (!databaseId.startsWith("local:") || !apiId.startsWith("local:")) throw new BackupIdentityError("REFUSED: BACKUP_ENVIRONMENT=local accepts only local database and API addresses.");
  } else {
    if (!PROJECT_REF.test(databaseId)) {
      throw new BackupIdentityError(`REFUSED: the database connection string does not identify a Supabase project (${databaseId}). Use the direct connection (db.<ref>.supabase.co) or the session pooler (user postgres.<ref>).`);
    }
    if (PROJECT_REF.test(apiId)) {
      if (apiId !== databaseId) throw new BackupIdentityError(`REFUSED: the database belongs to ${databaseId} but the Storage/API URL to ${apiId}. A backup must read ONE project.`);
    } else if (apiId.startsWith("host:")) {
      customDomain = true; // proven by the live cross-check, never assumed
    } else {
      throw new BackupIdentityError(`REFUSED: unrecognized API URL identity (${apiId}).`);
    }
  }
  if (expectedRef !== databaseId) throw new BackupIdentityError(`REFUSED: BACKUP_EXPECTED_PROJECT_REF is ${expectedRef} but the database is ${databaseId}.`);
  const claims = jwtClaims(key);
  if (claims) {
    if (claims.role && claims.role !== "service_role") throw new BackupIdentityError("REFUSED: the key is not a service-role key.");
    if (claims.ref && environment !== "local" && claims.ref !== databaseId) throw new BackupIdentityError(`REFUSED: the service-role key belongs to ${claims.ref}, not ${databaseId}.`);
  }
  const production = productionIdentities(root);
  if (environment === "production" && !production.has(databaseId)) {
    throw new BackupIdentityError(`REFUSED: BACKUP_ENVIRONMENT=production but ${databaseId} is not a registered production project (PRODUCTION_PROJECT_REFS / HUSNALOGY_PRODUCTION_SUPABASE_REFS).`);
  }
  if (environment === "staging" && production.has(databaseId)) {
    throw new BackupIdentityError(`REFUSED: ${databaseId} is a production project; it cannot be backed up as "staging".`);
  }
  return { environment, ref: databaseId, databaseId, apiId, customDomain };
}

const time = (value) => {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
};

async function columnExists(client, table, column) {
  const { rows } = await client.query("select 1 from information_schema.columns where table_schema = 'storage' and table_name = $1 and column_name = $2", [table, column]);
  return rows.length > 0;
}

/**
 * Live proof that `client` (PostgreSQL) and `storage` (Storage API) are the
 * same project. Read-only. Returns evidence; throws BackupIdentityError.
 */
export async function verifyLiveIdentity({ client, storage, sampleSize = 5 }) {
  const bucketCreated = await columnExists(client, "buckets", "created_at");
  const dbBuckets = (await client.query(`select id, public${bucketCreated ? ", created_at" : ""} from storage.buckets order by id`)).rows;
  const { data, error } = await storage.listBuckets();
  if (error) throw new BackupIdentityError(`REFUSED: the Storage API could not list buckets (${error.message}); identity not established.`);
  const apiBuckets = new Map((data || []).map((bucket) => [bucket.id, bucket]));
  const dbIds = dbBuckets.map((bucket) => bucket.id).join(",");
  const apiIds = [...apiBuckets.keys()].sort().join(",");
  if (dbIds !== apiIds) throw new BackupIdentityError("REFUSED: the database and the Storage API list different buckets — they are not the same project.");
  let createdMatched = 0;
  for (const bucket of dbBuckets) {
    const api = apiBuckets.get(bucket.id);
    if (Boolean(api.public) !== Boolean(bucket.public)) throw new BackupIdentityError(`REFUSED: bucket ${bucket.id} is ${bucket.public ? "public" : "private"} in the database but not in the Storage API.`);
    const a = time(bucket.created_at);
    const b = time(api.created_at);
    if (a !== null && b !== null) {
      if (Math.abs(a - b) > 1) throw new BackupIdentityError(`REFUSED: bucket ${bucket.id} has a different creation time in the database and in the Storage API — different projects.`);
      createdMatched += 1;
    }
  }
  const objectCreated = await columnExists(client, "objects", "created_at");
  const sample = (await client.query(`select id, bucket_id, name from storage.objects order by ${objectCreated ? "created_at desc nulls last," : ""} id limit $1`, [sampleSize])).rows;
  let objectsMatched = 0;
  for (const object of sample) {
    const slash = object.name.lastIndexOf("/");
    const folder = slash >= 0 ? object.name.slice(0, slash) : "";
    const base = slash >= 0 ? object.name.slice(slash + 1) : object.name;
    const listed = await storage.from(object.bucket_id).list(folder, { limit: 100, search: base });
    if (listed.error) throw new BackupIdentityError(`REFUSED: the Storage API could not list a folder of ${object.bucket_id} (${listed.error.message}); identity not established.`);
    const entry = (listed.data || []).find((candidate) => candidate.name === base);
    if (!entry || String(entry.id) !== String(object.id)) throw new BackupIdentityError(`REFUSED: an object recorded in the database's ${object.bucket_id} bucket is missing or has a different id in the Storage API — different projects.`);
    objectsMatched += 1;
  }
  const established = (dbBuckets.length > 0 && createdMatched === dbBuckets.length) || objectsMatched > 0;
  if (!established) throw new BackupIdentityError("REFUSED: project identity could not be established (no bucket creation times or objects to compare). Not backing up.");
  return { buckets: dbBuckets.length, createdMatched, objectsMatched };
}
