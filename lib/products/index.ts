import crypto from "node:crypto";
import { createId, nowIso } from "@/lib/core/id";
import { getProductCollections } from "@/lib/collections/store";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { normalizeCustomizerTemplate, templateFromRow } from "@/lib/customizer";
import { saveCustomizerTemplate } from "@/lib/customizer/store";
import {
  clampString,
  cleanOptionalString,
  cleanString,
  isValidSlug,
  normalizeBoolean,
  normalizePrice,
  normalizeStringArray,
} from "@/lib/validation";
import { normalizeProductOptionEntries } from "@/lib/products/options";
import { normalizeCurrency } from "@/lib/currency";

const PRODUCT_STATUSES = new Set(["draft", "active", "hidden", "deleted"]);
const PRODUCT_VISIBILITIES = new Set(["public", "hidden", "direct"]);
const SUITABLE_AUDIENCES = new Set(["G", "PG-13", "R"]);
const COLLECTION_SECTIONS = new Set(["otherStyles", "suite"]);

function normalizeComingInDays(value) {
  if (value === "" || value === null || value === undefined) return null;
  const days = Math.floor(Number(value));
  return Number.isFinite(days) && days > 0 ? days : null;
}

const CUSTOMIZATION_TYPES = new Set([
  "text",
  "date",
  "time",
  "textarea",
  "image",
  "file",
  "select",
  "color",
  "checkbox",
  "email",
  "tel",
  "number",
]);

export const DEFAULT_CUSTOMIZATION_FIELDS = [
  { name: "brideName", label: "Bride name", type: "text", required: false },
  { name: "groomName", label: "Groom name", type: "text", required: false },
  { name: "eventDate", label: "Event date", type: "date", required: false },
  { name: "eventTime", label: "Event time", type: "time", required: false },
  { name: "venue", label: "Venue", type: "text", required: false },
  { name: "venueAddress", label: "Venue address", type: "textarea", required: false },
  { name: "photoUpload", label: "Photo upload", type: "image", required: false },
  { name: "wordingNote", label: "Wording note", type: "textarea", required: false },
];

export const DEFAULT_QUANTITY_OPTIONS = [1, 10, 20, 30, 40, 50, 75, 100];
export const DEFAULT_SIZE_OPTIONS = ['5" x 7"', '4.25" x 5.5"', '6" x 8"'];
export const DEFAULT_PAPER_OPTIONS = ["Signature Matte", "Premium Linen", "Pearl Shimmer", "Soft Touch"];
export const DEFAULT_ENVELOPE_OPTIONS = ["No Envelopes", "Blank White Envelopes", "Addressed Envelopes"];

function slugify(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeSecretCompare(a, b) {
  const first = Buffer.from(String(a || ""));
  const second = Buffer.from(String(b || ""));

  if (first.length !== second.length) return false;
  return crypto.timingSafeEqual(first, second);
}

function normalizeFieldName(value) {
  return cleanString(value)
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function parseFieldLine(line) {
  const parts = String(line || "").split("|").map((item) => item.trim());
  const label = parts[0] || "";
  const type = CUSTOMIZATION_TYPES.has(parts[1]) ? parts[1] : label.toLowerCase().includes("photo") ? "image" : label.toLowerCase().includes("date") ? "date" : label.toLowerCase().includes("time") ? "time" : "text";
  const options = parts[2]
    ? parts[2].split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  const required = parts.some((item) => item.toLowerCase() === "required");

  return {
    name: normalizeFieldName(label),
    label,
    type,
    options,
    required,
  };
}

function normalizeCustomizationFields(value) {
  if (Array.isArray(value)) {
    const fields = value
      .map((field) => {
        if (typeof field === "string") return parseFieldLine(field);

        const label = cleanString(field.label || field.name);
        const type = CUSTOMIZATION_TYPES.has(field.type) ? field.type : "text";

        return {
          name: normalizeFieldName(field.name || label),
          label,
          type,
          options: normalizeStringArray(field.options),
          required: normalizeBoolean(field.required),
          placeholder: cleanOptionalString(field.placeholder),
          helper: cleanOptionalString(field.helper),
        };
      })
      .filter((field) => field.name && field.label);

    return fields.length ? fields : DEFAULT_CUSTOMIZATION_FIELDS;
  }

  const labels = normalizeStringArray(value);
  if (!labels.length) return DEFAULT_CUSTOMIZATION_FIELDS;

  const fields = labels.map(parseFieldLine).filter((field) => field.name && field.label);
  return fields.length ? fields : DEFAULT_CUSTOMIZATION_FIELDS;
}

// Option lists accept plain label strings (legacy, may carry "+$x") and rich
// option objects (label/value/description/image/surcharge/badge/…). Both are
// stored as-is in the product's JSONB data.
function normalizeOptions(value, fallback = []) {
  return normalizeProductOptionEntries(value, fallback);
}

function normalizeReview(review: any = {}) {
  const rating = Math.min(5, Math.max(1, Number(review.rating || 5)));

  return {
    id: cleanOptionalString(review.id) || createId("review"),
    name: clampString(review.name, 120) || "Husnalogy customer",
    rating,
    text: clampString(review.text || review.message, 2000),
    orderId: cleanOptionalString(review.orderId),
    customerEmail: cleanOptionalString(review.customerEmail || review.email).toLowerCase(),
    verifiedPurchase: normalizeBoolean(review.verifiedPurchase ?? true),
    status: cleanOptionalString(review.status) || "published",
    createdAt: review.createdAt || review.date || nowIso(),
  };
}

function normalizeReviews(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(normalizeReview)
    .filter((review) => review.text && review.status !== "deleted")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function getComparable(value) {
  return cleanString(value).toLowerCase();
}

function normalizeCollectionSection(value) {
  const normalized = cleanString(value).replace(/[\s_-]+/g, "").toLowerCase();
  if (normalized === "suite" || normalized === "suites") return "suite";
  if (normalized === "otherstyles" || normalized === "otherstyle" || normalized === "styles") return "otherStyles";
  return "";
}

function normalizeCollectionSections(value, collectionIds = []) {
  const allowedIds = new Set(normalizeStringArray(collectionIds));
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return Object.entries(source).reduce((sections: any, [collectionId, section]) => {
    const id = cleanString(collectionId);
    const normalizedSection = normalizeCollectionSection(section);

    if (id && allowedIds.has(id) && COLLECTION_SECTIONS.has(normalizedSection)) {
      sections[id] = normalizedSection;
    }

    return sections;
  }, {});
}

function getProductCollectionIds(product) {
  return normalizeStringArray(product?.collectionIds);
}

function getCollectionIdsForSection(product, section) {
  const normalizedSection = normalizeCollectionSection(section);
  const collectionSections = normalizeCollectionSections(product?.collectionSections, product?.collectionIds);

  return getProductCollectionIds(product).filter((collectionId) => collectionSections[collectionId] === normalizedSection);
}

function hasAnyCollection(product, collectionIds = []) {
  if (!collectionIds.length) return false;
  const selected = new Set(collectionIds);
  return getProductCollectionIds(product).some((collectionId) => selected.has(collectionId));
}

async function getChildProductCollectionIds() {
  try {
    const collections = await getProductCollections();
    return new Set(
      collections
        .filter((collection) => collection.parentCollectionId)
        .map((collection) => collection.id)
        .filter(Boolean)
    );
  } catch {
    return null;
  }
}

function filterChildCollectionIds(collectionIds = [], childCollectionIds = null) {
  if (!childCollectionIds) return collectionIds;
  return collectionIds.filter((collectionId) => childCollectionIds.has(collectionId));
}

function normalizeSearchText(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/stationary/g, "stationery")
    .replace(/save dates/g, "save the date")
    .replace(/save-the-date/g, "save the date")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchHaystack(product) {
  return normalizeSearchText([
    product.title,
    product.slug,
    product.category,
    product.subcategory,
    product.productType,
    product.style,
    product.styleGroup,
    product.styleGroupId,
    product.suiteGroupId,
    product.collection,
    product.color,
    product.theme,
    product.occasion,
    product.eventCategory,
    product.recipientCategory,
    ...(product.departmentPath || []),
    product.aboutDesign,
    product.aboutInvitation,
    product.shortDescription,
    product.fullDescription,
    product.description,
    product.seoTitle,
    product.seoDescription,
    ...(product.tags || []),
  ].join(" "));
}

function buildSearchTerms(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const aliases = {
    invite: "invitation",
    invites: "invitation",
    stationery: "stationery",
    stationary: "stationery",
    dates: "date",
    gifts: "gift",
    cards: "card",
    weddings: "wedding",
    birthdays: "birthday",
  };

  return normalized
    .split(" ")
    .map((term) => aliases[term] || term)
    .filter((term) => term.length > 1);
}

function productSearchScore(product, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const haystack = buildSearchHaystack(product);
  const title = normalizeSearchText(product.title);
  const category = normalizeSearchText(product.category);
  const productType = normalizeSearchText(product.productType);
  const tags = normalizeSearchText((product.tags || []).join(" "));
  const terms = buildSearchTerms(normalizedQuery);

  if (!terms.length) return 0;

  let score = 0;
  let matchedTerms = 0;

  if (haystack.includes(normalizedQuery)) score += 50;
  if (title.includes(normalizedQuery)) score += 30;
  if (category.includes(normalizedQuery) || productType.includes(normalizedQuery)) score += 18;
  if (tags.includes(normalizedQuery)) score += 14;

  terms.forEach((term) => {
    const termPattern = new RegExp(`(^| )${escapeRegExp(term)}($| )`);
    const matched = haystack.includes(term);
    if (!matched) return;

    matchedTerms += 1;

    if (termPattern.test(title)) score += 12;
    else if (title.includes(term)) score += 8;

    if (termPattern.test(category) || termPattern.test(productType)) score += 7;
    if (termPattern.test(tags)) score += 5;
    score += 2;
  });

  const requiredMatches = terms.length <= 2 ? terms.length : Math.ceil(terms.length * 0.7);
  if (matchedTerms < requiredMatches) return -1;

  return score + matchedTerms;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreProductAgainst(currentProduct, item) {
  const currentSlug = currentProduct.slug;
  if (item.slug === currentSlug) return -1;

  const currentTags = new Set(normalizeStringArray(currentProduct.tags).map((tag) => tag.toLowerCase()));
  const sharedTags = normalizeStringArray(item.tags).filter((tag) => currentTags.has(tag.toLowerCase())).length;
  let score = 0;

  if (currentProduct.category && getComparable(item.category) === getComparable(currentProduct.category)) score += 4;
  if (currentProduct.subcategory && getComparable(item.subcategory) === getComparable(currentProduct.subcategory)) score += 2;
  if (currentProduct.productType && getComparable(item.productType) === getComparable(currentProduct.productType)) score += 3;
  if (currentProduct.occasion && getComparable(item.occasion) === getComparable(currentProduct.occasion)) score += 2;
  if (currentProduct.theme && getComparable(item.theme) === getComparable(currentProduct.theme)) score += 2;
  if (currentProduct.color && getComparable(item.color) === getComparable(currentProduct.color)) score += 1;
  score += Math.min(sharedTags, 4);

  return score;
}

export function normalizeProduct(input: any, existing: any = {}) {
  const now = nowIso();
  const title = cleanString(input.title ?? existing.title);
  const inputSlug = cleanString(input.slug).toLowerCase();
  const slug = inputSlug || slugify(title || existing.title || "");
  const departmentPath = normalizeStringArray(input.departmentPath ?? existing.departmentPath);
  const category = cleanString(input.category ?? existing.category) || departmentPath[0] || "";
  const status = PRODUCT_STATUSES.has(input.status) ? input.status : existing.status || "draft";
  const visibility = PRODUCT_VISIBILITIES.has(input.visibility)
    ? input.visibility
    : PRODUCT_VISIBILITIES.has(existing.visibility)
      ? existing.visibility
      : "public";
  const suitableAudience = SUITABLE_AUDIENCES.has(input.suitableAudience)
    ? input.suitableAudience
    : SUITABLE_AUDIENCES.has(existing.suitableAudience)
      ? existing.suitableAudience
      : "G";
  const eventCategory = cleanOptionalString(input.eventCategory ?? existing.eventCategory);
  const recipientCategory = cleanOptionalString(input.recipientCategory ?? existing.recipientCategory);
  const collectionIds = normalizeStringArray(input.collectionIds ?? existing.collectionIds);
  const collectionSections = normalizeCollectionSections(
    input.collectionSections ?? input.collectionPlacements ?? existing.collectionSections ?? existing.collectionPlacements,
    collectionIds
  );
  const isStockOut = normalizeBoolean(
    input.isStockOut ?? existing.isStockOut ?? (existing.stockStatus === "out-of-stock")
  );
  const comingInDays = isStockOut ? normalizeComingInDays(input.comingInDays ?? existing.comingInDays) : null;
  const customizeEnabled = normalizeBoolean(input.customizeEnabled ?? existing.customizeEnabled ?? true);
  const customizerTemplateSource = input.customizerTemplate ?? existing.customizerTemplate;
  const customizerTemplate = customizerTemplateSource
    ? normalizeCustomizerTemplate(customizerTemplateSource, existing.customizerTemplate || {})
    : undefined;
  const price = normalizePrice(input.price ?? input.salePrice ?? existing.price ?? existing.salePrice);
  const salePrice = normalizePrice(input.salePrice ?? input.price ?? existing.salePrice ?? existing.price);
  const oldPrice = normalizePrice(input.oldPrice ?? existing.oldPrice);
  const aboutDesign = cleanOptionalString(
    input.aboutDesign ?? input.fullDescription ?? input.description ?? existing.aboutDesign ?? existing.fullDescription ?? existing.description
  );
  const aboutInvitation =
    cleanOptionalString(
      input.aboutInvitation ?? input.about?.description ?? existing.aboutInvitation ?? existing.about?.description
    ) || aboutDesign;
  const existingAbout = existing.about && typeof existing.about === "object" ? existing.about : {};
  const inputAbout = input.about && typeof input.about === "object" ? input.about : {};
  const images = normalizeStringArray(input.images ?? existing.images);
  const mockups = normalizeStringArray(input.mockups ?? existing.mockups);
  const thumbnail = cleanOptionalString(input.thumbnail ?? existing.thumbnail) || images[0] || mockups[0] || "";
  const featured = normalizeBoolean(input.featured ?? input.isFeatured ?? existing.featured ?? existing.isFeatured);
  const isBestSeller = normalizeBoolean(input.isBestSeller ?? input.bestSeller ?? existing.isBestSeller ?? existing.bestSeller);
  const isNew = normalizeBoolean(input.isNew ?? input.isNewArrival ?? input.new ?? existing.isNew ?? existing.isNewArrival ?? existing.new);
  const styleGroupId = cleanOptionalString(input.styleGroupId ?? input.styleGroup ?? existing.styleGroupId ?? existing.styleGroup);
  const suiteGroupId = cleanOptionalString(input.suiteGroupId ?? input.suiteGroup ?? existing.suiteGroupId ?? existing.suiteGroup);
  const about = {
    title: inputAbout.title || existingAbout.title || "About This Product",
    size: inputAbout.size || existingAbout.size || '5" x 7"',
    paperType: inputAbout.paperType || existingAbout.paperType || "Signature Matte",
    description: aboutInvitation,
    features: Array.isArray(inputAbout.features)
      ? inputAbout.features
      : Array.isArray(existingAbout.features)
        ? existingAbout.features
        : [
            'Dimensions: 5" x 7" portrait or landscape',
            "Personalized names, date, and event wording",
            "High quality full color printing",
            "Envelope options available",
            "Standard and high definition printing options",
          ],
  };

  return {
    id: existing.id || cleanString(input.id) || createId("product"),
    title,
    slug,
    category,
    departmentPath,
    subcategory: cleanOptionalString(input.subcategory ?? existing.subcategory) || departmentPath[1] || "",
    productType: cleanOptionalString(input.productType ?? existing.productType),
    price,
    salePrice,
    oldPrice,
    description: aboutDesign,
    shortDescription: cleanOptionalString(input.shortDescription ?? existing.shortDescription) || aboutDesign,
    fullDescription: cleanOptionalString(input.fullDescription ?? existing.fullDescription) || aboutDesign,
    aboutDesign,
    aboutInvitation,
    images,
    mockups,
    thumbnail,
    video: cleanOptionalString(input.video ?? existing.video),
    styleGroupId,
    styleGroup: styleGroupId,
    suiteGroupId,
    suiteGroup: suiteGroupId,
    collection: cleanOptionalString(input.collection ?? existing.collection),
    collectionIds,
    collectionSections,
    collectionPlacements: collectionSections,
    color: cleanOptionalString(input.color ?? existing.color),
    theme: cleanOptionalString(input.theme ?? existing.theme),
    occasion: cleanOptionalString(input.occasion ?? existing.occasion) || eventCategory,
    eventCategory,
    recipientCategory,
    suitableAudience,
    customizeEnabled,
    ...(customizerTemplate ? { customizerTemplate } : {}),
    tags: normalizeStringArray(input.tags ?? existing.tags),
    imageAltText: normalizeStringArray(input.imageAltText ?? existing.imageAltText),
    seoTitle: cleanOptionalString(input.seoTitle ?? existing.seoTitle) || title,
    seoDescription: cleanOptionalString(input.seoDescription ?? existing.seoDescription) || aboutDesign,
    seoKeywords: normalizeStringArray(input.seoKeywords ?? existing.seoKeywords),
    customizationFields: normalizeCustomizationFields(input.customizationFields ?? existing.customizationFields),
    quantityOptions: normalizeOptions(input.quantityOptions ?? existing.quantityOptions, DEFAULT_QUANTITY_OPTIONS.map(String)),
    sizeOptions: normalizeOptions(input.sizeOptions ?? existing.sizeOptions, DEFAULT_SIZE_OPTIONS),
    paperOptions: normalizeOptions(input.paperOptions ?? existing.paperOptions, DEFAULT_PAPER_OPTIONS),
    envelopeOptions: normalizeOptions(input.envelopeOptions ?? existing.envelopeOptions, DEFAULT_ENVELOPE_OPTIONS),
    cornerOptions: normalizeOptions(input.cornerOptions ?? existing.cornerOptions, ["Squared", "Rounded", "Arch", "Scallop", "Bracket", "Ticket"]),
    printingOptions: normalizeOptions(input.printingOptions ?? existing.printingOptions, ["Standard", "High Definition +$0.40"]),
    // Newer option groups. Empty means "not configured": the customizer falls
    // back to its built-in format list and hides Paper Style entirely.
    formatOptions: normalizeOptions(input.formatOptions ?? existing.formatOptions, []),
    paperStyleOptions: normalizeOptions(input.paperStyleOptions ?? existing.paperStyleOptions, []),
    isStockOut,
    comingInDays,
    currency: normalizeCurrency(input.currency ?? existing.currency),
    stockStatus: isStockOut ? "out-of-stock" : (cleanOptionalString(input.stockStatus ?? existing.stockStatus) === "out-of-stock" ? "in-stock" : cleanOptionalString(input.stockStatus ?? existing.stockStatus) || "in-stock"),
    availability: cleanOptionalString(input.availability ?? existing.availability) || "available",
    deliveryEstimate: cleanOptionalString(input.deliveryEstimate ?? existing.deliveryEstimate),
    productionTime: cleanOptionalString(input.productionTime ?? existing.productionTime),
    requiresShipping: normalizeBoolean(input.requiresShipping ?? existing.requiresShipping ?? true),
    digitalProduct: normalizeBoolean(input.digitalProduct ?? existing.digitalProduct),
    instantDownload: normalizeBoolean(input.instantDownload ?? existing.instantDownload),
    relatedProducts: normalizeStringArray(input.relatedProducts ?? existing.relatedProducts),
    otherStyleProducts: normalizeStringArray(input.otherStyleProducts ?? existing.otherStyleProducts),
    status,
    visibility,
    featured,
    isFeatured: featured,
    isBestSeller,
    isNew,
    isNewArrival: isNew,
    deletedAt: input.deletedAt ?? existing.deletedAt ?? null,
    about,
    reviews: normalizeReviews(input.reviews ?? existing.reviews ?? []),
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: now,
    publishedAt: status === "active" ? existing.publishedAt || input.publishedAt || now : existing.publishedAt ?? null,
  };
}

export function validateProduct(product: any) {
  const errors: any = {};

  if (!product.title) errors.title = "Product title is required.";
  if (!product.slug) errors.slug = "Product slug is required.";
  if (product.slug && !isValidSlug(product.slug)) {
    errors.slug = "Use lowercase letters, numbers and single hyphens only.";
  }
  if (product.price !== null && product.price < 0) errors.price = "Price cannot be negative.";

  // Drafts only need a title; the full checklist applies when publishing.
  if (product.status === "active") {
    if (!product.category && !(product.departmentPath || []).length) {
      errors.category = "Marketplace department is required.";
    }
    if (!product.aboutDesign) errors.aboutDesign = "Product description is required.";
    if (!product.images.length && !product.mockups.length) errors.images = "Add at least one product image.";
    if (!product.tags.length) errors.tags = "Add at least one tag before publishing.";
  }

  return errors;
}

const PRODUCT_SELECT = `
  *,
  product_images(*),
  product_mockups(*),
  product_videos(*),
  product_collection_products(collection_id),
  product_customizer_templates(*),
  reviews(*)
`;

function sortByOrder(a: any, b: any) {
  const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
  if (orderDiff) return orderDiff;
  return String(a.created_at || "").localeCompare(String(b.created_at || ""));
}

function mediaUrls(rows = [], key = "image_url") {
  return [...rows].sort(sortByOrder).map((row) => row[key]).filter(Boolean);
}

function reviewFromRow(row: any = {}) {
  const metadata = row.metadata || {};

  return {
    id: row.id,
    name: clampString(row.customer_name || metadata.name, 120) || "Husnalogy customer",
    rating: Math.min(5, Math.max(1, Number(row.rating || 5))),
    text: clampString(row.body || metadata.text || metadata.message, 2000),
    orderId: cleanOptionalString(row.order_id || metadata.orderId),
    customerEmail: cleanOptionalString(row.customer_email || metadata.customerEmail || metadata.email).toLowerCase(),
    verifiedPurchase: normalizeBoolean(row.verified_purchase ?? metadata.verifiedPurchase ?? true),
    status: cleanOptionalString(row.status) || "published",
    createdAt: row.created_at || metadata.createdAt || nowIso(),
  };
}

function productFromRow(row: any = {}) {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  const images = mediaUrls(row.product_images || [], "image_url");
  const mockups = mediaUrls(row.product_mockups || [], "mockup_url");
  const videos = mediaUrls(row.product_videos || [], "video_url");
  const linkedCollectionIds = Array.isArray(row.product_collection_products)
    ? row.product_collection_products.map((item) => item.collection_id).filter(Boolean)
    : [];
  const collectionIds = normalizeStringArray(data.collectionIds).length ? data.collectionIds : linkedCollectionIds;
  const reviews = Array.isArray(row.reviews)
    ? row.reviews.map(reviewFromRow).filter((review) => review.text && review.status !== "deleted")
    : data.reviews || [];

  const templateRow = Array.isArray(row.product_customizer_templates)
    ? row.product_customizer_templates[0]
    : row.product_customizer_templates;
  // The dedicated table is the source of truth; fall back to the copy kept in
  // product.data for fast reads when the join is unavailable.
  const customizerTemplate = templateRow
    ? templateFromRow(templateRow)
    : data.customizerTemplate
      ? normalizeCustomizerTemplate(data.customizerTemplate)
      : undefined;

  const product = normalizeProduct(
    {
      ...data,
      id: row.id,
      slug: row.slug,
      title: row.title,
      category: row.category || data.category,
      categoryId: row.category_id || data.categoryId,
      collectionIds,
      status: row.status || data.status,
      visibility: row.visibility || data.visibility,
      price: row.price ?? data.price,
      salePrice: row.sale_price ?? data.salePrice,
      thumbnail: row.thumbnail || data.thumbnail,
      description: row.description || data.description,
      images: images.length ? images : data.images,
      mockups: mockups.length ? mockups : data.mockups,
      video: videos[0] || data.video,
      videos: videos.length ? videos : data.videos,
      featured: row.featured ?? data.featured,
      isFeatured: row.featured ?? data.isFeatured,
      isBestSeller: row.is_best_seller ?? data.isBestSeller,
      isNew: row.is_new_arrival ?? data.isNew,
      isNewArrival: row.is_new_arrival ?? data.isNewArrival,
      isStockOut: row.is_stock_out ?? data.isStockOut,
      comingInDays: row.coming_in_days ?? data.comingInDays,
      deletedAt: row.deleted_at ?? data.deletedAt,
      publishedAt: row.published_at ?? data.publishedAt,
      reviews,
      createdAt: row.created_at || data.createdAt,
      updatedAt: row.updated_at || data.updatedAt,
    },
    {
      ...data,
      id: row.id,
      createdAt: row.created_at || data.createdAt,
      updatedAt: row.updated_at || data.updatedAt,
      publishedAt: row.published_at ?? data.publishedAt,
    }
  );

  return {
    ...product,
    categoryId: row.category_id || data.categoryId || "",
    images: images.length ? images : product.images,
    mockups: mockups.length ? mockups : product.mockups,
    video: videos[0] || product.video,
    videos,
    ...(customizerTemplate ? { customizerTemplate } : {}),
    reviews,
    createdAt: row.created_at || product.createdAt,
    updatedAt: row.updated_at || product.updatedAt,
    publishedAt: row.published_at ?? product.publishedAt,
    deletedAt: row.deleted_at ?? product.deletedAt,
  };
}

async function getCategoryIdForProduct(product) {
  const categoryName = cleanString(product.category);
  if (!categoryName) return null;

  const supabase = createServiceRoleClient();
  const categorySlug = slugify(categoryName);
  const { data, error } = await supabase
    .from("categories")
    .select("id")
    .or(`slug.eq.${categorySlug},name.eq.${categoryName}`)
    .limit(1);

  if (error) throw error;
  return data?.[0]?.id || null;
}

async function toProductRow(product) {
  const categoryId = product.categoryId || (await getCategoryIdForProduct(product));

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    category_id: categoryId,
    category: product.category || null,
    status: product.status,
    visibility: product.visibility || "public",
    price: product.price ?? 0,
    sale_price: product.salePrice ?? null,
    thumbnail: product.thumbnail || null,
    description: product.description || product.aboutDesign || null,
    featured: Boolean(product.featured || product.isFeatured),
    is_new_arrival: Boolean(product.isNew || product.isNewArrival),
    is_best_seller: Boolean(product.isBestSeller),
    is_stock_out: Boolean(product.isStockOut),
    coming_in_days: product.isStockOut ? product.comingInDays : null,
    deleted_at: product.deletedAt || null,
    published_at: product.publishedAt || null,
    data: product,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  };
}

async function replaceProductMedia(productId, table, urlColumn, urls = []) {
  const supabase = createServiceRoleClient();
  const { error: deleteError } = await supabase.from(table).delete().eq("product_id", productId);
  if (deleteError) throw deleteError;

  const rows = normalizeStringArray(urls).map((url, index) => ({
    product_id: productId,
    [urlColumn]: url,
    sort_order: index,
  }));

  if (!rows.length) return;

  const { error } = await supabase.from(table).insert(rows);
  if (error) throw error;
}

async function replaceProductCollectionLinks(productId, collectionIds = []) {
  const supabase = createServiceRoleClient();
  const { error: deleteError } = await supabase.from("product_collection_products").delete().eq("product_id", productId);
  if (deleteError) throw deleteError;

  const rows = normalizeStringArray(collectionIds).map((collectionId) => ({
    product_id: productId,
    collection_id: collectionId,
  }));

  if (!rows.length) return;

  const { error } = await supabase.from("product_collection_products").insert(rows);
  if (error) throw error;
}

async function syncProductDetails(product) {
  await replaceProductMedia(product.id, "product_images", "image_url", product.images);
  await replaceProductMedia(product.id, "product_mockups", "mockup_url", product.mockups);
  await replaceProductMedia(product.id, "product_videos", "video_url", normalizeStringArray(product.videos || product.video));
  await replaceProductCollectionLinks(product.id, product.collectionIds);

  // Persist the customizer template into its dedicated table (source of truth).
  // Products without a template are left untouched so existing products keep working.
  if (product.customizerTemplate) {
    const saved = await saveCustomizerTemplate(product.id, product.customizerTemplate);
    if (saved) product.customizerTemplate = saved;
  }
}

async function getProductRows(includeDeleted = false) {
  const supabase = createServiceRoleClient();
  let query = supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .order("created_at", { ascending: false });

  if (!includeDeleted) query = query.neq("status", "deleted");

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

function isPubliclyListed(product) {
  return product.status === "active" && (product.visibility || "public") === "public";
}

export async function getProducts() {
  const rows = await getProductRows(false);
  return rows
    .map(productFromRow)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export async function getActiveProducts(filters = {}) {
  const products = await getProducts();
  return filterProducts(products.filter(isPubliclyListed), filters);
}

export async function getFeaturedProducts(limit) {
  const products = await getActiveProducts({ featured: true });
  return limit ? products.slice(0, limit) : products;
}

export async function getProductBySlug(slug, includeInactive = false) {
  const products = await getProducts();
  const product = products.find((item) => item.slug === slug);

  if (!product) return null;
  // "direct" visibility stays reachable through its link but never in listings;
  // "hidden" visibility is admin-only even when the product status is active.
  if (!includeInactive && (product.status !== "active" || (product.visibility || "public") === "hidden")) return null;

  return product;
}

export async function getOtherStyles(productOrSlug, limit = 12) {
  const products = await getActiveProducts();
  const currentProduct =
    typeof productOrSlug === "string"
      ? products.find((item) => item.slug === productOrSlug) || (await getProductBySlug(productOrSlug))
      : productOrSlug;

  if (!currentProduct) return [];

  const childCollectionIds = await getChildProductCollectionIds();
  const styleCollectionIds = getCollectionIdsForSection(currentProduct, "otherStyles");
  const childStyleCollectionIds = filterChildCollectionIds(styleCollectionIds, childCollectionIds);
  const fallbackCollectionIds = filterChildCollectionIds(getProductCollectionIds(currentProduct), childCollectionIds);
  const otherStyleCollectionIds = childStyleCollectionIds.length ? childStyleCollectionIds : fallbackCollectionIds;
  if (otherStyleCollectionIds.length) {
    return products
      .filter((item) => item.slug !== currentProduct.slug)
      .filter((item) => hasAnyCollection(item, otherStyleCollectionIds))
      .slice(0, limit);
  }

  const groupId = getComparable(currentProduct.styleGroupId || currentProduct.styleGroup);
  if (!groupId) return [];

  return products
    .filter((item) => item.slug !== currentProduct.slug)
    .filter((item) => getComparable(item.styleGroupId || item.styleGroup) === groupId)
    .slice(0, limit);
}

export async function getMatchingSuiteProducts(productOrSlug, limit = 16) {
  const products = await getActiveProducts();
  const currentProduct =
    typeof productOrSlug === "string"
      ? products.find((item) => item.slug === productOrSlug) || (await getProductBySlug(productOrSlug))
      : productOrSlug;

  if (!currentProduct) return [];

  const suiteCollectionIds = getCollectionIdsForSection(currentProduct, "suite");
  if (suiteCollectionIds.length) {
    return products
      .filter((item) => item.slug !== currentProduct.slug)
      .filter((item) => hasAnyCollection(item, suiteCollectionIds))
      .slice(0, limit);
  }

  const groupId = getComparable(currentProduct.suiteGroupId || currentProduct.suiteGroup);
  if (!groupId) return [];

  return products
    .filter((item) => item.slug !== currentProduct.slug)
    .filter((item) => getComparable(item.suiteGroupId || item.suiteGroup) === groupId)
    .slice(0, limit);
}

export async function getRelatedProducts(productOrSlug, limit = 12) {
  const products = await getActiveProducts();
  const currentProduct =
    typeof productOrSlug === "string"
      ? products.find((item) => item.slug === productOrSlug) || (await getProductBySlug(productOrSlug))
      : productOrSlug;

  if (!currentProduct) return products.slice(0, limit);

  return products
    .filter((item) => item.slug !== currentProduct.slug)
    .map((item) => ({ product: item, score: scoreProductAgainst(currentProduct, item) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.product.createdAt || "").localeCompare(String(a.product.createdAt || ""));
    })
    .map((item) => item.product)
    .slice(0, limit);
}

export async function getRelatedProductsByStyleGroup(productOrSlug, limit = 12) {
  const otherStyles = await getOtherStyles(productOrSlug, limit);
  if (otherStyles.length) return otherStyles;
  return getRelatedProducts(productOrSlug, limit);
}

export function filterProducts(products: any, filters: any = {}) {
  const query = cleanString(filters.query || filters.q);
  const category = getComparable(filters.category);
  const subcategory = getComparable(filters.subcategory);
  const productType = getComparable(filters.productType);
  const occasion = getComparable(filters.occasion);
  const style = getComparable(filters.style || filters.theme);
  const color = getComparable(filters.color);
  const collection = getComparable(filters.collection);
  const collectionId = cleanString(filters.collectionId);
  const featured = filters.featured === true || filters.featured === "true";
  const bestSeller = filters.bestSeller === true || filters.bestSeller === "true";
  const newest = filters.newest === true || filters.newest === "true";
  const minPrice = normalizePrice(filters.minPrice);
  const maxPrice = normalizePrice(filters.maxPrice);
  const sort = cleanString(filters.sort || "").toLowerCase();

  const result = products
    .map((product) => ({ product, searchScore: productSearchScore(product, query) }))
    .filter(({ product, searchScore }) => {
      const productPrice = Number(product.salePrice ?? product.price ?? 0);

      if (query && searchScore < 0) return false;
      if (category && getComparable(product.category) !== category) return false;
      if (subcategory && getComparable(product.subcategory) !== subcategory) return false;
      if (productType && getComparable(product.productType) !== productType) return false;
      if (occasion && getComparable(product.occasion) !== occasion) return false;
      if (style && getComparable(product.theme || product.style) !== style) return false;
      if (color && getComparable(product.color) !== color) return false;
      if (collection && getComparable(product.collection) !== collection) return false;
      if (collectionId && !getProductCollectionIds(product).includes(collectionId)) return false;
      if (featured && !product.featured && !product.isFeatured) return false;
      if (bestSeller && !product.isBestSeller) return false;
      if (newest && !product.isNew) return false;
      if (minPrice !== null && productPrice < minPrice) return false;
      if (maxPrice !== null && productPrice > maxPrice) return false;

      return true;
    });

  const byNewest = (a, b) => String(b.product.createdAt || "").localeCompare(String(a.product.createdAt || ""));

  if (sort === "price-low") {
    return result
      .sort((a, b) => Number(a.product.salePrice ?? a.product.price ?? 0) - Number(b.product.salePrice ?? b.product.price ?? 0))
      .map((item) => item.product);
  }

  if (sort === "price-high") {
    return result
      .sort((a, b) => Number(b.product.salePrice ?? b.product.price ?? 0) - Number(a.product.salePrice ?? a.product.price ?? 0))
      .map((item) => item.product);
  }

  if (sort === "featured") {
    return result
      .sort((a, b) => {
        const featuredDiff = Number(Boolean(b.product.featured || b.product.isFeatured)) - Number(Boolean(a.product.featured || a.product.isFeatured));
        return featuredDiff || byNewest(a, b);
      })
      .map((item) => item.product);
  }

  if (query) {
    return result
      .sort((a, b) => {
        const scoreDiff = b.searchScore - a.searchScore;
        return scoreDiff || byNewest(a, b);
      })
      .map((item) => item.product);
  }

  return result.sort(byNewest).map((item) => item.product);
}

export function getFilterOptions(products = []) {
  const build = (key) =>
    [...new Set(products.map((product) => cleanString(product[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return {
    categories: build("category"),
    subcategories: build("subcategory"),
    productTypes: build("productType"),
    occasions: build("occasion"),
    styles: build("theme"),
    colors: build("color"),
    collections: build("collection"),
  };
}

async function assertUniqueSlug(slug, idToIgnore = null) {
  const supabase = createServiceRoleClient();
  let query = supabase.from("products").select("id").eq("slug", slug).limit(1);
  if (idToIgnore) query = query.neq("id", idToIgnore);

  const { data, error } = await query;
  if (error) throw error;

  return !data?.length;
}

function generateUniqueSlug(products, baseSlug) {
  const taken = new Set(products.map((product) => product.slug));
  if (!taken.has(baseSlug)) return baseSlug;

  let counter = 2;
  while (taken.has(`${baseSlug}-${counter}`)) counter += 1;
  return `${baseSlug}-${counter}`;
}

export async function createProduct(input) {
  const products = await getProducts();
  const product = normalizeProduct(input);
  const errors = validateProduct(product);

  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }

  product.slug = generateUniqueSlug(products, product.slug);

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("products").insert(await toProductRow(product));
  if (error) throw error;

  await syncProductDetails(product);
  return { ok: true, product };
}

export async function updateProduct(id, input) {
  const products = await getProducts();
  const index = products.findIndex((product) => product.id === id);

  if (index === -1) {
    return { ok: false, errors: { product: "Product not found." } };
  }

  const product = normalizeProduct(input, products[index]);
  const errors = validateProduct(product);

  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }

  if (!(await assertUniqueSlug(product.slug, id))) {
    return { ok: false, errors: { slug: "This slug already exists." } };
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("products").update(await toProductRow(product)).eq("id", id);
  if (error) throw error;

  await syncProductDetails(product);
  return { ok: true, product };
}

export async function getDeletedProducts() {
  const rows = await getProductRows(true);
  return rows
    .map(productFromRow)
    .filter((product) => product.status === "deleted")
    .sort((a, b) => String(b.deletedAt || b.updatedAt || "").localeCompare(String(a.deletedAt || a.updatedAt || "")));
}

export async function deleteProduct(id) {
  const products = await getProducts();
  const product = products.find((item) => item.id === id);

  if (!product) {
    return { ok: false, errors: { product: "Product not found." } };
  }

  const deletedProduct = {
    ...product,
    status: "deleted",
    deletedAt: nowIso(),
    updatedAt: nowIso(),
  };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("products").update(await toProductRow(deletedProduct)).eq("id", id);
  if (error) throw error;

  return { ok: true, product: deletedProduct };
}

export async function restoreProduct(id) {
  const products = await getDeletedProducts();
  const product = products.find((item) => item.id === id);

  if (!product) {
    return { ok: false, errors: { product: "Product not found." } };
  }

  if (product.status !== "deleted") {
    return { ok: false, errors: { product: "Only recently deleted products can be restored." } };
  }

  const restoredProduct = {
    ...product,
    status: "draft",
    deletedAt: null,
    updatedAt: nowIso(),
  };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("products").update(await toProductRow(restoredProduct)).eq("id", id);
  if (error) throw error;

  return { ok: true, product: restoredProduct };
}

export async function addProductReview(productId, input: any = {}) {
  const products = await getProductRows(true);
  const row = products.find((product) => String(product.id) === String(productId));

  if (!row) {
    return { ok: false, errors: { product: "Product not found." } };
  }

  const existingReviews = Array.isArray(row.reviews) ? row.reviews.map(reviewFromRow) : [];
  const orderId = cleanString(input.orderId);
  const customerEmail = cleanString(input.customerEmail || input.email).toLowerCase();

  if (!orderId) return { ok: false, errors: { orderId: "Confirmed order ID is required." } };
  if (!customerEmail) return { ok: false, errors: { customerEmail: "Order email is required." } };
  if (existingReviews.some((review) => review.orderId === orderId && review.customerEmail === customerEmail)) {
    return { ok: false, errors: { review: "A review for this order has already been submitted." } };
  }

  const review = normalizeReview({
    ...input,
    orderId,
    customerEmail,
    verifiedPurchase: true,
    status: "published",
    createdAt: nowIso(),
  });

  if (!review.text) return { ok: false, errors: { text: "Review text is required." } };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("reviews")
    .insert({
      product_id: productId,
      order_id: orderId,
      customer_id: cleanOptionalString(input.customerId) || null,
      customer_name: cleanOptionalString(input.name),
      customer_email: customerEmail,
      rating: review.rating,
      title: cleanOptionalString(input.title),
      body: review.text,
      verified_purchase: true,
      status: "published",
      metadata: review,
      created_at: review.createdAt,
      updated_at: nowIso(),
    })
    .select("*")
    .single();

  if (error) throw error;

  const savedReview = reviewFromRow(data);
  const reviews = normalizeReviews([savedReview, ...existingReviews]);

  return { ok: true, review: savedReview, reviews };
}

export async function addProductReviewBySlug(slug, input: any = {}) {
  const product = await getProductBySlug(slug, true);
  if (!product) return { ok: false, errors: { product: "Product not found." } };
  return addProductReview(product.id, input);
}

export async function deleteProductReview(productId, reviewId) {
  const product = (await getProductRows(true)).find((row) => String(row.id) === String(productId));

  if (!product) {
    return { ok: false, errors: { product: "Product not found." } };
  }

  const supabase = createServiceRoleClient();
  const { error, count } = await supabase
    .from("reviews")
    .delete({ count: "exact" })
    .eq("product_id", productId)
    .eq("id", reviewId);

  if (error) throw error;
  if (!count) {
    return { ok: false, errors: { review: "Review not found." } };
  }

  const { data, error: readError } = await supabase
    .from("reviews")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false });

  if (readError) throw readError;

  return { ok: true, reviews: (data || []).map(reviewFromRow) };
}

export function verifyPermanentDeleteCredentials(email, password) {
  return (
    Boolean(process.env.DELETE_ADMIN_EMAIL) &&
    Boolean(process.env.DELETE_ADMIN_PASSWORD) &&
    safeSecretCompare(email, process.env.DELETE_ADMIN_EMAIL) &&
    safeSecretCompare(password, process.env.DELETE_ADMIN_PASSWORD)
  );
}

export async function permanentlyDeleteProduct(id) {
  const products = await getDeletedProducts();
  const product = products.find((item) => item.id === id);

  if (!product) {
    return { ok: false, errors: { product: "Product not found." } };
  }

  if (product.status !== "deleted") {
    return { ok: false, errors: { product: "Move the product to Recently Deleted first." } };
  }

  const supabase = createServiceRoleClient();
  const { error, count } = await supabase.from("products").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  if (!count) return { ok: false, errors: { product: "Product not found." } };

  return { ok: true };
}
