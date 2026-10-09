/**
 * Target identification and guards for every backup / restore tool.
 *
 * Backups READ from a source (production included) and never write to it.
 * Restores WRITE, so they are refused unless the target:
 *   - is not a known production project (PRODUCTION_PROJECT_REFS, the
 *     HUSNALOGY_PRODUCTION_SUPABASE_REFS list, and the project configured in
 *     `.env.local`, which the running app uses and is treated as production);
 *   - resolves to ONE identity across its Supabase URL and database URL;
 *   - is confirmed explicitly with RESTORE_CONFIRM_TARGET=<that identity>.
 *
 * Secrets are never printed: only identities (project ref or local host:port).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PRODUCTION_PROJECT_REFS, parseEnvFile } from "../../staging/staging-env.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Identity of a Supabase API URL: the project ref, or local:<host>:<port>. */
export function supabaseTargetId(url) {
  const parsed = new URL(String(url));
  if (LOCAL_HOSTS.has(parsed.hostname)) return `local:${parsed.hostname}:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`;
  if (parsed.hostname.endsWith(".supabase.co")) return parsed.hostname.split(".")[0];
  return `host:${parsed.hostname}`;
}

/**
 * Identity of a Postgres connection string. Supabase direct connections are
 * db.<ref>.supabase.co; pooler connections carry the ref in the user name
 * (postgres.<ref>@aws-0-<region>.pooler.supabase.com).
 */
export function databaseTargetId(databaseUrl) {
  const parsed = new URL(String(databaseUrl));
  const host = parsed.hostname;
  if (LOCAL_HOSTS.has(host)) return `local:${host}:${parsed.port || "5432"}`;
  const direct = host.match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
  if (direct) return direct[1];
  const pooled = decodeURIComponent(parsed.username).match(/^[a-z_]+\.([a-z0-9]{20})$/);
  if (pooled && host.endsWith(".pooler.supabase.com")) return pooled[1];
  return `host:${host}`;
}

/** Every identity that must be treated as production. */
export function productionIdentities(root = process.cwd()) {
  const ids = new Set(PRODUCTION_PROJECT_REFS);
  for (const value of String(process.env.HUSNALOGY_PRODUCTION_SUPABASE_REFS || "").split(",")) {
    if (value.trim()) ids.add(value.trim());
  }
  const local = join(root, ".env.local");
  if (existsSync(local)) {
    const url = parseEnvFile(local).NEXT_PUBLIC_SUPABASE_URL;
    if (url) {
      try {
        ids.add(supabaseTargetId(url));
      } catch {
        // an unparsable .env.local URL is simply not an identity
      }
    }
  }
  return ids;
}

export function describeTarget(id, root = process.cwd()) {
  return { id, kind: productionIdentities(root).has(id) ? "production" : id.startsWith("local:") ? "local" : "remote" };
}

/**
 * Refuse a restore unless the target is provably not production and was
 * confirmed by identity. Returns the identity.
 */
export function assertRestoreTarget({ supabaseUrl = "", databaseUrl = "", confirm = "", root = process.cwd() }) {
  const ids = [];
  if (supabaseUrl) ids.push(supabaseTargetId(supabaseUrl));
  if (databaseUrl) ids.push(databaseTargetId(databaseUrl));
  if (!ids.length) throw new Error("REFUSED: no restore target given.");
  if (new Set(ids).size !== 1) throw new Error(`REFUSED: the Supabase URL and database URL point at different targets (${ids.join(" vs ")}).`);
  const id = ids[0];
  if (productionIdentities(root).has(id)) throw new Error(`REFUSED: ${id} is a production project (or the project in .env.local). Restores never write to it; restore into a new, isolated project.`);
  if (confirm !== id) throw new Error(`REFUSED: set RESTORE_CONFIRM_TARGET=${id} after verifying this is the isolated recovery target.`);
  return id;
}

/** Read KEY=value pairs from an explicit file (no implicit .env.local fallback). */
export function readEnvFile(path) {
  if (!path) return {};
  if (!existsSync(path)) throw new Error(`BLOCKED: environment file not found: ${path}`);
  return parseEnvFile(path);
}

/** The first non-empty value among the named keys of `sources` (in order). */
export function pick(sources, names) {
  for (const source of sources) {
    for (const name of names) if (source && source[name]) return String(source[name]);
  }
  return "";
}

/**
 * Like pick(), but REFUSES ambiguous configuration: if the named settings hold
 * two different non-empty values (e.g. RESTORE_DATABASE_URL and
 * STAGING_DATABASE_URL pointing at different databases), nothing is guessed.
 */
export function pickOne(sources, names, label = names[0]) {
  const values = new Set();
  for (const source of sources) {
    for (const name of names) if (source && source[name]) values.add(String(source[name]));
  }
  if (values.size > 1) throw new Error(`REFUSED: ambiguous ${label}: ${names.join(" / ")} are set to different values. Keep exactly one.`);
  return values.size ? [...values][0] : "";
}

export function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}

export function isMain(file) {
  return Boolean(process.argv[1]) && process.argv[1].split("\\").join("/").endsWith(file);
}
