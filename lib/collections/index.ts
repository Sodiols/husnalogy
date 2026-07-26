import { filterProducts, getActiveProducts } from "@/lib/products";
import { getProductCollections } from "@/lib/collections/store";

function clean(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function titleFromSlug(slug) {
  return clean(slug)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildHaystack(product) {
  return [
    product.title,
    product.slug,
    product.category,
    product.subcategory,
    product.productType,
    product.style,
    product.styleGroup,
    product.styleGroupId,
    product.suiteGroup,
    product.suiteGroupId,
    product.collection,
    product.theme,
    product.occasion,
    product.description,
    product.shortDescription,
    product.fullDescription,
    product.aboutDesign,
    product.aboutInvitation,
    product.seoTitle,
    product.seoDescription,
    ...(product.tags || []),
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

function includesTerm(haystack, term) {
  const value = normalize(term);
  if (!value) return true;

  return haystack.includes(value);
}

function matchesField(product, field, values = []) {
  const current = normalize(product[field]);
  if (!current) return false;

  return values.map(normalize).some((value) => current === value);
}

function matchesDefinition(product, definition) {
  const haystack = buildHaystack(product);

  if (definition.fields) {
    const valid = Object.entries(definition.fields).every(([field, values]) => {
      return matchesField(product, field, Array.isArray(values) ? values : [values]);
    });

    if (!valid) return false;
  }

  if (definition.anyField) {
    const valid = Object.entries(definition.anyField).some(([field, values]) => {
      return matchesField(product, field, Array.isArray(values) ? values : [values]);
    });

    if (!valid) return false;
  }

  if (definition.allKeywords?.length) {
    const valid = definition.allKeywords.every((term) => includesTerm(haystack, term));
    if (!valid) return false;
  }

  if (definition.keywords?.length) {
    return definition.keywords.some((term) => includesTerm(haystack, term));
  }

  return true;
}

function trendScore(product) {
  let score = 0;
  if (product.isBestSeller) score += 20;
  if (product.featured || product.isFeatured) score += 14;
  if (product.isNew) score += 8;
  if (normalize(product.occasion) === "wedding") score += 6;
  if (normalize(product.category).includes("wedding")) score += 5;
  if (normalize(product.collection)) score += 3;
  return score;
}

function collectionMatchesProduct(product, collection) {
  const collectionIds = Array.isArray(product.collectionIds) ? product.collectionIds : [];
  if (collectionIds.includes(collection.id)) return true;

  const productCollection = normalize(product.collection);
  return Boolean(productCollection && [normalize(collection.name), normalize(collection.slug)].includes(productCollection));
}

function getProductsForCollection(collection, products = []) {
  if (!collection) return [];
  return products.filter((product) => collectionMatchesProduct(product, collection));
}

function buildCollectionChildren(collection, collections = [], products = []) {
  return collections
    .filter((item) => item.parentCollectionId === collection.id)
    .map((child) => ({
      ...child,
      products: sortTrendingProducts(getProductsForCollection(child, products)),
    }));
}

function sortTrendingProducts(products = []) {
  return [...products].sort((a, b) => {
    const scoreDiff = trendScore(b) - trendScore(a);
    if (scoreDiff) return scoreDiff;
    return clean(b.createdAt).localeCompare(clean(a.createdAt));
  });
}

export const COLLECTION_DEFINITIONS = [
  {
    slug: "personalized-gifts",
    title: "Personalized Gifts",
    eyebrow: "Gift ideas",
    description: "Personalized gifts selected from real products available in the Husnalogy store.",
    allKeywords: ["gift"],
    keywords: ["personalized", "custom", "name", "photo"],
  },
  {
    slug: "birthday-gifts",
    title: "Birthday Gifts",
    eyebrow: "Gift ideas",
    description: "Birthday gift products and cards currently available from Husnalogy.",
    keywords: ["birthday", "birth day"],
  },
  {
    slug: "gifts-for-her",
    title: "Gifts For Her",
    eyebrow: "Gift ideas",
    description: "Gift ideas for her, built only from products that exist in the store.",
    allKeywords: ["gift"],
    keywords: ["her", "bride", "wife", "women", "woman", "female"],
  },
  {
    slug: "gifts-for-him",
    title: "Gifts For Him",
    eyebrow: "Gift ideas",
    description: "Gift ideas for him, built only from products that exist in the store.",
    allKeywords: ["gift"],
    keywords: ["him", "groom", "husband", "men", "man", "male"],
  },
  {
    slug: "gifts",
    title: "Gifts",
    eyebrow: "Shop gifts",
    description: "Browse all gift focused products currently available from Husnalogy.",
    keywords: ["gift", "present", "personalized"],
  },
  {
    slug: "invitations",
    title: "Invitations",
    eyebrow: "Shop invitations",
    description: "Invitation designs available in the Husnalogy catalog.",
    keywords: ["invitation", "invite"],
  },
  {
    slug: "birthdays",
    title: "Birthdays",
    eyebrow: "Shop birthdays",
    description: "Birthday products currently available from Husnalogy.",
    keywords: ["birthday"],
  },
  {
    slug: "best-selling-products",
    title: "Best Selling Products",
    eyebrow: "Most loved",
    description: "Best selling and featured products from the current Husnalogy store.",
    keywords: ["wedding", "gift", "card", "invitation"],
    sort: "trending",
    preferBestSeller: true,
  },
  {
    slug: "trending-wedding-collections",
    title: "Trending Wedding Collections",
    eyebrow: "Most loved",
    description: "Trending wedding products and suite pieces pulled directly from the live Husnalogy catalog.",
    keywords: ["wedding", "bride", "groom", "save the date", "rsvp", "invitation"],
    sort: "trending",
  },
  {
    slug: "weddings",
    title: "Weddings",
    eyebrow: "Wedding stationery",
    description: "Wedding invitations, save the dates, cards, and refined wedding pieces currently in the store.",
    keywords: ["wedding", "bride", "groom", "rsvp", "save the date", "invitation"],
  },
  {
    slug: "wedding-invitations",
    title: "Wedding Invitations",
    eyebrow: "Wedding stationery",
    description: "Wedding invitation products currently available from Husnalogy.",
    allKeywords: ["wedding"],
    keywords: ["invitation", "invite"],
  },
  {
    slug: "save-the-dates",
    title: "Save The Dates",
    eyebrow: "Wedding stationery",
    description: "Save the date designs from the current Husnalogy catalog.",
    keywords: ["save the date", "save-the-date", "save dates"],
  },
  {
    slug: "wedding-announcements",
    title: "Wedding Announcements",
    eyebrow: "Wedding stationery",
    description: "Wedding announcement cards available in the store.",
    allKeywords: ["wedding"],
    keywords: ["announcement", "announce"],
  },
  {
    slug: "enclosure-cards",
    title: "Enclosure Cards",
    eyebrow: "Wedding stationery",
    description: "Enclosure and details cards currently available from Husnalogy.",
    keywords: ["enclosure", "details card", "detail card", "information card"],
  },
  {
    slug: "rehearsal-dinner-invitations",
    title: "Rehearsal Dinner Invitations",
    eyebrow: "Wedding stationery",
    description: "Rehearsal dinner invitation products currently in the catalog.",
    keywords: ["rehearsal", "dinner"],
  },
  {
    slug: "response-cards",
    title: "Response Cards",
    eyebrow: "Wedding stationery",
    description: "RSVP and response cards available in the current store.",
    keywords: ["rsvp", "response card", "reply card"],
  },
  {
    slug: "thank-you-cards",
    title: "Thank You Cards",
    eyebrow: "Wedding stationery",
    description: "Thank you card designs currently available from Husnalogy.",
    keywords: ["thank you", "thanks"],
  },
  {
    slug: "mailing-accessories",
    title: "Mailing Accessories",
    eyebrow: "Wedding stationery",
    description: "Mailing accessories available in the Husnalogy catalog.",
    keywords: ["mailing", "address label", "stamp", "seal", "envelope"],
  },
  {
    slug: "envelopes",
    title: "Envelopes",
    eyebrow: "Wedding stationery",
    description: "Envelope products and matching envelope options from Husnalogy.",
    keywords: ["envelope"],
  },
  {
    slug: "all-wedding-stationery",
    title: "All Wedding Stationery",
    eyebrow: "Wedding stationery",
    description: "All wedding stationery products currently available from Husnalogy.",
    keywords: ["wedding", "invitation", "rsvp", "save the date", "card"],
  },
  {
    slug: "wedding-supplies",
    title: "Wedding Supplies",
    eyebrow: "Wedding day details",
    description: "Wedding day signs, menus, programs, and table details from the current store.",
    allKeywords: ["wedding"],
    keywords: ["sign", "menu", "program", "table", "decor", "guest book", "napkin"],
  },
  {
    slug: "signs",
    title: "Wedding Signs",
    eyebrow: "Wedding day details",
    description: "Wedding sign products currently available from Husnalogy.",
    keywords: ["sign", "welcome sign", "tabletop sign"],
  },
  {
    slug: "posters-prints",
    title: "Posters & Prints",
    eyebrow: "Wedding day details",
    description: "Wedding posters and print pieces available in the catalog.",
    keywords: ["poster", "print"],
  },
  {
    slug: "seating-charts",
    title: "Seating Charts",
    eyebrow: "Wedding day details",
    description: "Wedding seating chart products from Husnalogy.",
    keywords: ["seating chart", "seat chart"],
  },
  {
    slug: "guest-books",
    title: "Guest Books",
    eyebrow: "Wedding day details",
    description: "Guest book products available from the Husnalogy store.",
    keywords: ["guest book"],
  },
  {
    slug: "table-serving-decor",
    title: "Table Serving & Decor",
    eyebrow: "Wedding day details",
    description: "Table serving and decor pieces currently available from Husnalogy.",
    keywords: ["table", "decor", "serving", "coaster", "plate", "cup"],
  },
  {
    slug: "napkins",
    title: "Napkins",
    eyebrow: "Wedding day details",
    description: "Wedding napkin products currently in the store.",
    keywords: ["napkin"],
  },
  {
    slug: "menus",
    title: "Menus",
    eyebrow: "Wedding day details",
    description: "Wedding menu card products from Husnalogy.",
    keywords: ["menu"],
  },
  {
    slug: "programs",
    title: "Programs",
    eyebrow: "Wedding day details",
    description: "Wedding program products currently available from Husnalogy.",
    keywords: ["program"],
  },
  {
    slug: "games-activities",
    title: "Games & Activities",
    eyebrow: "Wedding day details",
    description: "Wedding games and activity products available in the catalog.",
    keywords: ["game", "activity", "activities"],
  },
  {
    slug: "all-wedding-supplies",
    title: "All Wedding Supplies",
    eyebrow: "Wedding day details",
    description: "All wedding supply and decor products currently available from Husnalogy.",
    keywords: ["wedding", "sign", "menu", "program", "table", "decor"],
  },
  {
    slug: "wedding-parties",
    title: "Wedding Parties",
    eyebrow: "Wedding celebrations",
    description: "Bridal shower, bachelor, bachelorette, and wedding party products.",
    keywords: ["bridal shower", "bridesmaid", "bachelorette", "bachelor", "bridal party"],
  },
  {
    slug: "bridal-shower-invitations",
    title: "Bridal Shower Invitations",
    eyebrow: "Wedding celebrations",
    description: "Bridal shower invitation products available from Husnalogy.",
    keywords: ["bridal shower"],
  },
  {
    slug: "bridesmaid-cards",
    title: "Bridesmaid Cards",
    eyebrow: "Wedding celebrations",
    description: "Bridesmaid cards currently available from Husnalogy.",
    keywords: ["bridesmaid"],
  },
  {
    slug: "bachelorette-invitations",
    title: "Bachelorette Invitations",
    eyebrow: "Wedding celebrations",
    description: "Bachelorette invitation products available in the store.",
    keywords: ["bachelorette"],
  },
  {
    slug: "bachelor-invitations",
    title: "Bachelor Invitations",
    eyebrow: "Wedding celebrations",
    description: "Bachelor invitation products available from Husnalogy.",
    keywords: ["bachelor"],
  },
  {
    slug: "bridal-party-proposal",
    title: "Bridal Party Proposal Cards",
    eyebrow: "Wedding celebrations",
    description: "Bridal party proposal cards currently available from Husnalogy.",
    keywords: ["proposal card", "bridal party"],
  },
  {
    slug: "all-wedding-party-supplies",
    title: "All Wedding Party Supplies",
    eyebrow: "Wedding celebrations",
    description: "All wedding party products currently available from Husnalogy.",
    keywords: ["bridal shower", "bridesmaid", "bachelorette", "bachelor", "bridal party"],
  },
  {
    slug: "wedding-favors-gifts",
    title: "Wedding Favors & Gifts",
    eyebrow: "Wedding gifting",
    description: "Wedding favors and gift products currently available from Husnalogy.",
    allKeywords: ["wedding"],
    keywords: ["favor", "gift", "matches", "tag", "album"],
  },
  {
    slug: "wedding-favors",
    title: "Wedding Favors",
    eyebrow: "Wedding gifting",
    description: "Wedding favor products available from Husnalogy.",
    keywords: ["wedding favor", "favor"],
  },
  {
    slug: "matches",
    title: "Matches",
    eyebrow: "Wedding gifting",
    description: "Match box and match favor products from Husnalogy.",
    keywords: ["match", "matches"],
  },
  {
    slug: "candy-favors",
    title: "Candy Favors",
    eyebrow: "Wedding gifting",
    description: "Candy favor products available from Husnalogy.",
    keywords: ["candy", "favor"],
  },
  {
    slug: "packaging",
    title: "Packaging",
    eyebrow: "Wedding gifting",
    description: "Packaging products available from Husnalogy.",
    keywords: ["packaging", "favor bag", "label", "tag"],
  },
  {
    slug: "favor-tags",
    title: "Favor Tags",
    eyebrow: "Wedding gifting",
    description: "Favor tag products available from Husnalogy.",
    keywords: ["favor tag", "gift tag", "tag"],
  },
  {
    slug: "wedding-party-gifts",
    title: "Wedding Party Gifts",
    eyebrow: "Wedding gifting",
    description: "Wedding party gift products from the Husnalogy store.",
    keywords: ["wedding party gift", "bridesmaid gift", "groomsmen gift"],
  },
  {
    slug: "newlywed-gifts",
    title: "Newlywed Gifts",
    eyebrow: "Wedding gifting",
    description: "Gift ideas for newlyweds from Husnalogy.",
    keywords: ["newlywed", "newlyweds", "married", "wedding gift"],
  },
  {
    slug: "wedding-albums",
    title: "Wedding Albums",
    eyebrow: "Wedding gifting",
    description: "Wedding album products currently available from Husnalogy.",
    keywords: ["album"],
  },
  {
    slug: "wedding-anniversary-gifts",
    title: "Wedding Anniversary Gifts",
    eyebrow: "Wedding gifting",
    description: "Wedding anniversary gift products from Husnalogy.",
    keywords: ["anniversary"],
  },
  {
    slug: "all-wedding-gifts",
    title: "All Wedding Gifts",
    eyebrow: "Wedding gifting",
    description: "All wedding gift products currently available from Husnalogy.",
    allKeywords: ["wedding"],
    keywords: ["gift", "favor", "newlywed", "album", "anniversary"],
  },

  {
    slug: "stationery",
    title: "Stationery",
    eyebrow: "Shop stationery",
    description: "Stationery products currently available from Husnalogy.",
    keywords: [
      "stationery",
      "paper",
      "notecard",
      "note card",
      "writing set",
      "thank you",
      "rsvp",
      "response card",
      "details card",
      "menu",
      "program",
      "place card",
      "table number",
      "envelope",
      "address label",
      "label",
      "sticker",
      "seal",
      "stamp",
    ],
  },
  {
    slug: "cards",
    title: "Cards",
    eyebrow: "Shop cards",
    description: "Cards for weddings, gifts, announcements, birthdays, and meaningful moments from the current Husnalogy store.",
    keywords: [
      "card",
      "cards",
      "printed card",
      "photo card",
      "announcement",
      "thank you",
      "birthday",
      "save the date",
      "rsvp",
      "response card",
      "details card",
      "enclosure card",
      "invitation card",
    ],
  },
  {
    slug: "simple-wedding",
    title: "Simple Wedding Designs",
    eyebrow: "Shop by theme",
    description: "Simple wedding designs available in the current Husnalogy store.",
    allKeywords: ["wedding"],
    keywords: ["simple", "clean"],
  },
  {
    slug: "minimal-wedding",
    title: "Minimal Wedding Designs",
    eyebrow: "Shop by theme",
    description: "Minimal wedding designs available in the current Husnalogy store.",
    allKeywords: ["wedding"],
    keywords: ["minimal", "minimalist"],
  },
  {
    slug: "elegant-wedding",
    title: "Elegant Wedding Designs",
    eyebrow: "Shop by theme",
    description: "Elegant wedding designs available in the current Husnalogy store.",
    allKeywords: ["wedding"],
    keywords: ["elegant", "refined"],
  },
  {
    slug: "classic-wedding",
    title: "Classic Wedding Designs",
    eyebrow: "Shop by theme",
    description: "Classic wedding designs available in the current Husnalogy store.",
    allKeywords: ["wedding"],
    keywords: ["classic", "timeless"],
  },
  {
    slug: "black-white-wedding",
    title: "Black & White Wedding Designs",
    eyebrow: "Shop by theme",
    description: "Black and white wedding designs from the Husnalogy catalog.",
    allKeywords: ["wedding"],
    keywords: ["black", "white", "black and white"],
  },
  {
    slug: "trendy-wedding",
    title: "Trendy Wedding Designs",
    eyebrow: "Shop by theme",
    description: "Trendy wedding designs available in the current Husnalogy store.",
    allKeywords: ["wedding"],
    keywords: ["trendy", "modern"],
  },
  {
    slug: "retro-wedding",
    title: "Retro Wedding Designs",
    eyebrow: "Shop by theme",
    description: "Retro wedding designs available in the current Husnalogy store.",
    allKeywords: ["wedding"],
    keywords: ["retro", "vintage"],
  },
];

export function getCollectionDefinition(slug) {
  const normalizedSlug = normalize(slug);
  const found = COLLECTION_DEFINITIONS.find((item) => item.slug === normalizedSlug);

  if (found) return found;

  const title = titleFromSlug(normalizedSlug || "products");

  return {
    slug: normalizedSlug,
    title,
    eyebrow: "Husnalogy collection",
    description: `Products matching ${title} from the current Husnalogy store.`,
    keywords: normalizedSlug.split("-").filter(Boolean),
  };
}

export function getCollectionHref(slug) {
  return `/collections/${slug}`;
}

export async function getCollectionSuite(slug) {
  const normalizedSlug = normalize(slug);
  const [collections, allProducts] = await Promise.all([
    getProductCollections(),
    getActiveProducts(),
  ]);
  const collection = collections.find((item) => normalize(item.slug) === normalizedSlug);

  if (!collection) return null;

  const subCollections = buildCollectionChildren(collection, collections, allProducts);
  const directProducts = sortTrendingProducts(getProductsForCollection(collection, allProducts));
  const products = subCollections.length
    ? sortTrendingProducts(subCollections.flatMap((child) => child.products))
    : directProducts;

  return {
    ...collection,
    title: collection.name,
    eyebrow: collection.parentCollectionId ? "Suite collection" : "Husnalogy collection",
    subCollections,
    products,
    directProducts,
  };
}

export async function getAllCollectionSuites() {
  const [collections, allProducts] = await Promise.all([
    getProductCollections(),
    getActiveProducts(),
  ]);

  return collections
    .filter((collection) => !collection.parentCollectionId)
    .map((collection) => {
      const subCollections = buildCollectionChildren(collection, collections, allProducts);
      const directProducts = sortTrendingProducts(getProductsForCollection(collection, allProducts));
      const products = subCollections.length
        ? sortTrendingProducts(subCollections.flatMap((child) => child.products))
        : directProducts;

      return {
        ...collection,
        subCollections,
        products,
      };
    })
    .filter((collection) => collection.products.length > 0);
}

function applyCollectionSort(products, definition) {
  if (definition.preferBestSeller) {
    const bestSellers = products.filter((product) => product.isBestSeller);
    if (bestSellers.length) {
      return bestSellers.sort((a, b) => trendScore(b) - trendScore(a));
    }
  }

  if (definition.sort === "trending") {
    return products.sort((a, b) => {
      const scoreDiff = trendScore(b) - trendScore(a);
      if (scoreDiff) return scoreDiff;
      return clean(b.createdAt).localeCompare(clean(a.createdAt));
    });
  }

  return products;
}

export async function getCollectionProducts(slug, filters = {}, limit = null) {
  const suite = await getCollectionSuite(slug);
  if (suite) {
    const visibleProducts = filterProducts(suite.products, filters);
    const sortedProducts = sortTrendingProducts(visibleProducts);

    if (limit) return sortedProducts.slice(0, limit);

    return sortedProducts;
  }

  const definition = getCollectionDefinition(slug);
  const allProducts = await getActiveProducts();
  const matchingProducts = allProducts.filter((product) => matchesDefinition(product, definition));
  const visibleProducts = filterProducts(matchingProducts, filters);
  const sortedProducts = applyCollectionSort(visibleProducts, definition);

  if (limit) return sortedProducts.slice(0, limit);

  return sortedProducts;
}

export async function getTrendingWeddingCollections(limit = 10) {
  const [collections, allProducts] = await Promise.all([
    getProductCollections(),
    getActiveProducts(),
  ]);

  const trendingCollections = collections
    .filter((collection) => collection.isTrendingWedding)
    .map((collection) => {
      const subCollections = buildCollectionChildren(collection, collections, allProducts);
      const products = subCollections.length
        ? sortTrendingProducts(subCollections.flatMap((child) => child.products))
        : sortTrendingProducts(getProductsForCollection(collection, allProducts));

      return {
        ...collection,
        subCollections,
        products,
      };
    })
    .filter((collection) => collection.products.length > 0);

  if (limit) return trendingCollections.slice(0, limit);

  return trendingCollections;
}

export async function getCollectionOptions(slug) {
  const suite = await getCollectionSuite(slug);
  if (suite) return suite.products;

  const definition = getCollectionDefinition(slug);
  const allProducts = await getActiveProducts();
  return allProducts.filter((product) => matchesDefinition(product, definition));
}
