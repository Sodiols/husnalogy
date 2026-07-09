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

const COLOR_SWATCH_CLASSES = {
  beige: "bg-[#E6E6E6]",
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

function formatPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return `$${amount.toFixed(2)}`;
}

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
  const unique = [...new Set(values)].slice(0, 2);
  return unique.length ? unique : ["White", "Charcoal"];
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
  const currentPriceLabel = formatPrice(currentPrice);
  const originalPriceLabel = formatPrice(product?.price);
  const salePercent = getSalePercent(product);
  const hasOriginalPrice = Boolean(salePercent && originalPriceLabel);
  const collectionLabel = product.collection || product.category || product.productType || "Husnalogy Collection";
  const moreLikeThisHref = buildMoreLikeThisHref(product);
  const swatches = getSwatches(product);
  const isStockOut = Boolean(product.isStockOut);
  const comingInDays = Number(product.comingInDays);
  const hasComingDays = isStockOut && Number.isFinite(comingInDays) && comingInDays > 0;
  const isFeatured = Boolean(product.featured || product.isFeatured);
  const isNewArrival = Boolean(product.isNew || product.isNewArrival);

  return (
    <article className="product-card group min-w-0 text-[#303839]">
      <div className="relative aspect-square overflow-hidden rounded-none bg-[#f8f6f1] ring-1 ring-[#303839]/8">
        <Link href={`/products/${product.slug}`} className="block h-full w-full">
          <Image
            src={image}
            alt={product.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className={`object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] ${isStockOut ? "opacity-55" : ""}`}
          />
        </Link>

        {(isStockOut || isNewArrival || product.isBestSeller || isFeatured) && (
          <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
            {isStockOut && (
              <span className="rounded-none bg-[#303839]/85 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
                Stock Out
              </span>
            )}
            {isNewArrival && (
              <span className="rounded-none bg-white/95 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#303839]">
                New Arrival
              </span>
            )}
            {product.isBestSeller && (
              <span className="rounded-none bg-[#303839] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
                Best Seller
              </span>
            )}
            {isFeatured && (
              <span className="rounded-none border border-[#303839]/70 bg-white/95 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#303839]">
                Featured
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={toggleWishlist}
          aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
          data-shape="round"
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border border-[#303839]/10 bg-white/95 text-[13px] text-[#303839] opacity-0 transition-opacity duration-200 hover:bg-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]/20 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <i className={wishlisted ? "fa-solid fa-heart text-[#303839]" : "fa-regular fa-heart"} />
        </button>

        {salePercent && (
          <span className="absolute bottom-2 left-2 rounded-none bg-white px-2 py-1 text-[11px] font-semibold leading-none text-[#303839]">
            You save {salePercent}%
          </span>
        )}
      </div>

      <div className="mt-3.5 px-0.5">
        <div className="mb-2.5 flex items-center gap-1.5">
          {swatches.map((color) => (
            <span
              key={color}
              title={color}
              className={`h-3.5 w-3.5 rounded-full border border-[#303839]/25 ring-1 ring-white ${swatchClass(color)}`}
            />
          ))}
        </div>

        <Link href={`/products/${product.slug}`} className="block min-w-0">
          <h2 className="line-clamp-1 text-[14px] font-medium leading-5 tracking-[0.01em] text-[#303839]">
            {product.title}
          </h2>
        </Link>

        {currentPriceLabel && (
          <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[14px] leading-4">
            <span className="font-semibold text-[#303839]">{currentPriceLabel}</span>
            {hasOriginalPrice && <span className="text-[13px] text-[#303839]/50 line-through">{originalPriceLabel}</span>}
            {hasOriginalPrice && <span className="text-[13px] text-[#303839]/60">Comp. value</span>}
          </div>
        )}

        {isStockOut && (
          <p className="mt-1 text-[12px] font-semibold leading-4 text-[#303839]/70">
            {hasComingDays ? `Coming in ${comingInDays} day${comingInDays === 1 ? "" : "s"}` : "Stock Out"}
          </p>
        )}

        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[12px] font-medium leading-4 text-[#303839]/70">
          <CollectionIcon />
          <span className="line-clamp-1">{collectionLabel}</span>
        </p>

        {hasSuite ? (
          <Link
            href={moreLikeThisHref}
            className="group mt-1 inline-flex items-center gap-1 text-[12px] font-semibold leading-4 text-black transition hover:text-[#303839]/70"
          >
            Wedding Suite <RightArrowIcon className="group-hover:translate-x-1" />
          </Link>
        ) : hasOtherStyles ? (
          <Link
            href={moreLikeThisHref}
            className="group mt-1 inline-flex items-center gap-1 text-[12px] font-semibold leading-4 text-black transition hover:text-[#303839]/70"
          >
            More like this <RightArrowIcon className="group-hover:translate-x-1" />
          </Link>
        ) : null}
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
