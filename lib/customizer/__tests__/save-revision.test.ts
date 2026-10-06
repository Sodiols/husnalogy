import { describe, expect, it } from "vitest";
import { parseClientRevision, storedClientRevision, writeWithRevisionGuard, type RevisionGuardStore } from "../save-revision";
import { prepareCustomerWrite } from "../customization-write";

type Row = { updated_at: string; status: string; order_id: string | null; render_data: { clientRevision?: number; title?: string } };

/** An in-memory row with the same compare-and-swap semantics as the PATCH route's update. */
function memoryRow(initial: Row) {
  let row = { ...initial };
  let tick = 0;
  const stamp = () => `2026-10-05T10:00:00.${String(++tick).padStart(3, "0")}Z`;
  return {
    get: () => row,
    /** A writer outside the guard (another request) changes the row. */
    externalWrite(renderData: Row["render_data"]) {
      row = { ...row, render_data: renderData, updated_at: stamp() };
    },
    store(revision: number, title: string, beforeWrite?: () => void): RevisionGuardStore<Row> {
      return {
        read: async () => ({ row, error: null }),
        write: async (current) => {
          beforeWrite?.();
          // The update's WHERE clause: same row version, not ordered.
          if (row.updated_at !== current.updated_at || row.status === "ordered" || row.order_id) return { row: null, error: null };
          row = { ...row, render_data: { clientRevision: revision, title }, updated_at: stamp() };
          return { row, error: null };
        },
        isLocked: (current) => current.status === "ordered" || Boolean(current.order_id),
        revision: (current) => storedClientRevision(current.render_data),
      };
    },
  };
}

const base: Row = { updated_at: "2026-10-05T10:00:00.000Z", status: "draft", order_id: null, render_data: { clientRevision: 4, title: "v4" } };

describe("writeWithRevisionGuard", () => {
  it("accepts a newer revision", async () => {
    const db = memoryRow(base);
    const result = await writeWithRevisionGuard(5, db.get(), db.store(5, "v5"));
    expect(result.ok).toBe(true);
    expect(db.get().render_data).toEqual({ clientRevision: 5, title: "v5" });
  });

  it("refuses an older revision that arrives after a newer one (queue save landing after the unload keepalive)", async () => {
    const db = memoryRow(base);
    // The keepalive with the newest state lands first...
    expect((await writeWithRevisionGuard(7, db.get(), db.store(7, "v7"))).ok).toBe(true);
    // ...then the autosave that was already in flight with an older state.
    const stale = await writeWithRevisionGuard(5, db.get(), db.store(5, "v5"));
    expect(stale).toEqual({ ok: false, reason: "stale", storedRevision: 7 });
    expect(db.get().render_data.title).toBe("v7");
  });

  it("accepts an equal revision — the same state sent twice", async () => {
    const db = memoryRow({ ...base, render_data: { clientRevision: 6, title: "v6" } });
    expect((await writeWithRevisionGuard(6, db.get(), db.store(6, "v6"))).ok).toBe(true);
  });

  it("re-checks after losing a race, so a newer write that slipped in between is never overwritten", async () => {
    const db = memoryRow(base);
    const initial = db.get();
    // Between this request's read and its write, a newer revision lands.
    const result = await writeWithRevisionGuard(5, initial, db.store(5, "v5", () => {
      if (db.get().render_data.clientRevision === 4) db.externalWrite({ clientRevision: 9, title: "v9" });
    }));
    expect(result).toEqual({ ok: false, reason: "stale", storedRevision: 9 });
    expect(db.get().render_data.title).toBe("v9");
  });

  it("retries the swap when a write with an OLDER revision slipped in between", async () => {
    const db = memoryRow(base);
    let raced = false;
    const result = await writeWithRevisionGuard(8, db.get(), db.store(8, "v8", () => {
      if (!raced) {
        raced = true;
        db.externalWrite({ clientRevision: 6, title: "v6" });
      }
    }));
    expect(result.ok).toBe(true);
    expect(db.get().render_data).toEqual({ clientRevision: 8, title: "v8" });
  });

  it("treats rows saved before revisions existed as revision 0", async () => {
    const db = memoryRow({ ...base, render_data: { title: "legacy" } });
    expect((await writeWithRevisionGuard(1, db.get(), db.store(1, "v1"))).ok).toBe(true);
  });

  it("never writes an ordered design", async () => {
    const db = memoryRow({ ...base, status: "ordered" });
    expect(await writeWithRevisionGuard(50, db.get(), db.store(50, "v50"))).toEqual({ ok: false, reason: "locked" });
  });
});

describe("client revision input", () => {
  it("accepts only non-negative safe integers", () => {
    expect(parseClientRevision(12)).toBe(12);
    expect(parseClientRevision("12")).toBe(12);
    expect(parseClientRevision(undefined)).toBeNull();
    expect(parseClientRevision(-1)).toBeNull();
    expect(parseClientRevision(1.5)).toBeNull();
    expect(parseClientRevision(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
    expect(parseClientRevision("x")).toBeNull();
  });

  it("passes a valid revision through the customer write filter and rejects a malformed one", () => {
    const ok = prepareCustomerWrite({ values: {}, clientRevision: 3 }, { productId: "p", templateId: "t", templateVersion: 1 });
    expect(ok.ok && ok.body.clientRevision).toBe(3);
    const bad = prepareCustomerWrite({ values: {}, clientRevision: "drop table" }, { productId: "p", templateId: "t", templateVersion: 1 });
    expect(bad.ok).toBe(false);
  });
});
