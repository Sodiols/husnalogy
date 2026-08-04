// Customized order integrity schema contract (spec §5, §7, §10, §33, §35,
// §38, §39).
//
// The application-level guarantees in lib/customizer/order-snapshots.ts only
// hold if the database enforces them too. These assertions pin the migration
// and the consolidated schema to the constraints those guarantees rely on.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const canonical = readFileSync(path.join(root, "supabase", "customizer_v2.sql"), "utf8");
const baseSchema = readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");
const migration = readFileSync(
  path.join(root, "supabase", "migrations", "20260804120000_customizer_order_integrity.sql"),
  "utf8",
);
const sources = { migration, canonical };

function bothContain(pattern: RegExp) {
  for (const [name, sql] of Object.entries(sources)) {
    expect(sql, `expected ${name} to match ${pattern}`).toMatch(pattern);
  }
}

describe("duplicate snapshot protection", () => {
  it("adds a unique index per order item and customization", () => {
    bothContain(/create unique index if not exists\s+uniq_order_design_snapshot_item_customization/i);
    bothContain(/create unique index if not exists\s+uniq_order_design_snapshot_order_customization/i);
  });

  it("scopes the partial indexes so a detached snapshot is still allowed", () => {
    // order_item_id is nullable by design, so the pair index must be partial
    // or a second snapshot with a null item would violate it spuriously.
    bothContain(/uniq_order_design_snapshot_item_customization[\s\S]{0,220}?where order_item_id is not null/i);
  });
});

describe("transactional order creation", () => {
  it("defines the service-role-only order function", () => {
    bothContain(/create or replace function public\.create_customized_order\(/i);
    bothContain(/if auth\.role\(\) <> 'service_role' then\s*\r?\n?\s*raise exception 'service role required'/i);
    bothContain(/revoke all on function public\.create_customized_order\(jsonb, jsonb, jsonb\) from public, anon, authenticated/i);
    bothContain(/grant execute on function public\.create_customized_order\(jsonb, jsonb, jsonb\) to service_role/i);
  });

  it("attaches each snapshot to the real inserted order item, not a client id", () => {
    // The function resolves the client's opaque "ref" through the ids it just
    // inserted; a snapshot that cannot be resolved aborts the transaction.
    bothContain(/v_item_refs\s*:=\s*v_item_refs\s*\|\|\s*jsonb_build_object\(coalesce\(v_item->>'ref'/i);
    bothContain(/v_item_id\s*:=\s*nullif\(v_item_refs->>\(v_snapshot->>'item_ref'\), ''\)::uuid/i);
    bothContain(/raise exception 'snapshot for customization % has no matching order item/i);
  });

  it("refuses to commit when a required snapshot went missing", () => {
    bothContain(/if v_inserted_snapshots <> v_expected_snapshots then/i);
    bothContain(/raise exception 'expected % order design snapshots but inserted %'/i);
  });

  it("replays an identical submission instead of creating a duplicate order", () => {
    bothContain(/where idempotency_key = v_idempotency_key/i);
    bothContain(/'reused', true/i);
    bothContain(/create unique index if not exists\s+uniq_orders_idempotency_key/i);
    expect(baseSchema).toMatch(/create unique index if not exists\s+uniq_orders_idempotency_key/i);
  });
});

describe("snapshot immutability", () => {
  it("keeps the design payload frozen and only render metadata mutable", () => {
    bothContain(/raise exception 'order design snapshots are immutable'/i);
    const trigger = migration.match(/mutable_columns text\[\] :=([\s\S]*?)\];/i)?.[1] || "";
    // Only operational fields may change after an order is accepted.
    for (const column of ["print_files", "preview_files", "render_status", "render_error_code", "render_attempt_count"]) {
      expect(trigger).toContain(column);
    }
    // Design identity must never appear in the mutable list.
    for (const column of ["snapshot", "integrity_hash", "customization_id", "template_version", "pricing"]) {
      expect(trigger).not.toMatch(new RegExp(`'${column}'`));
    }
  });
});

describe("render job linkage and failure visibility", () => {
  it("links a production job to the snapshot and order item it renders", () => {
    bothContain(/alter table public\.customizer_render_jobs[\s\S]{0,300}?add column if not exists snapshot_id uuid references public\.order_design_snapshots\(id\)/i);
    bothContain(/add column if not exists order_item_id uuid references public\.order_items\(id\)/i);
  });

  it("records a queue failure as a real status with its error", () => {
    bothContain(/render_status in \([\s\S]{0,220}?'queue_failed'/i);
    bothContain(/add column if not exists render_error_code text/i);
    bothContain(/add column if not exists render_error_message text/i);
    bothContain(/add column if not exists render_attempt_count integer not null default 0/i);
  });

  it("indexes the health queries the admin view depends on", () => {
    bothContain(/create index if not exists idx_order_design_snapshots_render_status/i);
    bothContain(/create index if not exists idx_render_jobs_snapshot/i);
  });
});

describe("production status stays separate from order status", () => {
  it("constrains production_status to the defined lifecycle", () => {
    for (const status of [
      "not_required", "snapshot_pending", "snapshot_ready", "render_queued",
      "rendering", "render_ready", "attention_required", "failed",
    ]) {
      bothContain(new RegExp(`production_status[\\s\\S]{0,400}?'${status}'`, "i"));
    }
    expect(baseSchema).toMatch(/production_status text not null default 'not_required'/i);
  });

  it("does not alter the customer-facing orders.status column", () => {
    expect(migration).not.toMatch(/alter table public\.orders[\s\S]{0,200}?(?:drop column|alter column)\s+status\b/i);
  });
});

describe("draft conflict protection", () => {
  it("adds a revision counter advanced only by real content changes", () => {
    bothContain(/alter table public\.product_customizations[\s\S]{0,120}?add column if not exists revision integer not null default 0/i);
    bothContain(/create or replace function public\.bump_product_customization_revision\(\)/i);
    bothContain(/new\.values is distinct from old\.values/i);
  });
});

describe("migration safety", () => {
  it("is idempotent and never destroys existing data", () => {
    const executable = migration.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(executable).not.toMatch(/\b(?:drop\s+table|drop\s+schema|truncate|delete\s+from)\b/i);
    // Every add-column is guarded, so re-running the migration is safe.
    const addColumns = executable.match(/add column(?!\s+if not exists)/gi) || [];
    expect(addColumns).toHaveLength(0);
  });

  it("does not modify a historical migration", () => {
    // The new work lives in its own timestamped file.
    expect(migration).toContain("create_customized_order");
    const older = readFileSync(
      path.join(root, "supabase", "migrations", "20260726120000_customizer_public_versioning.sql"),
      "utf8",
    );
    expect(older).not.toContain("create_customized_order");
  });
});
