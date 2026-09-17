/**
 * Development-only editor instrumentation (spec §20 of the editor upgrade
 * brief).
 *
 * The customizer's central performance contract is that a continuous gesture
 * writes the canonical document exactly ONCE, on release — not once per pointer
 * event. That is the kind of guarantee which silently regresses: a well-meaning
 * change that moves a `setState` back inside a pointer handler still looks and
 * behaves correctly on a small design, and only becomes a visible stutter on a
 * heavy one, long after the change shipped.
 *
 * So the contract is made observable. Every canonical document write from a
 * gesture reports itself here, a browser test drives a real drag and asserts
 * the count, and the regression fails CI instead of a customer's laptop.
 *
 * This must never ship as behaviour. In a production build `NODE_ENV` is
 * "production", `enabled()` is false, and every function short-circuits before
 * touching anything — no counters, no globals, no logging, no UI.
 */

export type DocumentCommitKind = "transform" | "crop" | "grid-crop" | "text" | "other";

/**
 * Named editor events, counted alongside document writes.
 *
 * These answer questions a commit count alone cannot: did Cancel actually
 * discard a session, did a wheel burst open one session or ten, and did a
 * gesture produce exactly one undo entry.
 */
export type EditorEvent =
  | "cropSessionStarted"
  | "cropCommit"
  | "cropDiscard"
  | "cropRollback"
  | "batchTransformCommit"
  | "saveStarted"
  /** A save response found the document unchanged since it began, and cleared dirty. */
  | "saveClearedDirty"
  /** A save response found the document CHANGED since it began, and left it dirty. */
  | "saveKeptDirty"
  | "dragSession"
  | "transformSession"
  | "historyTransaction";

export type CustomizerMetrics = {
  /** Canonical document writes since the last reset. */
  documentCommits: number;
  byKind: Record<string, number>;
  /** Counts keyed by EditorEvent. */
  events: Record<string, number>;
  /**
   * React render counts, keyed "workspace", "preview" or "layer:<id>". Used to
   * prove a live gesture re-renders only the layer it moves.
   */
  renders: Record<string, number>;
};

/** The property a test reads. Deliberately verbose so it cannot collide. */
const GLOBAL_KEY = "__husnalogyCustomizerMetrics";

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" && typeof window !== "undefined";
}

function store(): CustomizerMetrics | null {
  if (!enabled()) return null;
  const host = window as unknown as Record<string, CustomizerMetrics | undefined>;
  if (!host[GLOBAL_KEY]) host[GLOBAL_KEY] = { documentCommits: 0, byKind: {}, events: {}, renders: {} };
  return host[GLOBAL_KEY]!;
}

/**
 * Report one canonical document write.
 *
 * Call this at the point the EDITOR DOCUMENT actually changes — not where a
 * gesture previews, and not where a component re-renders. A transient preview
 * must not increment this, which is precisely what the tests assert.
 */
export function recordDocumentCommit(kind: DocumentCommitKind = "other"): void {
  const metrics = store();
  if (!metrics) return;
  metrics.documentCommits += 1;
  metrics.byKind[kind] = (metrics.byKind[kind] || 0) + 1;
}

/**
 * Create the counters up front, on editor mount.
 *
 * Without this the global only appears after the FIRST document write, so a
 * test that checks for instrumentation before touching anything would conclude
 * it is unavailable and skip — silently passing the very assertions that are
 * supposed to protect the gesture contract.
 */
export function ensureCustomizerMetrics(): void {
  store();
}

/**
 * Report a named editor event.
 *
 * Cheap by construction: one object property increment, and nothing at all in
 * a production build.
 */
export function recordEditorEvent(event: EditorEvent): void {
  const metrics = store();
  if (!metrics) return;
  metrics.events[event] = (metrics.events[event] || 0) + 1;
}

/**
 * Count one React render of an editor component. Called from render bodies, so
 * it must stay a single guarded increment; in production it returns at once.
 */
export function recordRender(component: string): void {
  const metrics = store();
  if (!metrics) return;
  metrics.renders[component] = (metrics.renders[component] || 0) + 1;
}

/** Zero the counters. Tests call this immediately before a gesture. */
export function resetCustomizerMetrics(): void {
  const metrics = store();
  if (!metrics) return;
  metrics.documentCommits = 0;
  metrics.byKind = {};
  metrics.events = {};
  metrics.renders = {};
}

/** Current counts, or null when instrumentation is compiled out. */
export function readCustomizerMetrics(): CustomizerMetrics | null {
  const metrics = store();
  return metrics
    ? {
        documentCommits: metrics.documentCommits,
        byKind: { ...metrics.byKind },
        events: { ...metrics.events },
        renders: { ...metrics.renders },
      }
    : null;
}

/**
 * Development-only hold point inside a save, between "the payload is built and
 * its version captured" and "the write happens" — the window in which a real
 * network request is in flight.
 *
 * A browser test installs `window.__husnalogyCustomizerSaveGate` (a function
 * returning a promise) to hold a save open, act on the editor, then release it.
 * That turns the in-flight-save race from a timing accident into a
 * deterministic test. In production this returns immediately and reads nothing.
 */
export async function awaitDevSaveGate(): Promise<void> {
  if (!enabled()) return;
  const gate = (window as unknown as Record<string, unknown>).__husnalogyCustomizerSaveGate;
  if (typeof gate === "function") await (gate as () => Promise<void>)();
}
