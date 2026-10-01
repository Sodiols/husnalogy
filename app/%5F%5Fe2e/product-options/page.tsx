import { notFound } from "next/navigation";

import ProductInfo from "@/app/products/ProductInfo";

/**
 * Internal product-options fixture for browser tests of option persistence
 * (Paper Style autosave). Mounts the REAL ProductInfo with a deterministic,
 * unbuyable product, so the test needs no seeded Supabase data and no account.
 *
 * Closed like the customizer fixture: allowed in dev and the Playwright run,
 * and in a production build ONLY with ENABLE_CUSTOMIZER_E2E_FIXTURE=1
 * (staging). It never appears in navigation, search or the sitemap.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Product Options E2E Fixture",
  robots: { index: false, follow: false },
};

function fixtureEnabled(): boolean {
  if (process.env.ENABLE_CUSTOMIZER_E2E_FIXTURE === "1") return true;
  return process.env.NODE_ENV !== "production";
}

const FIXTURE_PRODUCT = {
  id: "e2e-product-options-fixture",
  slug: "e2e-product-options-fixture",
  title: "E2E Options Fixture Card",
  price: 100,
  oldPrice: null,
  currency: "BDT",
  isStockOut: false,
  comingInDays: null,
  customizeEnabled: false,
  hasPublishedCustomizer: false,
  customizationFields: [],
  reviews: [],
  quantityOptions: ["25", "50", "100"],
  sizeOptions: ['5" x 7"', '6" x 8"'],
  paperStyleOptions: ["Flat Card", "Folded Card", "Tri-fold Card"],
  paperOptions: ["Signature Matte", "Premium Linen"],
  envelopeOptions: ["No Envelopes", "Blank White Envelopes"],
  cornerOptions: ["Squared", "Rounded"],
  printingOptions: ["Standard"],
  formatOptions: [],
};

export default function ProductOptionsE2EFixturePage() {
  if (!fixtureEnabled()) notFound();
  return (
    <main className="mx-auto max-w-xl p-4">
      <ProductInfo product={FIXTURE_PRODUCT} initialUser={null} />
    </main>
  );
}
