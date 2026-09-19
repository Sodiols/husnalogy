import { getSiteUrl } from "@/lib/site-url";

const SITE_URL = getSiteUrl();

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api/",
          "/checkout",
          "/cart",
          "/account",
          "/profile",
          "/orders",
          "/saved-addresses",
          "/favorites",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
