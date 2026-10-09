/**
 * PostgreSQL client tools (pg_dump, pg_restore, psql) for backups. They come
 * from HUSNALOGY_PG_BIN (a folder) or PATH, and must be at least the server's
 * major version. Connection passwords travel in PGPASSWORD, never on the
 * command line, and never appear in logs or errors.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

export function pgBin(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  return process.env.HUSNALOGY_PG_BIN ? join(process.env.HUSNALOGY_PG_BIN, exe) : exe;
}

/** libpq arguments + environment for a connection string (password kept out of argv). */
export function connection(databaseUrl) {
  const url = new URL(String(databaseUrl));
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  return {
    args: ["--host", url.hostname, "--port", url.port || "5432", "--username", decodeURIComponent(url.username || "postgres"), "--dbname", decodeURIComponent(url.pathname.replace(/^\//, "") || "postgres")],
    env: {
      PGPASSWORD: decodeURIComponent(url.password || ""),
      PGSSLMODE: url.searchParams.get("sslmode") || (local ? "disable" : "require"),
      PGCONNECT_TIMEOUT: "20",
      PGAPPNAME: "husnalogy-backup",
    },
    pgConfig: {
      host: url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username || "postgres"),
      password: decodeURIComponent(url.password || ""),
      database: decodeURIComponent(url.pathname.replace(/^\//, "") || "postgres"),
      ssl: local || url.searchParams.get("sslmode") === "disable" ? false : { rejectUnauthorized: false },
    },
  };
}

/** Run a client tool; resolves { stdout, stderr }, rejects with stderr on a non-zero exit. */
export function runTool(name, args, { env = {}, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pgBin(name), args, { env: { ...process.env, ...env }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(new Error(`${name} could not start (${error.message}). Install the PostgreSQL client tools or set HUSNALOGY_PG_BIN.`)));
    child.on("close", (code) => {
      const secret = env.PGPASSWORD;
      const clean = (text) => (secret ? text.split(secret).join("***") : text);
      if (code === 0) resolve({ stdout: clean(stdout), stderr: clean(stderr) });
      else reject(new Error(`${name} exited with ${code}: ${clean(stderr).trim().split("\n").slice(-8).join("\n")}`));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function toolMajorVersion(name) {
  const { stdout } = await runTool(name, ["--version"]);
  const match = stdout.match(/(\d+)(?:\.(\d+))?/);
  if (!match) throw new Error(`cannot read the ${name} version from "${stdout.trim()}"`);
  return { major: Number(match[1]), text: stdout.trim() };
}
