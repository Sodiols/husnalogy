import {
  getActiveProducts,
  getOtherStyles,
  getProductBySlug,
  getRelatedProducts,
} from "@/lib/products";
import { getProductCollections } from "@/lib/collections/store";

import ProductGallery from "../ProductGallery";
import ProductInfo from "../ProductInfo";
import Breadcrumbs from "../Breadcrumbs";
import ProductTrustStrip from "../ProductTrustStrip";
import ProductSuite from "../ProductSuite";
import ProductAboutReviews from "../ProductAboutReviews";
import ProductCarousel from "../ProductCarousel";
import RecentlyViewedTracker from "../RecentlyViewedTracker";
import RecentlyViewedCarousel from "../RecentlyViewedCarousel";
import { getMainMockupImage } from "../product-image";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://husnalogy.com";

function hasCollection(product, collectionIds = []) {
  if (!collectionIds.length) return false;
  const selected = new Set(collectionIds);
  return Array.isArray(product?.collectionIds) && product.collectionIds.some((id) => selected.has(id));
}

function getParentCollectionSection(product, products = [], collections = []) {
  const productCollectionIds = Array.isArray(product?.collectionIds) ? product.collectionIds : [];
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
  const selectedCollections = productCollectionIds.map((id) => collectionById.get(id)).filter(Boolean);
  const selectedChild = selectedCollections.find((collection) => collection.parentCollectionId);
  const selectedParent = selectedChild
    ? collectionById.get(selectedChild.parentCollectionId)
    : selectedCollections.find((collection) => !collection.parentCollectionId);

  if (!selectedParent) return null;

  const children = collections.filter((collection) => collection.parentCollectionId === selectedParent.id);
  if (!children.length) return null;

  // One tile per child collection, imaged by its first product — the current
  // product stays included so the full suite is visible, like on Zazzle.
  const childCollections = children
    .map((child) => {
      const childProducts = products.filter((item) => hasCollection(item, [child.id]));
      if (!childProducts.length) return null;

      const primary = childProducts.find((item) => item.slug !== product.slug) || childProducts[0];

      return {
        id: child.id,
        name: child.name,
        image: getMainMockupImage(primary),
        count: childProducts.length,
        href:
          childProducts.length === 1
            ? `/products/${primary.slug}`
            : `/products?collectionId=${encodeURIComponent(child.id)}`,
      };
    })
    .filter(Boolean);

  if (!childCollections.length) return null;

  return {
    parent: selectedParent,
    childCollections,
    title: `Shop the ${selectedParent.name} ${selectedParent.isSuite ? "suite" : "collection"}`,
  };
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return { title: "Product not found" };
  }

  const title = product.seoTitle || product.title;
  const description =
    product.seoDescription ||
    product.shortDescription ||
    product.description ||
    `${product.title} — a refined Husnalogy design you can personalize.`;
  const image = getMainMockupImage(product);

  return {
    title,
    description,
    alternates: { canonical: `/products/${slug}` },
    openGraph: {
      type: "website",
      title,
      description,
      url: `/products/${slug}`,
      images: image ? [{ url: image, alt: product.title }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ProductDetailsPage({ params }) {
  const { slug } = await params;

  const product = await getProductBySlug(slug);

  if (!product) {
    return (
      <main className="bg-white px-4 py-24 text-center text-[#303839]">
        <h1 className="font-display text-4xl">Product not found</h1>
      </main>
    );
  }

  const products = await getActiveProducts();
  const collections = await getProductCollections().catch(() => []);
  const otherStyles = await getOtherStyles(product, 12);
  const relatedProducts = await getRelatedProducts(product, 12);

  const suggestedProducts = relatedProducts.length
    ? relatedProducts
    : products.filter((item) => item.slug !== slug).slice(0, 12);

  const parentCollectionSection = getParentCollectionSection(product, products, collections);

  // Slim catalog with the real mockup pre-resolved on the server, so Recently
  // Viewed can rebuild each card's image by slug instead of relying on whatever
  // (possibly imageless) snapshot was persisted when the product was viewed.
  const recentlyViewedCatalog = products.map((item) => ({
    id: item.id ?? null,
    slug: item.slug,
    title: item.title,
    category: item.category ?? "",
    price: item.price ?? null,
    salePrice: item.salePrice ?? null,
    oldPrice: item.oldPrice ?? null,
    mainMockup: getMainMockupImage(item),
  }));

  const productImage = getMainMockupImage(product);
  const reviews = Array.isArray(product.reviews) ? product.reviews.filter((review) => review.status !== "deleted") : [];
  const productJsonLd: any = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.seoDescription || product.shortDescription || product.description || product.title,
    image: productImage ? [productImage.startsWith("http") ? productImage : `${SITE_URL}${productImage}`] : undefined,
    sku: product.slug || String(product.id || ""),
    brand: { "@type": "Brand", name: "Husnalogy" },
    category: product.category || product.productType || undefined,
    offers:
      product.price != null || product.salePrice != null
        ? {
            "@type": "Offer",
            price: Number(product.salePrice ?? product.price ?? 0),
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
            url: `${SITE_URL}/products/${slug}`,
          }
        : undefined,
  };
  if (reviews.length) {
    const average = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length;
    productJsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: average.toFixed(1),
      reviewCount: reviews.length,
    };
  }

  return (
    <main className="overflow-x-hidden bg-white px-3 pb-10 pt-4 text-[#303839] sm:px-4 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <RecentlyViewedTracker product={product} />

      <Breadcrumbs product={product} />

      <section className="mx-auto grid w-full min-w-0 max-w-[1480px] items-start gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(380px,1fr)] lg:gap-8 xl:grid-cols-[minmax(0,1.55fr)_minmax(420px,1fr)] xl:gap-10 2xl:grid-cols-[minmax(0,1.58fr)_minmax(430px,1fr)]">
        <div className="w-full min-w-0 max-w-full self-start overflow-hidden">
          <ProductGallery
            product={product}
            belowMainContent={
              <ProductCarousel
                title="Other styles for this product"
                products={otherStyles}
                className="mt-6 hidden lg:block lg:mt-8 [&_*]:shadow-none [&_*]:hover:shadow-none"
                itemClassName="w-[78vw] max-w-[280px] shrink-0 sm:w-[46%] sm:max-w-none xl:w-[31%]"
              />
            }
          />

          <div className="mt-8 block lg:hidden">
            <ProductInfo product={product} />
            <ProductTrustStrip className="mt-4" />
          </div>

          <ProductCarousel
            title="Other styles for this product"
            products={otherStyles}
            className="mt-10 block lg:hidden [&_*]:shadow-none [&_*]:hover:shadow-none"
            itemClassName="w-[78vw] max-w-[280px] shrink-0 sm:w-[46%] sm:max-w-none"
          />

          <ProductCarousel
            title="Other designs you might like"
            products={suggestedProducts}
            className="mt-16 [&_*]:shadow-none [&_*]:hover:shadow-none"
            itemClassName="w-[78vw] max-w-[280px] shrink-0 sm:w-[46%] sm:max-w-none xl:w-[31%]"
          />

          <ProductSuite
            product={product}
            collection={parentCollectionSection?.parent?.name}
            title={parentCollectionSection?.title}
            childCollections={parentCollectionSection?.childCollections || []}
            className="mt-16"
          />

          <ProductAboutReviews
            product={product}
            insideProductColumn
            className="mt-16"
          />
        </div>

        <div className="mt-0 hidden w-full min-w-0 max-w-none self-start pt-0 lg:block">
          <ProductInfo product={product} />
          <ProductTrustStrip className="mt-4" />
        </div>
      </section>

      <RecentlyViewedCarousel currentSlug={slug} catalog={recentlyViewedCatalog} />
    </main>
  );
}
