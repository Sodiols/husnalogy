import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Order creation must never leave a partial/orphaned row behind. Supabase's
// REST client has no cross-table transaction, so lib/orders/index.ts uses a
// compensation strategy: each critical step that can fail after the order row
// exists deletes that row before throwing.
//
// CRITICAL SUBTLETY these tests pin: the Supabase JS client RESOLVES with
// `{ error }` rather than throwing, so a rollback wrapped only in try/catch
// silently "succeeds" even when the delete failed. Every rollback and every
// state-sync mutation must inspect the returned error explicitly.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const orders = read("lib/orders/index.ts");
const snapshots = read("lib/customizer/order-snapshots.ts");
const renderJobs = read("lib/customizer/render-jobs.ts");

describe("shared rollback helper inspects real Supabase errors", () => {
  const helperIndex = orders.indexOf("async function rollbackPartialOrder(");
  const helperBody = orders.slice(helperIndex, orders.indexOf("\n}\n", helperIndex));

  it("exists as one shared helper rather than duplicated inline cleanup", () => {
    expect(helperIndex).toBeGreaterThan(-1);
    // No rollback path may call delete directly any more.
    const strayDeletes = orders.match(/try \{\s*await supabase\.from\("orders"\)\.delete\(\)/g) || [];
    expect(strayDeletes).toHaveLength(0);
  });

  it("destructures and checks the returned error instead of relying on a throw", () => {
    expect(helperBody).toContain("const { error } = await supabase.from(\"orders\").delete().eq(\"id\", orderId);");
    expect(helperBody).toContain("if (error) {");
  });

  it("reports whether the rollback genuinely succeeded", () => {
    expect(helperBody).toContain("return { rolledBack: false };");
    expect(helperBody).toContain("return { rolledBack: true };");
  });

  it("logs a distinctive, searchable marker when a partial order survives", () => {
    expect(helperBody).toContain("ORDER_ROLLBACK_FAILED");
    expect(helperBody).toContain("needs manual review");
  });

  it("still handles a genuine transport-level throw", () => {
    expect(helperBody).toContain("catch (thrown)");
  });
});

describe("order_items insert failure rolls back the order", () => {
  it("routes the order_items failure through the shared rollback helper", () => {
    const itemErrorIndex = orders.indexOf("if (itemError) {");
    expect(itemErrorIndex).toBeGreaterThan(-1);
    const block = orders.slice(itemErrorIndex, itemErrorIndex + 600);
    expect(block).toContain('rollbackPartialOrder(supabase, data.id, "order_items")');
    expect(block).toContain('wrapped.code = "ORDER_ITEMS_FAILED"');
    expect(block).toContain("wrapped.rolledBack = rolledBack;");
  });

  it("surfaces the rollback as a customer-facing rejection, not a 500", () => {
    expect(orders).toContain('error?.code === "ORDER_SNAPSHOT_FAILED" || error?.code === "ORDER_ITEMS_FAILED"');
  });

  it("routes the snapshot failure through the same helper", () => {
    const verdictIndex = orders.indexOf("if (!verdict.ok)");
    const block = orders.slice(verdictIndex, verdictIndex + 600);
    expect(block).toContain('rollbackPartialOrder(supabase, data.id, "order_design_snapshots")');
    expect(block).toContain("error.rolledBack = rolledBack;");
  });

  it("only marks customizations ordered after both order_items and snapshots exist", () => {
    const itemsInsertIndex = orders.indexOf('.from("order_items")');
    const snapshotIndex = orders.indexOf("createOrderDesignSnapshots(order");
    const orderedIndex = orders.indexOf('status: "ordered"');
    expect(itemsInsertIndex).toBeGreaterThan(-1);
    expect(snapshotIndex).toBeGreaterThan(itemsInsertIndex);
    expect(orderedIndex).toBeGreaterThan(snapshotIndex);
  });
});

describe("ordered-customization lock failure preserves the valid order", () => {
  it("inspects the returned error rather than assuming a throw", () => {
    expect(orders).toContain("const { error: lockError } = await supabase");
    expect(orders).toContain("if (lockError) {");
  });

  it("does NOT roll back the order — the immutable snapshot already exists", () => {
    const lockIndex = orders.indexOf("if (lockError) {");
    const lockBlock = orders.slice(lockIndex, lockIndex + 900);
    expect(lockBlock).not.toContain("rollbackPartialOrder");
    expect(lockBlock).toContain("CUSTOMIZATION_LOCK_FAILED");
  });

  it("records the desync so Admin can see and resynchronise it", () => {
    expect(orders).toContain("recordOrderProductionIssue(supabase, data.id, {");
    expect(orders).toContain('code: "CUSTOMIZATION_LOCK_FAILED"');
  });

  it("stores production issues on the order metadata without unbounded growth", () => {
    expect(orders).toContain("metadata.productionIssues = issues.slice(-20);");
  });
});

describe("asynchronous render processing is separate from order integrity", () => {
  // The render-queue catch block runs from `} catch (queueError) {` up to the
  // `created += 1;` that follows it. Bounding the slice there keeps the outer
  // per-item catch (which legitimately calls failures.push) out of the window.
  const queueCatchIndex = snapshots.indexOf("} catch (queueError) {");
  const queueCatchBody = snapshots.slice(queueCatchIndex, snapshots.indexOf("created += 1;", queueCatchIndex));

  it("catches render-enqueue failures locally instead of failing the snapshot (and therefore the order)", () => {
    const enqueueIndex = snapshots.indexOf("enqueueRenderJob(");
    expect(enqueueIndex).toBeGreaterThan(-1);
    expect(queueCatchIndex).toBeGreaterThan(enqueueIndex);
    expect(queueCatchBody).not.toContain("failures.push");
    expect(queueCatchBody).not.toContain("throw ");
  });

  it("marks the snapshot render_status=failed so a never-queued render is visible, not silently 'pending'", () => {
    expect(queueCatchBody).toContain('render_status: "failed"');
    expect(queueCatchBody).toContain("RENDER_ENQUEUE_FAILED");
  });

  it("stores diagnostic context for the failed enqueue", () => {
    expect(queueCatchBody).toContain("renderQueueError");
    expect(queueCatchBody).toContain("at: new Date().toISOString()");
  });

  it("still counts the snapshot as created when only the render queue failed", () => {
    const enqueueIndex = snapshots.indexOf("enqueueRenderJob(");
    const createdIndex = snapshots.indexOf("created += 1;", enqueueIndex);
    expect(createdIndex).toBeGreaterThan(enqueueIndex);
  });

  it("checks the returned error when flipping the snapshot to queued", () => {
    expect(snapshots).toContain("const { error: queuedStatusError }");
    expect(snapshots).toContain("RENDER_STATUS_SYNC_FAILED");
  });
});

describe("render worker state sync inspects returned errors", () => {
  it("checks the print_files write on the customization", () => {
    expect(renderJobs).toContain("const { error: printFilesError }");
    expect(renderJobs).toContain("PRINT_FILES_SYNC_FAILED");
  });

  it("fails the job rather than reporting success when the order snapshot cannot be updated", () => {
    expect(renderJobs).toContain("const { error: snapshotSyncError }");
    expect(renderJobs).toContain("Could not attach production files to order");
  });

  it("checks cleanup errors on the failure path so orphaned outputs are visible", () => {
    expect(renderJobs).toContain("const { error: outputCleanupError }");
    expect(renderJobs).toContain("const { error: storageCleanupError }");
    expect(renderJobs).toContain("const { error: snapshotStatusError }");
  });
});
