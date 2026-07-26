import { nowIso } from "@/lib/core/id";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { cleanOptionalString, cleanString, isValidEmail, normalizeBoolean, normalizePrice } from "@/lib/validation";

const SETTINGS_ID = "global";

export const DEFAULT_SETTINGS = {
  store: {
    name: "Husnalogy",
    tagline: "Timeless Invitations & Gifts",
    email: "hello@husnalogy.com",
    phone: "+880 1712 345678",
    address: "House 12, Road 5, Dhanmondi\nDhaka 1205, Bangladesh",
  },
  branding: {
    logoUrl: "/Brand Kit/Logo-5.png",
    faviconUrl: "/Brand Kit/Logo-1.png",
  },
  hero: {
    collectionId: "",
  },
  adminProfile: {
    fullName: "Admin User",
    email: "admin@husnalogy.com",
    role: "Administrator",
    photoUrl: "",
  },
  preferences: {
    allowProductReviews: true,
    newsletterEnabled: true,
    maintenanceMode: false,
  },
  payment: {
    cashOnDeliveryEnabled: true,
    sslCommerzEnabled: false,
    sslCommerzMode: "test",
    sslCommerzStoreId: "",
    sslCommerzStorePassword: "",
    sslCommerzApiKey: "",
  },
  shipping: {
    digitalProductsNoShipping: true,
    methods: [
      { id: "inside-dhaka", name: "Inside Dhaka", area: "Dhaka city", fee: 20, eta: "1-2 business days", enabled: true },
      { id: "outside-dhaka", name: "Outside Dhaka", area: "Bangladesh", fee: 80, eta: "3-5 business days", enabled: true },
    ],
  },
  email: {
    senderName: "Husnalogy",
    senderEmail: "hello@husnalogy.com",
    provider: "",
    smtpHost: "",
    smtpPort: "",
    smtpUser: "",
    smtpPassword: "",
    orderConfirmationEmails: true,
    designRequestUpdateEmails: true,
    newsletterEmails: true,
  },
  security: {
    twoStepVerificationEnabled: false,
    twoStepVerificationSupported: false,
    sessionTimeoutMinutes: 1440,
    allowedRoles: ["Administrator"],
  },
  notifications: {
    newOrders: true,
    newDesignRequests: true,
    newContactMessages: true,
    newReviews: true,
    paymentUpdates: true,
    lowStockProducts: true,
    newsletterSubscribers: true,
  },
  backup: {
    lastExportAt: "",
  },
  updatedAt: "",
};

function mergeSettings(input: any = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    store: { ...DEFAULT_SETTINGS.store, ...(input.store || {}) },
    branding: { ...DEFAULT_SETTINGS.branding, ...(input.branding || {}) },
    hero: { ...DEFAULT_SETTINGS.hero, ...(input.hero || {}) },
    adminProfile: { ...DEFAULT_SETTINGS.adminProfile, ...(input.adminProfile || {}) },
    preferences: { ...DEFAULT_SETTINGS.preferences, ...(input.preferences || {}) },
    payment: { ...DEFAULT_SETTINGS.payment, ...(input.payment || {}) },
    shipping: {
      ...DEFAULT_SETTINGS.shipping,
      ...(input.shipping || {}),
      methods: Array.isArray(input.shipping?.methods) ? input.shipping.methods : DEFAULT_SETTINGS.shipping.methods,
    },
    email: { ...DEFAULT_SETTINGS.email, ...(input.email || {}) },
    security: { ...DEFAULT_SETTINGS.security, ...(input.security || {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(input.notifications || {}) },
    backup: { ...DEFAULT_SETTINGS.backup, ...(input.backup || {}) },
  };
}

function maskSecret(value) {
  return value ? "Saved securely" : "";
}

function sanitizeShippingMethod(method: any = {}, index = 0) {
  const name = cleanString(method.name) || `Shipping Method ${index + 1}`;
  return {
    id: cleanOptionalString(method.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `method-${index + 1}`,
    name,
    area: cleanOptionalString(method.area),
    fee: normalizePrice(method.fee) ?? 0,
    eta: cleanOptionalString(method.eta),
    enabled: normalizeBoolean(method.enabled ?? true),
  };
}

export function sanitizeSettings(input: any = {}, existing: any = DEFAULT_SETTINGS) {
  const current = mergeSettings(existing);
  const merged = mergeSettings({
    ...current,
    ...input,
    store: { ...current.store, ...(input.store || {}) },
    branding: { ...current.branding, ...(input.branding || {}) },
    hero: { ...current.hero, ...(input.hero || {}) },
    adminProfile: { ...current.adminProfile, ...(input.adminProfile || {}) },
    preferences: { ...current.preferences, ...(input.preferences || {}) },
    payment: { ...current.payment, ...(input.payment || {}) },
    shipping: { ...current.shipping, ...(input.shipping || {}) },
    email: { ...current.email, ...(input.email || {}) },
    security: { ...current.security, ...(input.security || {}) },
    notifications: { ...current.notifications, ...(input.notifications || {}) },
    backup: { ...current.backup, ...(input.backup || {}) },
  });
  const errors: any = {};

  const store = {
    name: cleanString(merged.store.name),
    tagline: cleanString(merged.store.tagline),
    email: cleanString(merged.store.email).toLowerCase(),
    phone: cleanString(merged.store.phone),
    address: cleanString(merged.store.address),
  };

  if (!store.name) errors.storeName = "Store name is required.";
  if (!store.tagline) errors.storeTagline = "Store tagline is required.";
  if (!store.email || !isValidEmail(store.email)) errors.storeEmail = "A valid store email is required.";
  if (!store.phone) errors.storePhone = "Phone number is required.";
  if (!store.address) errors.storeAddress = "Store address is required.";

  const adminProfile = {
    fullName: cleanString(merged.adminProfile.fullName) || DEFAULT_SETTINGS.adminProfile.fullName,
    email: cleanString(merged.adminProfile.email).toLowerCase() || DEFAULT_SETTINGS.adminProfile.email,
    role: cleanString(merged.adminProfile.role) || DEFAULT_SETTINGS.adminProfile.role,
    photoUrl: cleanOptionalString(merged.adminProfile.photoUrl),
  };

  if (!isValidEmail(adminProfile.email)) errors.adminEmail = "A valid admin email is required.";

  const payment = {
    cashOnDeliveryEnabled: normalizeBoolean(merged.payment.cashOnDeliveryEnabled),
    sslCommerzEnabled: normalizeBoolean(merged.payment.sslCommerzEnabled),
    sslCommerzMode: ["live", "test"].includes(merged.payment.sslCommerzMode) ? merged.payment.sslCommerzMode : "test",
    sslCommerzStoreId: cleanOptionalString(merged.payment.sslCommerzStoreId),
    sslCommerzStorePassword:
      merged.payment.sslCommerzStorePassword === "__KEEP__"
        ? cleanOptionalString(existing.payment?.sslCommerzStorePassword)
        : cleanOptionalString(merged.payment.sslCommerzStorePassword),
    sslCommerzApiKey:
      merged.payment.sslCommerzApiKey === "__KEEP__"
        ? cleanOptionalString(existing.payment?.sslCommerzApiKey)
        : cleanOptionalString(merged.payment.sslCommerzApiKey),
  };

  const email = {
    senderName: cleanString(merged.email.senderName) || store.name,
    senderEmail: cleanString(merged.email.senderEmail).toLowerCase() || store.email,
    provider: cleanOptionalString(merged.email.provider),
    smtpHost: cleanOptionalString(merged.email.smtpHost),
    smtpPort: cleanOptionalString(merged.email.smtpPort),
    smtpUser: cleanOptionalString(merged.email.smtpUser),
    smtpPassword:
      merged.email.smtpPassword === "__KEEP__"
        ? cleanOptionalString(existing.email?.smtpPassword)
        : cleanOptionalString(merged.email.smtpPassword),
    orderConfirmationEmails: normalizeBoolean(merged.email.orderConfirmationEmails),
    designRequestUpdateEmails: normalizeBoolean(merged.email.designRequestUpdateEmails),
    newsletterEmails: normalizeBoolean(merged.email.newsletterEmails),
  };

  if (!isValidEmail(email.senderEmail)) errors.senderEmail = "A valid sender email is required.";

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    settings: {
      ...merged,
      store,
      branding: {
        logoUrl: cleanOptionalString(merged.branding.logoUrl),
        faviconUrl: cleanOptionalString(merged.branding.faviconUrl),
      },
      hero: {
        collectionId: cleanOptionalString(merged.hero.collectionId),
      },
      adminProfile,
      preferences: {
        allowProductReviews: normalizeBoolean(merged.preferences.allowProductReviews),
        newsletterEnabled: normalizeBoolean(merged.preferences.newsletterEnabled),
        maintenanceMode: normalizeBoolean(merged.preferences.maintenanceMode),
      },
      payment,
      shipping: {
        digitalProductsNoShipping: normalizeBoolean(merged.shipping.digitalProductsNoShipping),
        methods: (Array.isArray(merged.shipping.methods) ? merged.shipping.methods : [])
          .map(sanitizeShippingMethod)
          .filter((method) => method.name),
      },
      email,
      security: {
        twoStepVerificationEnabled:
          normalizeBoolean(merged.security.twoStepVerificationSupported) &&
          normalizeBoolean(merged.security.twoStepVerificationEnabled),
        twoStepVerificationSupported: normalizeBoolean(merged.security.twoStepVerificationSupported),
        sessionTimeoutMinutes: Math.max(15, Number(merged.security.sessionTimeoutMinutes || 1440)),
        allowedRoles: Array.isArray(merged.security.allowedRoles) ? merged.security.allowedRoles : ["Administrator"],
      },
      notifications: Object.fromEntries(
        Object.entries(DEFAULT_SETTINGS.notifications).map(([key]) => [key, normalizeBoolean(merged.notifications[key])])
      ),
      backup: {
        lastExportAt: cleanOptionalString(merged.backup.lastExportAt),
      },
      updatedAt: nowIso(),
    },
  };
}

export async function getSettings() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("site_settings")
    .select("settings")
    .eq("id", SETTINGS_ID)
    .maybeSingle();

  if (error) throw error;
  return mergeSettings(data?.settings || DEFAULT_SETTINGS);
}

export async function updateSettings(input: any = {}) {
  const existing = await getSettings();
  const result = sanitizeSettings(input, existing);
  if (!result.ok) return result;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("site_settings").upsert({
    id: SETTINGS_ID,
    settings: result.settings,
    updated_at: result.settings.updatedAt,
  });

  if (error) throw error;
  return { ok: true, settings: result.settings };
}

export function toAdminSettings(settings) {
  const merged = mergeSettings(settings);
  return {
    ...merged,
    payment: {
      ...merged.payment,
      sslCommerzStorePassword: maskSecret(merged.payment.sslCommerzStorePassword),
      sslCommerzApiKey: maskSecret(merged.payment.sslCommerzApiKey),
      hasSslCommerzStorePassword: Boolean(merged.payment.sslCommerzStorePassword),
      hasSslCommerzApiKey: Boolean(merged.payment.sslCommerzApiKey),
    },
    email: {
      ...merged.email,
      smtpPassword: maskSecret(merged.email.smtpPassword),
      hasSmtpPassword: Boolean(merged.email.smtpPassword),
    },
  };
}

export function toPublicSettings(settings) {
  const merged = mergeSettings(settings);
  return {
    store: merged.store,
    branding: merged.branding,
    preferences: {
      maintenanceMode: Boolean(merged.preferences.maintenanceMode),
      newsletterEnabled: Boolean(merged.preferences.newsletterEnabled),
      allowProductReviews: Boolean(merged.preferences.allowProductReviews),
    },
  };
}
