import { notFound } from "next/navigation";
import RenderParityFixture from "./RenderParityFixture";

/**
 * Internal render-parity fixture (stabilization task 17).
 *
 * Renders a design through the CLIENT renderer the Admin studio and the
 * Customer editor both draw with (CustomizerPreview), and through the SERVER
 * SVG renderer (buildPageSvg) in the same browser with the same font bytes, so
 * a browser test can compare them. Closed in production exactly like the
 * customizer fixture.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Render Parity Fixture",
  robots: { index: false, follow: false },
};

export default function RenderParityPage() {
  if (process.env.ENABLE_CUSTOMIZER_E2E_FIXTURE !== "1" && process.env.NODE_ENV === "production") notFound();
  return <RenderParityFixture />;
}
