"use client";

import { useEffect } from "react";
import { addRecentlyViewed } from "../lib/customer-lists";
import { pinMockupImage } from "./product-image";

export default function RecentlyViewedTracker({ product }) {
  useEffect(() => {
    if (!product?.slug) return undefined;

    let cancelled = false;

    const frameId = window.requestAnimationFrame(() => {
      if (cancelled) return;
      addRecentlyViewed(pinMockupImage(product));
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [product?.slug]);

  return null;
}
