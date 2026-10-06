import { describe, expect, it } from "vitest";
import {
  clearStudioRecovery,
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
  };
}

const template = { id: "tpl", layers: [{ id: "a", type: "shape" }] };

describe("studio recovery store", () => {
  it("keys each product separately and shares one slot for unsaved new products", () => {
    expect(studioRecoveryKey("prod-1")).toBe("husnalogy_studio_draft:prod-1");
    expect(studioRecoveryKey("")).toBe("husnalogy_studio_draft:new");
    expect(studioRecoveryKey(null)).toBe("husnalogy_studio_draft:new");
  });

  it("round-trips a snapshot exactly", () => {
    const storage = memoryStorage();
    const key = studioRecoveryKey("prod-1");
    expect(writeStudioRecovery(storage, key, { productId: "prod-1", productName: "Card", template, savedAt: "2026-10-05T10:00:00.000Z" })).toBe(true);
    expect(readStudioRecovery(storage, key)).toEqual({ productId: "prod-1", productName: "Card", savedAt: "2026-10-05T10:00:00.000Z", template });
    clearStudioRecovery(storage, key);
    expect(readStudioRecovery(storage, key)).toBeNull();
  });

  it("reads anything that is not a template snapshot as nothing to recover", () => {
    const key = studioRecoveryKey("p");
    for (const raw of ["not json", "null", "[]", JSON.stringify({ template: { layers: "x" } }), JSON.stringify({ productId: "p" })]) {
      expect(readStudioRecovery(memoryStorage({ [key]: raw }), key)).toBeNull();
    }
    expect(readStudioRecovery(null, key)).toBeNull();
  });

  it("reports a refused write instead of pretending it was kept", () => {
    const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(writeStudioRecovery(full, "k", { productId: "", productName: "", template })).toBe(false);
  });

  it("offers a snapshot only when it holds something the studio does not show", () => {
    const snapshot = { productId: "", productName: "", savedAt: "", template };
    expect(studioRecoveryDiffers(snapshot, { id: "tpl", layers: [{ id: "a", type: "shape" }] })).toBe(false);
    expect(studioRecoveryDiffers(snapshot, { id: "tpl", layers: [] })).toBe(true);
    expect(studioRecoveryDiffers(null, template)).toBe(false);
  });
});
