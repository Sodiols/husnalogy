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
  const eyebrow = seasonLabel || collectionLabel;
  const heading = [headingLineOne, headingLineTwo].filter(Boolean).join(" ").trim();
  const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-cream";

  return (
    <section className="bg-cream">
      <div className="page-container grid items-center gap-8 py-12 sm:gap-10 sm:py-16 lg:grid-cols-[minmax(0,60fr)_minmax(0,40fr)] lg:gap-16 lg:py-20">
        {/* LEFT — content */}
        <div className="order-2 max-w-[680px] lg:order-1">
          {eyebrow && <p className="text-[13px] font-semibold text-muted">{eyebrow}</p>}

          <h1 className="heading-hero mt-4 sm:mt-5">{heading}</h1>

          {description && <p className="text-lead mt-5 max-w-[560px] sm:mt-6">{description}</p>}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {primaryButtonText && (
              <Link href={primaryButtonUrl || "/weddings"} className="btn btn-primary btn-lg">
                {primaryButtonText}
              </Link>
            )}

            {secondaryLinkText && (
              <Link href={secondaryLinkUrl || "/weddings"} className="btn btn-secondary btn-lg bg-transparent hover:bg-ink hover:text-white">
                {secondaryLinkText}
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
            className={`group relative block aspect-square overflow-hidden rounded-[10px] bg-cream-deep shadow-[0_22px_60px_-42px_rgba(48,56,57,0.45)] ${focusRing}`}
          >
            <Image
              src={mainImage}
              alt={title ? `${title} collection` : "Featured collection"}
              fill
              priority
              loading="eager"
              sizes="(min-width: 1024px) 460px, 78vw"
              className="object-cover object-center transition-transform duration-[1200ms] ease-out group-hover:scale-[1.03]"
            />
            {sourceCollectionName && (
              <span className="absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-[6px] bg-white px-3 py-1.5 text-[12px] font-semibold leading-tight text-ink shadow-[0_8px_24px_rgba(48,56,57,0.12)] sm:bottom-4 sm:left-4 sm:text-[13px]">
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
                  className={`group relative block overflow-hidden rounded-[10px] bg-cream-deep ${focusRing}`}
                >
                  <Image
                    src={thumb.image}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 130px, 22vw"
                    className="object-cover object-center transition-transform duration-700 ease-out group-hover:scale-[1.05]"
                  />
                  {isLast && itemCount > 0 && (
                    <span className="absolute bottom-2 left-2 rounded-[6px] bg-white px-2.5 py-1 text-[12px] font-semibold text-ink">
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
