"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import RightArrowIcon from "../components/RightArrowIcon";
import useAuth from "../lib/useAuth";
import {
  addToWishlist,
  formatRemoteError,
  isProductWishlisted,
  openCustomerLogin,
  removeFromWishlist,
} from "../lib/customer-lists";
import { getMainMockupImage } from "./product-image";
import { productImageAlt } from "@/lib/seo/image-alt";
import { formatCurrency } from "@/lib/currency";

const COLOR_SWATCH_CLASSES = {
  beige: "bg-cream",
  black: "bg-[#303839]",
  blue: "bg-[#2f4d6e]",
  blush: "bg-[#e9cdc6]",
  brown: "bg-[#7b604a]",
  champagne: "bg-[#d9c9ad]",
  charcoal: "bg-[#303839]",
  cream: "bg-[#f1e9da]",
  gold: "bg-[#a78955]",
  green: "bg-[#6f7f64]",
  grey: "bg-[#9aa0a0]",
  gray: "bg-[#9aa0a0]",
  ivory: "bg-[#f6f1e4]",
  navy: "bg-[#26354a]",
  pink: "bg-[#dba2b0]",
  sage: "bg-[#9aa889]",
  silver: "bg-[#cfd2d1]",
  tan: "bg-[#c9a37a]",
  white: "bg-white",
};

function getSalePercent(product) {
  const original = Number(product?.price);
  const sale = Number(product?.salePrice);
  if (!Number.isFinite(original) || !Number.isFinite(sale) || sale >= original || original <= 0) return null;
  return Math.max(1, Math.round(((original - sale) / original) * 100));
}

function getSwatches(product) {
  const values = [product?.color, product?.secondaryColor, product?.accentColor]
    .flatMap((item) => String(item || "").split(/[,/]/))
    .map((item) => item.trim())
    .filter(Boolean);
  // Only colours the product actually lists; nothing is invented when empty.
  return [...new Set(values)].slice(0, 3);
}

function swatchClass(color) {
  return COLOR_SWATCH_CLASSES[String(color || "").toLowerCase()] || "bg-[#7b604a]";
}

function buildMoreLikeThisHref(product) {
  const key = product?.collection ? "collection" : product?.category ? "category" : product?.productType ? "productType" : "";
  const value = product?.collection || product?.category || product?.productType || "";
  return key && value ? `/products?${key}=${encodeURIComponent(value)}` : "/products";
}

export default function ProductCard({ product, hasOtherStyles = false, hasSuite = false }) {
  const { user } = useAuth();
  const [wishlisted, setWishlisted] = useState(false);

  useEffect(() => {
    let mounted = true;

    if (!user || !product?.id) {
      setWishlisted(false);

      return () => {
        mounted = false;
      };
    }

    Promise.resolve(isProductWishlisted(user, product.id))
      .then((value) => {
        if (mounted) setWishlisted(Boolean(value));
      })
      .catch(() => {
        if (mounted) setWishlisted(false);
      });

    return () => {
      mounted = false;
    };
  }, [product?.id, user]);

  if (!product) return null;

  const toggleWishlist = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!product?.id) return;

    if (!user) {
      openCustomerLogin();
      return;
    }

    try {
      if (wishlisted) {
        await removeFromWishlist(user, product.id);
        setWishlisted(false);
      } else {
        await addToWishlist(user, product);
        setWishlisted(true);
      }
    } catch (error) {
      console.error("Wishlist update failed:", formatRemoteError(error));
    }
  };

  const image = getMainMockupImage(product);
  const currentPrice = product?.salePrice ?? product?.price;
  const currentPriceLabel = formatCurrency(currentPrice, product.currency);
  const originalPriceLabel = formatCurrency(product?.price, product.currency);
  const salePercent = getSalePercent(product);
  const hasOriginalPrice = Boolean(salePercent && originalPriceLabel);
  const collectionLabel = product.collection || product.category || product.productType || "Husnalogy";
  const moreLikeThisHref = buildMoreLikeThisHref(product);
  const swatches = getSwatches(product);
  const isStockOut = Boolean(product.isStockOut);
  const comingInDays = Number(product.comingInDays);
  const hasComingDays = isStockOut && Number.isFinite(comingInDays) && comingInDays > 0;
  const isFeatured = Boolean(product.featured || product.isFeatured);
  const isNewArrival = Boolean(product.isNew || product.isNewArrival);

  return (
    <article className="product-card group min-w-0 text-ink">
      <div className="relative aspect-square overflow-hidden rounded-[10px] bg-cream">
        <Link href={`/products/${product.slug}`} className="relative block h-full w-full" tabIndex={-1} aria-hidden="true">
          <Image
            src={image}
            alt={productImageAlt(product, image)}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className={`object-cover ${isStockOut ? "opacity-60" : ""}`}
          />
        </Link>

        {(isStockOut || isNewArrival || product.isBestSeller || isFeatured) && (
          <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
            {isStockOut && <span className="badge badge-ink">Out of stock</span>}
            {isNewArrival && <span className="badge">New</span>}
            {product.isBestSeller && <span className="badge badge-ink">Best seller</span>}
            {isFeatured && <span className="badge">Featured</span>}
          </div>
        )}

        <button
          type="button"
          onClick={toggleWishlist}
          aria-label={wishlisted ? `Remove ${product.title} from wishlist` : `Add ${product.title} to wishlist`}
          aria-pressed={wishlisted}
          data-shape="round"
          className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-[15px] text-ink transition-colors hover:border-ink/50"
        >
          <i className={wishlisted ? "fa-solid fa-heart" : "fa-regular fa-heart"} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3">
        {swatches.length > 0 && (
          <div className="mb-2 flex items-center gap-1.5" aria-label={`Colours: ${swatches.join(", ")}`}>
            {swatches.map((color) => (
              <span
                key={color}
                title={color}
                className={`h-3.5 w-3.5 rounded-full border border-ink/25 ${swatchClass(color)}`}
              />
            ))}
          </div>
        )}

        <h3 className="heading-card line-clamp-2 min-h-[2.7em]">
          <Link href={`/products/${product.slug}`} className="hover:underline hover:underline-offset-4">
            {product.title}
          </Link>
        </h3>

        {currentPriceLabel && (
          <p className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[15px]">
            <span className="price">{currentPriceLabel}</span>
            {hasOriginalPrice && (
              <>
                <span className="text-[14px] text-muted line-through">
                  <span className="sr-only">Was </span>
                  {originalPriceLabel}
                </span>
                <span className="text-[13px] font-medium text-ink">Save {salePercent}%</span>
              </>
            )}
          </p>
        )}

        {isStockOut && (
          <p className="mt-1 text-[13px] font-medium text-muted">
            {hasComingDays ? `Back in ${comingInDays} day${comingInDays === 1 ? "" : "s"}` : "Currently unavailable"}
          </p>
        )}

        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
          <CollectionIcon />
          <span className="line-clamp-1">{collectionLabel}</span>
        </p>

        {(hasSuite || hasOtherStyles) && (
          <Link
            href={moreLikeThisHref}
            className="mt-2 inline-flex min-h-6 items-center gap-1 text-[13px] font-semibold text-ink underline-offset-4 hover:underline"
          >
            {hasSuite ? "View the wedding suite" : "More like this"} <RightArrowIcon />
          </Link>
        )}
      </div>
    </article>
  );
}

function CollectionIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}
