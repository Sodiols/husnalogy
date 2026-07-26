"use client";

import { createClient } from "@/lib/supabase/client";
import { normalizeCurrency } from "@/lib/currency";

const RECENT_KEY = "husnalogy_recently_viewed";
const ADDRESS_KEY = "husnalogy_saved_addresses";
const ORDER_KEY = "husnalogy_orders";
const PROFILE_KEY = "husnalogy_profile";
const EVENT_NAME = "husnalogy-commerce-change";
const USER_REQUIRED_ERROR = "Sign in to use cart and wishlist.";
const MAX_CUSTOMER_UPLOAD_SIZE = 25 * 1024 * 1024;
const CUSTOMER_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const loggedRemoteReadWarnings = new Set();
const REMOTE_CACHE_TTL = 5 * 1000;
const remoteCache: any = {
  cart: new Map(),
  wishlist: new Map(),
};
const remoteInflight: any = {
  cart: new Map(),
  wishlist: new Map(),
};

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function safeRead(key, fallback: any = []) {
  if (!canUseStorage()) return fallback;

  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.error(`Could not read ${key}:`, error);
    return fallback;
  }
}

function safeWrite(key, value) {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    dispatchCommerceChange(key);
  } catch (error) {
    console.error(`Could not write ${key}:`, error);
  }
}

function dispatchCommerceChange(key = "") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key } }));
  }
}

export function formatRemoteError(error) {
  if (!error) return "Unknown Supabase error.";
  if (typeof error === "string") return error;

  const parts = [
    error.message,
    error.details,
    error.hint,
    error.code ? `Code: ${error.code}` : "",
  ].filter(Boolean);

  if (parts.length) return parts.join(" ");

  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : "Unknown Supabase error.";
  } catch {
    return "Unknown Supabase error.";
  }
}

function warnRemoteReadOnce(resource, error) {
  const message = formatRemoteError(error);
  const key = `${resource}:${message}`;

  if (loggedRemoteReadWarnings.has(key)) return;
  loggedRemoteReadWarnings.add(key);

  console.warn(`Could not load ${resource}. ${message}`);
}

function requireUser(user) {
  const userId = String(user?.uid || user?.id || "").trim();
  if (userId) return userId;

  const error: any = new Error(USER_REQUIRED_ERROR);
  error.code = "auth-required";
  throw error;
}

function getCachedRemote(resource, userId) {
  const cached = remoteCache[resource]?.get(userId);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > REMOTE_CACHE_TTL) return null;
  return cached.items;
}

function setCachedRemote(resource, userId, items) {
  remoteCache[resource]?.set(userId, { items, cachedAt: Date.now() });
}

function invalidateRemoteCache(resource, userId = "") {
  if (userId) {
    remoteCache[resource]?.delete(userId);
    remoteInflight[resource]?.delete(userId);
    return;
  }

  remoteCache[resource]?.clear();
  remoteInflight[resource]?.clear();
}

function nowIso() {
  return new Date().toISOString();
}

function makeCartItemId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `cart_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getProductImage(product) {
  return product?.images?.[0] || product?.mockups?.[0] || product?.thumbnail || "/images/weddings.png";
}

function normalizeRemoteCartItem(row: any = {}) {
  const metadata = row.metadata || {};
  const quantity = Math.max(1, Number(row.quantity || metadata.quantity || 1));
  const price = Number(row.unit_price ?? metadata.price ?? 0);

  return {
    id: row.id,
    productId: row.product_id || metadata.productId || "",
    slug: row.product_slug || metadata.slug || "",
    title: row.product_title || metadata.title || "Untitled product",
    image: row.product_image || metadata.image || "/images/weddings.png",
    price,
    currency: normalizeCurrency(metadata.currency),
    quantity,
    selectedOptions: metadata.selectedOptions || metadata.options || {},
    options: metadata.selectedOptions || metadata.options || {},
    customizationValues: metadata.customizationValues || metadata.customization || {},
    customization: metadata.customizationValues || metadata.customization || {},
    uploadedFiles: metadata.uploadedFiles || {},
    previewData: metadata.previewData || {},
    previewImages: metadata.previewImages || {},
    customizationId: metadata.customizationId || "",
    templateId: metadata.templateId || "",
    templateVersion: metadata.templateVersion || 0,
    renderData: metadata.renderData || {},
    mockupOutputRef: metadata.mockupOutputRef || null,
    finalPrice: Number((price * quantity).toFixed(2)),
    addedAt: row.created_at || metadata.addedAt || nowIso(),
    updatedAt: row.updated_at || metadata.updatedAt || row.created_at || nowIso(),
  };
}

function normalizeRemoteWishlistItem(row: any = {}) {
  const metadata = row.metadata || {};

  return {
    id: row.id,
    productId: row.product_id || metadata.productId || "",
    slug: row.product_slug || metadata.slug || "",
    title: row.product_title || metadata.title || "Untitled product",
    image: row.product_image || metadata.image || "/images/weddings.png",
    price: Number(row.price ?? metadata.price ?? 0),
    currency: normalizeCurrency(metadata.currency),
    quantity: 1,
    addedAt: row.created_at || metadata.addedAt || nowIso(),
    updatedAt: row.updated_at || metadata.updatedAt || row.created_at || nowIso(),
  };
}

function normalizeCartItem(product, quantity = 1, payload: any = {}) {
  const selectedOptions = payload.selectedOptions || payload.options || {};
  const customizationValues = payload.customizationValues || payload.customization || {};
  const uploadedFiles = payload.uploadedFiles || {};
  const previewImages = payload.previewImages || {};
  const previewData = payload.previewData || customizationValues;
  const price = Number(
    payload.unitPrice ?? getProductBasePrice(product) + getOptionsSurcharge(selectedOptions)
  );
  const safeQuantity = Math.max(1, Number(quantity || 1));
  // Customized items show their personalized front preview in the cart when one
  // is available; otherwise fall back to the product image.
  const image = previewImages.front || previewData.frontPreview || getProductImage(product);

  return {
    id: makeCartItemId(),
    productId: String(product?.id || ""),
    slug: product?.slug || "",
    title: product?.title || "Untitled product",
    image,
    price,
    currency: normalizeCurrency(payload.currency || product?.currency),
    quantity: safeQuantity,
    selectedOptions,
    options: selectedOptions,
    customizationValues,
    customization: customizationValues,
    uploadedFiles,
    previewData,
    previewImages,
    // Links the cart line back to the saved customization (Part 8).
    customizationId: payload.customizationId || "",
    templateId: payload.templateId || "",
    templateVersion: payload.templateVersion || 0,
    renderData: payload.renderData || {},
    mockupOutputRef: payload.mockupOutputRef || null,
    finalPrice: Number((price * safeQuantity).toFixed(2)),
    addedAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizeWishlistItem(product) {
  return {
    productId: String(product?.id || product?.productId || ""),
    slug: product?.slug || "",
    title: product?.title || "Untitled product",
    image: getProductImage(product),
    price: Number(product?.salePrice ?? product?.price ?? 0),
    currency: normalizeCurrency(product?.currency),
    quantity: 1,
    addedAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizeRecentlyViewedItem(product) {
  const currentTime = nowIso();

  return {
    id: String(product?.id || product?.productId || product?.slug || ""),
    productId: String(product?.id || product?.productId || ""),
    slug: product?.slug || "",
    title: product?.title || "Untitled product",
    image: getProductImage(product),
    price: Number(product?.salePrice ?? product?.price ?? 0),
    currency: normalizeCurrency(product?.currency),
    category: product?.category || "",
    productType: product?.productType || "",
    viewedAt: currentTime,
    updatedAt: currentTime,
  };
}

function normalizeRecentlyViewedList(items = []) {
  const seen = new Set();

  return items
    .filter((item) => item && (item.slug || item.productId || item.id))
    .map((item) => ({
      ...normalizeRecentlyViewedItem(item),
      viewedAt: item.viewedAt || item.updatedAt || item.addedAt || nowIso(),
    }))
    .sort((a, b) => String(b.viewedAt || "").localeCompare(String(a.viewedAt || "")))
    .filter((item) => {
      const key = item.slug || item.productId || item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

async function readCart(user) {
  const userId = requireUser(user);
  const cached = getCachedRemote("cart", userId);
  if (cached) return cached;

  const inflight = remoteInflight.cart.get(userId);
  if (inflight) return inflight;

  const supabase = createClient();
  const request = Promise.resolve(
    supabase.from("cart_items").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
  )
    .then(({ data, error }) => {
      if (error) {
        warnRemoteReadOnce("cart", error);
        setCachedRemote("cart", userId, []);
        return [];
      }

      const items = (data || []).map(normalizeRemoteCartItem);
      setCachedRemote("cart", userId, items);
      return items;
    })
    .finally(() => {
      remoteInflight.cart.delete(userId);
    });

  remoteInflight.cart.set(userId, request);
  return request;
}

async function readWishlist(user) {
  const userId = requireUser(user);
  const cached = getCachedRemote("wishlist", userId);
  if (cached) return cached;

  const inflight = remoteInflight.wishlist.get(userId);
  if (inflight) return inflight;

  const supabase = createClient();
  const request = Promise.resolve(
    supabase.from("wishlist_items").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
  )
    .then(({ data, error }) => {
      if (error) {
        warnRemoteReadOnce("wishlist", error);
        setCachedRemote("wishlist", userId, []);
        return [];
      }

      const items = (data || []).map(normalizeRemoteWishlistItem);
      setCachedRemote("wishlist", userId, items);
      return items;
    })
    .finally(() => {
      remoteInflight.wishlist.delete(userId);
    });

  remoteInflight.wishlist.set(userId, request);
  return request;
}

function subscribeLocal(key, callback) {
  if (!canUseStorage()) {
    callback([]);
    return () => {};
  }

  callback(safeRead(key, []));

  const handler = (event) => {
    if (!event?.detail?.key || event.detail.key === key) callback(safeRead(key, []));
  };

  const storageHandler = (event) => {
    if (event.key === key) callback(safeRead(key, []));
  };

  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", storageHandler);
  };
}

function subscribeRemote(user, callback, loader, eventKey) {
  if (!user) {
    callback([]);
    return () => {};
  }

  let active = true;

  async function load() {
    try {
      const items = await loader(user);
      if (active) callback(items);
    } catch (error) {
      warnRemoteReadOnce(eventKey, error);
      if (active) callback([]);
    }
  }

  load();

  const handler = (event) => {
    if (!event?.detail?.key || event.detail.key === eventKey) load();
  };

  window.addEventListener(EVENT_NAME, handler);

  return () => {
    active = false;
    window.removeEventListener(EVENT_NAME, handler);
  };
}

export function openCustomerLogin() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("husnalogy-open-auth", { detail: { mode: "login" } }));
}

export function subscribeToUserCart(user, callback) {
  return subscribeRemote(user, callback, readCart, "cart");
}

export function subscribeToUserWishlist(user, callback) {
  return subscribeRemote(user, callback, readWishlist, "wishlist");
}

export async function getUserCart(user) {
  if (!user) return [];
  return readCart(user);
}

export async function addToCart(user, product, quantity = 1, payload = {}) {
  const userId = requireUser(user);
  const item = normalizeCartItem(product, quantity, payload);
  const supabase = createClient();
  const { data, error } = await supabase
    .from("cart_items")
    .insert({
      user_id: userId,
      product_id: item.productId,
      product_slug: item.slug,
      product_title: item.title,
      product_image: item.image,
      quantity: item.quantity,
      unit_price: item.price,
      metadata: item,
    })
    .select("*")
    .single();

  if (error) throw error;
  invalidateRemoteCache("cart", userId);
  dispatchCommerceChange("cart");
  return normalizeRemoteCartItem(data);
}

export async function updateCartQuantity(user, cartItemId, quantity) {
  const userId = requireUser(user);
  const safeQuantity = Math.max(1, Number(quantity || 1));
  const supabase = createClient();
  const current = (await getUserCart(user)).find((item) => String(item.id) === String(cartItemId));
  const metadata = {
    ...(current || {}),
    quantity: safeQuantity,
    finalPrice: Number((Number(current?.price || 0) * safeQuantity).toFixed(2)),
    updatedAt: nowIso(),
  };
  const { error } = await supabase
    .from("cart_items")
    .update({ quantity: safeQuantity, metadata, updated_at: nowIso() })
    .eq("id", cartItemId);

  if (error) throw error;
  invalidateRemoteCache("cart", userId);
  dispatchCommerceChange("cart");
}

export async function updateCartItem(user, cartItemId, patch: any = {}) {
  const userId = requireUser(user);
  const current = (await getUserCart(user)).find((item) => String(item.id) === String(cartItemId));
  const next = { ...(current || {}), ...patch, updatedAt: nowIso() };
  const quantity = Math.max(1, Number(next.quantity || 1));
  const price = Number(next.price || 0);
  const supabase = createClient();
  const { error } = await supabase
    .from("cart_items")
    .update({
      quantity,
      unit_price: price,
      metadata: { ...next, quantity, price, finalPrice: Number((price * quantity).toFixed(2)) },
      updated_at: nowIso(),
    })
    .eq("id", cartItemId);

  if (error) throw error;
  invalidateRemoteCache("cart", userId);
  dispatchCommerceChange("cart");
}

export async function increaseCartQuantity(user, cartItemId, amount = 1) {
  const current = (await getUserCart(user)).find((entry) => String(entry.id) === String(cartItemId));
  await updateCartQuantity(user, cartItemId, Number(current?.quantity || 1) + amount);
}

export async function removeFromCart(user, cartItemId) {
  const userId = requireUser(user);
  const supabase = createClient();
  const { error } = await supabase.from("cart_items").delete().eq("id", cartItemId);
  if (error) throw error;
  invalidateRemoteCache("cart", userId);
  dispatchCommerceChange("cart");
}

export async function clearCart(user) {
  const userId = requireUser(user);
  const supabase = createClient();
  const { error } = await supabase.from("cart_items").delete().eq("user_id", userId);
  if (error) throw error;
  invalidateRemoteCache("cart", userId);
  dispatchCommerceChange("cart");
}

export async function getUserWishlist(user) {
  if (!user) return [];
  return readWishlist(user);
}

export async function addToWishlist(user, product) {
  const userId = requireUser(user);
  const item = normalizeWishlistItem(product);
  const supabase = createClient();
  const { data, error } = await supabase
    .from("wishlist_items")
    .upsert(
      {
        user_id: userId,
        product_id: item.productId,
        product_slug: item.slug,
        product_title: item.title,
        product_image: item.image,
        price: item.price,
        metadata: item,
      },
      { onConflict: "user_id,product_id" },
    )
    .select("*")
    .single();

  if (error) throw error;
  invalidateRemoteCache("wishlist", userId);
  dispatchCommerceChange("wishlist");
  return normalizeRemoteWishlistItem(data);
}

export async function removeFromWishlist(user, productId) {
  const userId = requireUser(user);
  const supabase = createClient();
  const value = String(productId || "");
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  let query = supabase.from("wishlist_items").delete();
  query = uuidLike ? query.or(`id.eq.${value},product_id.eq.${value}`) : query.eq("product_id", value);
  const { error } = await query;

  if (error) throw error;
  invalidateRemoteCache("wishlist", userId);
  dispatchCommerceChange("wishlist");
}

export async function isProductWishlisted(user, productId) {
  if (!user) return false;
  const wishlist = await getUserWishlist(user);
  return wishlist.some((item) => String(item.productId || item.id) === String(productId));
}

export function clearCustomerCommerceData() {
  invalidateRemoteCache("cart");
  invalidateRemoteCache("wishlist");
  dispatchCommerceChange();
}

export function getProductBasePrice(product) {
  return Number(product?.salePrice ?? product?.price ?? 0);
}

export function parseOptionSurcharge(label) {
  const match = String(label || "").match(/\+\s*(?:৳|\$|BDT\s*)?\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : 0;
}

export function getOptionsSurcharge(selectedOptions: any = {}) {
  return Object.values(selectedOptions).reduce<number>(
    (sum, value) => sum + (typeof value === "string" ? parseOptionSurcharge(value) : 0),
    0
  );
}

export function subscribeToRecentlyViewed(callback) {
  return subscribeLocal(RECENT_KEY, (items) => callback(normalizeRecentlyViewedList(items)));
}

export function addRecentlyViewed(product) {
  if (!product?.id && !product?.slug) return;

  const item = normalizeRecentlyViewedItem(product);
  const current = normalizeRecentlyViewedList(safeRead(RECENT_KEY, [])).filter((entry) => {
    const sameSlug = item.slug && entry.slug === item.slug;
    const sameProductId = item.productId && entry.productId === item.productId;
    return !sameSlug && !sameProductId;
  });

  safeWrite(RECENT_KEY, normalizeRecentlyViewedList([item, ...current]));
}

export function subscribeToSavedAddresses(callback) {
  return subscribeLocal(ADDRESS_KEY, callback);
}

export function saveCustomerAddress(address) {
  const current = safeRead(ADDRESS_KEY, []);
  const item = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `address_${Date.now()}`,
    ...address,
    createdAt: nowIso(),
  };
  safeWrite(ADDRESS_KEY, [item, ...current].slice(0, 10));
  return item;
}

export function updateCustomerAddress(id, patch = {}) {
  const next = safeRead(ADDRESS_KEY, []).map((item) =>
    String(item.id) === String(id) ? { ...item, ...patch, updatedAt: nowIso() } : item
  );
  safeWrite(ADDRESS_KEY, next);
}

export function setDefaultAddress(id) {
  const next = safeRead(ADDRESS_KEY, []).map((item) => ({
    ...item,
    isDefault: String(item.id) === String(id),
  }));
  safeWrite(ADDRESS_KEY, next);
}

export function removeCustomerAddress(id) {
  safeWrite(
    ADDRESS_KEY,
    safeRead(ADDRESS_KEY, []).filter((item) => String(item.id) !== String(id))
  );
}

export function getLocalProfile() {
  const value = safeRead(PROFILE_KEY, {});
  return value && !Array.isArray(value) ? value : {};
}

export function saveLocalProfile(patch = {}) {
  const current = getLocalProfile();
  safeWrite(PROFILE_KEY, { ...current, ...patch });
}

export function getCartTotals(items = []) {
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0
  );
  const deliveryCharge = 0;
  const total = subtotal + deliveryCharge;

  return {
    subtotal: Number(subtotal.toFixed(2)),
    deliveryCharge: Number(deliveryCharge.toFixed(2)),
    total: Number(total.toFixed(2)),
    currency: normalizeCurrency(items[0]?.currency),
  };
}

function safeFileName(name) {
  const original = String(name || "file");
  const parts = original.split(".");
  const ext = parts.length > 1 ? `.${parts.pop()}` : "";
  const base = parts
    .join(".")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${base || "file"}${ext.toLowerCase()}`;
}

function validateCustomerUpload(file) {
  if (!file) return;

  if (file.size > MAX_CUSTOMER_UPLOAD_SIZE) {
    throw new Error("Upload files must be 25MB or smaller.");
  }

  if (file.type && !CUSTOMER_UPLOAD_TYPES.has(file.type)) {
    throw new Error("Upload file type is not allowed. Use JPG, PNG, WebP, GIF, or PDF.");
  }
}

export async function uploadCustomerFile(user, file, folder = "product-customization") {
  const userId = requireUser(user);
  if (!file) return null;
  validateCustomerUpload(file);

  const supabase = createClient();
  const fileName = `${Date.now()}-${safeFileName(file.name)}`;
  const path = `${userId}/${folder}/${fileName}`;
  const { error } = await supabase.storage.from("customer-uploads").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (error) throw error;

  const { data } = await supabase.storage.from("customer-uploads").createSignedUrl(path, 60 * 60);

  await supabase.from("customer_uploads").insert({
    user_id: userId,
    bucket: "customer-uploads",
    path,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size || null,
    metadata: {
      folder,
    },
  });

  return {
    bucket: "customer-uploads",
    path,
    name: file.name,
    type: file.type,
    size: file.size,
    signedUrl: data?.signedUrl || "",
  };
}

export function subscribeToLocalOrders(callback) {
  return subscribeLocal(ORDER_KEY, callback);
}

export function saveLocalOrder(order) {
  const current = safeRead(ORDER_KEY, []);
  const item = {
    id: order?.id || `local_order_${Date.now()}`,
    ...order,
    createdAt: order?.createdAt || nowIso(),
  };
  safeWrite(ORDER_KEY, [item, ...current].slice(0, 50));
  return item;
}
