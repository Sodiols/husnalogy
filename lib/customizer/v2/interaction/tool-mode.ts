/**
 * The canvas tool state machine (spec §44) and the pointer priority rules that
 * go with it (spec §37).
 *
 * Both surfaces previously tracked "what is the canvas doing right now" across
 * several independent booleans — `activeTool`, `cropLayerId`, `editingTextId`,
 * `spacePanActive`, plus a mutable `dragRef`. Nothing forced them to be
 * consistent, so states that should be impossible were merely unlikely: crop
 * mode with a text editor open, a marquee starting under an active transform,
 * a creation tool still armed after it had already created its object.
 *
 * Modelling it as one value with explicit transitions makes those states
 * unrepresentable, and makes the whole thing testable without a DOM.
 */

export type ToolMode =
  | "select"
  | "pan"
  | "text-create"
  | "text-edit"
  | "crop"
  | "grid-slot-edit"
  | "marquee"
  | "transform"
  | "guide-drag";

/** Modes that are a live pointer gesture rather than a resting tool. */
const TRANSIENT_MODES: ReadonlySet<ToolMode> = new Set<ToolMode>([
  "marquee",
  "transform",
  "guide-drag",
]);

export function isTransientMode(mode: ToolMode): boolean {
  return TRANSIENT_MODES.has(mode);
}

/**
 * The mode a canvas returns to when a gesture or an editing session ends.
 *
 * Always `select`, and deliberately so (spec §44): a creation tool that stayed
 * armed after creating its object is the "I clicked once and got four text
 * boxes" bug. Persistent creation is opt-in, via `armPersistent`.
 */
export const RESTING_MODE: ToolMode = "select";

export type ToolEvent =
  | { type: "requestTextCreate"; persistent?: boolean }
  | { type: "objectCreated" }
  | { type: "beginTextEdit" }
  | { type: "endTextEdit" }
  | { type: "beginCrop" }
  | { type: "endCrop" }
  | { type: "beginGridSlotEdit" }
  | { type: "endGridSlotEdit" }
  | { type: "beginMarquee" }
  | { type: "beginTransform" }
  | { type: "gestureEnd" }
  | { type: "beginGuideDrag" }
  | { type: "togglePan" }
  | { type: "setPan"; active: boolean }
  | { type: "escape" }
  | { type: "reset" };

export type ToolState = {
  mode: ToolMode;
  /**
   * A creation tool that survives creating an object. Off by default, so the
   * one-shot behaviour in §22 is what a plain "Add text" press gets.
   */
  persistentCreate: boolean;
  /** Pan held via space bar / middle mouse: restores the previous mode. */
  panFallbackMode: ToolMode | null;
};

export const INITIAL_TOOL_STATE: ToolState = {
  mode: RESTING_MODE,
  persistentCreate: false,
  panFallbackMode: null,
};

export function toolReducer(state: ToolState, event: ToolEvent): ToolState {
  switch (event.type) {
    case "requestTextCreate":
      return { ...state, mode: "text-create", persistentCreate: Boolean(event.persistent) };

    case "objectCreated":
      // ONE object per press unless the tool was explicitly armed to persist
      // (spec §22). Every insertion command — text, photo area, shape, line,
      // QR, element, background — ends here, so "return to Select" is enforced
      // in one place instead of being remembered at each call site.
      if (state.persistentCreate) return state;
      return state.mode === RESTING_MODE ? state : { ...state, mode: RESTING_MODE, panFallbackMode: null };

    case "beginTextEdit":
      return { ...state, mode: "text-edit" };

    case "endTextEdit":
      return state.mode === "text-edit"
        ? { ...state, mode: RESTING_MODE, persistentCreate: false }
        : state;

    case "beginCrop":
      return { ...state, mode: "crop", persistentCreate: false };

    case "endCrop":
      return state.mode === "crop" ? { ...state, mode: RESTING_MODE } : state;

    case "beginGridSlotEdit":
      return { ...state, mode: "grid-slot-edit", persistentCreate: false };

    case "endGridSlotEdit":
      return state.mode === "grid-slot-edit" ? { ...state, mode: RESTING_MODE } : state;

    case "beginMarquee":
      return state.mode === "select" ? { ...state, mode: "marquee" } : state;

    case "beginTransform":
      // A transform may start from select OR from crop / grid-slot editing,
      // which resume their own mode when the gesture ends.
      return isTransientMode(state.mode) ? state : { ...state, mode: "transform", panFallbackMode: state.mode };

    case "beginGuideDrag":
      return { ...state, mode: "guide-drag", panFallbackMode: state.mode };

    case "gestureEnd": {
      if (!isTransientMode(state.mode)) return state;
      const restore = state.panFallbackMode;
      const next =
        restore === "crop" || restore === "grid-slot-edit" ? restore : RESTING_MODE;
      return { ...state, mode: next, panFallbackMode: null };
    }

    case "togglePan":
      return state.mode === "pan"
        ? { ...state, mode: state.panFallbackMode ?? RESTING_MODE, panFallbackMode: null }
        : { ...state, mode: "pan", panFallbackMode: state.mode };

    case "setPan":
      if (event.active) {
        if (state.mode === "pan") return state;
        return { ...state, mode: "pan", panFallbackMode: state.mode };
      }
      if (state.mode !== "pan") return state;
      return { ...state, mode: state.panFallbackMode ?? RESTING_MODE, panFallbackMode: null };

    case "escape":
      // Escape peels ONE layer of context at a time (spec §20): it leaves the
      // active mode first and only then does the caller clear the selection.
      return state.mode === RESTING_MODE
        ? state
        : { ...INITIAL_TOOL_STATE };

    case "reset":
      return { ...INITIAL_TOOL_STATE };

    default:
      return state;
  }
}

/* ---------------------------------------------------------------------------
 * Pointer priority (spec §37)
 * ------------------------------------------------------------------------ */

export type PointerOwner =
  | "text-editor"
  | "crop"
  | "grid-slot"
  | "transform"
  | "guide"
  | "pan"
  | "pinch"
  | "object"
  | "marquee"
  | "none";

export type PointerContext = {
  tool: ToolMode;
  /** Two fingers down: the viewport owns the gesture, whatever else is active. */
  pinching?: boolean;
  /** Pointer landed on a transform handle. */
  onHandle?: boolean;
  /** Pointer landed on a selectable object. */
  onObject?: boolean;
  /** Pointer landed on a draggable ruler guide (admin). */
  onGuide?: boolean;
  /** Middle mouse / space bar held. */
  panModifier?: boolean;
};

/**
 * Exactly one owner for a pointer-down, resolved from a single ordered list.
 *
 * The order is the contract: pinch beats everything (it is a viewport gesture
 * and the user has already committed two fingers), then the modal editing
 * sessions, then explicit controls, then plain objects, and marquee last —
 * because a marquee may only begin from genuinely empty design space.
 */
export function resolvePointerOwner(context: PointerContext): PointerOwner {
  if (context.pinching) return "pinch";
  if (context.panModifier || context.tool === "pan") return "pan";
  if (context.tool === "text-edit") return "text-editor";
  if (context.onHandle) return "transform";
  if (context.tool === "crop") return "crop";
  if (context.tool === "grid-slot-edit") return "grid-slot";
  if (context.onGuide) return "guide";
  if (context.onObject) return "object";
  if (context.tool === "select" || context.tool === "marquee") return "marquee";
  return "none";
}

/**
 * Whether a keyboard shortcut should reach the canvas. While the DOM text
 * editor is focused, typing belongs to the text (spec §33) — including Delete,
 * Backspace and the arrow keys, which are caret controls there and destructive
 * commands here.
 */
export function canvasOwnsKeyboard(tool: ToolMode, typingInDom: boolean): boolean {
  if (typingInDom) return false;
  return tool !== "text-edit";
}
