"use client";

/**
 * Browser-only entry point for the shared Konva interaction layer.
 *
 * Konva draws to a `<canvas>` and touches `window` while its modules evaluate,
 * so it cannot run during server rendering. Loading it through `next/dynamic`
 * with `ssr: false` keeps the customizer's server-rendered HTML — the artwork,
 * the toolbars, the panels — completely unchanged, and adds the interaction
 * layer once the browser takes over.
 *
 * That ordering is deliberate rather than incidental: the design underneath is
 * still the shared SVG renderer (spec §10, Strategy A), so a customer on a slow
 * connection sees their product immediately and gains handles a moment later,
 * instead of waiting on a canvas bundle to see anything at all.
 */

import dynamic from "next/dynamic";

const InteractionStageClient = dynamic(() => import("./CustomizerInteractionStage"), {
  ssr: false,
  loading: () => null,
});

export default InteractionStageClient;
export type { InteractionNode, GestureCommit, InteractionStageProps } from "./CustomizerInteractionStage";
