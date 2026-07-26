"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import RightArrowIcon from "../components/RightArrowIcon";
import useAuth from "../lib/useAuth";
import {
  addToWishlist,
  formatRemoteError,
  openCustomerLogin,
  removeFromWishlist,
  subscribeToUserWishlist,
} from "../lib/customer-lists";
import {
  getLocalProductOptions,
  saveProductOptions,
} from "../lib/product-options";

const DESKTOP_THUMB_SIZE = 80;
const DESKTOP_THUMB_GAP = 12;
const DESKTOP_ARROW_SPACE = 88;

const MOBILE_THUMB_SIZE = 64;
const MOBILE_THUMB_GAP = 10;
const MOBILE_SIDE_SPACE = 84;

function getImageSource(value) {
  if (!value) return "";

  if (typeof value === "string") return value;

  if (typeof value === "object") {
    return (
      value.src ||
      value.url ||
      value.image ||
      value.imageUrl ||
      value.mockup ||
      value.thumbnail ||
      ""
    );
  }

  return "";
}

function GalleryCircleButton({
  children,
  onClick,
  disabled = false,
  ariaLabel,
  className = "",
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-shape="round"
      className={`grid place-items-center rounded-full border border-[#303839]/10 bg-white text-[#303839] transition-all duration-300 ease-out hover:scale-[1.04] hover:border-[#303839]/25 hover:bg-[#E6E6E6] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]/20 disabled:pointer-events-none disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

function ThumbCarouselButton({
  direction = "up",
  onClick,
  disabled = false,
  ariaLabel,
  className = "",
}) {
  const iconClass =
    direction === "up"
      ? "fa-chevron-up"
      : direction === "down"
        ? "fa-chevron-down"
        : direction === "left"
          ? "fa-chevron-left"
          : "fa-chevron-right";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-shape="round"
      className={`grid place-items-center rounded-full border border-[#303839]/10 bg-white/95 text-[10px] text-[#303839] backdrop-blur-sm transition-all duration-300 ease-out hover:border-[#303839]/25 hover:bg-[#E6E6E6] active:scale-95 disabled:pointer-events-none disabled:opacity-35 ${className}`}
    >
      <i className={`fa-solid ${iconClass}`} />
    </button>
  );
}

export default function ProductGallery({ product, belowMainContent = null, initialUser = undefined }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [thumbStart, setThumbStart] = useState(0);
  const [visibleThumbs, setVisibleThumbs] = useState(4);
  const [isDesktop, setIsDesktop] = useState(false);
  const [wishlisted, setWishlisted] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  const thumbRailRef = useRef(null);
  const mountedRef = useRef(false);
  const { user } = useAuth(initialUser);

  const productIdentity = product?.id || product?.slug || product?.title;
  const productKey = product?.id || product?.slug;

  const images = useMemo(() => {
    const sourceImages = product?.images?.length
      ? product.images
      : product?.mockups?.length
        ? product.mockups
        : ["/images/weddings.png"];

    const cleanImages = sourceImages.map(getImageSource).filter(Boolean);

    return cleanImages.length ? cleanImages : ["/images/weddings.png"];
  }, [product]);

  const activeImage = images[activeIndex] || images[0];
  const maxThumbStart = Math.max(0, images.length - visibleThumbs);
  const hasThumbnailCarousel = images.length > visibleThumbs;

  const thumbStep = isDesktop
    ? DESKTOP_THUMB_SIZE + DESKTOP_THUMB_GAP
    : MOBILE_THUMB_SIZE + MOBILE_THUMB_GAP;

  const thumbTransform = isDesktop
    ? `translate3d(0, -${thumbStart * thumbStep}px, 0)`
    : `translate3d(-${thumbStart * thumbStep}px, 0, 0)`;

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    setThumbStart(0);
    setFullscreenOpen(false);
  }, [productIdentity]);

  useEffect(() => {
    if (!fullscreenOpen) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setFullscreenOpen(false);
      if (event.key === "ArrowLeft") {
        setActiveIndex((previousIndex) =>
          previousIndex === 0 ? images.length - 1 : previousIndex - 1,
        );
      }
      if (event.key === "ArrowRight") {
        setActiveIndex((previousIndex) =>
          previousIndex === images.length - 1 ? 0 : previousIndex + 1,
        );
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [fullscreenOpen, images.length]);

  useEffect(() => {
    let mounted = true;
    let frameId = null;
    let observer = null;

    const updateVisibleThumbs = () => {
      if (!mounted || typeof window === "undefined") return;

      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        const rail = thumbRailRef.current;

        if (!mounted || !rail) return;

        const desktop = window.matchMedia("(min-width: 768px)").matches;
        setIsDesktop(desktop);

        const thumbSize = desktop ? DESKTOP_THUMB_SIZE : MOBILE_THUMB_SIZE;
        const thumbGap = desktop ? DESKTOP_THUMB_GAP : MOBILE_THUMB_GAP;
        const fullThumbSpace = thumbSize + thumbGap;

        const rawSpace = desktop ? rail.clientHeight : rail.clientWidth;

        const availableSpace = desktop
          ? rawSpace - DESKTOP_ARROW_SPACE
          : rawSpace - MOBILE_SIDE_SPACE;

        let count = Math.floor((availableSpace + thumbGap) / fullThumbSpace);

        if (desktop) {
          count = Math.max(1, count);
        } else {
          count = Math.max(3, count);
          count = Math.min(4, count);
        }

        if (mounted) {
          setVisibleThumbs(Math.min(images.length, count));
        }
      });
    };

    updateVisibleThumbs();

    if (typeof ResizeObserver !== "undefined" && thumbRailRef.current) {
      observer = new ResizeObserver(updateVisibleThumbs);
      observer.observe(thumbRailRef.current);
    }

    window.addEventListener("resize", updateVisibleThumbs);

    return () => {
      mounted = false;

      if (observer) {
        observer.disconnect();
      }

      window.removeEventListener("resize", updateVisibleThumbs);

      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [images.length]);

  useEffect(() => {
    setThumbStart((current) => Math.min(current, maxThumbStart));
  }, [maxThumbStart]);

  useEffect(() => {
    setThumbStart((current) => {
      if (activeIndex < current) return activeIndex;

      if (activeIndex >= current + visibleThumbs) {
        return Math.min(activeIndex - visibleThumbs + 1, maxThumbStart);
      }

      return current;
    });
  }, [activeIndex, visibleThumbs, maxThumbStart]);

  useEffect(() => {
    let mounted = true;

    if (!user) {
      setWishlisted(false);

      return () => {
        mounted = false;
      };
    }

    const unsubscribe = subscribeToUserWishlist(user, (items) => {
      if (!mounted) return;

      setWishlisted(
        items.some((item) => String(item.productId || item.id || item.slug) === String(productKey)),
      );
    });

    return () => {
      mounted = false;

      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [user, productKey]);

  const toggleWishlist = async () => {
    if (!user) {
      openCustomerLogin();
      return;
    }

    setWishlistLoading(true);

    try {
      if (wishlisted) {
        await removeFromWishlist(user, productKey);
      } else {
        const localOptions = getLocalProductOptions(product);

        if (localOptions) {
          await saveProductOptions(user, product, localOptions);
        }

        await addToWishlist(user, product);
      }
    } catch (error) {
      console.error("Wishlist update failed:", formatRemoteError(error));

      if (error?.code === "auth-required") {
        openCustomerLogin();
      }
    } finally {
      if (mountedRef.current) {
        setWishlistLoading(false);
      }
    }
  };

  const goPrev = () => {
    setActiveIndex((previousIndex) =>
      previousIndex === 0 ? images.length - 1 : previousIndex - 1,
    );
  };

  const goNext = () => {
    setActiveIndex((previousIndex) =>
      previousIndex === images.length - 1 ? 0 : previousIndex + 1,
    );
  };

  const goThumbPrev = () => {
    setThumbStart((previousStart) => Math.max(0, previousStart - 1));
  };

  const goThumbNext = () => {
    setThumbStart((previousStart) =>
      Math.min(maxThumbStart, previousStart + 1),
    );
  };

  return (
    <div className="grid w-full min-w-0 max-w-full items-start overflow-hidden gap-4 md:grid-cols-[90px_minmax(0,1fr)] md:gap-5">
      <div className="relative order-3 min-w-0 max-w-full self-start md:order-1 md:row-span-2 md:h-[calc(100vh-190px)] md:min-h-[520px]">
        <div
          ref={thumbRailRef}
          className={`relative max-w-full overflow-hidden ${
            hasThumbnailCarousel ? "px-[42px] md:px-0 md:py-[48px]" : ""
          } md:h-full`}
        >
          <div
            className="flex gap-[10px] will-change-transform transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:flex-col md:items-center md:gap-3"
            style={{ transform: thumbTransform }}
          >
            {images.map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-none border bg-white transition-all duration-300 ease-out hover:border-[#303839]/70 md:h-20 md:w-20 ${
                  activeIndex === index
                    ? "border-[#303839]"
                    : "border-[#303839]/12"
                }`}
              >
                <img
                  src={image}
                  alt={product.title}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>

        {hasThumbnailCarousel && (
          <>
            <div className="pointer-events-none absolute left-0 top-0 z-20 hidden h-[58px] w-full bg-gradient-to-b from-white via-white/95 to-white/0 md:block" />

            <div className="pointer-events-none absolute bottom-0 left-0 z-20 hidden h-[58px] w-full bg-gradient-to-t from-white via-white/95 to-white/0 md:block" />

            <div className="pointer-events-none absolute left-0 top-0 z-20 h-full w-[52px] bg-gradient-to-r from-white via-white/95 to-white/0 md:hidden" />

            <div className="pointer-events-none absolute right-0 top-0 z-20 h-full w-[52px] bg-gradient-to-l from-white via-white/95 to-white/0 md:hidden" />

            <div className="absolute left-1/2 top-[8px] z-30 hidden -translate-x-1/2 md:block">
              <ThumbCarouselButton
                direction="up"
                onClick={goThumbPrev}
                disabled={thumbStart === 0}
                ariaLabel="Previous thumbnails"
                className="h-[30px] w-[72px]"
              />
            </div>

            <div className="absolute bottom-[8px] left-1/2 z-30 hidden -translate-x-1/2 md:block">
              <ThumbCarouselButton
                direction="down"
                onClick={goThumbNext}
                disabled={thumbStart >= maxThumbStart}
                ariaLabel="Next thumbnails"
                className="h-[30px] w-[72px]"
              />
            </div>

            <div className="absolute left-0 top-1/2 z-30 -translate-y-1/2 md:hidden">
              <ThumbCarouselButton
                direction="left"
                onClick={goThumbPrev}
                disabled={thumbStart === 0}
                ariaLabel="Previous thumbnails"
                className="h-[34px] w-[34px]"
              />
            </div>

            <div className="absolute right-0 top-1/2 z-30 -translate-y-1/2 md:hidden">
              <ThumbCarouselButton
                direction="right"
                onClick={goThumbNext}
                disabled={thumbStart >= maxThumbStart}
                ariaLabel="Next thumbnails"
                className="h-[34px] w-[34px]"
              />
            </div>
          </>
        )}
      </div>

      <div className="relative order-1 flex aspect-[4/3] min-h-0 w-full max-w-full items-center justify-center self-start overflow-hidden rounded-none bg-white md:order-2 md:col-start-2 md:row-start-1 md:h-[calc(100vh-190px)] md:min-h-[520px] md:aspect-auto">
        <button
          type="button"
          onClick={toggleWishlist}
          disabled={wishlistLoading}
          aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
          data-shape="round"
          className="absolute right-4 top-4 z-30 grid h-[44px] w-[44px] place-items-center rounded-full border border-[#303839]/10 bg-white text-[20px] text-[#303839] transition-all duration-300 ease-out hover:scale-[1.04] hover:border-[#303839]/25 hover:bg-[#E6E6E6] disabled:opacity-70 md:h-[52px] md:w-[52px] md:text-[22px]"
        >
          {wishlistLoading ? (
            <i className="fa-solid fa-circle-notch animate-spin" />
          ) : (
            <i
              className={
                wishlisted ? "fa-solid fa-heart" : "fa-regular fa-heart"
              }
            />
          )}
        </button>

        <button
          type="button"
          onClick={() => setFullscreenOpen(true)}
          aria-label="View image in full screen"
          className="cursor-image-expand block h-full w-full max-w-full"
        >
          <img
            src={activeImage}
            alt={product.title}
            className="h-full w-full max-w-full object-cover transition-opacity duration-500 ease-out"
          />
        </button>

        {images.length > 1 && (
          <>
            <GalleryCircleButton
              onClick={goPrev}
              ariaLabel="Previous image"
              className="absolute left-[18px] top-1/2 z-20 h-[42px] w-[42px] -translate-y-1/2 text-[25px] leading-none md:left-[28px] md:h-[48px] md:w-[48px] md:text-[28px]"
            >
              <span className="block -translate-y-[2px]">‹</span>
            </GalleryCircleButton>

            <GalleryCircleButton
              onClick={goNext}
              ariaLabel="Next image"
              className="absolute right-[18px] top-1/2 z-20 h-[42px] w-[42px] -translate-y-1/2 text-[25px] leading-none md:right-[28px] md:h-[48px] md:w-[48px] md:text-[28px]"
            >
              <RightArrowIcon />
            </GalleryCircleButton>
          </>
        )}
      </div>

      {belowMainContent && (
        <div className="order-2 min-w-0 overflow-hidden md:col-start-2 md:row-start-2 [&_*]:shadow-none [&_*]:hover:shadow-none">
          {belowMainContent}
        </div>
      )}

      {fullscreenOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${product.title} full screen image`}
            onClick={() => setFullscreenOpen(false)}
            className="fixed inset-0 z-[3100] flex items-center justify-center bg-[#303839]/95 p-4 sm:p-8"
          >
            <button
              type="button"
              onClick={() => setFullscreenOpen(false)}
              aria-label="Close full screen image"
              data-shape="round"
              className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white text-[18px] text-[#303839] transition-transform duration-200 hover:scale-105 sm:right-6 sm:top-6"
            >
              <i className="fa-solid fa-xmark" />
            </button>

            {images.length > 1 && (
              <>
                <GalleryCircleButton
                  onClick={(event) => {
                    event.stopPropagation();
                    goPrev();
                  }}
                  ariaLabel="Previous full screen image"
                  className="absolute left-4 top-1/2 z-10 h-11 w-11 -translate-y-1/2 text-base sm:left-6 sm:h-12 sm:w-12"
                >
                  <i className="fa-solid fa-chevron-left" />
                </GalleryCircleButton>

                <GalleryCircleButton
                  onClick={(event) => {
                    event.stopPropagation();
                    goNext();
                  }}
                  ariaLabel="Next full screen image"
                  className="absolute right-4 top-1/2 z-10 h-11 w-11 -translate-y-1/2 text-base sm:right-6 sm:h-12 sm:w-12"
                >
                  <i className="fa-solid fa-chevron-right" />
                </GalleryCircleButton>
              </>
            )}

            <div
              onClick={(event) => event.stopPropagation()}
              className="flex h-full w-full max-w-[1180px] flex-col items-center justify-center gap-4"
            >
              <div className="min-h-0 flex-1">
                <img
                  src={activeImage}
                  alt={product.title}
                  className="h-full max-h-[calc(100vh-150px)] max-w-full object-contain"
                />
              </div>

              {images.length > 1 && (
                <div className="flex max-w-full gap-2 overflow-x-auto px-2 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {images.map((image, index) => (
                    <button
                      key={`fullscreen-${image}-${index}`}
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      aria-label={`View full screen image ${index + 1}`}
                      aria-current={activeIndex === index ? "true" : undefined}
                      className={`h-16 w-16 shrink-0 overflow-hidden rounded-none border bg-white transition hover:border-white sm:h-20 sm:w-20 ${
                        activeIndex === index ? "border-white" : "border-white/30"
                      }`}
                    >
                      <img
                        src={image}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
