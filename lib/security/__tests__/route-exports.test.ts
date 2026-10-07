/**
 * A route file (app/**\/route.ts) may export only HTTP handlers and route
 * segment config. Anything else (a shared constant, a helper) fails the
 * production build's type check — `next build` rejected
 * `export const ADDRESS_RATE_LIMIT` in app/api/account/addresses/route.ts —
 * while a plain `tsc --noEmit` without generated route types passes. This
 * catches it in the unit suite instead of on the deploy server.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "../../../app");
const ALLOWED = new Set([
  "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS",
  "dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime", "preferredRegion", "maxDuration", "generateStaticParams",
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return /^route\.(ts|tsx|js|mjs)$/.test(name) ? [full] : [];
  });
}

describe("route files export only handlers and segment config", () => {
  it("no route file exports anything else", () => {
    const offenders: string[] = [];
    for (const file of routeFiles(APP)) {
      const source = readFileSync(file, "utf8");
      const names = [
        ...source.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm),
      ].map((match) => match[1]);
      for (const list of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        names.push(...list[1].split(",").map((entry) => entry.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean));
      }
      if (/^export\s+default\b/m.test(source)) names.push("default");
      for (const name of names) if (!ALLOWED.has(name)) offenders.push(`${path.relative(APP, file)}: ${name}`);
    }
    expect(offenders).toEqual([]);
  });
});
