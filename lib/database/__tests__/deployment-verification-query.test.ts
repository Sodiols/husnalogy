/**
 * HOSTINGER_DEPLOYMENT.md §3 tells the operator to run one SQL query and see
 * `true` on EVERY row. This runs that exact query against the real schema +
 * every migration (PGlite), so the documented check can never drift from the
 * migrations it verifies.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/lib/testing/pglite-supabase";

describe("the documented migration verification query", () => {
  it("returns true on every row of a fully migrated database", async () => {
    const doc = readFileSync("docs/HOSTINGER_DEPLOYMENT.md", "utf8");
    const sql = doc.split("```sql")[1].split("```")[0];
    const t = await createTestDatabase();
    try {
      const rows = (await t.db.query<{ migration: string; applied: boolean }>(sql)).rows;
      expect(rows.map((row) => row.migration)).toEqual(expect.arrayContaining(["customer addresses (RLS)", "profile photo storage", "video limit = app limit"]));
      expect(rows.filter((row) => row.applied !== true).map((row) => row.migration)).toEqual([]);
    } finally {
      await t.close();
    }
  }, 120_000);
});
