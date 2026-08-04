// Guest draft storage honesty (spec §13, §14, §45).
//
// The interface must never display "Saved" when the browser refused the write.
// These tests drive the adapter through every failure the browser can throw:
// storage disabled, quota exhausted, a SecurityError from private browsing,
// and a corrupt or expired entry left behind by an earlier session.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  draftStorageKey,
  guestSaveFailureMessage,
  GUEST_DRAFT_SCHEMA_VERSION,
  GUEST_SAVE_FAILURE_MESSAGE,
  readGuestDraft,
  removeGuestDraft,
  writeGuestDraft,
} from "../guest-draft-storage";

// A minimal localStorage double whose failure mode each test chooses.
// IndexedDB is deliberately left undefined so the adapter exercises its
// documented localStorage fallback path.
type FailureMode = "none" | "quota" | "security" | "unavailable";

function installBrowser(mode: FailureMode) {
  const store = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      if (mode === "unavailable") throw new Error("localStorage is not available");
      if (mode === "security") {
        const error = new Error("The operation is insecure.");
        error.name = "SecurityError";
        throw error;
      }
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      if (mode === "unavailable") throw new Error("localStorage is not available");
      if (mode === "security") {
        const error = new Error("The operation is insecure.");
        error.name = "SecurityError";
        throw error;
      }
      if (mode === "quota") {
        const error = new Error("Exceeded the quota.");
        error.name = "QuotaExceededError";
        throw error;
      }
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };

  (globalThis as any).window = { localStorage, indexedDB: undefined };
  return store;
}

const KEY = draftStorageKey("prod_1", "tmpl_1", 2);
const PAYLOAD = { productId: "prod_1", templateId: "tmpl_1", templateVersion: 2, values: { names: "Aisha\n& Omar" } };

afterEach(() => {
  delete (globalThis as any).window;
});

describe("guest draft writes report the truth", () => {
  it("confirms a successful write with the store that accepted it", async () => {
    installBrowser("none");
    const result = await writeGuestDraft(KEY, PAYLOAD);
    expect(result.ok).toBe(true);
    expect(result.storageType).toBe("localstorage");
    expect(result.draft?.schemaVersion).toBe(GUEST_DRAFT_SCHEMA_VERSION);
    expect(result.draft?.payload.values).toEqual({ names: "Aisha\n& Omar" });
    expect(result.errorCode).toBeUndefined();
  });

  it("reports failure — never a draft — when the quota is exhausted", async () => {
    installBrowser("quota");
    const result = await writeGuestDraft(KEY, PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.draft).toBeNull();
    expect(result.errorCode).toBe("QUOTA_EXCEEDED");
    expect(result.storageType).toBe("none");
  });

  it("reports failure when the browser raises a SecurityError", async () => {
    installBrowser("security");
    const result = await writeGuestDraft(KEY, PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.draft).toBeNull();
    expect(result.storageType).toBe("none");
  });

  it("reports failure when storage is unavailable entirely", async () => {
    installBrowser("unavailable");
    const result = await writeGuestDraft(KEY, PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.draft).toBeNull();
    expect(result.errorCode).toBe("STORAGE_UNAVAILABLE");
  });

  it("reports failure when there is no browser storage at all", async () => {
    (globalThis as any).window = undefined;
    const result = await writeGuestDraft(KEY, PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.draft).toBeNull();
  });
});

describe("guest draft reads", () => {
  it("round-trips a saved draft, preserving line breaks", async () => {
    installBrowser("none");
    await writeGuestDraft(KEY, PAYLOAD);
    const read = await readGuestDraft(KEY);
    expect(read.ok).toBe(true);
    expect((read.draft?.payload.values as any).names).toBe("Aisha\n& Omar");
  });

  it("reports corrupt JSON instead of silently returning an empty design", async () => {
    const store = installBrowser("none");
    store.set(KEY, "{ this is not json");
    const read = await readGuestDraft(KEY);
    expect(read.ok).toBe(false);
    expect(read.errorCode).toBe("INVALID_JSON");
    expect(read.draft).toBeNull();
    // The unusable entry is cleared so the editor is not wedged next time.
    expect(store.has(KEY)).toBe(false);
  });

  it("reports an unreadable draft shape as corrupt", async () => {
    const store = installBrowser("none");
    store.set(KEY, JSON.stringify({ unrelated: true }));
    const read = await readGuestDraft(KEY);
    expect(read.ok).toBe(false);
    expect(read.errorCode).toBe("CORRUPT_DRAFT");
  });

  it("discards an expired draft without reporting an error", async () => {
    const store = installBrowser("none");
    store.set(
      KEY,
      JSON.stringify({
        key: KEY,
        id: "local_old",
        schemaVersion: GUEST_DRAFT_SCHEMA_VERSION,
        productId: "prod_1",
        templateId: "tmpl_1",
        templateVersion: 2,
        updatedAt: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(),
        payload: PAYLOAD,
      }),
    );
    const read = await readGuestDraft(KEY);
    expect(read.ok).toBe(true);
    expect(read.draft).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it("migrates a flat draft written by an earlier editor version", async () => {
    const store = installBrowser("none");
    store.set(KEY, JSON.stringify({ ...PAYLOAD, id: "local_legacy", updatedAt: new Date().toISOString() }));
    const read = await readGuestDraft(KEY);
    expect(read.ok).toBe(true);
    expect(read.draft?.id).toBe("local_legacy");
    expect((read.draft?.payload.values as any).names).toBe("Aisha\n& Omar");
  });

  it("keeps large regenerable previews out of the guest's storage quota", async () => {
    installBrowser("none");
    const result = await writeGuestDraft(KEY, { ...PAYLOAD, previewImages: { front: "data:image/png;base64,AAAA" } });
    expect(result.ok).toBe(true);
    expect(result.draft?.payload).not.toHaveProperty("previewImages");
  });

  it("removes a draft after it has been migrated to the account", async () => {
    const store = installBrowser("none");
    await writeGuestDraft(KEY, PAYLOAD);
    await removeGuestDraft(KEY);
    expect(store.has(KEY)).toBe(false);
    expect((await readGuestDraft(KEY)).draft).toBeNull();
  });
});

describe("guest failure messaging", () => {
  it("never claims the design is saved and always offers signing in", () => {
    for (const code of ["STORAGE_UNAVAILABLE", "SECURITY_ERROR", "WRITE_FAILED", undefined] as const) {
      const message = guestSaveFailureMessage(code as any);
      expect(message).toMatch(/could not be saved|not enough storage/i);
      expect(message).toContain("sign in");
      // It must never read as a success ("Saved on this device").
      expect(message).not.toMatch(/^\s*saved\b/i);
    }
  });

  it("explains the quota case specifically", () => {
    expect(guestSaveFailureMessage("QUOTA_EXCEEDED")).toContain("storage space");
    expect(GUEST_SAVE_FAILURE_MESSAGE).toContain("could not be saved on this device");
  });
});
