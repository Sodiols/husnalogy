import { getActiveProducts } from "@/lib/products";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://husnalogy.com";

// Refresh the sitemap periodically so newly added products are included.
export const revalidate = 3600;

const STATIC_ROUTES = [
  { path: "", priority: 1, changeFrequency: "daily" },
  { path: "/weddings", priority: 0.9, changeFrequency: "weekly" },
  { path: "/save-the-dates", priority: 0.8, changeFrequency: "weekly" },
  { path: "/gifts", priority: 0.8, changeFrequency: "weekly" },
  { path: "/stationery", priority: 0.8, changeFrequency: "weekly" },
  { path: "/cards", priority: 0.8, changeFrequency: "weekly" },
  { path: "/products", priority: 0.9, changeFrequency: "daily" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.6, changeFrequency: "monthly" },
  { path: "/our-style", priority: 0.5, changeFrequency: "monthly" },
  { path: "/husnalogy-studio", priority: 0.5, changeFrequency: "monthly" },
  { path: "/support", priority: 0.4, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

export default async function sitemap() {
  const now = new Date();

  const staticEntries = STATIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  let productEntries = [];
  try {
    const products = await getActiveProducts();
    productEntries = products
      .filter((product) => product.slug)
      .map((product) => ({
        url: `${SITE_URL}/products/${product.slug}`,
        lastModified: product.updatedAt ? new Date(product.updatedAt) : now,
        changeFrequency: "weekly",
        priority: 0.7,
      }));
  } catch (error) {
    console.error("Sitemap product listing failed:", error);
  }

  return [...staticEntries, ...productEntries];
}
