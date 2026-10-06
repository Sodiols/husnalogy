// Mirroring a layer's artwork in its own frame (the Alignment panel's Flip).
//
// Text and shapes carry `flipX` / `flipY`; decorative elements always have.
// The mirror is applied INSIDE the layer's rotation — first flip about the
// object's centre, then rotate — by the browser preview and the server/print
// renderer through this one function, so both draw the same mirror.

/** The SVG transform list for a rotated, optionally mirrored object about (cx, cy); "" for none. */
export function layerTransform(layer: { rotation?: unknown; flipX?: unknown; flipY?: unknown }, cx: number, cy: number): string {
  const parts: string[] = [];
  const rotation = Number(layer.rotation) || 0;
  if (rotation) parts.push(`rotate(${rotation} ${cx} ${cy})`);
  if (layer.flipX || layer.flipY) {
    parts.push(`translate(${cx} ${cy}) scale(${layer.flipX ? -1 : 1} ${layer.flipY ? -1 : 1}) translate(${-cx} ${-cy})`);
  }
  return parts.join(" ");
}
