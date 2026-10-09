import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTROL_HEIGHT_CLASS,
  CONTROL_HEIGHT_PX,
  FOCUS_RING,
  HUSNALOGY_COLORS,
  RADIUS,
  SHADOW,
} from "../design-tokens";

// Spec §7/§8: consistent control heights, radius and spacing; clear focus
// states; the Husnalogy palette with gold used sparingly as an accent; no glow
// and no gradients.
//
// The audit behind these tests found FOUR competing interactive control heights
// (colliding inside a single toolbar row), EIGHT competing border radii, and
// five interactive components with no focus-visible treatment at all.

const CUSTOMIZER_DIR = path.join(process.cwd(), "app/components/customizer");
const files = readdirSync(CUSTOMIZER_DIR).filter((name) => name.endsWith(".tsx"));
const read = (name: string) => readFileSync(path.join(CUSTOMIZER_DIR, name), "utf8");
const sources = new Map(files.map((name) => [name, read(name)]));

/** Components that render output only and own no focusable control. */
const RENDER_ONLY = new Set([
  "CustomizerPreview.tsx",
  "CustomizerProtectionOverlay.tsx",
  "ServerCustomizationImage.tsx",
  "CustomerProductEditingPreview.tsx",
]);

describe("design tokens", () => {
  it("pins the canonical control height at the 44px accessible target size", () => {
    expect(CONTROL_HEIGHT_CLASS).toBe("h-11");
    // WCAG 2.5.8 minimum target size.
    expect(CONTROL_HEIGHT_PX).toBe(44);
  });

  it("carries the Husnalogy palette (the storefront's cream behind the canvas)", () => {
    expect(HUSNALOGY_COLORS).toMatchObject({
      charcoal: "#303839",
      soft: "#F8F6F1",
      gold: "#D4AF37",
    });
  });

  it("uses focus-visible rather than focus, so a mouse click paints no ring", () => {
    expect(FOCUS_RING).toContain("focus-visible:ring-2");
    expect(FOCUS_RING).not.toMatch(/(?<!-)\bfocus:ring/);
  });

  it("draws focus in charcoal with a white gap, not gold (gold on white is ~2:1, below WCAG 1.4.11's 3:1)", () => {
    expect(FOCUS_RING).toContain(`focus-visible:ring-[${HUSNALOGY_COLORS.charcoal}]`);
    expect(FOCUS_RING).toContain("focus-visible:ring-offset-2");
    expect(FOCUS_RING).toContain("focus-visible:ring-offset-white");
    expect(FOCUS_RING).not.toContain(HUSNALOGY_COLORS.gold);
  });

  it("keeps elevation restrained and uncoloured", () => {
    for (const shadow of Object.values(SHADOW)) {
      expect(shadow).toContain("rgba(48,56,57");
    }
  });

  it("offers one control radius rather than a scale of near-identical ones", () => {
    expect(RADIUS.control).toBe("rounded-lg");
  });
});

describe("every interactive component has a visible focus state", () => {
  const interactive = files.filter((name) => !RENDER_ONLY.has(name));

  it.each(interactive)("%s", (name) => {
    const source = sources.get(name)!;
    // A component with no focusable element at all is fine; one that renders a
    // button or input must show keyboard focus.
    const hasFocusable = /<(button|input|select|textarea)\b/.test(source);
    if (!hasFocusable) return;
    expect(source).toMatch(/focus-visible:|focus-within:/);
  });
});

describe("toolbar rows share one control height", () => {
  // These three toolbars sit directly above the canvas and mix buttons with
  // numeric steppers, so a height mismatch is visible as a ragged row.
  const TOOLBARS = [
    "CustomerImageToolbar.tsx",
    "CustomerElementToolbar.tsx",
    "CustomerGridToolbar.tsx",
  ];

  it.each(TOOLBARS)("%s uses no off-scale control height", (name) => {
    const source = sources.get(name)!;
    // h-12 stood beside h-11 buttons; h-8 was below the touch target minimum.
    expect(source).not.toMatch(/\bh-12\b/);
    expect(source).not.toMatch(/\bh-8 w-8\b/);
  });

  it("draws every toolbar control at the kit's one height, the 44px target on touch", () => {
    // The toolbars share the studio's look through CustomerToolbarKit: 36px
    // (32px compact) with a mouse, and the canonical 44px on a coarse pointer.
    const kit = sources.get("CustomerToolbarKit.tsx")!;
    expect(kit).toContain("pointer-coarse:[--tb-size:44px]");
    expect(kit).toContain("h-[var(--tb-size,36px)]");
    for (const name of [...TOOLBARS, "CustomerContextToolbar.tsx", "CustomerGroupToolbar.tsx"]) {
      expect(sources.get(name)!, name).toContain('from "./CustomerToolbarKit"');
    }
  });
});

describe("gold stays an accent", () => {
  // §8 asks for gold "sparingly for important accent states rather than
  // covering the interface". Every opaque use in the customizer today is a
  // small marker — status dots, the 3px active-tool rule, 1px snap guides,
  // progress fills — so the rule worth enforcing is that gold never becomes a
  // full-bleed surface, not that it is never opaque.
  it("never fills a full-bleed surface", () => {
    for (const [name, source] of sources) {
      const fullBleedGold = new RegExp(
        String.raw`class(Name)?=(["\`])[^"\`]*bg-\[#D4AF37\](?!\/)[^"\`]*\b(inset-0|h-screen|min-h-screen|h-full w-full)\b`,
      );
      expect(source, name).not.toMatch(fullBleedGold);
    }
  });

  it("keeps gold off large text, where it would fail contrast on white", () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/text-\[#D4AF37\][^"`]*\btext-(2xl|3xl|4xl|5xl)\b/);
    }
  });

  it("adds no glow and no gradient", () => {
    for (const [name, source] of sources) {
      // A glow is a zero-offset shadow with a NON-ZERO blur. A zero-blur
      // `shadow-[0_0_0_1px_…]` is a hairline ring and is legitimate.
      expect(source, name).not.toMatch(/shadow-\[0_0_[1-9]/);
      expect(source, name).not.toMatch(/drop-shadow-\[0_0_[1-9]/);
      expect(source, name).not.toMatch(/bg-gradient-to/);
    }
  });
});
