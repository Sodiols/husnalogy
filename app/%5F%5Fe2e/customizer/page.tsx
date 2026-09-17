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
  });

  return <PersonalizeClient product={product} template={template} />;
}
