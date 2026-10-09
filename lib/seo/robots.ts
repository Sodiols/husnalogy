/**
 * Crawl exclusions for robots.txt. robots.txt is NOT access control: every
 * path below is also protected by the proxy, page-level role checks and RLS.
 * It only keeps crawlers out of surfaces with nothing to index.
 *
 * Public-but-noindex pages (search, sign-in, password reset, thank-you) are
 * deliberately NOT listed: a crawler has to fetch them to see their
 * `noindex`. Product pages, collections, images and /_next assets stay open.
 */
export const DISALLOWED_PATHS = [
  "/api/",
  "/admin",
  "/designer",
  "/upload-from-phone",
  "/account",
  "/profile",
  "/orders",
  "/saved-addresses",
  "/favorites",
  "/cart",
  "/checkout",
  "/auth/",
  "/products/*/personalize",
  "/__e2e/",
];
