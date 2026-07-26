export function getImageSource(value) {
  if (!value) return "";

  if (typeof value === "string") return value;

  if (typeof value === "object") {
    return (
      value.src ||
      value.url ||
      value.image ||
      value.imageUrl ||
      value.mockup ||
      value.thumbnail ||
      ""
    );
  }

  return "";
}

export function getMainMockupImage(product) {
  return (
    getImageSource(product?.mainMockup) ||
    getImageSource(product?.mockupImage) ||
    getImageSource(product?.mockup) ||
    getImageSource(product?.mockups?.[0]) ||
    getImageSource(product?.mainImage) ||
    getImageSource(product?.thumbnail) ||
    getImageSource(product?.image) ||
    getImageSource(product?.images?.[0]) ||
    "/images/weddings.png"
  );
}

export function withMainMockupImage(product) {
  if (!product) return product;

  return {
    ...product,
    image: getMainMockupImage(product),
  };
}

/**
 * pinMockupImage
 * Forces the resolved product mockup onto `mainMockup` (the highest-priority
 * field read by getMainMockupImage) as well as `image`. This guarantees the
 * product's own mockup is the image shown — e.g. in Recently Viewed — even if
 * the `mockups`/`images` arrays are dropped when the item is persisted.
 */
export function pinMockupImage(product) {
  if (!product) return product;

  const mockup = getMainMockupImage(product);

  return {
    ...product,
    mainMockup: mockup,
    image: mockup,
  };
}
