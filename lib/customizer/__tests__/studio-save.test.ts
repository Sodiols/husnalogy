import { describe, expect, it, vi } from "vitest";
import {
  asProductSaveResult,
  createRevisionTracker,
  requestTemplatePublication,
  saveThenPublish,
  type TemplatePublishResult,
} from "@/lib/customizer/studio-save";

const published: TemplatePublishResult = { ok: true, displayVersion: "2.001", version: { display: "2.001" }, warnings: [] };

describe("saveThenPublish", () => {
  it("never calls publication after a failed validation", async () => {
    const publish = vi.fn(async () => published);
    const outcome = await saveThenPublish({
      save: async () => ({ ok: false, reason: "validation", error: "Enter a product name." }),
      publish,
    });
    expect(publish).not.toHaveBeenCalled();
    expect(outcome.status).toBe("save-failed");
    expect(outcome.message).toContain("Enter a product name.");
  });

  it("never calls publication after a failed or unconfirmed save", async () => {
    for (const result of [{ ok: false, reason: "request", error: "500" }, undefined, { ok: true }]) {
      const publish = vi.fn(async () => published);
      const outcome = await saveThenPublish({ save: async () => result, publish });
      expect(publish).not.toHaveBeenCalled();
      expect(outcome.status).toBe("save-failed");
    }
  });

  it("publishes the persisted draft by the id the save returned (a new product)", async () => {
    const publish = vi.fn(async () => published);
    const outcome = await saveThenPublish({
      save: async () => ({ ok: true, productId: "product-new", product: { id: "product-new" }, template: { updatedAt: "2026-10-04T07:00:00.123456+00:00" } }),
      publish,
    });
    expect(publish).toHaveBeenCalledWith("product-new", "2026-10-04T07:00:00.123456+00:00");
    expect(outcome).toMatchObject({ status: "published", message: "Published as Version 2.001." });
  });

  it("reports a saved draft whose publication failed truthfully", async () => {
    const outcome = await saveThenPublish({
      save: async () => ({ ok: true, productId: "p", product: {}, template: null }),
      publish: async () => ({ ok: false, conflict: false, error: "Snapshot failed." }),
    });
    expect(outcome.status).toBe("publish-failed");
    expect(outcome.message).toBe("Draft saved, but it was not published: Snapshot failed.");
  });
});

describe("requestTemplatePublication", () => {
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("sends the expected draft revision and parses success", async () => {
    const fetchImpl = respond(200, { ok: true, version: { display: "3" }, warnings: ["w"] });
    const result = await requestTemplatePublication("p 1", { updateType: "major", notes: "n", expectedDraftUpdatedAt: "x" }, fetchImpl);
    expect(result).toMatchObject({ ok: true, displayVersion: "3", warnings: ["w"] });
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("/api/admin/customizer/templates/p%201/publish");
    expect(JSON.parse(init.body)).toEqual({ updateType: "major", notes: "n", expectedDraftUpdatedAt: "x" });
  });

  it("flags a revision conflict and never throws on network failure", async () => {
    expect(await requestTemplatePublication("p", { updateType: "minor", notes: "", expectedDraftUpdatedAt: null }, respond(409, { ok: false, errors: ["changed"], conflict: true })))
      .toEqual({ ok: false, conflict: true, error: "changed" });
    const broken = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect((await requestTemplatePublication("p", { updateType: "minor", notes: "", expectedDraftUpdatedAt: null }, broken)).ok).toBe(false);
  });
});

describe("revision-based dirty tracking", () => {
  it("keeps edits made while a save was running unsaved", () => {
    const revisions = createRevisionTracker();
    revisions.next();
    const sent = revisions.current; // the save captures this revision
    revisions.next(); // an edit lands while the request is in flight
    revisions.markSaved(sent);
    expect(revisions.isDirty()).toBe(true);
    revisions.markSaved(revisions.current);
    expect(revisions.isDirty()).toBe(false);
  });

  it("returns to clean when a preview is cancelled or edits are undone back to the saved revision", () => {
    const revisions = createRevisionTracker();
    revisions.next();
    revisions.markSaved(revisions.current);
    const before = revisions.current;
    revisions.next();
    revisions.next();
    expect(revisions.isDirty()).toBe(true);
    revisions.restore(before);
    expect(revisions.isDirty()).toBe(false);
    // A later edit never reuses a token, so it cannot look "saved" by accident.
    revisions.next();
    expect(revisions.current).not.toBe(before);
    expect(revisions.isDirty()).toBe(true);
  });

  it("only accepts a confirmed save result", () => {
    expect(asProductSaveResult({ ok: true, productId: "p" })).toMatchObject({ ok: true, productId: "p" });
    expect(asProductSaveResult(undefined)).toMatchObject({ ok: false, reason: "request" });
    expect(asProductSaveResult({ ok: false, reason: "busy", error: "x" })).toEqual({ ok: false, reason: "busy", error: "x" });
  });
});
