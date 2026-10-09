/**
 * The one place page metadata is assembled.
 *
 * Next.js merges metadata SHALLOWLY: a page that sets `openGraph` replaces the
 * layout's whole `openGraph` object. So every public page gets a complete set
 * here — title, description, canonical, robots, Open Graph and X card — built
 * from the same inputs, and nothing relies on a half-inherited object.
 *
 * Private and tool pages get `noindex` and no canonical/sharing data at all,
 * so a URL that only makes sense signed in never advertises itself.
 */

import type { Metadata } from "next";
import { DEFAULT_SHARE_IMAGE, type ShareImage } from "./share-image";

export const SITE_NAME = "Husnalogy";
const TITLE_SEPARATOR = " - ";
const DESCRIPTION_LIMIT = 160;

export const INDEXABLE_ROBOTS: Metadata["robots"] = {
  index: true,
  follow: true,
  googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
};

/** Reachable, linkable, but not a search result (search, sign-in, thank-you). */
export const NOINDEX_FOLLOW_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: true,
  googleBot: { index: false, follow: true },
};

/** Account, checkout, studio and admin surfaces. */
export const PRIVATE_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  googleBot: { index: false, follow: false },
};

/** Collapse whitespace and cut at a word boundary to a search-snippet length. */
export function toMetaDescription(value: unknown, limit = DESCRIPTION_LIMIT): string {
  const text = typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** The document title as the root template renders it ("About - Husnalogy"). */
export function fullTitle(title: string): string {
  return title.includes(SITE_NAME) ? title : `${title}${TITLE_SEPARATOR}${SITE_NAME}`;
}

type PublicPageInput = {
  /** Page title without the brand suffix; the brand is added once. */
  title: string;
  description: string;
  /** Site-relative canonical path, e.g. "/products/minimal-floral-invite". */
  path: string;
  image?: ShareImage | null;
  /** Reachable but kept out of search results (e.g. a direct-link product). */
  noindex?: boolean;
};

export function publicPageMetadata({ title, description, path, image, noindex = false }: PublicPageInput): Metadata {
  const documentTitle = fullTitle(title);
  const summary = toMetaDescription(description);
  const shareImage = image || DEFAULT_SHARE_IMAGE;
  const ogImage = {
    url: shareImage.url,
    alt: shareImage.alt,
    ...(shareImage.width && shareImage.height ? { width: shareImage.width, height: shareImage.height } : {}),
    ...(shareImage.type ? { type: shareImage.type } : {}),
  };

  return {
    title: { absolute: documentTitle },
    description: summary,
    alternates: { canonical: path },
    robots: noindex ? NOINDEX_FOLLOW_ROBOTS : INDEXABLE_ROBOTS,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title: documentTitle,
      description: summary,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: documentTitle,
      description: summary,
      images: [{ url: shareImage.url, alt: shareImage.alt }],
    },
  };
}

/** A page that is public but should never be a search result. */
export function noindexPageMetadata(title: string, description?: string): Metadata {
  return {
    title,
    ...(description ? { description: toMetaDescription(description) } : {}),
    robots: NOINDEX_FOLLOW_ROBOTS,
  };
}

/** Signed-in, checkout, studio and admin pages. Carries no personal data. */
export function privatePageMetadata(title: string): Metadata {
  return { title, robots: PRIVATE_ROBOTS };
}
