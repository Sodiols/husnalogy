/**
 * Describing a thrown value so a server log is actually actionable, and telling
 * a real failure apart from one of Next.js's internal control-flow signals.
 *
 * Two things went wrong at every `try/catch` around a server data fetch:
 *
 *   1. `console.error("...:", error)` renders as `{}` for anything that is not
 *      an `Error`. `message` and `name` are NON-ENUMERABLE on `Error`, and a
 *      Next.js bailout signal or a Supabase `PostgrestError` carries what
 *      matters somewhere other than its own enumerable keys — so the one line
 *      that was supposed to explain the failure explained nothing, and the
 *      failure could only be diagnosed by adding logging and reproducing it.
 *
 *   2. The catch swallowed EVERYTHING except one hardcoded digest
 *      (`DYNAMIC_SERVER_USAGE`). Next.js aborts a render by THROWING: that is
 *      how `redirect()`, `notFound()`, `forbidden()`, `unauthorized()` and the
 *      dynamic-rendering bailouts all work. Catching one of those and returning
 *      a fallback turns a redirect into a silently wrong page. `unstable_rethrow`
 *      is Next's own answer to this and it knows about every signal, including
 *      ones added after this code was written.
 */

import { unstable_rethrow } from "next/navigation";

/** Own enumerable properties worth printing, minus the ones we name explicitly. */
const DESCRIBED_KEYS = new Set(["message", "name", "stack", "digest", "cause"]);

function describeCause(cause: unknown, depth: number): string {
  if (cause === undefined || cause === null || depth > 2) return "";
  return ` <- caused by ${describeError(cause, depth + 1)}`;
}

/**
 * A one-line, human-readable description of any thrown value.
 *
 * Deliberately never throws itself: a logger that can fail inside a catch block
 * replaces the original problem with a worse one.
 */
export function describeError(error: unknown, depth = 0): string {
  try {
    if (error === null) return "null";
    if (error === undefined) return "undefined";
    if (typeof error === "string") return error;
    if (typeof error !== "object") return String(error);

    const source = error as Record<string, unknown>;
    const parts: string[] = [];

    const name = typeof source.name === "string" ? source.name : error.constructor?.name;
    const message = typeof source.message === "string" ? source.message : "";
    parts.push(message ? `${name || "Error"}: ${message}` : name || "Object");

    // Supabase/Postgrest put the useful part here; Next.js puts it in `digest`.
    for (const key of ["digest", "code", "details", "hint", "status", "statusCode"]) {
      const value = source[key];
      if (value === undefined || value === null || value === "") continue;
      parts.push(`${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
    }

    const extra = Object.keys(source).filter(
      (key) => !DESCRIBED_KEYS.has(key) && !["code", "details", "hint", "status", "statusCode"].includes(key),
    );
    if (extra.length) {
      parts.push(
        `props={${extra
          .slice(0, 8)
          .map((key) => {
            const value = source[key];
            return `${key}: ${typeof value === "object" ? JSON.stringify(value)?.slice(0, 120) : String(value)}`;
          })
          .join(", ")}}`,
      );
    }

    return parts.join(" | ") + describeCause(source.cause, depth);
  } catch {
    return "<unprintable error>";
  }
}

/**
 * Rethrow anything Next.js threw as control flow; otherwise log one actionable
 * line and let the caller fall back.
 *
 * Every server-side `try/catch` around a data fetch should start with this, so
 * that "the page rendered without settings" and "the page tried to redirect"
 * can never be confused for one another again.
 */
export function logServerFailure(context: string, error: unknown): void {
  unstable_rethrow(error);
  console.error(`${context}: ${describeError(error)}`);
}
