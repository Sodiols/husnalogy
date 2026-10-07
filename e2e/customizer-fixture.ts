/**
 * Shared helpers for specs that drive the in-memory customizer fixture at
 * /__e2e/customizer. Geometry is read from SVG attributes (document units) and
 * press points come from Konva's own hit graph — see
 * customizer-interaction-contract.spec.ts for why.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export const FIXTURE = "/__e2e/customizer";

/**
 * Recovery keys are scoped to their owner (a signed-in account or this
 * browser's guest session — lib/customizer/recovery-store.ts), so specs match
 * on the design part of the key and let the page name the owner.
 */
export const draftSuffix = (templateId = "e2e-fixture-template") => `:product:e2e-fixture-product:template:${templateId}:version:1`;

export type Point = { x: number; y: number };

export function canvasLayer(page: Page, layerId: string): Locator {
  return page.locator(`[data-customizer-canvas="main"] [data-layer-id="${layerId}"]`).first();
}

/** Open the fixture and wait until the interaction stage exists and the saved design is restored. */
export async function openFixture(page: Page, query = ""): Promise<void> {
  await page.goto(`${FIXTURE}${query}`);
  await waitForEditor(page);
}

export async function waitForEditor(page: Page): Promise<void> {
  await expect(canvasLayer(page, "fx_title")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean((window as any).Konva?.stages?.length), null, { timeout: 30_000 });
  await expect(page.locator("[data-customizer-restore-overlay]")).toHaveCount(0, { timeout: 30_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(500);
}

export async function centreOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no rendered box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A viewport point Konva's hit graph resolves to the layer's body (never a
 * handle). A picture becomes hit-testable only once it has loaded and drawn,
 * so this waits (up to 10s) for the layer to be pressable instead of sampling
 * the hit graph once — exactly as a person waits to see it before clicking.
 */
export async function bodyPoint(page: Page, layerId: string): Promise<Point> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const point = await bodyPointNow(page, layerId);
    if (point) return point;
    if (Date.now() > deadline) throw new Error(`no pressable body point for ${layerId}`);
    await page.waitForTimeout(100);
  }
}

async function bodyPointNow(page: Page, layerId: string): Promise<Point | null> {
  const point = await page.evaluate((id) => {
    const K = (window as any).Konva;
    for (const stage of K?.stages || []) {
      const proxy = stage.findOne((node: any) => node.name?.() === id);
      if (!proxy) continue;
      const rect = proxy.getClientRect();
      const box = stage.container().getBoundingClientRect();
      const candidates: Array<{ x: number; y: number }> = [];
      for (let gy = 1; gy < 10; gy += 1) {
        for (let gx = 1; gx < 10; gx += 1) {
          candidates.push({ x: rect.x + (rect.width * gx) / 10, y: rect.y + (rect.height * gy) / 10 });
        }
      }
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      candidates.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
      for (const candidate of candidates) {
        if (stage.getIntersection(candidate)?.name?.() === id) {
          return { x: box.left + candidate.x, y: box.top + candidate.y };
        }
      }
    }
    return null;
  }, layerId);
  return point;
}

/** Viewport centre of a transformer anchor ("rotater", "bottom-right", ...). */
export async function anchorPoint(page: Page, name: string): Promise<Point> {
  const point = await page.evaluate((anchor) => {
    const K = (window as any).Konva;
    for (const stage of K?.stages || []) {
      const transformer = stage.findOne("Transformer");
      if (!transformer || !transformer.nodes().length) continue;
      const node = transformer.findOne(`.${anchor}`);
      if (!node) continue;
      const rect = node.getClientRect();
      const box = stage.container().getBoundingClientRect();
      return { x: box.left + rect.x + rect.width / 2, y: box.top + rect.y + rect.height / 2 };
    }
    return null;
  }, name);
  if (!point) throw new Error(`transformer anchor "${name}" is not on screen`);
  return point;
}

/** Click a layer's body, then wait for the selection panel to re-fit the canvas. */
export async function selectLayer(page: Page, layerId: string, modifiers: Array<"Shift"> = []): Promise<void> {
  const point = await bodyPoint(page, layerId);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(point.x, point.y);
  for (const key of modifiers) await page.keyboard.up(key);
  await page.waitForTimeout(450);
}

/** Press at `from`, move through `steps` positions, and release. */
export async function drag(page: Page, from: Point, to: Point, steps = 16): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** The persisted geometry of a rect-drawn layer (shape), in document units. */
export async function rectAttrs(page: Page, layerId: string) {
  return page.evaluate((id) => {
    const rect = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"] rect`);
    const read = (name: string) => Number(rect?.getAttribute(name));
    return { x: read("x"), y: read("y"), width: read("width"), height: read("height"), transform: rect?.getAttribute("transform") || "" };
  }, layerId);
}

export async function layerText(page: Page, layerId: string): Promise<string> {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-customizer-canvas="main"] [data-layer-id="${id}"] text`)]
        .map((node) => node.textContent || "")
        .join("\n"),
    layerId,
  );
}

export async function cropDrawBox(page: Page, layerId: string) {
  return page.evaluate((id) => {
    const image = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"] image`);
    const read = (name: string) => Number(image?.getAttribute(name));
    return { x: read("x"), y: read("y"), width: read("width"), height: read("height") };
  }, layerId);
}

export async function enterCrop(page: Page, layerId: string): Promise<Locator> {
  await selectLayer(page, layerId);
  const point = await bodyPoint(page, layerId);
  await page.mouse.dblclick(point.x, point.y);
  const surface = page.getByRole("application", { name: /crop photo/i });
  await expect(surface, "crop mode did not open").toBeVisible({ timeout: 10_000 });
  return surface;
}

export async function panCrop(page: Page, surface: Locator, dx: number, dy: number): Promise<void> {
  const from = await centreOf(surface);
  await drag(page, from, { x: from.x + dx, y: from.y + dy }, 20);
  await page.waitForTimeout(450);
}

/** The current actor's recovery key on this page: the one stored for this design, or the guest session's. */
export async function draftKey(page: Page, templateId = "e2e-fixture-template"): Promise<string> {
  return page.evaluate((suffix) => {
    const stored = Object.keys(window.localStorage).find((key) => key.startsWith("husnalogy_customizer_draft:v2:") && key.endsWith(suffix));
    if (stored) return stored;
    return `husnalogy_customizer_draft:v2:guest:${window.localStorage.getItem("husnalogy_guest_session_id") || ""}${suffix}`;
  }, draftSuffix(templateId));
}

export async function readDraft(page: Page, templateId = "e2e-fixture-template"): Promise<any> {
  const key = await draftKey(page, templateId);
  return page.evaluate((stored) => JSON.parse(window.localStorage.getItem(stored) || "null"), key);
}

export async function switchToAdvancedCustomize(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /^(Advanced Customize|Advanced)$/ });
  if (await toggle.count()) await toggle.first().click();
}

export const editorTextarea = (page: Page) => page.locator('[aria-label="Edit text on canvas"]');

/** The selection as the canvas shows it: the proxies the Transformer is attached to. */
export async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const K = (window as any).Konva;
    for (const stage of K?.stages || []) {
      const transformer = stage.findOne("Transformer");
      if (transformer) return transformer.nodes().map((node: any) => node.name());
    }
    return [];
  });
}

/** A document point (page pixels) in viewport coordinates. */
export async function docToScreen(page: Page, x: number, y: number): Promise<Point> {
  const point = await page.evaluate(({ x, y }) => {
    const K = (window as any).Konva;
    const stage = K?.stages?.find((candidate: any) => candidate.findOne("Transformer"));
    if (!stage) return null;
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + stage.x() + x * stage.scaleX(), y: box.top + stage.y() + y * stage.scaleY() };
  }, { x, y });
  if (!point) throw new Error("no interaction stage");
  return point;
}

/** The proxy Konva would hit at a document point, or null for empty canvas. */
export async function hitAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const K = (window as any).Konva;
    const stage = K?.stages?.find((candidate: any) => candidate.findOne("Transformer"));
    if (!stage) return null;
    const hit = stage.getIntersection({ x: stage.x() + x * stage.scaleX(), y: stage.y() + y * stage.scaleY() });
    return hit ? hit.name() || hit.getClassName() : null;
  }, { x, y });
}

export async function clickDoc(page: Page, x: number, y: number, modifiers: Array<"Shift" | "Control"> = []): Promise<void> {
  const point = await docToScreen(page, x, y);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(point.x, point.y);
  for (const key of modifiers) await page.keyboard.up(key);
  await page.waitForTimeout(350);
}
