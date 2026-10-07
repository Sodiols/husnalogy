import { notFound } from "next/navigation";

import PersonalizeClient from "@/app/products/[slug]/personalize/personalize-client";
import { buildE2ECustomizerFixture } from "@/lib/customizer/v2/fixtures/e2e-customizer-fixture";

/**
 * Internal customizer fixture route (spec §18 of the editor upgrade brief).
 *
 * Mounts the REAL customer customizer against an in-memory deterministic
 * document, so interaction tests exercise the actual editor without depending
 * on a seeded Supabase product, an authenticated customer, or reachable remote
 * assets. It is not a product page and never appears in navigation, search,
 * the sitemap or the product listing.
 *
 * Availability is deliberately closed by default in production: a fixture that
 * shipped to customers would be an unpriced, unbuyable product page with a
 * fake template on it. Non-production builds (dev and the Playwright run)
 * always allow it; a production build must opt in explicitly with
 * ENABLE_CUSTOMIZER_E2E_FIXTURE=1, which is what a staging deployment sets.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Customizer E2E Fixture",
  robots: { index: false, follow: false },
};

function fixtureEnabled(): boolean {
  if (process.env.ENABLE_CUSTOMIZER_E2E_FIXTURE === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export default async function CustomizerE2EFixturePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!fixtureEnabled()) notFound();

  const params = await searchParams;
  const { product, template } = buildE2ECustomizerFixture({
    autosave: params.autosave === "1",
    // ?snap=0 disables snapping for exact-geometry assertions.
    snapping: params.snap !== "0",
    // ?stress=200 pads the page for performance runs (spec §22).
    stressLayers: Number(Array.isArray(params.stress) ? params.stress[0] : params.stress) || 0,
    // ?size=3.5x5 runs the editor on an official non-default card size.
    cardSize: String((Array.isArray(params.size) ? params.size[0] : params.size) || ""),
    // ?orientation=landscape turns the card, exactly as the Design Studio does.
    orientation: String((Array.isArray(params.orientation) ? params.orientation[0] : params.orientation) || ""),
    // ?fonts=Inter,Caveat restricts the customer's fonts, like a template allowlist.
    // ?adminClip=1 turns the front photos into Design Studio clipping masks.
    adminClip: params.adminClip === "1",
    // ?templateVersion=2 serves a newer version of the template (version-pinning tests).
    templateVersion: Number(Array.isArray(params.templateVersion) ? params.templateVersion[0] : params.templateVersion) || undefined,
    // ?libraryAsset=8000 makes the croppable photo a library asset whose URL expires in 8s (negative: expired).
    libraryAssetExpiresInMs: params.libraryAsset !== undefined ? Number(Array.isArray(params.libraryAsset) ? params.libraryAsset[0] : params.libraryAsset) || 0 : undefined,
    allowedFonts: String((Array.isArray(params.fonts) ? params.fonts[0] : params.fonts) || "")
      .split(",")
      .map((family) => family.trim())
      .filter(Boolean),
  });

  return <PersonalizeClient product={product} template={template} />;
}
