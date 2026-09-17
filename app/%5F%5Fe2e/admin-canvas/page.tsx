import { notFound } from "next/navigation";

import { buildE2ECustomizerFixture } from "@/lib/customizer/v2/fixtures/e2e-customizer-fixture";
import AdminCanvasFixture from "./AdminCanvasFixture";

/**
 * Internal admin-canvas fixture. Same availability rule as /__e2e/customizer:
 * always in non-production builds, and in production only with
 * ENABLE_CUSTOMIZER_E2E_FIXTURE=1.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin Canvas E2E Fixture",
  robots: { index: false, follow: false },
};

function fixtureEnabled(): boolean {
  if (process.env.ENABLE_CUSTOMIZER_E2E_FIXTURE === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export default function AdminCanvasE2EFixturePage() {
  if (!fixtureEnabled()) notFound();
  const { template } = buildE2ECustomizerFixture();
  return <AdminCanvasFixture initialTemplate={template} />;
}
