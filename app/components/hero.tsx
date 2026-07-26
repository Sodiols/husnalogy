import Image from "next/image";
import Link from "next/link";

/**
 * Homepage hero — "The Wedding Suite" collection section.
 *
 * Presentational only. Every value comes from the admin-managed
 * `hero_collections` record passed in as `collection` (see
 * lib/hero-collections/store.ts). The page hides the section entirely when no
 * active/featured collection is available, so this component assumes a valid
 * record with a heading, a main image, and three thumbnails.
 *
 * Layout mirrors the approved design: ~60% left content / ~40% right gallery,
 * and the gallery is a fixed 78/22 grid (main image + a three-thumbnail column)
 * that keeps the same internal structure at every breakpoint.
 */
export default function Hero({ collection }: { collection?: any }) {
  if (!collection) return null;

  const {
    seasonLabel,
    collectionLabel,
    headingLineOne,
    headingLineTwo,
    description,
    primaryButtonText,
    primaryButtonUrl,
    secondaryLinkText,
    secondaryLinkUrl,
    mainImage,
    thumbnailOne,
    thumbnailTwo,
    thumbnailThree,
    mainImageHref,
    thumbnailOneHref,
    thumbnailTwoHref,
    thumbnailThreeHref,
    itemCount,
    title,
    sourceCollectionName,
  } = collection;

  const galleryHref = mainImageHref || secondaryLinkUrl || "/products";
  const thumbnails = [
    { image: thumbnailOne, href: thumbnailOneHref },
    { image: thumbnailTwo, href: thumbnailTwoHref },
    { image: thumbnailThree, href: thumbnailThreeHref },
  ];
  const countLabel = `${itemCount} ${Number(itemCount) === 1 ? "item" : "items"}`;
  const headingWords = [headingLineOne, headingLineTwo]
    .filter(Boolean)
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const firstHeadingLine = headingWords.slice(0, 3).join(" ");
  const secondHeadingLine = headingWords.slice(3).join(" ");
  const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F8F6F1]";

  return (
    <section className="bg-[#F8F6F1]">
      <div className="mx-auto grid max-w-[1480px] items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,60fr)_minmax(0,40fr)] lg:gap-14 lg:px-10 lg:py-24">
        {/* LEFT — content */}
        <div className="order-2 max-w-[680px] lg:order-1">
          <p className="flex flex-wrap items-center gap-x-2.5 text-[12px] font-semibold tracking-[0.01em]">
            <span className="text-[#303839]">{seasonLabel}</span>
            <span className="uppercase tracking-[0.14em] text-[#303839]/45">{collectionLabel}</span>
          </p>

          <h1 className="mt-5 font-body text-[2rem] font-medium leading-[1.05] tracking-[-0.03em] text-[#303839] sm:text-[2.5rem] lg:text-[2.75rem]">
            {firstHeadingLine}
            {secondHeadingLine && (
              <>
                <br />
                {secondHeadingLine}
              </>
            )}
          </h1>

          {description && (
            <p className="mt-6 max-w-[520px] text-[15px] leading-[1.75] text-[#303839]/75">
              {description}
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
            {primaryButtonText && (
              <Link
                href={primaryButtonUrl || "/weddings"}
                className={`inline-flex h-[52px] items-center justify-center rounded-[6px] border border-[#303839] bg-[#F8F6F1] px-8 text-[13px] font-semibold text-[#303839] transition-colors duration-300 hover:bg-[#303839] hover:text-[#F8F6F1] ${focusRing}`}
              >
                {primaryButtonText}
              </Link>
            )}

            {secondaryLinkText && (
              <Link
                href={secondaryLinkUrl || "/weddings"}
                className={`group inline-flex items-center gap-2 rounded-[4px] text-[13px] font-semibold text-[#303839] transition-colors duration-300 hover:text-[#303839]/60 ${focusRing}`}
              >
                {secondaryLinkText}
                <span aria-hidden="true" className="inline-flex transition-transform duration-300 ease-out group-hover:translate-x-1">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
                    <path d="M4 12h15" />
                    <path d="m13 6 6 6-6 6" />
                  </svg>
                </span>
              </Link>
            )}
          </div>
        </div>

        {/* RIGHT — collection gallery: main image (78%) + thumbnail column (22%).
            Same grid at every breakpoint; only the section stacks on mobile. */}
        <div className="order-1 grid grid-cols-[minmax(0,78fr)_minmax(0,22fr)] items-stretch gap-2.5 sm:gap-3 lg:order-2">
          <Link
            href={galleryHref}
            aria-label={`View the ${title || "featured"} collection`}
            className={`group relative block aspect-square overflow-hidden rounded-[10px] bg-[#ece9e1] shadow-[0_22px_60px_-42px_rgba(48,56,57,0.45)] ${focusRing}`}
          >
            <Image
              src={mainImage}
              alt={title ? `${title} collection` : "Featured collection"}
              fill
              priority
              sizes="(min-width: 1024px) 460px, 78vw"
              className="object-cover object-center transition-transform duration-[1200ms] ease-out group-hover:scale-[1.03]"
            />
            {sourceCollectionName && (
              <span className="absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-[6px] bg-[#F8F6F1] px-3 py-1.5 text-[11px] font-semibold leading-tight text-[#303839] shadow-[0_8px_24px_rgba(48,56,57,0.12)] sm:bottom-4 sm:left-4 sm:text-xs">
                {sourceCollectionName}
              </span>
            )}
          </Link>

          <div className="grid grid-rows-3 gap-2.5 sm:gap-3">
            {thumbnails.map((thumb, index) => {
              const isLast = index === thumbnails.length - 1;
              return (
                <Link
                  key={index}
                  href={thumb.href || galleryHref}
                  aria-label={
                    isLast
                      ? `View the ${title || "featured"} collection — ${countLabel}`
                      : `View the ${title || "featured"} collection`
                  }
                  className={`group relative block overflow-hidden rounded-[10px] bg-[#ece9e1] ${focusRing}`}
                >
                  <Image
                    src={thumb.image}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 130px, 22vw"
                    className="object-cover object-center transition-transform duration-700 ease-out group-hover:scale-[1.05]"
                  />
                  {isLast && itemCount > 0 && (
                    <span className="absolute bottom-2 left-2 rounded-[6px] bg-[#F8F6F1] px-2.5 py-1 text-[11px] font-semibold text-[#303839]">
                      {countLabel}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
