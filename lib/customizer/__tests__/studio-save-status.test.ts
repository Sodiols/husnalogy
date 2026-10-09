import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asProductSaveResult, describeStudioSaveStatus, studioAutosaveRetryDelayMs, studioMayAutosave } from "../studio-save";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
const base = { hasServerRecord: true, dirty: false, saving: false, failure: null, online: true, canCreateDraft: true };

describe("studio save status: only what the server confirmed is called saved", () => {
  it("Saved only for a confirmed revision of a server record", () => {
    expect(describeStudioSaveStatus(base)).toMatchObject({ primary: "Saved", flags: [], alert: false });
    // A new, untouched design claims nothing.
    expect(describeStudioSaveStatus({ ...base, hasServerRecord: false })).toMatchObject({ primary: "", flags: [] });
  });

  it("Unsaved stays while a save is in flight — sending is not saving", () => {
    expect(describeStudioSaveStatus({ ...base, dirty: true })).toMatchObject({ primary: "Unsaved", flags: [] });
    expect(describeStudioSaveStatus({ ...base, dirty: true, saving: true })).toMatchObject({ primary: "Unsaved", flags: ["Saving…"] });
  });

  it("a design with no server record is Local only, with what it needs to get there", () => {
    const named = describeStudioSaveStatus({ ...base, hasServerRecord: false, dirty: true });
    expect(named).toMatchObject({ primary: "Unsaved", flags: ["Local only"], alert: false });
    expect(named.detail).toContain("saved to the server as a draft automatically");
    const unnamed = describeStudioSaveStatus({ ...base, hasServerRecord: false, dirty: true, canCreateDraft: false });
    expect(unnamed).toMatchObject({ primary: "Unsaved", flags: ["Local only"], alert: true });
    expect(unnamed.detail).toContain("Give the product a name");
  });

  it("a failed save is reported with its reason and that the work is kept; busy is not a failure", () => {
    const failed = describeStudioSaveStatus({ ...base, dirty: true, failure: { reason: "request", error: "Database unavailable." } });
    expect(failed).toMatchObject({ primary: "Unsaved", flags: ["Save failed"], alert: true });
    expect(failed.detail).toContain("Database unavailable.");
    expect(failed.detail).toContain("kept on this device");
    expect(failed.detail).toContain("Retrying automatically");
    const refused = describeStudioSaveStatus({ ...base, dirty: true, failure: { reason: "validation", error: "Enter a product name." } });
    expect(refused.detail).toContain("Not saved to the server — Enter a product name.");
    expect(refused.detail).not.toContain("Retrying");
    expect(describeStudioSaveStatus({ ...base, dirty: true, failure: { reason: "busy", error: "x" } }).flags).toEqual([]);
    // A later success (not dirty) leaves no stale failure on screen.
    expect(describeStudioSaveStatus({ ...base, failure: { reason: "request", error: "old" } })).toMatchObject({ primary: "Saved", flags: [] });
  });

  it("a draft changed elsewhere is a conflict: the work is kept, nothing is retried, the designer chooses", () => {
    const conflict = describeStudioSaveStatus({
      ...base,
      dirty: true,
      failure: { reason: "conflict", error: "This design was changed in another tab or by another person after you opened it." },
    });
    expect(conflict).toMatchObject({ primary: "Unsaved", flags: ["Save failed"], alert: true });
    expect(conflict.detail).toContain("changed in another tab or by another person");
    expect(conflict.detail).toContain("kept on this device");
    expect(conflict.detail).toContain("Keep your version");
    expect(conflict.detail).not.toContain("Retrying");
    expect(asProductSaveResult({ ok: false, reason: "conflict", error: "x" })).toEqual({ ok: false, reason: "conflict", error: "x" });
  });

  it("offline is reported while there is unsaved work", () => {
    const offline = describeStudioSaveStatus({ ...base, dirty: true, online: false });
    expect(offline.flags).toContain("Offline");
    expect(offline.detail).toContain("offline");
    expect(describeStudioSaveStatus({ ...base, online: false }).flags).toEqual([]);
  });

  it("autosave runs only with something to save, a connection, and a server record or the means to create one", () => {
    expect(studioMayAutosave({ hasServerRecord: true, canCreateDraft: false, dirty: true, online: true })).toBe(true);
    expect(studioMayAutosave({ hasServerRecord: false, canCreateDraft: true, dirty: true, online: true })).toBe(true);
    expect(studioMayAutosave({ hasServerRecord: false, canCreateDraft: false, dirty: true, online: true })).toBe(false);
    expect(studioMayAutosave({ hasServerRecord: true, canCreateDraft: true, dirty: false, online: true })).toBe(false);
    expect(studioMayAutosave({ hasServerRecord: true, canCreateDraft: true, dirty: true, online: false })).toBe(false);
  });

  it("retries back off and then settle at a steady interval (never a tight loop)", () => {
    expect([1, 2, 3, 4, 9].map(studioAutosaveRetryDelayMs)).toEqual([5_000, 15_000, 30_000, 60_000, 60_000]);
  });
});

describe("the studio and product form are wired to it", () => {
  it("the form resolves create-vs-update from the id the server returned, synchronously", () => {
    const form = read("app/admin/dashboard/product-upload-form.tsx");
    expect(form).toContain("persistedIdRef.current = String(saved.id);");
    expect(form).toContain('method: savedId ? "PUT" : "POST"');
    expect(form).toContain("canCreateDraft={Boolean(form.title.trim())}");
  });
  it("the header shows the save state at every width", () => {
    const header = read("app/admin/dashboard/design-builder/AdminBuilderHeader.tsx");
    expect(header).toMatch(/<div className="flex items-center gap-1\.5" data-save-status=/);
  });
});
