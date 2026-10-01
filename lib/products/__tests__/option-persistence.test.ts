import { describe, expect, it, vi } from "vitest";
import { canonicalProductOptions, createOptionAutosave, PRODUCT_OPTION_KEYS, restoreProductOptions, type ProductOptionState } from "@/lib/products/option-persistence";

const base: ProductOptionState = { format: "printed", size: "classic-5x7", quantity: "50", customQty: "", envelope: "none", corner: "square", paper: "matte", paperStyle: "flat", printing: "standard", logo: true };

function harness() {
  vi.useFakeTimers();
  const writes: ProductOptionState[] = [];
  const autosave = createOptionAutosave({ delayMs: 250, save: (state) => writes.push(state) });
  return { writes, autosave };
}

describe("product option persistence", () => {
  it("Paper Style is part of the canonical persisted options", () => {
    expect(PRODUCT_OPTION_KEYS).toContain("paperStyle");
    expect(canonicalProductOptions(base)).toHaveProperty("paperStyle", "flat");
  });

  it("changing ONLY Paper Style is saved", () => {
    const { writes, autosave } = harness();
    autosave.schedule(base);
    vi.advanceTimersByTime(250);
    autosave.schedule({ ...base, paperStyle: "folded" });
    vi.advanceTimersByTime(250);
    expect(writes.map((state) => state.paperStyle)).toEqual(["flat", "folded"]);
    vi.useRealTimers();
  });

  it("Paper Style then another option: both are saved", () => {
    const { writes, autosave } = harness();
    autosave.schedule({ ...base, paperStyle: "folded" });
    vi.advanceTimersByTime(250);
    autosave.schedule({ ...base, paperStyle: "folded", paper: "linen" });
    vi.advanceTimersByTime(250);
    expect(writes.at(-1)).toMatchObject({ paperStyle: "folded", paper: "linen" });
    vi.useRealTimers();
  });

  it("rapid Paper Style changes write once, with the FINAL state", () => {
    const { writes, autosave } = harness();
    for (const style of ["a", "b", "c", "d", "final"]) {
      autosave.schedule({ ...base, paperStyle: style });
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(250);
    expect(writes).toHaveLength(1);
    expect(writes[0].paperStyle).toBe("final");
    vi.useRealTimers();
  });

  it("leaving the page before the debounce elapsed still saves (flush)", () => {
    const { writes, autosave } = harness();
    autosave.schedule({ ...base, paperStyle: "folded" });
    autosave.flush(); // pagehide / unmount / product switch
    expect(writes.map((state) => state.paperStyle)).toEqual(["folded"]);
    vi.advanceTimersByTime(1_000);
    expect(writes).toHaveLength(1); // no duplicate write afterwards
    vi.useRealTimers();
  });

  it("never writes an identical state twice and can cancel", () => {
    const { writes, autosave } = harness();
    autosave.schedule(base);
    vi.advanceTimersByTime(250);
    autosave.schedule({ ...base });
    vi.advanceTimersByTime(250);
    autosave.schedule({ ...base, paper: "pearl" });
    autosave.cancel();
    vi.advanceTimersByTime(250);
    expect(writes).toHaveLength(1);
    vi.useRealTimers();
  });

  it("calls the platform timers with the right `this` (browsers throw 'Illegal invocation' otherwise)", async () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const strict = <T extends (...args: never[]) => unknown>(real: T) =>
      function (this: unknown, ...args: Parameters<T>) {
        if (this !== globalThis && this !== undefined) throw new TypeError("Illegal invocation");
        return real.apply(globalThis, args);
      };
    vi.stubGlobal("setTimeout", strict(realSetTimeout));
    vi.stubGlobal("clearTimeout", strict(realClearTimeout));
    try {
      const writes: ProductOptionState[] = [];
      const autosave = createOptionAutosave({ delayMs: 1, save: (state) => writes.push(state) });
      expect(() => autosave.schedule(base)).not.toThrow();
      expect(() => autosave.schedule({ ...base, paperStyle: "folded" })).not.toThrow();
      await new Promise((resolve) => realSetTimeout(resolve, 20));
      expect(writes.at(-1)?.paperStyle).toBe("folded");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("restores a stored object, including Paper Style", () => {
    // Empty values (customQty "") keep the page default, as before.
    const { customQty: _empty, ...stored } = base;
    expect(restoreProductOptions({ ...base, paperStyle: "folded", savedLocallyAt: "2026-10-01" })).toEqual({ ...stored, paperStyle: "folded" });
  });

  it("an OLD saved object without Paper Style falls back safely (default kept)", () => {
    const { paperStyle: _omitted, ...old } = base;
    const restored = restoreProductOptions(old);
    expect(restored).not.toHaveProperty("paperStyle");
    expect(restored).toMatchObject({ paper: "matte", logo: true });
  });

  it("ignores corrupt or hostile stored values", () => {
    expect(restoreProductOptions(null)).toEqual({});
    expect(restoreProductOptions("not an object")).toEqual({});
    expect(restoreProductOptions([1, 2])).toEqual({});
    expect(restoreProductOptions({ paperStyle: 42, paper: "", logo: "yes", size: "x".repeat(500), __proto__: { polluted: true } })).toEqual({});
  });
});
