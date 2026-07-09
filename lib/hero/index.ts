import { getProductCollections } from "@/lib/collections/store";
import { getCollectionSuite } from "@/lib/collections";
import { getSettings } from "@/lib/settings";

function firstImage(product: any = {}) {
  return (
    product.thumbnail ||
    (Array.isArray(product.images) && product.images[0]) ||
    (Array.isArray(product.mockups) && product.mockups[0]) ||
    ""
  );
}

// Resolve the collection an admin pinned to the homepage hero (Settings → Hero
// Section) into everything the hero needs to render: the collection label, a
// featured product, and images. Returns null when nothing is selected or the
// selected collection no longer exists, so the hero falls back to its default
// styling.
export async function getHeroSpotlight() {
  let collectionId = "";
  try {
    const settings = await getSettings();
    collectionId = String(settings?.hero?.collectionId || "").trim();
  } catch {
    return null;
  }

  if (!collectionId) return null;

  try {
    const collections = await getProductCollections();
    const collection = collections.find((item) => item.id === collectionId);
    if (!collection) return null;

    const suite = await getCollectionSuite(collection.slug);
    const product = suite?.products?.[0] || null;
    const productImage = product ? firstImage(product) : "";

    return {
      collectionId: collection.id,
      name: collection.name,
      slug: collection.slug,
      description: collection.description || suite?.description || "",
      href: `/collections/${collection.slug}`,
      image: productImage,
      product: product
        ? {
            title: product.title || "",
            href: `/products/${product.slug}`,
            price: product.salePrice ?? product.price ?? null,
            image: productImage,
          }
        : null,
    };
  } catch {
    return null;
  }
}
