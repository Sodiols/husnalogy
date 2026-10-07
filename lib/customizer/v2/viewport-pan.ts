// Editor viewport pan maths for the admin design builder.
//
// Pan is EDITOR-ONLY navigation state: a screen-space translation applied to
// the canvas surface. It never touches layer coordinates, the CustomizerDocument,
// render output, or anything that is saved. Keeping the maths here (instead of
// inline in AdminCanvas) makes the behaviour directly testable.
//
// The previous implementation drove `scrollLeft`/`scrollTop` on the workspace
// wrapper, so it silently did nothing whenever the canvas fitted inside the
// workspace and there was no scrollable overflow. Translation has no such
// dependency: it works at every zoom, with or without scrollbars.

export type ViewportState = {
  zoom: number;
  panX: number;
  panY: number;
};

export type PanBounds = {
  workspaceWidth: number;
  workspaceHeight: number;
  displayWidth: number;
  displayHeight: number;
};

export type PanOffset = {
  panX: number;
  panY: number;
};

export type PanGesture = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
};

export const PAN_TOOL = "pan";
export const MIDDLE_MOUSE_BUTTON = 1;

export const INITIAL_VIEWPORT: ViewportState = { zoom: 1, panX: 0, panY: 0 };

// How much of the canvas must stay inside the workspace. Derived from the
// workspace/canvas size rather than a fixed pixel budget so the limits behave
// the same on a small laptop and a large desktop.
const MIN_VISIBLE_PX = 48;
const VISIBLE_RATIO = 0.25;

const finite = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Reset to the centred, unpanned view. `zoom` stays a parameter so Fit can keep
// whatever zoom the existing Fit behaviour decides on.
export function fitViewport(zoom = 1): ViewportState {
  return { zoom: finite(zoom, 1) || 1, panX: 0, panY: 0 };
}

// Maximum translation on each axis. At pan 0 the surface sits at its natural
// (flex-centred) position, so the limits are symmetric: the canvas may be pushed
// until only `keep` pixels of it still overlap the workspace, which keeps it
// recoverable without making pan feel fenced in.
export function panLimits(bounds: PanBounds): { maxPanX: number; maxPanY: number } {
  const workspaceWidth = Math.max(0, finite(bounds?.workspaceWidth));
  const workspaceHeight = Math.max(0, finite(bounds?.workspaceHeight));
  const displayWidth = Math.max(0, finite(bounds?.displayWidth));
  const displayHeight = Math.max(0, finite(bounds?.displayHeight));

  const keepX = Math.max(MIN_VISIBLE_PX, Math.min(displayWidth, workspaceWidth) * VISIBLE_RATIO);
  const keepY = Math.max(MIN_VISIBLE_PX, Math.min(displayHeight, workspaceHeight) * VISIBLE_RATIO);

  return {
    maxPanX: Math.max(0, workspaceWidth / 2 + displayWidth / 2 - keepX),
    maxPanY: Math.max(0, workspaceHeight / 2 + displayHeight / 2 - keepY),
  };
}

export function clampPan(pan: PanOffset, bounds: PanBounds): PanOffset {
  const { maxPanX, maxPanY } = panLimits(bounds);
  return {
    panX: clamp(finite(pan?.panX), -maxPanX, maxPanX),
    panY: clamp(finite(pan?.panY), -maxPanY, maxPanY),
  };
}

// Screen-space delta. Pan is deliberately NOT divided by scale: moving the
// pointer 100px must move the canvas 100px on screen at every zoom level.
export function panFromGesture(gesture: PanGesture, clientX: number, clientY: number, bounds: PanBounds): PanOffset {
  const dx = finite(clientX) - finite(gesture?.startClientX);
  const dy = finite(clientY) - finite(gesture?.startClientY);
  return clampPan({ panX: finite(gesture?.startPanX) + dx, panY: finite(gesture?.startPanY) + dy }, bounds);
}

export function createPanGesture(
  event: { pointerId?: number; clientX: number; clientY: number },
  pan: PanOffset,
): PanGesture {
  return {
    pointerId: finite(event?.pointerId, -1),
    startClientX: finite(event?.clientX),
    startClientY: finite(event?.clientY),
    startPanX: finite(pan?.panX),
    startPanY: finite(pan?.panY),
  };
}

// Fields a caret (or a keyboard-driven value) lives in: every key belongs to
// them. Includes anything contenteditable (the inline canvas text editor).
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
// Controls that only ACTIVATE from the keyboard. They own Enter and Space —
// so a focused button still clicks and Space never starts a canvas pan — but
// nothing else. Counting them as typing (as this used to) meant that after
// clicking any toolbar button, every canvas shortcut — Delete, Ctrl+D/C/V/Z,
// arrows, Escape — was dead until the canvas was clicked again.
const ACTIVATION_TAGS = new Set(["BUTTON", "OPTION", "SUMMARY"]);
const ACTIVATION_KEYS = new Set(["Enter", " ", "Spacebar"]);

/**
 * Does the focused element own this keystroke? With no `key`, answers for
 * typing fields only (a control's activation keys are then the caller's
 * concern).
 */
export function isTypingTarget(target: unknown, key?: string): boolean {
  const element = target as { tagName?: unknown; isContentEditable?: unknown; getAttribute?: (name: string) => string | null } | null;
  if (!element) return false;
  if (element.isContentEditable === true) return true;
  const tag = String(element.tagName || "").toUpperCase();
  if (TYPING_TAGS.has(tag)) return true;
  if (key === undefined || !ACTIVATION_KEYS.has(key)) return false;
  const role = typeof element.getAttribute === "function" ? element.getAttribute("role") : null;
  return ACTIVATION_TAGS.has(tag) || role === "button" || role === "menuitem" || role === "option" || role === "tab";
}

// A pan gesture starts on: the Pan tool, held Space, or the middle mouse button
// (which pans from any tool, as in professional editors).
export function shouldBeginPan({
  activeTool,
  spacePanActive = false,
  button = 0,
  editingText = false,
}: {
  activeTool?: string;
  spacePanActive?: boolean;
  button?: number;
  editingText?: boolean;
}): boolean {
  if (button === MIDDLE_MOUSE_BUTTON) return true;
  if (button !== 0) return false;
  if (activeTool === PAN_TOOL) return true;
  return Boolean(spacePanActive) && !editingText;
}

// True whenever the viewport owns the pointer, so layer/handle/guide handlers
// must stand down and let the gesture through.
export function panHasPointerPriority({
  activeTool,
  spacePanActive = false,
  button = 0,
}: {
  activeTool?: string;
  spacePanActive?: boolean;
  button?: number;
}): boolean {
  return activeTool === PAN_TOOL || Boolean(spacePanActive) || button === MIDDLE_MOUSE_BUTTON;
}

export function panCursor({ isPanning, panToolActive }: { isPanning?: boolean; panToolActive?: boolean }): string {
  if (isPanning) return "grabbing";
  if (panToolActive) return "grab";
  return "";
}

/* ------------------------------------------------------------ wheel scroll --
 * The mouse wheel / trackpad scrolls a zoomed-in artboard like a document:
 * vertical wheel scrolls up and down, Shift+wheel (or a sideways swipe) left
 * and right. It only scrolls what is actually hidden — the part of the card
 * beyond the workspace, plus a small margin — so at Fit the wheel leaves the
 * card where it is, and a scroll can never fling it out of view.
 */

/** Extra room past the card's edge a scroll may reveal, in screen px. */
export const WHEEL_SCROLL_MARGIN = 48;

const LINE_PX = 16;

/** How far a scroll may move the card on each axis (0 when it already fits). */
export function wheelScrollLimits(bounds: PanBounds): { maxPanX: number; maxPanY: number } {
  const overflow = (display: unknown, workspace: unknown) => {
    const extra = Math.max(0, finite(display)) - Math.max(0, finite(workspace));
    return extra > 0 ? extra / 2 + WHEEL_SCROLL_MARGIN : 0;
  };
  return {
    maxPanX: overflow(bounds?.displayWidth, bounds?.workspaceWidth),
    maxPanY: overflow(bounds?.displayHeight, bounds?.workspaceHeight),
  };
}

/** A wheel event's movement in screen px, whatever unit the device reports. */
export function normalizeWheelDelta(
  event: { deltaX: number; deltaY: number; deltaMode?: number; shiftKey?: boolean },
  pageHeight: number,
): { dx: number; dy: number } {
  const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? Math.max(1, finite(pageHeight, 600)) : 1;
  let dx = finite(event.deltaX) * unit;
  let dy = finite(event.deltaY) * unit;
  // A mouse has one wheel: Shift turns it sideways.
  if (event.shiftKey && !dx) {
    dx = dy;
    dy = 0;
  }
  return { dx, dy };
}

// One axis: move by `delta`, never past the limit — but a card already beyond
// it (moved there by dragging) is never pulled back, only stopped from going
// further out.
function scrollAxis(current: number, delta: number, limit: number): number {
  const next = current - delta;
  // `|| 0` folds -0 into 0, so "nothing moved" compares equal.
  if (next > current) return Math.min(next, Math.max(limit, current)) || 0;
  if (next < current) return Math.max(next, Math.min(-limit, current)) || 0;
  return current;
}

/** The pan after scrolling by `delta` screen px (content moves opposite to the wheel). */
export function panFromWheel(pan: PanOffset, delta: { dx: number; dy: number }, bounds: PanBounds): PanOffset {
  const { maxPanX, maxPanY } = wheelScrollLimits(bounds);
  return {
    panX: scrollAxis(finite(pan?.panX), finite(delta?.dx), maxPanX),
    panY: scrollAxis(finite(pan?.panY), finite(delta?.dy), maxPanY),
  };
}

/** Ctrl/⌘+wheel and trackpad pinch: a smooth zoom factor for one wheel event. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = finite(deltaY) * (deltaMode === 1 ? LINE_PX : 1);
  return Math.exp(-px * 0.0025);
}
