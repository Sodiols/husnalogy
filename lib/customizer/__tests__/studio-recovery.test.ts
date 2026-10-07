import { describe, expect, it } from "vitest";
import {
  clearStudioRecovery,
  purgeLegacyStudioRecovery,
  readStudioRecovery,
  studioRecoveryDiffers,
  studioRecoveryKey,
  writeStudioRecovery,
} from "../studio-recovery";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}

const template = { id: "tpl", layers: [{ id: "a", type: "shape" }] };
const ADMIN_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const DESIGNER_B = "bbbbbbbb-0000-4000-8000-00000000000b";

describe("studio recovery store", () => {
  it("keys each account and product separately, with one 'new product' slot PER ACCOUNT", () => {
    expect(studioRecoveryKey(ADMIN_A, "prod-1")).toBe(`husnalogy_studio_draft:v2:${ADMIN_A}:product:prod-1`);
    expect(studioRecoveryKey(ADMIN_A, "")).toBe(`husnalogy_studio_draft:v2:${ADMIN_A}:new`);
    expect(studioRecoveryKey(ADMIN_A, null)).toBe(`husnalogy_studio_draft:v2:${ADMIN_A}:new`);
    expect(studioRecoveryKey(DESIGNER_B, "")).not.toBe(studioRecoveryKey(ADMIN_A, ""));
    // No signed-in studio account: no recovery at all.
    expect(studioRecoveryKey("", "prod-1")).toBe("");
    expect(studioRecoveryKey("a:b", "prod-1")).toBe("");
  });

  it("round-trips a snapshot exactly", () => {
    const storage = memoryStorage();
    const key = studioRecoveryKey(ADMIN_A, "prod-1");
    expect(writeStudioRecovery(storage, key, ADMIN_A, { productId: "prod-1", productName: "Card", template, savedAt: "2026-10-05T10:00:00.000Z" })).toBe(true);
    expect(readStudioRecovery(storage, key, ADMIN_A)).toEqual({ owner: ADMIN_A, productId: "prod-1", productName: "Card", savedAt: "2026-10-05T10:00:00.000Z", template });
    clearStudioRecovery(storage, key);
    expect(readStudioRecovery(storage, key, ADMIN_A)).toBeNull();
  });

  it("reads anything that is not a template snapshot as nothing to recover", () => {
    const key = studioRecoveryKey(ADMIN_A, "p");
    for (const raw of ["not json", "null", "[]", JSON.stringify({ owner: ADMIN_A, template: { layers: "x" } }), JSON.stringify({ owner: ADMIN_A, productId: "p" })]) {
      expect(readStudioRecovery(memoryStorage({ [key]: raw }), key, ADMIN_A)).toBeNull();
    }
    expect(readStudioRecovery(null, key, ADMIN_A)).toBeNull();
  });

  it("reports a refused write instead of pretending it was kept", () => {
    const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(writeStudioRecovery(full, studioRecoveryKey(ADMIN_A, ""), ADMIN_A, { productId: "", productName: "", template })).toBe(false);
  });

  it("offers a snapshot only when it holds something the studio does not show", () => {
    const snapshot = { owner: ADMIN_A, productId: "", productName: "", savedAt: "", template };
    expect(studioRecoveryDiffers(snapshot, { id: "tpl", layers: [{ id: "a", type: "shape" }] })).toBe(false);
    expect(studioRecoveryDiffers(snapshot, { id: "tpl", layers: [] })).toBe(true);
    expect(studioRecoveryDiffers(null, template)).toBe(false);
  });
});

describe("studio recovery is scoped to the studio account (shared browser)", () => {
  const unsaved = { id: "tpl", layers: [{ id: "secret", type: "text", text: "Admin A unsaved wedding suite" }] };

  it("Admin A's unsaved NEW design is never offered to Designer B on the same browser", () => {
    const storage = memoryStorage();
    expect(writeStudioRecovery(storage, studioRecoveryKey(ADMIN_A, ""), ADMIN_A, { productId: "", productName: "New", template: unsaved })).toBe(true);
    expect(readStudioRecovery(storage, studioRecoveryKey(DESIGNER_B, ""), DESIGNER_B)).toBeNull();
    expect(readStudioRecovery(storage, studioRecoveryKey(DESIGNER_B, "prod-1"), DESIGNER_B)).toBeNull();
    // Admin A, back on the browser, still has it.
    expect(readStudioRecovery(storage, studioRecoveryKey(ADMIN_A, ""), ADMIN_A)?.template).toEqual(unsaved);
  });

  it("a snapshot copied under another account's key is refused by its owner stamp", () => {
    const storage = memoryStorage();
    writeStudioRecovery(storage, studioRecoveryKey(ADMIN_A, "prod-1"), ADMIN_A, { productId: "prod-1", productName: "Card", template: unsaved });
    storage.setItem(studioRecoveryKey(DESIGNER_B, "prod-1"), storage.getItem(studioRecoveryKey(ADMIN_A, "prod-1"))!);
    expect(readStudioRecovery(storage, studioRecoveryKey(DESIGNER_B, "prod-1"), DESIGNER_B)).toBeNull();
  });

  it("nothing is read from or written into another account's slot", () => {
    const storage = memoryStorage();
    expect(writeStudioRecovery(storage, studioRecoveryKey(ADMIN_A, ""), DESIGNER_B, { productId: "", productName: "", template })).toBe(false);
    writeStudioRecovery(storage, studioRecoveryKey(ADMIN_A, ""), ADMIN_A, { productId: "", productName: "", template });
    expect(readStudioRecovery(storage, studioRecoveryKey(ADMIN_A, ""), DESIGNER_B)).toBeNull();
    expect(writeStudioRecovery(storage, "", ADMIN_A, { productId: "", productName: "", template })).toBe(false);
  });

  it("legacy unscoped snapshots are purged and never read", () => {
    const storage = memoryStorage({
      "husnalogy_studio_draft:new": JSON.stringify({ productId: "", productName: "", template: unsaved }),
      "husnalogy_studio_draft:prod-9": JSON.stringify({ productId: "prod-9", productName: "", template: unsaved }),
      unrelated: "keep",
    });
    writeStudioRecovery(storage, studioRecoveryKey(ADMIN_A, ""), ADMIN_A, { productId: "", productName: "", template });
    expect(purgeLegacyStudioRecovery(storage)).toBe(2);
    expect([...storage.data.keys()].sort()).toEqual([studioRecoveryKey(ADMIN_A, ""), "unrelated"].sort());
  });
});
