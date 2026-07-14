import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

nextEnv.loadEnvConfig(process.cwd());

const target = String(process.env.CUSTOMIZER_SEED_TARGET || "").toLowerCase();
if (!new Set(["local", "staging"]).has(target)) {
  throw new Error("Refusing to seed. Set CUSTOMIZER_SEED_TARGET=local or staging. Production is never an accepted target.");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const parsedUrl = new URL(url);
const projectRef = parsedUrl.hostname.split(".")[0];
if (target === "local" && !/^(localhost|127\.0\.0\.1)$/.test(parsedUrl.hostname)) {
  throw new Error(`Refusing local seed against remote host ${parsedUrl.hostname}.`);
}
if (target === "staging" && process.env.CUSTOMIZER_SEED_CONFIRM_PROJECT_REF !== projectRef) {
  throw new Error(`Refusing staging seed. Set CUSTOMIZER_SEED_CONFIRM_PROJECT_REF=${projectRef} after verifying this is the staging project.`);
}
if (process.env.CUSTOMIZER_SEED_ALLOW_PRODUCTION === "I_UNDERSTAND") {
  throw new Error("Production seeding remains disabled by design; create a dedicated staging project instead.");
}

const password = process.env.CUSTOMIZER_SEED_PASSWORD || "";
if (password.length < 12) throw new Error("CUSTOMIZER_SEED_PASSWORD must contain at least 12 characters.");
const emailPrefix = String(process.env.CUSTOMIZER_SEED_EMAIL_PREFIX || "customizer-e2e").replace(/[^a-z0-9._-]/gi, "");
const domain = process.env.CUSTOMIZER_SEED_EMAIL_DOMAIN || "example.test";
const emails = {
  customerA: `${emailPrefix}+customer-a@${domain}`,
  customerB: `${emailPrefix}+customer-b@${domain}`,
  admin: `${emailPrefix}+admin@${domain}`,
};

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureUser(email, role, fullName) {
  let page = 1;
  let user = null;
  while (!user && page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase()) || null;
    if (data.users.length < 100) break;
    page += 1;
  }
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (error) throw error;
    user = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error) throw error;
    user = data.user;
  }
  const { error: profileError } = await supabase.from("profiles").upsert({ id: user.id, email, full_name: fullName, role, metadata: { e2eSeed: true, seedTarget: target }, updated_at: new Date().toISOString() });
  if (profileError) throw profileError;
  return user;
}

function gridSlots() {
  return [
    ["slot_1_1", 0, 0], ["slot_1_2", 0.5, 0], ["slot_2_1", 0, 0.5], ["slot_2_2", 0.5, 0.5],
  ].map(([id, x, y]) => ({ id, x, y, width: 0.5, height: 0.5, assetId: "", src: "", transform: { assetId: "", zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 }, permissions: { replace: true, crop: true }, required: false, mask: { kind: "rectangle" }, metadata: {} }));
}

const customerA = await ensureUser(emails.customerA, "customer", "Customizer E2E Customer A");
const customerB = await ensureUser(emails.customerB, "customer", "Customizer E2E Customer B");
const admin = await ensureUser(emails.admin, "admin", "Customizer E2E Admin");

const productId = "e2e-customizer-v2-product";
const slug = "e2e-customizer-v2";
const fixtureUrl = "/images/weddings/invitations/collection1.png";
const { error: productError } = await supabase.from("products").upsert({
  id: productId,
  slug,
  title: "Customizer V2 Staging Invitation",
  category: "E2E",
  status: "active",
  visibility: "direct",
  price: 1200,
  thumbnail: fixtureUrl,
  description: "Dedicated automated acceptance fixture. Do not use for customer orders.",
  published_at: new Date().toISOString(),
  data: { customizeEnabled: true, currency: "BDT", e2eSeed: true, productType: "flat-card", mockups: [fixtureUrl] },
  updated_at: new Date().toISOString(),
});
if (productError) throw productError;

const permissions = { editContent: true, editStyle: true, changeFont: true, changeFontSize: true, changeColor: true, changeAlignment: true, changeLetterSpacing: true, changeLineHeight: true, changeFontWeight: true, changeFontStyle: true, move: true, resize: true, rotate: true, duplicate: false, changeOpacity: true, replaceImage: true, cropImage: true, zoomImage: true, repositionImage: true, flipImage: true, rotateImage: true };
const pages = [
  { id: "front", label: "Front", enabled: true, backgroundColor: "#F8F6F1", allowCustomerText: true },
  { id: "back", label: "Back", enabled: true, backgroundColor: "#ffffff", allowCustomerText: true },
];
const fields = [
  { id: "guest_name", label: "Guest name", type: "text", required: true, defaultValue: "Alex & Jordan", placeholder: "Names", customerVisible: true },
  { id: "upload_photo", label: "Feature photo", type: "image", required: false, defaultValue: "", customerVisible: true },
];
const layers = [
  { id: "title_layer", name: "Guest name", page: "front", type: "text", fieldId: "guest_name", customerEditable: true, customerPermissions: permissions, text: "Alex & Jordan", x: 750, y: 260, width: 1100, height: 130, rotation: 0, zIndex: 10, opacity: 1, textStyle: { fontFamily: "Cormorant Garamond", fontSize: 72, fontWeight: 600, color: "#303839", textAlign: "center", lineHeight: 1.15, letterSpacing: 0 } },
  { id: "photo_layer", name: "Feature photo", page: "front", type: "image", fieldId: "upload_photo", customerEditable: true, customerPermissions: permissions, src: "", x: 750, y: 720, width: 900, height: 620, rotation: 0, zIndex: 11, opacity: 1 },
  { id: "grid_layer", name: "Photo grid", page: "front", type: "grid", customerEditable: true, customerPermissions: permissions, columns: 2, rows: 2, slots: gridSlots(), x: 750, y: 1420, width: 1080, height: 700, rotation: 0, zIndex: 12, opacity: 1, gap: 18, padding: 0, cornerRadius: 0, backgroundColor: "#ffffff" },
  { id: "back_text", name: "Back message", page: "back", type: "text", customerEditable: false, text: "Thank you", x: 750, y: 1050, width: 1000, height: 140, rotation: 0, zIndex: 10, opacity: 1, textStyle: { fontFamily: "Cormorant Garamond", fontSize: 70, fontWeight: 500, color: "#303839", textAlign: "center", lineHeight: 1.15, letterSpacing: 0 } },
];
const settings = { templateName: "Customizer V2 E2E", allowCustomerText: true, allowCustomerUploads: true, allowCustomerElements: true, requireApprovalCheckbox: true, protectedPreview: true, autosave: true, featureFlags: {} };
const { data: template, error: templateError } = await supabase.from("product_customizer_templates").upsert({
  product_id: productId, enabled: true, version: 1, engine: "svg", canvas_width_px: 1500, canvas_height_px: 2100,
  card_width_in: 5, card_height_in: 7, dpi: 300, orientation: "portrait", default_page: "front", pages, fields, layers,
  safe_area: { top: 90, right: 90, bottom: 90, left: 90 }, bleed: { top: 30, right: 30, bottom: 30, left: 30 }, assets: {}, settings,
  updated_at: new Date().toISOString(),
}, { onConflict: "product_id" }).select("*").single();
if (templateError) throw templateError;

const document = { id: template.id, productId, enabled: true, version: 1, engine: "svg", canvasWidthPx: 1500, canvasHeightPx: 2100, cardWidthIn: 5, cardHeightIn: 7, dpi: 300, orientation: "portrait", defaultPage: "front", pages, fields, layers, safeArea: { top: 90, right: 90, bottom: 90, left: 90 }, bleed: { top: 30, right: 30, bottom: 30, left: 30 }, assets: {}, settings };
const { error: versionError } = await supabase.from("customizer_template_versions").upsert({ template_id: template.id, product_id: productId, version: 1, schema_version: 3, engine_version: "husnalogy-2.2.0", document, font_dependencies: ["Cormorant Garamond", "Inter"], published_by: admin.id, notes: "Automated staging acceptance fixture" }, { onConflict: "template_id,version" });
if (versionError) throw versionError;

const fixturePath = join(process.cwd(), "public", "images", "weddings", "invitations", "collection1.png");
const fixture = await readFile(fixturePath);
const checksum = createHash("sha256").update(fixture).digest("hex");
const assetPath = `${customerA.id}/e2e/${checksum}.png`;
const { error: uploadError } = await supabase.storage.from("customer-uploads").upload(assetPath, fixture, { contentType: "image/png", upsert: true });
if (uploadError) throw uploadError;
const { data: asset, error: assetError } = await supabase.from("customer_asset_library").upsert({ user_id: customerA.id, bucket: "customer-uploads", path: assetPath, thumbnail_path: assetPath, editor_path: assetPath, file_name: "collection1.png", mime_type: "image/png", size_bytes: fixture.byteLength, width: 1200, height: 1200, checksum, status: "ready", metadata: { e2eSeed: true } }, { onConflict: "user_id,path" }).select("*").single();
if (assetError) throw assetError;
const assetReference = { version: 1, assetId: asset.id, ownerId: customerA.id, bucket: "customer-uploads", storagePath: assetPath, editorStoragePath: assetPath, thumbnailStoragePath: assetPath, originalFileName: "collection1.png", mimeType: "image/png", fileSize: fixture.byteLength, width: 1200, height: 1200, checksum, createdAt: asset.created_at };
const values = { guest_name: "Seeded Guest", upload_photo: { assetReference, assetId: asset.id, ownerId: customerA.id, bucket: "customer-uploads", path: assetPath, originalPath: assetPath, fileName: "collection1.png", mimeType: "image/png", width: 1200, height: 1200 } };
const editorState = { layerOverrides: { grid_layer: { gridSlots: { slot_1_1: { assetReference, assetId: asset.id, ownerId: customerA.id, bucket: "customer-uploads", path: assetPath, originalPath: assetPath, transform: { assetId: asset.id, zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 } } } } }, userLayers: [] };
const { data: existingCustomization } = await supabase.from("product_customizations").select("id").eq("user_id", customerA.id).eq("product_id", productId).in("status", ["draft", "in_cart"]).order("updated_at", { ascending: false }).limit(1).maybeSingle();
const customizationRow = { ...(existingCustomization?.id ? { id: existingCustomization.id } : {}), user_id: customerA.id, product_id: productId, template_id: template.id, template_version: 1, status: "draft", values, uploaded_files: { upload_photo: values.upload_photo }, selected_options: { quantity: 1 }, preview_images: {}, render_data: { editorState, activePage: "front" }, print_files: {}, asset_references: [assetReference], updated_at: new Date().toISOString() };
const { data: customization, error: customizationError } = await supabase.from("product_customizations").upsert(customizationRow, { onConflict: "id" }).select("*").single();
if (customizationError) throw customizationError;

const flags = ["customizer_v2", "customizer_v2_grids", "customizer_v2_groups", "customizer_v2_mockups", "customizer_v2_perspective_mockups", "customizer_v2_server_rendering", "customizer_v2_print_pdf"];
const { error: flagError } = await supabase.from("customizer_feature_flags").upsert(flags.map((flag) => ({ product_id: productId, product_type: null, flag, enabled: true, scope: "product", scope_key: productId, environments: ["development", "preview", "production", "test"], rollout_percentage: 100, admin_only: false })), { onConflict: "scope,scope_key,flag" });
if (flagError) throw flagError;

const mockup = {
  productId, productType: "flat-card", name: "E2E perspective card", width: 1200, height: 900, version: 1, status: "draft",
  views: [
    { id: "front", name: "Front perspective", baseImageUrl: fixtureUrl, width: 1200, height: 900, sortOrder: 0, requiresTransparency: false, artworkAreas: [{ id: "front-art", sourcePageId: "front", x: 260, y: 100, width: 650, height: 700, rotation: 0, warpType: "perspective", perspectivePoints: { topLeft: { x: 300, y: 110 }, topRight: { x: 900, y: 155 }, bottomRight: { x: 960, y: 790 }, bottomLeft: { x: 235, y: 745 } }, opacity: 1, sortOrder: 0, visible: true }], overlays: [] },
    { id: "back", name: "Back", baseImageUrl: fixtureUrl, width: 1200, height: 900, sortOrder: 1, requiresTransparency: false, artworkAreas: [{ id: "back-art", sourcePageId: "back", x: 260, y: 100, width: 650, height: 700, rotation: -2, warpType: "none", opacity: 1, sortOrder: 0, visible: true }], overlays: [] },
  ],
};
const { error: mockupError } = await supabase.rpc("upsert_customizer_mockup", { p_product_id: productId, p_payload: mockup, p_publish: false });
if (mockupError) throw mockupError;
const { error: publishMockupError } = await supabase.rpc("upsert_customizer_mockup", { p_product_id: productId, p_payload: mockup, p_publish: true });
if (publishMockupError) throw publishMockupError;

const appBaseUrl = (process.env.E2E_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const manifest = {
  version: 1,
  target,
  projectRef,
  seededAt: new Date().toISOString(),
  productId,
  templateId: template.id,
  customizationAId: customization.id,
  customerAssetReference: assetReference,
  customerAId: customerA.id,
  customerBId: customerB.id,
  adminId: admin.id,
  customerAEmail: emails.customerA,
  customerBEmail: emails.customerB,
  adminEmail: emails.admin,
  password,
  customizerUrl: `/products/${slug}/personalize?customizationId=${customization.id}`,
  adminProductUrl: "/admin/dashboard?section=Products",
  baseUrl: appBaseUrl,
};
await writeFile(join(process.cwd(), ".customizer-e2e.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({ ok: true, target, projectRef, productId, customizationId: customization.id, manifest: ".customizer-e2e.json" }, null, 2));
