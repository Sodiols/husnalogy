import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/lib/testing/pglite-supabase";
import { callCheckoutRpc, orderPayload, seedCheckoutFixtures, USERS } from "@/lib/testing/checkout-fixtures";

const migration = "20261002120000_snapshot_owned_production.sql";
describe("forward migration preserves actual accepted history", () => {
  it("applies when the production-mode constraint already exists", async () => {
    const t = await createTestDatabase(process.cwd(), migration);
    try {
      await t.db.exec("alter table public.order_design_snapshots add column production_mode text not null default 'legacy'; alter table public.order_design_snapshots add constraint snapshot_production_mode_check check (production_mode in ('automatic','manual','legacy'));");
      await t.db.exec(readFileSync(join(process.cwd(), "supabase/migrations", migration), "utf8"));
      expect((await t.db.query("select convalidated from pg_constraint where conrelid='public.order_design_snapshots'::regclass and conname='snapshot_production_mode_check'")).rows).toEqual([{ convalidated: true }]);
    } finally { await t.close(); }
  }, 120_000);

  it("keeps old orders, customers, tasks and snapshots and explicitly marks incomplete legacy designs", async () => {
    const t = await createTestDatabase(process.cwd(), migration);
    try {
      await seedCheckoutFixtures(t);
      const accepted = await callCheckoutRpc(t, await orderPayload(t));
      const snapshot = (await t.db.query<any>("select * from public.order_design_snapshots where order_id=$1", [accepted.order_id])).rows[0];
      const tasks = (await t.db.query<any>("select id from public.production_tasks where order_id=$1", [accepted.order_id])).rows;
      await t.db.exec(readFileSync(join(process.cwd(), "supabase/migrations", migration), "utf8"));
      const migrated = (await t.db.query<any>("select * from public.order_design_snapshots where id=$1", [snapshot.id])).rows[0];
      expect(migrated).toMatchObject({ snapshot_schema_version: 0, production_mode: "legacy", render_status: "remediation_required", integrity_hash: snapshot.integrity_hash, snapshot: snapshot.snapshot });
      expect((await t.db.query<any>("select checkout_state from public.orders where id=$1", [accepted.order_id])).rows[0].checkout_state).toBe("finalized");
      expect((await t.db.query<any>("select id from public.production_tasks where order_id=$1", [accepted.order_id])).rows).toEqual(tasks);
      expect((await t.db.query("select id from auth.users where id=$1", [USERS.customerA.id])).rows).toHaveLength(1);
      expect((await t.db.query("select * from public.order_production_assets where snapshot_id=$1", [snapshot.id])).rows).toHaveLength(0);
      // Successful replays must preserve accepted legacy history and its state.
      await t.db.exec(readFileSync(join(process.cwd(), "supabase/migrations", migration), "utf8"));
      await t.db.exec(readFileSync(join(process.cwd(), "supabase/migrations", migration), "utf8"));
      expect((await t.db.query<any>("select * from public.order_design_snapshots where id=$1", [snapshot.id])).rows[0]).toEqual(migrated);
      expect((await t.db.query<any>("select id from public.production_tasks where order_id=$1", [accepted.order_id])).rows).toEqual(tasks);
      await expect(t.asService(db => db.query("delete from public.products where id=$1", [snapshot.product_id]))).rejects.toThrow(/DEPENDENT_PRODUCTION/);
    } finally { await t.close(); }
  }, 120_000);
});
