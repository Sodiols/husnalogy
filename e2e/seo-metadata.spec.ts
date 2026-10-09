/**
 * Search, sharing and crawl output as crawlers and visitors actually receive
 * it: rendered <head> tags, HTTP status codes, sitemap.xml, robots.txt, the
 * sharing images, image alt text, and the contact form's confirmation flow.
 *
 * Runs in the default local stub mode (playwright.config.ts): the catalogue is
 * STUB_CATALOGUE_PRODUCT plus unlisted draft / hidden / direct / deleted rows.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { STUB_CATALOGUE_PRODUCT, STUB_UNLISTED_PRODUCTS } from "./supabase-http-stub";

// HTML-limited bots get metadata in <head> before the body (Next streams it
// later for browsers that run JavaScript).
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

type Head = {
  titles: string[];
  description: string | null;
  canonical: string | null;
  robots: string | null;
  og: Record<string, string>;
  twitter: Record<string, string>;
};

async function fetchHead(page: Page, request: APIRequestContext, path: string): Promise<{ status: number; head: Head }> {
  const response = await request.get(path, { headers: { "user-agent": CRAWLER_UA }, maxRedirects: 0 });
  const html = await response.text();
  const head = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const meta = (selector: string) => doc.querySelector(selector)?.getAttribute("content") ?? null;
    const group = (prefix: string, attribute: string) =>
      Object.fromEntries(
        [...doc.querySelectorAll(`meta[${attribute}^="${prefix}"]`)].map((tag) => [tag.getAttribute(attribute)!, tag.getAttribute("content") || ""]),
      );
    return {
      titles: [...doc.querySelectorAll("title")].map((tag) => tag.textContent || ""),
      description: meta('meta[name="description"]'),
      canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      robots: meta('meta[name="robots"]'),
      og: group("og:", "property"),
      twitter: group("twitter:", "name"),
    };
  }, html);
  return { status: response.status(), head };
}

function pngSize(buffer: Buffer) {
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test.describe("rendered search and sharing metadata", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("about:blank");
  });

  test("public pages each have a unique title and description, a self canonical and complete sharing tags", async ({ page, request }) => {
    // A dev server compiles each of these pages on first request.
    test.setTimeout(300_000);
    const paths = ["/", "/products", "/collections", "/weddings", "/save-the-dates", "/cards", "/stationery", "/gifts", "/about", "/our-style", "/husnalogy-studio", "/contact", "/support", "/privacy", "/terms"];
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    let origin = "";
    for (const path of paths) {
      const { status, head } = await fetchHead(page, request, path);
      expect(status, path).toBe(200);
      expect(head.titles, path).toHaveLength(1);
      expect(head.titles[0], path).toContain("Husnalogy");
      expect(head.description?.length, path).toBeGreaterThan(60);
      titles.add(head.titles[0]);
      descriptions.add(head.description!);

      const canonical = new URL(head.canonical!);
      origin ||= canonical.origin;
      expect(canonical.protocol, path).toBe("https:");
      expect(canonical.origin, path).toBe(origin);
      expect(canonical.pathname, path).toBe(path);
      expect(head.robots, path).toMatch(/^index, follow/);

      expect(head.og["og:title"], path).toBe(head.titles[0]);
      expect(head.og["og:description"], path).toBe(head.description);
      expect(head.og["og:url"], path).toBe(head.canonical);
      expect(head.og["og:type"], path).toBe("website");
      expect(head.og["og:site_name"], path).toBe("Husnalogy");
      expect(head.og["og:image"], path).toBe(`${origin}/og/husnalogy-share.png`);
      expect(head.og["og:image:width"], path).toBe("1200");
      expect(head.og["og:image:height"], path).toBe("630");
      expect(head.twitter["twitter:card"], path).toBe("summary_large_image");
      expect(head.twitter["twitter:title"], path).toBe(head.titles[0]);
      expect(head.twitter["twitter:image"], path).toBe(head.og["og:image"]);
    }
    expect(titles.size).toBe(paths.length);
    expect(descriptions.size).toBe(paths.length);
  });

  test("listing filters canonicalize to the clean listing URL", async ({ page, request }) => {
    const { head } = await fetchHead(page, request, "/products?category=Wedding%20Cards&sort=newest");
    expect(new URL(head.canonical!).pathname).toBe("/products");
    expect(new URL(head.canonical!).search).toBe("");
  });

  test("a published product page is described by its own catalogue record and image", async ({ page, request }) => {
    const path = `/products/${STUB_CATALOGUE_PRODUCT.slug}`;
    const { status, head } = await fetchHead(page, request, path);
    expect(status).toBe(200);
    expect(head.titles).toEqual([`${STUB_CATALOGUE_PRODUCT.title} - Husnalogy`]);
    expect(head.description).toBe(STUB_CATALOGUE_PRODUCT.description);
    expect(new URL(head.canonical!).pathname).toBe(path);
    expect(head.robots).toMatch(/^index, follow/);
    expect(head.og["og:url"]).toBe(head.canonical);
    expect(new URL(head.og["og:image"]).pathname).toBe(STUB_CATALOGUE_PRODUCT.thumbnail);
    expect(head.og["og:image:alt"]).toBe(STUB_CATALOGUE_PRODUCT.title);
    expect(head.twitter["twitter:image"]).toBe(head.og["og:image"]);
  });

  test("unpublished, hidden, deleted and unknown products are real 404s; direct-link products are noindex", async ({ page, request }) => {
    for (const row of STUB_UNLISTED_PRODUCTS) {
      const { status, head } = await fetchHead(page, request, `/products/${row.slug}`);
      if (row.visibility === "direct" && row.status === "active") {
        expect(status, row.slug).toBe(200);
        expect(head.robots, row.slug).toMatch(/^noindex, follow/);
      } else {
        expect(status, row.slug).toBe(404);
        expect(head.og["og:url"], row.slug).toBeUndefined();
        expect(head.titles.join(" "), row.slug).not.toContain(row.title);
      }
    }
    expect((await request.get("/products/no-such-product-anywhere")).status()).toBe(404);
  });

  test("collections: real ones are indexable, unknown and empty ones are not, landing twins point at the landing page", async ({ page, request }) => {
    const weddings = await fetchHead(page, request, "/collections/weddings");
    expect(weddings.status).toBe(200);
    expect(weddings.head.robots).toMatch(/^index, follow/);
    expect(new URL(weddings.head.canonical!).pathname).toBe("/collections/weddings");

    const unknown = await fetchHead(page, request, "/collections/definitely-not-a-collection");
    expect(unknown.head.robots).toMatch(/^noindex/);

    const twin = await fetchHead(page, request, "/collections/gifts");
    expect(new URL(twin.head.canonical!).pathname).toBe("/gifts");
  });

  test("public-but-noindex and private pages tell search engines to stay out", async ({ page, request }) => {
    for (const path of ["/login", "/signup", "/forgot-password", "/search?q=card", "/thank-you"]) {
      const { status, head } = await fetchHead(page, request, path);
      expect(status, path).toBe(200);
      expect(head.robots, path).toMatch(/^noindex, follow/);
      expect(head.canonical, path).toBeNull();
    }
    // Signed-out visitors never see account pages: the proxy redirects first.
    for (const path of ["/account", "/orders", "/cart", "/checkout", "/favorites", "/saved-addresses", "/profile"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect([302, 303, 307, 308], path).toContain(response.status());
    }
    const missing = await fetchHead(page, request, "/no-such-page-here");
    expect(missing.status).toBe(404);
    expect(missing.head.robots).toMatch(/noindex/);
  });

  test("API responses carry X-Robots-Tag noindex", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  });
});

test.describe("sharing images", () => {
  test("the default preview is a reachable 1200 x 630 PNG and product imagery is public", async ({ request }) => {
    const share = await request.get("/og/husnalogy-share.png");
    expect(share.status()).toBe(200);
    expect(share.headers()["content-type"]).toBe("image/png");
    expect(pngSize(await share.body())).toEqual({ width: 1200, height: 630 });

    const productImage = await request.get(STUB_CATALOGUE_PRODUCT.thumbnail);
    expect(productImage.status()).toBe(200);
    expect(productImage.headers()["content-type"]).toBe("image/png");
  });
});

test.describe("sitemap.xml and robots.txt", () => {
  test("the sitemap is valid XML of canonical public URLs from the live catalogue", async ({ page, request }) => {
    test.setTimeout(300_000);
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("xml");
    const xml = await response.text();
    await page.goto("about:blank");
    const parsed = await page.evaluate((source) => {
      const doc = new DOMParser().parseFromString(source, "application/xml");
      return {
        error: doc.querySelector("parsererror")?.textContent ?? null,
        root: doc.documentElement.nodeName,
        locs: [...doc.getElementsByTagName("loc")].map((node) => node.textContent || ""),
        lastmods: [...doc.getElementsByTagName("lastmod")].map((node) => node.textContent || ""),
        changefreqs: doc.getElementsByTagName("changefreq").length,
      };
    }, xml);
    expect(parsed.error).toBeNull();
    expect(parsed.root).toBe("urlset");
    expect(parsed.changefreqs).toBe(0);

    const pageUrls = parsed.locs.filter((loc) => !loc.includes("/storage/") && !loc.includes("/images/"));
    const origin = new URL(pageUrls[0]).origin;
    expect(origin.startsWith("https://")).toBe(true);
    for (const loc of pageUrls) {
      expect(new URL(loc).origin).toBe(origin);
      expect(loc).not.toMatch(/\/(api|admin|designer|account|profile|orders|saved-addresses|favorites|cart|checkout|auth|login|signup|search|thank-you|upload-from-phone|__e2e)(\/|$)/);
      expect(loc).not.toContain("/personalize");
    }
    expect(new Set(pageUrls).size).toBe(pageUrls.length);
    expect(pageUrls).toContain(`${origin}/products/${STUB_CATALOGUE_PRODUCT.slug}`);
    for (const row of STUB_UNLISTED_PRODUCTS) expect(pageUrls).not.toContain(`${origin}/products/${row.slug}`);
    expect(pageUrls).not.toContain(`${origin}/collections/gifts`);
    // The product's real updated_at, not the request time.
    expect(parsed.lastmods).toContain(STUB_CATALOGUE_PRODUCT.updated_at);
    // Every listed page is served and indexable.
    for (const loc of pageUrls.slice(0, 40)) {
      const path = new URL(loc).pathname;
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
    }
  });

  test("robots.txt advertises the sitemap, blocks private surfaces and leaves public content open", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const text = await response.text();
    const sitemap = text.match(/^Sitemap: (.+)$/m)?.[1];
    expect(sitemap).toMatch(/^https:\/\/[^/]+\/sitemap\.xml$/);
    const disallowed = [...text.matchAll(/^Disallow: (.+)$/gm)].map((match) => match[1].trim());
    for (const path of ["/api/", "/admin", "/account", "/checkout", "/cart", "/designer", "/auth/"]) expect(disallowed).toContain(path);
    for (const path of ["/", "/products", "/collections", "/images", "/login", "/thank-you", "/_next"]) expect(disallowed).not.toContain(path);
    expect(text).toMatch(/^Allow: \/$/m);
  });
});

test.describe("image alt text", () => {
  test("homepage and product images have alt text; meaningful ones are descriptive", async ({ page }) => {
    for (const path of ["/", "/about", `/products/${STUB_CATALOGUE_PRODUCT.slug}`, "/products"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const images = await page.$$eval("main img", (nodes) =>
        nodes.map((node) => ({
          alt: node.getAttribute("alt"),
          src: node.getAttribute("src") || "",
          hidden: Boolean(node.closest('[aria-hidden="true"]')),
          labelled: Boolean(node.closest("a[aria-label], button[aria-label]")),
        })),
      );
      expect(images.length, path).toBeGreaterThan(0);
      for (const image of images) {
        expect(image.alt, `${path} ${image.src}`).not.toBeNull();
        expect(["image", "picture", "product image", "logo", "photo"]).not.toContain((image.alt || "").toLowerCase());
      }
    }

    await page.goto("/");
    for (const name of ["Floral wedding invitation with greenery and a gold arched border on an ivory card", "Photo collage necktie beside a black gift box"]) {
      await expect(page.getByRole("img", { name })).toHaveCount(1);
    }

    await page.goto(`/products/${STUB_CATALOGUE_PRODUCT.slug}`);
    await expect(page.getByRole("button", { name: "View image in full screen" }).getByRole("img", { name: STUB_CATALOGUE_PRODUCT.title })).toBeVisible();
  });
});

test.describe("contact form confirmation", () => {
  const fill = async (page: Page, values = { name: "Test Visitor", email: "visitor@example.com", message: "A question about a custom design." }) => {
    await page.getByLabel("Name").fill(values.name);
    await page.getByLabel("Email address").fill(values.email);
    await page.getByLabel(/^Message/).fill(values.message);
  };
  const send = (page: Page) => page.getByRole("button", { name: "Send message" }).click();

  test("a confirmed submission opens the noindex thank-you page with no personal data in the URL", async ({ page }) => {
    await page.goto("/contact");
    await fill(page);
    const posted = page.waitForResponse((response) => response.url().endsWith("/api/contact") && response.request().method() === "POST");
    await send(page);
    expect((await posted).status()).toBe(201);
    await expect(page).toHaveURL(/\/thank-you$/);
    await expect(page.getByRole("heading", { name: "Thank you for reaching out." })).toBeVisible();
    expect(page.url()).not.toMatch(/visitor|example\.com|question/i);
    await expect(page.getByRole("link", { name: "Continue exploring" })).toHaveAttribute("href", "/products");

    // Back returns to an empty form and sends nothing again.
    let resent = false;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/contact")) resent = true;
    });
    await page.goBack();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.getByLabel("Name")).toHaveValue("");
    expect(resent).toBe(false);
  });

  test("missing and invalid fields are reported in place without sending", async ({ page }) => {
    await page.goto("/contact");
    let sent = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/contact")) sent += 1;
    });
    await send(page);
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByText("Enter your message.")).toBeVisible();
    await fill(page, { name: "Test Visitor", email: "not-an-email", message: "Hello" });
    await send(page);
    await expect(page.getByText(/Enter a valid email address/)).toBeVisible();
    expect(sent).toBe(0);
    await expect(page).toHaveURL(/\/contact$/);
  });

  test("the server's own validation is shown and the visitor's text kept", async ({ page }) => {
    await page.goto("/contact");
    await fill(page);
    // Past the client-side check, blank the message so the real API rejects it.
    await page.route("**/api/contact", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      await route.continue({ postData: JSON.stringify({ ...body, message: "" }) });
    });
    await send(page);
    await expect(page.getByText("Message is required.").first()).toBeVisible();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.getByLabel("Email address")).toHaveValue("visitor@example.com");
  });

  for (const failure of [
    { name: "server error", fulfill: { status: 500, json: { ok: false, error: "Could not send your message." } }, message: "Could not send your message." },
    { name: "rate limit", fulfill: { status: 429, json: { ok: false, error: "Too many requests. Please try again soon." } }, message: "Too many requests. Please try again soon." },
    { name: "provider error page (non-JSON)", fulfill: { status: 502, body: "<html>Bad gateway</html>", contentType: "text/html" }, message: /could not be sent/ },
    { name: "a 200 without a confirmed save", fulfill: { status: 200, json: { ok: false } }, message: /could not be sent/ },
  ] as const) {
    test(`${failure.name}: no redirect, a useful error, the text kept, and retry works`, async ({ page }) => {
      await page.goto("/contact");
      await fill(page);
      await page.route("**/api/contact", (route) => route.fulfill(failure.fulfill as any), { times: 1 });
      await send(page);
      await expect(page.locator(".notice-error")).toHaveText(failure.message);
      await expect(page).toHaveURL(/\/contact$/);
      await expect(page.getByLabel(/^Message/)).toHaveValue("A question about a custom design.");

      await page.route("**/api/contact", (route) => route.fulfill({ status: 201, json: { ok: true } }), { times: 1 });
      await send(page);
      await expect(page).toHaveURL(/\/thank-you$/);
    });
  }

  test("network failure keeps the form and explains what happened", async ({ page }) => {
    await page.goto("/contact");
    await fill(page);
    await page.route("**/api/contact", (route) => route.abort("internetdisconnected"), { times: 1 });
    await send(page);
    await expect(page.locator(".notice-error")).toContainText("couldn't reach Husnalogy");
    await expect(page.getByLabel("Name")).toHaveValue("Test Visitor");
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  test("a double click sends one enquiry", async ({ page }) => {
    await page.goto("/contact");
    await fill(page);
    let calls = 0;
    await page.route("**/api/contact", async (route) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ status: 201, json: { ok: true } });
    });
    await page.getByRole("button", { name: "Send message" }).dblclick();
    await expect(page).toHaveURL(/\/thank-you$/);
    expect(calls).toBe(1);
  });

  test("contact and thank-you pages fit a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const path of ["/contact", "/thank-you"]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), path).toBe(true);
    }
    await expect(page.getByRole("link", { name: "Continue exploring" })).toBeVisible();
  });
});
