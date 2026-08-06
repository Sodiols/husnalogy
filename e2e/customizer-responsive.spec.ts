import { expect, test, type Page } from "@playwright/test";
import { seedManifest } from "./helpers";

// Responsive acceptance for the customer customizer shell (spec §8, §9, §25).
//
// Unlike the seeded journey specs this one needs no login and writes nothing:
// it opens the personalize page as a guest and measures layout only. That keeps
// it runnable on any environment that can serve the product catalogue.
//
// Set E2E_CUSTOMIZER_URL (or seed the manifest) to pin a specific product;
// otherwise the first product that exposes a personalize page is used.

const VIEWPORTS: Array<{ name: string; width: number; height: number }> = [
  { name: "320x568", width: 320, height: 568 },
  { name: "360x800", width: 360, height: 800 },
  { name: "375x812", width: 375, height: 812 },
  { name: "390x844", width: 390, height: 844 },
  { name: "414x896", width: 414, height: 896 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768 (landscape)", width: 1024, height: 768 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

let resolvedUrl: string | null = null;

async function personalizeUrl(page: Page): Promise<string> {
  if (resolvedUrl) return resolvedUrl;
  const fromEnv = process.env.E2E_CUSTOMIZER_URL || seedManifest.customizerUrl || "";
  if (fromEnv) {
    resolvedUrl = fromEnv;
    return resolvedUrl;
  }
  await page.goto("/products");
  const slugs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/products/"]'))
      .map((a) => a.getAttribute("href") || "")
      .map((href) => href.split("/")[2])
      .filter((slug, index, all) => slug && all.indexOf(slug) === index),
  );
  for (const slug of slugs) {
    const candidate = `/products/${slug}/personalize`;
    await page.goto(candidate);
    if (await page.locator("[data-customizer-root]").count()) {
      resolvedUrl = candidate;
      return candidate;
    }
  }
  throw new Error("No product exposes a personalize page. Seed a customizer product or set E2E_CUSTOMIZER_URL.");
}

type Layout = {
  documentOverflow: number;
  headerOverflow: number;
  secondaryOverflow: number;
  canvasBox: { width: number; height: number } | null;
  pageBox: { width: number; height: number } | null;
  canvasShareOfViewport: number;
  smallStepTargets: number;
};

async function measure(page: Page): Promise<Layout> {
  // Let the canvas settle: the workspace re-measures after layout so Fit
  // accounts for panels that mount after the first paint.
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const doc = document.documentElement;
    const header = document.querySelector("header");
    const secondary = header?.nextElementSibling as HTMLElement | null;
    const surface = Array.from(document.querySelectorAll("div")).find((el) =>
      (el.className || "").toString().includes("shrink-0 bg-white shadow-"),
    ) as HTMLElement | undefined;
    const wrap = surface?.parentElement || null;
    const surfaceRect = surface?.getBoundingClientRect() || null;
    const stepButtons = Array.from(secondary?.querySelectorAll("nav button") || []);

    return {
      documentOverflow: doc.scrollWidth - doc.clientWidth,
      headerOverflow: header ? header.scrollWidth - header.clientWidth : 0,
      secondaryOverflow: secondary ? secondary.scrollWidth - secondary.clientWidth : 0,
      canvasBox: wrap ? { width: wrap.clientWidth, height: wrap.clientHeight } : null,
      pageBox: surfaceRect ? { width: surfaceRect.width, height: surfaceRect.height } : null,
      canvasShareOfViewport: wrap ? wrap.clientHeight / window.innerHeight : 0,
      // Only visible controls count: the mobile bar stays mounted but hidden
      // from sm up, and a display:none button has no measurable size.
      smallStepTargets: stepButtons.filter((b) => {
        const rect = b.getBoundingClientRect();
        return rect.height > 0 && rect.height < 44;
      }).length,
    };
  });
}

test.describe("customer customizer responsive shell", () => {
  for (const viewport of VIEWPORTS) {
    test(`fits and centres the page at ${viewport.name}`, async ({ page }) => {
      const url = await personalizeUrl(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(url);
      await expect(page.locator("[data-customizer-root]")).toBeVisible();

      const layout = await measure(page);

      // DoD 6: no horizontal overflow anywhere in the chrome, down to 320px.
      expect(layout.documentOverflow, "document must not scroll horizontally").toBeLessThanOrEqual(0);
      expect(layout.headerOverflow, "header must not overflow").toBeLessThanOrEqual(0);
      expect(layout.secondaryOverflow, "secondary bar must not overflow").toBeLessThanOrEqual(0);

      // DoD 7: Fit uses the real viewport — the page fits on BOTH axes.
      expect(layout.canvasBox, "canvas workspace must be measurable").not.toBeNull();
      expect(layout.pageBox, "the design page must render").not.toBeNull();
      expect(layout.pageBox!.width).toBeLessThanOrEqual(layout.canvasBox!.width + 1);
      expect(layout.pageBox!.height).toBeLessThanOrEqual(layout.canvasBox!.height + 1);

      // DoD 5: the mobile interface must not hide most of the canvas.
      if (viewport.width < 768) {
        expect(layout.canvasShareOfViewport, "canvas should own most of a phone screen").toBeGreaterThan(0.5);
      }

      // Spec §22: 44px touch targets on the mobile step control.
      expect(layout.smallStepTargets, "step buttons must be at least 44px tall").toBe(0);
    });
  }
});
