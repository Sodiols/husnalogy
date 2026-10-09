import type { MetadataRoute } from "next";
import { DISALLOWED_PATHS } from "@/lib/seo/robots";
import { getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: DISALLOWED_PATHS }],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
