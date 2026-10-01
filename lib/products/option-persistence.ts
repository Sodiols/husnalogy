/**
 * Product option persistence (browser): ONE canonical description of the
 * customer's selected options, and a debounced autosave that also flushes when
 * the customer leaves the page.
 *
 * Every persisted option is listed exactly once (PRODUCT_OPTION_KEYS), so an
 * option can no longer be stored and restored but forgotten by the autosave
 * trigger (the Paper Style bug). Client safe: no server imports.
 */

export const PRODUCT_OPTION_KEYS = ["format", "size", "quantity", "customQty", "envelope", "corner", "paper", "paperStyle", "printing", "logo"] as const;

export type ProductOptionKey = (typeof PRODUCT_OPTION_KEYS)[number];

export type ProductOptionState = {
  format: string;
  size: string;
  quantity: string;
  customQty: string;
  envelope: string;
  corner: string;
  paper: string;
  paperStyle: string;
  printing: string;
  logo: boolean;
};

/** The canonical object that is persisted (stable key order). */
export function canonicalProductOptions(state: ProductOptionState): ProductOptionState {
  return Object.fromEntries(PRODUCT_OPTION_KEYS.map((key) => [key, key === "logo" ? Boolean(state.logo) : String(state[key] ?? "")])) as ProductOptionState;
}

/**
 * Read a stored option object safely. Unknown keys are ignored; missing or
 * invalid ones are left out, so an object saved before an option existed
 * (e.g. without `paperStyle`) keeps the page's default for that option.
 */
export function restoreProductOptions(saved: unknown): Partial<ProductOptionState> {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const source = saved as Record<string, unknown>;
  const restored: Partial<ProductOptionState> = {};
  for (const key of PRODUCT_OPTION_KEYS) {
    const value = source[key];
    if (key === "logo") {
      if (typeof value === "boolean") restored.logo = value;
    } else if (typeof value === "string" && value.length > 0 && value.length <= 200) {
      restored[key] = value;
    }
  }
  return restored;
}

export type OptionAutosave = {
  /** Remember the latest state and write it after `delayMs` of quiet. */
  schedule(state: ProductOptionState): void;
  /** Write the pending state now (leaving the page, switching product). */
  flush(): void;
  /** Drop a pending write. */
  cancel(): void;
};

/**
 * Debounced autosave. Rapid changes produce one write with the FINAL state;
 * an identical state is never written twice; a pending write is not lost when
 * the page is left before the debounce elapsed (call `flush`).
 */
export function createOptionAutosave(options: {
  save(state: ProductOptionState): void;
  delayMs?: number;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
}): OptionAutosave {
  // Wrapped, never stored as methods: browsers throw "Illegal invocation"
  // when window.setTimeout is called with another `this`.
  const timers = options.timers || {
    setTimeout: ((handler: () => void, ms?: number) => globalThis.setTimeout(handler, ms)) as typeof setTimeout,
    clearTimeout: ((id?: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id)) as typeof clearTimeout,
  };
  const delay = options.delayMs ?? 250;
  let pending: ProductOptionState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWritten = "";

  const write = () => {
    if (timer) timers.clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const state = pending;
    pending = null;
    const serialized = JSON.stringify(state);
    if (serialized === lastWritten) return;
    lastWritten = serialized;
    options.save(state);
  };

  return {
    schedule(state) {
      pending = canonicalProductOptions(state);
      if (timer) timers.clearTimeout(timer);
      timer = timers.setTimeout(write, delay);
    },
    flush: write,
    cancel() {
      if (timer) timers.clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
