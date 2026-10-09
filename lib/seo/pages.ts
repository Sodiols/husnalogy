/**
 * The public, indexable static pages: their search title and description.
 *
 * One registry feeds both each page's metadata and the sitemap, so a page
 * cannot be listed in the sitemap without metadata (or the other way round).
 * Catalogue pages (products, collections) are generated from data instead —
 * see app/sitemap.ts.
 *
 * Copy describes what each page actually contains today. Keep it that way:
 * no offerings that are not in the store, no superlatives.
 */

import type { Metadata } from "next";
import { publicPageMetadata } from "./metadata";

export type PublicPage = {
  path: string;
  title: string;
  description: string;
  /** Listing pages whose content follows the catalogue; dated by it in the sitemap. */
  catalogue?: boolean;
};

export const PUBLIC_PAGES = [
  {
    path: "/",
    title: "Husnalogy - Wedding Invitations, Stationery & Personalized Gifts",
    description:
      "Refined wedding invitations, save the dates, cards, stationery and personalized gifts by Husnalogy: clean, elegant designs for life's meaningful moments.",
    catalogue: true,
  },
  {
    path: "/products",
    title: "Shop All Products",
    description:
      "Browse every Husnalogy design: wedding invitations, save the dates, cards, stationery and personalized gifts. Filter by occasion, theme, colour and price.",
    catalogue: true,
  },
  {
    path: "/collections",
    title: "All Collections",
    description:
      "Explore Husnalogy collections: curated groups of invitations, stationery and gifts that share a style, a suite or an occasion.",
    catalogue: true,
  },
  {
    path: "/weddings",
    title: "Wedding Invitations & Stationery",
    description:
      "Elegant wedding invitations, save the dates and wedding stationery from Husnalogy, with timeless typography and calm, considered layouts you can personalize.",
  },
  {
    path: "/save-the-dates",
    title: "Save the Dates",
    description:
      "Personalized save the date cards from Husnalogy: refined, minimal designs for sharing your wedding date with family and friends.",
  },
  {
    path: "/cards",
    title: "Personalized Cards",
    description:
      "Personalized cards from Husnalogy for thank-yous, celebrations and everyday notes, designed with care and finished in your own words.",
  },
  {
    path: "/stationery",
    title: "Personalized Stationery",
    description:
      "Personalized stationery from Husnalogy, including menus, place cards, notes and paper details designed to match your occasion.",
  },
  {
    path: "/gifts",
    title: "Personalized Gifts",
    description:
      "Personalized gifts from Husnalogy for birthdays, weddings and the people who matter most, made meaningful with names and messages of your choosing.",
  },
  {
    path: "/about",
    title: "About Husnalogy",
    description:
      "Meet Husnalogy, a design studio creating refined wedding invitations, custom cards, personalized gifts and meaningful stationery with a clean, timeless style.",
  },
  {
    path: "/our-style",
    title: "Our Style",
    description:
      "The Husnalogy style: clean layouts, elegant typography and space for the names, dates and words that make each invitation, card and gift meaningful.",
  },
  {
    path: "/husnalogy-studio",
    title: "Husnalogy Studio",
    description:
      "Inside the Husnalogy studio: the design direction behind our wedding stationery, invitations, personalized gifts and keepsake products.",
  },
  {
    path: "/contact",
    title: "Contact Us",
    description:
      "Contact Husnalogy about an order, a custom design or a special request. Send a message and our team will reply by email.",
  },
  {
    path: "/support",
    title: "Help & Support",
    description:
      "Answers to common questions about Husnalogy orders, personalization, proofs, delivery, payment and returns, with ways to reach our team.",
  },
  {
    path: "/privacy",
    title: "Privacy Policy",
    description:
      "How Husnalogy collects, uses and protects your information, order details and personalized product files.",
  },
  {
    path: "/terms",
    title: "Terms and Conditions",
    description:
      "The terms for using the Husnalogy website and ordering from us, including payments, personalized products, proofs, delivery, returns and refunds.",
  },
] as const satisfies readonly PublicPage[];

export type PublicPagePath = (typeof PUBLIC_PAGES)[number]["path"];

export function getPublicPage(path: PublicPagePath): PublicPage {
  const page = PUBLIC_PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error(`Unknown public page: ${path}`);
  return page;
}

/** Complete metadata for a registered public page. */
export function staticPageMetadata(path: PublicPagePath): Metadata {
  const { title, description } = getPublicPage(path);
  return publicPageMetadata({ title, description, path });
}
