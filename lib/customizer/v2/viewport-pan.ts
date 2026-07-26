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

// Space must not hijack typing. Guards the explicit form controls plus anything
// contenteditable (the inline canvas text editor).
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "OPTION"]);

export function isTypingTarget(target: unknown): boolean {
  const element = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!element) return false;
  if (element.isContentEditable === true) return true;
  return TYPING_TAGS.has(String(element.tagName || "").toUpperCase());
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
