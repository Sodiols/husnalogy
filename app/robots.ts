const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://husnalogy.com";

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
