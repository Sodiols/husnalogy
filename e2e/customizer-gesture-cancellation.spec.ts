/**
 * Gesture cancellation, proven in a real browser.
 *
 * The cancellation rule itself is unit-tested (`gesture-lifecycle.test.ts`),
 * but the rule is only half the fix: the other half is the WIRING — six
 * different browser events reaching `abortGesture`, Konva's Transformer being
 * told to stop, and the abort flag being cleared so the NEXT real gesture still
 * commits. None of that is reachable from a unit test, and all of it is exactly
 * the kind of thing that silently rots.
 *
 * What makes these tests meaningful rather than decorative is the failure mode
 * they protect against. When a gesture is interrupted and nothing abandons it,
 * Konva never delivers the matching `dragend`/`transformend`, so:
 *
 *   - `gestureActiveRef` stays true FOREVER, which blocks every subsequent
 *     Transformer re-attachment — the editor looks alive but can never show
 *     handles on anything again;
 *   - the transient SVG transform stays painted over artwork the document does
 *     not describe, so what the customer sees is not what will print;
 *   - the next pointer press can commit a delta measured against a state the
 *     customer left minutes ago.
 *
 * So every test here asserts the same four things: the document did not change,
 * no transient preview survived, the editor is still USABLE afterwards, and a
 * later real gesture still commits exactly once.
 *
 * Runs against the in-memory fixture at /__e2e/customizer — no seeded database,
 * no auth, no remote assets.
 */

import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/__e2e/customizer";
const DRAG_TARGET = "fx_title";
const OTHER_TARGET = "fx_free_text";

type Point = { x: number; y: number };
type Metrics = {
  documentCommits: number;
  byKind: Record<string, number>;
  events: Record<string, number>;
  renders: Record<string, number>;
};

/* -------------------------------------------------------------------------- */
/* Helpers (same measurement rules as customizer-interaction-contract)         */
/* -------------------------------------------------------------------------- */

function canvasLayer(page: Page, layerId: string) {
  return page.locator(`[data-customizer-canvas="main"] [data-layer-id="${layerId}"]`).first();
}

async function openFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await expect(canvasLayer(page, DRAG_TARGET)).toBeVisible({ timeout: 30_000 });
  // Konva arrives in its own `next/dynamic` chunk, after the SVG artwork. Every
  // helper here asks its hit graph where to press, so the stage — not the
  // artwork — is the precondition.
  await page.waitForFunction(() => Boolean((window as any).Konva?.stages?.length), null, { timeout: 30_000 });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(900);
  const instrumented = await page.evaluate(
    () => typeof (window as any).__husnalogyCustomizerMetrics === "object",
  );
  expect(
    instrumented,
    "run against a DEVELOPMENT build — editor metrics are compiled out of production",
  ).toBe(true);
  await resetMetrics(page);
}

async function resetMetrics(page: Page): Promise<void> {
  await page.evaluate(() => {
    const metrics = (window as any).__husnalogyCustomizerMetrics;
    metrics.documentCommits = 0;
    metrics.byKind = {};
    metrics.events = {};
    metrics.renders = {};
  });
}

async function readMetrics(page: Page): Promise<Metrics> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as any).__husnalogyCustomizerMetrics)));
}

const count = (record: Record<string, number>, key: string) => record[key] || 0;

async function bodyPoint(page: Page, layerId: string): Promise<Point> {
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
  if (!point) throw new Error(`no pressable body point for ${layerId}`);
  return point;
}

async function anchorPoint(page: Page, name: string): Promise<Point> {
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

async function selectLayer(page: Page, layerId: string): Promise<void> {
  const point = await bodyPoint(page, layerId);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(450);
}

async function pressAndMove(page: Page, from: Point, to: (step: number) => Point, steps: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    const point = to(step);
    await page.mouse.move(point.x, point.y);
  }
}

async function rectAttrs(page: Page, layerId: string) {
  return page.evaluate((id) => {
    const rect = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"] rect`);
    const read = (name: string) => Number(rect?.getAttribute(name));
    return { x: read("x"), y: read("y"), width: read("width"), height: read("height") };
  }, layerId);
}

/**
 * The transient preview attribute the interaction layer writes during a live
 * drag/rotation. A non-empty value here after cancellation means the artwork is
 * still displaced from what the document says.
 */
async function transientTransform(page: Page, layerId: string): Promise<string> {
  return page.evaluate((id) => {
    const node = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"]`);
    return node?.getAttribute("transform") || "";
  }, layerId);
}

/** Is Konva's Transformer still mid-transform? Stuck here = editor bricked. */
async function transformerStuck(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const K = (window as any).Konva;
    for (const stage of K?.stages || []) {
      const transformer = stage.findOne("Transformer");
      if (transformer?.isTransforming?.()) return true;
    }
    return false;
  });
}

/** How many nodes the Transformer is attached to — proves re-attachment works. */
async function transformerNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const K = (window as any).Konva;
    for (const stage of K?.stages || []) {
      const transformer = stage.findOne("Transformer");
      if (transformer) return transformer.nodes().length;
    }
    return -1;
  });
}

/**
 * The editor must still be fully usable after an interruption. This is the
 * assertion that actually catches a stuck `gestureActiveRef`: selecting a
 * DIFFERENT layer has to re-attach the Transformer, and a real drag has to
 * commit exactly once.
 */
async function expectEditorStillWorks(page: Page): Promise<void> {
  expect(await transformerStuck(page), "Transformer left mid-transform").toBe(false);

  await selectLayer(page, OTHER_TARGET);
  expect(
    await transformerNodeCount(page),
    "Transformer did not re-attach after the cancelled gesture",
  ).toBeGreaterThan(0);

  await resetMetrics(page);
  const before = await rectAttrs(page, OTHER_TARGET);
  const from = await bodyPoint(page, OTHER_TARGET);
  await pressAndMove(page, from, (step) => ({ x: from.x + step * 3, y: from.y }), 10);
  await page.mouse.up();
  await page.waitForTimeout(450);

  const after = await rectAttrs(page, OTHER_TARGET);
  const metrics = await readMetrics(page);
  expect(after.x, "a real drag after cancellation did not move the object").not.toBe(before.x);
  expect(metrics.documentCommits, "a real drag after cancellation must still commit once").toBe(1);
}

/** Begin a drag on `layerId` and leave the pointer DOWN, mid-gesture. */
async function beginHeldDrag(page: Page, layerId: string): Promise<Point> {
  await selectLayer(page, layerId);
  await resetMetrics(page);
  const from = await bodyPoint(page, layerId);
  await pressAndMove(page, from, (step) => ({ x: from.x + step * 6, y: from.y + step * 4 }), 12);
  // The preview must actually be live, or the test proves nothing.
  expect(await transientTransform(page, layerId), "drag never produced a transient preview").not.toBe("");
  return from;
}

/**
 * Assert a held gesture was abandoned cleanly: document untouched, preview
 * gone, no history entry, and the later pointer release commits nothing.
 */
async function expectCancelled(page: Page, layerId: string, before: { x: number; y: number }): Promise<void> {
  expect(await transientTransform(page, layerId), "a stale transient preview survived cancellation").toBe("");

  await page.mouse.up();
  await page.waitForTimeout(450);

  const after = await rectAttrs(page, layerId);
  expect(after.x, "the document moved despite cancellation").toBe(before.x);
  expect(after.y, "the document moved despite cancellation").toBe(before.y);

  const metrics = await readMetrics(page);
  expect(metrics.documentCommits, "a cancelled gesture wrote to the document").toBe(0);
  expect(
    count(metrics.events, "historyTransaction"),
    "a cancelled gesture pushed a history entry",
  ).toBe(0);
  expect(await transientTransform(page, layerId), "preview reappeared after pointer release").toBe("");
}

/* -------------------------------------------------------------------------- */
/* Suite                                                                      */
/* -------------------------------------------------------------------------- */

test.describe("gesture cancellation", () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page);
  });

  test("Escape abandons a live drag and leaves the editor usable", async ({ page }) => {
    const before = await rectAttrs(page, DRAG_TARGET);
    await beginHeldDrag(page, DRAG_TARGET);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    await expectCancelled(page, DRAG_TARGET, before);
    await expectEditorStillWorks(page);
  });

  test("pointercancel abandons a live drag", async ({ page }) => {
    // The browser revoking the pointer — an OS gesture, palm rejection, a
    // device disconnecting. Konva never delivers `dragend` in this case, which
    // is precisely why it has to be handled explicitly.
    const before = await rectAttrs(page, DRAG_TARGET);
    await beginHeldDrag(page, DRAG_TARGET);

    await page.evaluate(() => {
      const K = (window as any).Konva;
      const container = K?.stages?.[0]?.container();
      container?.dispatchEvent(
        new PointerEvent("pointercancel", { pointerId: 1, bubbles: true, cancelable: true }),
      );
    });
    await page.waitForTimeout(200);

    await expectCancelled(page, DRAG_TARGET, before);
    await expectEditorStillWorks(page);
  });

  test("losing the window abandons a live drag", async ({ page }) => {
    const before = await rectAttrs(page, DRAG_TARGET);
    await beginHeldDrag(page, DRAG_TARGET);

    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.waitForTimeout(200);

    await expectCancelled(page, DRAG_TARGET, before);
    await expectEditorStillWorks(page);
  });

  test("hiding the tab abandons a live drag", async ({ page }) => {
    const before = await rectAttrs(page, DRAG_TARGET);
    await beginHeldDrag(page, DRAG_TARGET);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(200);

    await expectCancelled(page, DRAG_TARGET, before);

    // Put the tab back before exercising the editor again.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expectEditorStillWorks(page);
  });

  test("Escape abandons a live RESIZE without resizing the object", async ({ page }) => {
    // A resize runs on the Transformer's own pointer loop, not a node drag, so
    // it needs `stopTransform()` — releasing the proxies is not enough.
    await selectLayer(page, DRAG_TARGET);
    const before = await rectAttrs(page, DRAG_TARGET);
    await resetMetrics(page);

    const anchor = await anchorPoint(page, "bottom-right");
    await pressAndMove(page, anchor, (step) => ({ x: anchor.x + step * 4, y: anchor.y + step * 4 }), 12);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(450);

    const after = await rectAttrs(page, DRAG_TARGET);
    const metrics = await readMetrics(page);
    expect(after.width, "a cancelled resize still changed the size").toBe(before.width);
    expect(after.height, "a cancelled resize still changed the size").toBe(before.height);
    expect(metrics.documentCommits, "a cancelled resize wrote to the document").toBe(0);
    expect(await transformerStuck(page), "Transformer left mid-transform after a cancelled resize").toBe(false);

    await expectEditorStillWorks(page);
  });

  test("Escape abandons a live ROTATION without rotating the object", async ({ page }) => {
    await selectLayer(page, DRAG_TARGET);
    const before = await rectAttrs(page, DRAG_TARGET);
    await resetMetrics(page);

    // Sweep the rotater along a real arc about the object's centre. A short
    // LINEAR drag is not a rotation: the handle snaps to 15° steps, so a small
    // sweep resolves back to the starting angle and previews nothing at all.
    const rotater = await anchorPoint(page, "rotater");
    const centre = await bodyPoint(page, DRAG_TARGET);
    const radius = Math.hypot(rotater.x - centre.x, rotater.y - centre.y);
    const start = Math.atan2(rotater.y - centre.y, rotater.x - centre.x);
    await pressAndMove(
      page,
      rotater,
      (step) => {
        const angle = start + (step / 20) * (Math.PI / 3);
        return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
      },
      20,
    );
    expect(await transientTransform(page, DRAG_TARGET), "rotation never previewed").not.toBe("");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(450);

    const after = await rectAttrs(page, DRAG_TARGET);
    const metrics = await readMetrics(page);
    expect(after).toEqual(before);
    expect(metrics.documentCommits, "a cancelled rotation wrote to the document").toBe(0);
    expect(await transientTransform(page, DRAG_TARGET), "rotation preview survived cancellation").toBe("");

    await expectEditorStillWorks(page);
  });

  test("Escape with no gesture running still reaches the editor and clears the selection", async ({ page }) => {
    // The canvas swallows Escape ONLY when it actually cancelled something.
    // Otherwise one keypress would cost the customer both the gesture and the
    // object they were working on.
    await selectLayer(page, DRAG_TARGET);
    expect(await transformerNodeCount(page)).toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    expect(
      await transformerNodeCount(page),
      "Escape on an idle canvas did not clear the selection",
    ).toBe(0);
  });

  test("a cancelled gesture is never autosaved", async ({ page }) => {
    // Held past the autosave debounce so a save genuinely had the chance to
    // run, then cancelled: the committed document must be what persists.
    const before = await rectAttrs(page, DRAG_TARGET);
    await beginHeldDrag(page, DRAG_TARGET);
    await page.waitForTimeout(2200);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(2200);

    const after = await rectAttrs(page, DRAG_TARGET);
    const metrics = await readMetrics(page);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(metrics.documentCommits, "the cancelled drag reached the document").toBe(0);
  });

  test("two cancellations in a row do not break the third, real gesture", async ({ page }) => {
    // Guards the abort flag specifically: if it were left set, the NEXT genuine
    // gesture would return early and the customer's edit would vanish.
    const before = await rectAttrs(page, DRAG_TARGET);

    await beginHeldDrag(page, DRAG_TARGET);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(300);

    await beginHeldDrag(page, DRAG_TARGET);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const untouched = await rectAttrs(page, DRAG_TARGET);
    expect(untouched.x).toBe(before.x);
    expect(untouched.y).toBe(before.y);

    await resetMetrics(page);
    const from = await bodyPoint(page, DRAG_TARGET);
    await pressAndMove(page, from, (step) => ({ x: from.x + step * 5, y: from.y }), 12);
    await page.mouse.up();
    await page.waitForTimeout(450);

    const moved = await rectAttrs(page, DRAG_TARGET);
    const metrics = await readMetrics(page);
    expect(moved.x, "the third gesture was swallowed by a stale abort flag").not.toBe(before.x);
    expect(metrics.documentCommits, "the third gesture must commit exactly once").toBe(1);
  });
});

test.describe("transform handle reachability", () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page);
  });

  test("an object near the top edge can still be rotated", async ({ page }) => {
    // Regression: the interaction stage used to be sized exactly to the page,
    // so the canvas element CLIPPED anything the selection chrome drew outside
    // it. The rotation control sits above its object, so for any object near
    // the top of the design it was rendered off-canvas — invisible, and not in
    // the hit graph at all. Pressing it fell through to the workspace behind,
    // and the object simply could not be rotated. fx_title sits close enough to
    // the top edge to reproduce it exactly.
    await selectLayer(page, DRAG_TARGET);
    const rotater = await anchorPoint(page, "rotater");

    const reachable = await page.evaluate(([x, y]) => {
      const K = (window as any).Konva;
      const stage = K.stages[0];
      const box = stage.container().getBoundingClientRect();
      const inside = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      const hit = stage.getIntersection({ x: x - box.left, y: y - box.top });
      return { inside, hitName: hit ? String(hit.name?.() || "") : "" };
    }, [rotater.x, rotater.y]);

    expect(reachable.inside, "the rotation handle is drawn outside the interactive stage").toBe(true);
    expect(reachable.hitName, "the rotation handle is not in Konva's hit graph").toContain("rotater");

    // ...and it actually rotates. A full 60° sweep so the 15° snap cannot
    // resolve the gesture back to the starting angle.
    await resetMetrics(page);
    const centre = await bodyPoint(page, DRAG_TARGET);
    const radius = Math.hypot(rotater.x - centre.x, rotater.y - centre.y);
    const start = Math.atan2(rotater.y - centre.y, rotater.x - centre.x);
    await pressAndMove(
      page,
      rotater,
      (step) => {
        const angle = start + (step / 20) * (Math.PI / 3);
        return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
      },
      20,
    );
    await page.mouse.up();
    await page.waitForTimeout(450);

    const metrics = await readMetrics(page);
    expect(metrics.documentCommits, "the rotation did not reach the document").toBe(1);
    // Each layer type carries its rotation on a different node — text puts it
    // on an inner <g>, a shape on its <rect> — so ask the whole subtree rather
    // than assuming one shape of markup.
    const rendered = await page.evaluate((id) => {
      const group = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"]`);
      if (!group) return "";
      return [group, ...group.querySelectorAll("*")]
        .map((node) => node.getAttribute("transform") || "")
        .join(" ");
    }, DRAG_TARGET);
    expect(rendered, "the committed rotation did not render").toMatch(/rotate\(/);
  });

  test("the page still lines up exactly with the artwork underneath it", async ({ page }) => {
    // The stage is deliberately LARGER than the page now. If the compensating
    // offset were wrong, every pointer position would be displaced by the
    // gutter — so this pins the alignment rather than trusting it.
    const aligned = await page.evaluate(() => {
      const K = (window as any).Konva;
      const stage = K.stages[0];
      const container = stage.container();
      const box = container.getBoundingClientRect();
      const svg = document.querySelector('[data-customizer-canvas="main"] svg');
      const svgBox = svg!.getBoundingClientRect();
      // Where the stage thinks the document origin is, in viewport pixels.
      const originX = box.left + stage.x();
      const originY = box.top + stage.y();
      return {
        dx: Math.abs(originX - svgBox.left),
        dy: Math.abs(originY - svgBox.top),
      };
    });
    expect(aligned.dx, "stage origin drifted from the artwork horizontally").toBeLessThanOrEqual(1);
    expect(aligned.dy, "stage origin drifted from the artwork vertically").toBeLessThanOrEqual(1);
  });

  test("a click in the gutter outside the page clears the selection", async ({ page }) => {
    // The enlarged stage must not swallow the deselect click that used to land
    // on the workspace behind it.
    await selectLayer(page, DRAG_TARGET);
    expect(await transformerNodeCount(page)).toBeGreaterThan(0);

    const point = await page.evaluate(() => {
      const K = (window as any).Konva;
      const box = K.stages[0].container().getBoundingClientRect();
      return { x: box.left + 6, y: box.top + 6 };
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(450);

    expect(await transformerNodeCount(page), "clicking outside the page did not deselect").toBe(0);
  });
});
