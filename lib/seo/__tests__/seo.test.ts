/**
 * Search, sharing and crawl metadata: which images may be shared, what each
 * page tells search engines, what the sitemap lists and what robots.txt
 * blocks. Rendered-HTML checks live in e2e/seo-metadata.spec.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { collectionMetadata, collectionMetaDescription, productMetadata, productMetaDescription } from "../catalogue";
import { authoredImageAlt, productImageAlt } from "../image-alt";
import { fullTitle, privatePageMetadata, publicPageMetadata, toMetaDescription } from "../metadata";
import { PUBLIC_PAGES } from "../pages";
import { DISALLOWED_PATHS } from "../robots";
import { DEFAULT_SHARE_IMAGE, productShareImageUrls, toPublicShareImageUrl } from "../share-image";
import { buildSitemapEntries } from "../sitemap";

const SITE = "https://husnalogy.com";
const SUPABASE = "https://abcd1234.supabase.co";
const env = { siteUrl: SITE, supabaseUrl: SUPABASE };
const PUBLIC_MOCKUP = `${SUPABASE}/storage/v1/object/public/product-mockups/products/a/mockup.png`;

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    slug: "minimal-floral-invitation",
    title: "Minimal Floral Invitation",
    category: "Wedding Invitations",
    status: "active",
    visibility: "public",
    seoDescription: "",
    shortDescription: "",
    description: "",
    images: [],
    mockups: [PUBLIC_MOCKUP],
    imageAltText: [],
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("share images: only durable public imagery", () => {
  it("accepts shipped public files and the project's public catalogue buckets", () => {
    expect(toPublicShareImageUrl("/og/husnalogy-share.png", env)).toBe(`${SITE}/og/husnalogy-share.png`);
    expect(toPublicShareImageUrl("/Brand Kit/Logo-1.png", env)).toBe(`${SITE}/Brand%20Kit/Logo-1.png`);
    expect(toPublicShareImageUrl(PUBLIC_MOCKUP, env)).toBe(PUBLIC_MOCKUP);
    expect(toPublicShareImageUrl(`${SUPABASE}/storage/v1/object/public/product-images/x.webp`, env)).not.toBeNull();
  });

  it("rejects signed, private, foreign, query-string and non-image-path URLs", () => {
    const rejected = [
      `${SUPABASE}/storage/v1/object/sign/product-mockups/x.png?token=abc`,
      `${SUPABASE}/storage/v1/object/public/product-mockups/x.png?token=abc`,
      `${SUPABASE}/storage/v1/object/public/customer-uploads/u1/photo.jpg`,
      `${SUPABASE}/storage/v1/object/public/customizer-renders/r.png`,
      `${SUPABASE}/storage/v1/object/authenticated/product-mockups/x.png`,
      `${SUPABASE}/storage/v1/object/public/product-mockups/../customer-uploads/x.png`,
      "https://evil.supabase.co/storage/v1/object/public/product-mockups/x.png",
      "http://abcd1234.supabase.co/storage/v1/object/public/product-mockups/x.png",
      "https://user:pass@abcd1234.supabase.co/storage/v1/object/public/product-mockups/x.png",
      "https://example.com/image.png",
      "data:image/png;base64,AAAA",
      "blob:https://husnalogy.com/1",
      "//evil.example/x.png",
      "/api/customizer/assets/123",
      "/_next/image?url=%2Fimages%2Fa.png&w=1200&q=75",
      "/images/../api/x",
      "",
      null,
      { src: PUBLIC_MOCKUP },
    ];
    for (const value of rejected) expect(toPublicShareImageUrl(value, env), String(value)).toBeNull();
  });

  it("orders product imagery like the storefront and drops untrusted entries", () => {
    const urls = productShareImageUrls(
      { mockups: ["https://example.com/a.png", PUBLIC_MOCKUP], images: ["/images/weddings.png", { src: PUBLIC_MOCKUP }] },
      env,
    );
    expect(urls).toEqual([PUBLIC_MOCKUP, `${SITE}/images/weddings.png`]);
  });

  it("the default image is the generated 1200 x 630 PNG", () => {
    const file = join(process.cwd(), "public", DEFAULT_SHARE_IMAGE.url);
    expect(existsSync(file)).toBe(true);
    const png = readFileSync(file);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect([DEFAULT_SHARE_IMAGE.width, DEFAULT_SHARE_IMAGE.height]).toEqual([1200, 630]);
  });
});

describe("image alt text", () => {
  it("uses author alt text only for the exact image it describes", () => {
    const item = product({ images: ["/images/a.png", "/images/b.png"], imageAltText: ["Ivory card with gold border", ""] });
    expect(authoredImageAlt(item, "/images/a.png")).toBe("Ivory card with gold border");
    expect(authoredImageAlt(item, "/images/b.png")).toBe("");
    expect(authoredImageAlt(item, PUBLIC_MOCKUP)).toBe("");
    expect(productImageAlt(item, "/images/a.png", 1, 2)).toBe("Ivory card with gold border");
  });

  it("falls back to the product title, numbering further gallery views", () => {
    const item = product();
    expect(productImageAlt(item, PUBLIC_MOCKUP)).toBe("Minimal Floral Invitation");
    expect(productImageAlt(item, PUBLIC_MOCKUP, 3, 4)).toBe("Minimal Floral Invitation, view 3 of 4");
    expect(productImageAlt(undefined, "x")).toBe("Husnalogy design");
    for (const generic of ["image", "picture", "product image"]) expect(productImageAlt(item, PUBLIC_MOCKUP).toLowerCase()).not.toBe(generic);
  });
});

describe("page metadata", () => {
  it("public pages carry title, description, canonical, robots, Open Graph and X card together", () => {
    const meta: any = publicPageMetadata({ title: "Our Style", description: "About the studio.", path: "/about" });
    expect(meta.title).toEqual({ absolute: "Our Style - Husnalogy" });
    expect(meta.alternates.canonical).toBe("/about");
    expect(meta.robots.index).toBe(true);
    expect(meta.openGraph).toMatchObject({ type: "website", url: "/about", title: "Our Style - Husnalogy", siteName: "Husnalogy" });
    expect(meta.openGraph.images[0]).toMatchObject({ url: DEFAULT_SHARE_IMAGE.url, width: 1200, height: 630 });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "Our Style - Husnalogy" });
  });

  it("the brand is never doubled in titles", () => {
    expect(fullTitle("Husnalogy Studio")).toBe("Husnalogy Studio");
    expect(fullTitle("Contact Us")).toBe("Contact Us - Husnalogy");
  });

  it("private pages are noindex/nofollow and advertise no canonical or sharing data", () => {
    const meta: any = privatePageMetadata("Checkout");
    expect(meta.robots).toMatchObject({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph).toBeUndefined();
  });

  it("descriptions are trimmed to snippet length at a word boundary", () => {
    const long = `${"Refined wedding stationery ".repeat(12)}end`;
    const cut = toMetaDescription(long);
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(cut.endsWith("…")).toBe(true);
    expect(toMetaDescription("  <p>Short   and\nclean.</p> ")).toBe("Short and clean.");
  });

  it("registered public pages have unique, natural-length titles and descriptions", () => {
    const titles = PUBLIC_PAGES.map((page) => page.title);
    const descriptions = PUBLIC_PAGES.map((page) => page.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const page of PUBLIC_PAGES) {
      expect(page.description.length, page.path).toBeGreaterThanOrEqual(70);
      expect(page.description.length, page.path).toBeLessThanOrEqual(160);
      expect(toMetaDescription(page.description), page.path).toBe(page.description);
    }
  });

  it("every registered page exists and uses its registry metadata", () => {
    for (const page of PUBLIC_PAGES) {
      const file = join(process.cwd(), "app", page.path === "/" ? "" : page.path, "page.tsx");
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8"), file).toContain(`staticPageMetadata("${page.path}")`);
    }
  });
});

/** Every page.tsx route under app/, as a URL path (route groups and private folders aside). */
function pageRoutes(): Map<string, string> {
  const appDir = join(process.cwd(), "app");
  const routes = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "api" || name === "components" || name === "lib" || name === "node_modules") continue;
        walk(full);
      } else if (name === "page.tsx") {
        const route = `/${relative(appDir, dir).split(sep).join("/")}`.replace(/\/$/, "") || "/";
        routes.set(decodeURIComponent(route), readFileSync(full, "utf8"));
      }
    }
  };
  walk(appDir);
  return routes;
}

describe("indexing directive on every page", () => {
  const routes = pageRoutes();
  const registered = new Set<string>(PUBLIC_PAGES.map((page) => page.path));
  const catalogue = new Set(["/products/[slug]", "/collections/[slug]"]);
  const noindexFollow = new Set(["/search", "/login", "/signup", "/forgot-password", "/reset-password", "/thank-you"]);
  const callbackLayout = "/auth/callback/finish";

  it("every page is registered public, catalogue, noindex or private", () => {
    for (const [route, source] of routes) {
      if (registered.has(route) || catalogue.has(route) || route === callbackLayout) continue;
      if (noindexFollow.has(route)) {
        expect(source, route).toContain("noindexPageMetadata(");
        continue;
      }
      // Everything else is account, checkout, studio, admin or a test fixture.
      expect(/privatePageMetadata\(|PRIVATE_ROBOTS|robots: \{ index: false, follow: false \}/.test(source), route).toBe(true);
    }
    expect(readFileSync(join(process.cwd(), "app/auth/callback/finish/layout.tsx"), "utf8")).toContain("privatePageMetadata(");
  });

  it("covers the private surfaces named in the launch checklist", () => {
    for (const route of ["/account", "/profile", "/orders", "/saved-addresses", "/favorites", "/cart", "/checkout", "/admin/dashboard", "/admin/review", "/designer", "/upload-from-phone", "/products/[slug]/personalize"]) {
      expect(routes.has(route), route).toBe(true);
      expect(registered.has(route)).toBe(false);
    }
  });
});

describe("product and collection metadata", () => {
  it("builds product metadata from the published record with a canonical, durable image", () => {
    const meta: any = productMetadata(product({ seoDescription: "A calm floral invitation with soft greenery." }));
    expect(meta.title).toEqual({ absolute: "Minimal Floral Invitation - Husnalogy" });
    expect(meta.description).toBe("A calm floral invitation with soft greenery.");
    expect(meta.alternates.canonical).toBe("/products/minimal-floral-invitation");
    expect(meta.openGraph.url).toBe("/products/minimal-floral-invitation");
    expect(meta.robots.index).toBe(true);
  });

  it("falls back to the branded default when the product has no shareable image", () => {
    const signed = `${SUPABASE}/storage/v1/object/sign/product-mockups/x.png?token=t`;
    const meta: any = productMetadata(product({ mockups: [signed], images: [] }));
    expect(meta.openGraph.images[0].url).toBe(DEFAULT_SHARE_IMAGE.url);
    expect(JSON.stringify(meta)).not.toContain("token=");
  });

  it("direct-link products stay reachable but noindex", () => {
    const meta: any = productMetadata(product({ visibility: "direct" }));
    expect(meta.robots).toMatchObject({ index: false, follow: true });
  });

  it("never leaks review, customization or customer fields", () => {
    const meta = JSON.stringify(
      productMetadata(
        product({
          reviews: [{ customerEmail: "buyer@example.com", name: "A Buyer", text: "Lovely" }],
          customizerTemplate: { layers: [{ text: "Private Name" }] },
          customerEmail: "buyer@example.com",
        }),
      ),
    );
    for (const secret of ["buyer@example.com", "A Buyer", "Private Name"]) expect(meta).not.toContain(secret);
  });

  it("product descriptions prefer authored text and fall back to a factual sentence", () => {
    expect(productMetaDescription(product({ shortDescription: "Short text." }))).toBe("Short text.");
    expect(productMetaDescription(product())).toBe("Minimal Floral Invitation from Husnalogy, in Wedding Invitations.");
    expect(productMetaDescription(product({ category: "" }))).toBe("Minimal Floral Invitation from Husnalogy.");
  });

  it("collections: built-in blurbs become a plain description; landing twins canonicalize", () => {
    expect(collectionMetaDescription({ slug: "gifts-for-her", title: "Gifts For Her", description: "Gift ideas for her, built only from products that exist in the store." })).toBe(
      "Browse gifts for her from Husnalogy, with refined designs made for meaningful moments.",
    );
    expect(collectionMetaDescription({ slug: "s", title: "Sage Suite", description: "A suite in soft sage." })).toBe("A suite in soft sage.");
    const twin: any = collectionMetadata({ slug: "gifts", title: "Gifts", products: [product()] }, { indexable: true, canonicalPath: "/gifts" });
    expect(twin.alternates.canonical).toBe("/gifts");
    const empty: any = collectionMetadata({ slug: "menus", title: "Menus", products: [] }, { indexable: false });
    expect(empty.robots.index).toBe(false);
    expect(empty.openGraph.images[0].url).toBe(DEFAULT_SHARE_IMAGE.url);
  });
});

describe("sitemap", () => {
  const published = product();
  const draft = product({ id: "d", slug: "draft-card", status: "draft" });
  const hidden = product({ id: "h", slug: "hidden-card", visibility: "hidden" });
  const direct = product({ id: "x", slug: "direct-card", visibility: "direct" });
  const deleted = product({ id: "z", slug: "deleted-card", status: "deleted" });
  const entries = buildSitemapEntries({
    siteUrl: SITE,
    products: [published, draft, hidden, direct, deleted, product({ id: "e", slug: "" })],
    collections: [
      { slug: "sage-suite", updatedAt: "2026-08-01T00:00:00.000Z", products: [published] },
      { slug: "only-drafts", products: [draft] },
      { slug: "empty", products: [] },
    ],
  });
  const urls = entries.map((entry) => entry.url);

  it("lists public pages, public collections and active public products", () => {
    expect(urls).toContain(SITE);
    expect(urls).toContain(`${SITE}/about`);
    expect(urls).toContain(`${SITE}/collections/sage-suite`);
    expect(urls).toContain(`${SITE}/products/minimal-floral-invitation`);
  });

  it("excludes drafts, hidden, direct-link, deleted and slugless products and empty collections", () => {
    for (const slug of ["draft-card", "hidden-card", "direct-card", "deleted-card"]) expect(urls).not.toContain(`${SITE}/products/${slug}`);
    expect(urls).not.toContain(`${SITE}/products/`);
    expect(urls).not.toContain(`${SITE}/collections/only-drafts`);
    expect(urls).not.toContain(`${SITE}/collections/empty`);
  });

  it("contains no private, auth, API, tool or thank-you URL, and no duplicates", () => {
    for (const url of urls) {
      expect(url.startsWith(SITE)).toBe(true);
      expect(url).not.toMatch(/\/(api|admin|designer|account|profile|orders|saved-addresses|favorites|cart|checkout|auth|login|signup|search|thank-you|upload-from-phone|__e2e)(\/|$)/);
      expect(url).not.toContain("/personalize");
    }
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("dates entries only with stored timestamps", () => {
    const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
    expect(byUrl.get(`${SITE}/products/minimal-floral-invitation`)?.lastModified).toEqual(new Date("2026-09-01T10:00:00.000Z"));
    expect(byUrl.get(`${SITE}/collections/sage-suite`)?.lastModified).toEqual(new Date("2026-09-01T10:00:00.000Z"));
    expect(byUrl.get(SITE)?.lastModified).toEqual(new Date("2026-09-01T10:00:00.000Z"));
    expect(byUrl.get(`${SITE}/privacy`)?.lastModified).toBeUndefined();
    for (const entry of entries) expect(entry).not.toHaveProperty("changeFrequency");
  });

  it("lists the product's public image and encodes slugs", () => {
    const [entry] = buildSitemapEntries({ siteUrl: SITE, supabaseUrl: SUPABASE, products: [product({ slug: "café card" })], collections: [] }).filter((item) => item.url.includes("/products/"));
    expect(entry.url).toBe(`${SITE}/products/caf%C3%A9%20card`);
    expect(entry.images).toEqual([PUBLIC_MOCKUP]);
  });
});

/** Google's robots.txt matching: prefix match with `*` wildcards. */
function blocked(path: string): boolean {
  return DISALLOWED_PATHS.some((rule) => new RegExp(`^${rule.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}`).test(path));
}

describe("robots.txt rules", () => {
  it("keep crawlers out of private, studio, API and auth surfaces", () => {
    for (const path of ["/api/contact", "/admin", "/admin/dashboard", "/designer", "/account", "/orders", "/cart", "/checkout", "/favorites", "/saved-addresses", "/profile", "/auth/callback", "/upload-from-phone", "/products/minimal-card/personalize", "/__e2e/customizer"]) {
      expect(blocked(path), path).toBe(true);
    }
  });

  it("never block indexable content, images, assets or pages whose noindex must be seen", () => {
    for (const page of PUBLIC_PAGES) expect(blocked(page.path), page.path).toBe(false);
    for (const path of ["/products/minimal-card", "/collections/sage-suite", "/images/weddings.png", "/og/husnalogy-share.png", "/Brand%20Kit/Logo-1.png", "/_next/static/chunks/app.js", "/sitemap.xml", "/login", "/search", "/thank-you"]) {
      expect(blocked(path), path).toBe(false);
    }
  });
});
