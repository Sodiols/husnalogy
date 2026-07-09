// Shared mapping for the product_customizations table (Part 7).
import { cleanOptionalString, cleanString } from "@/lib/validation";

export const CUSTOMIZATION_STATUSES = new Set(["draft", "in_cart", "ordered", "archived"]);

function asObject(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function withActivePage(renderData: any, input: any = {}) {
  const next = { ...asObject(renderData) };
  const activePage = cleanOptionalString(input.activePage);
  if (activePage) next.activePage = activePage;
  return next;
}

export function customizationFromRow(row: any = {}): any {
  return {
    id: row.id,
    userId: row.user_id || "",
    productId: row.product_id || "",
    templateId: row.template_id || "",
    cartItemId: row.cart_item_id || "",
    orderId: row.order_id || "",
    templateVersion: Number(row.template_version || 1),
    status: row.status || "draft",
    values: asObject(row.values),
    uploadedFiles: asObject(row.uploaded_files),
    selectedOptions: asObject(row.selected_options),
    previewImages: asObject(row.preview_images),
    renderData: asObject(row.render_data),
    printFiles: asObject(row.print_files),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Build an insert row from a client payload. user_id is supplied by the route
// (from the authenticated session), never trusted from the body.
export function customizationInsertRow(userId: string, input: any = {}): any {
  const status = cleanString(input.status).toLowerCase();
  return {
    user_id: userId,
    product_id: cleanOptionalString(input.productId) || null,
    template_id: cleanOptionalString(input.templateId) || null,
    cart_item_id: cleanOptionalString(input.cartItemId) || null,
    order_id: cleanOptionalString(input.orderId) || null,
    template_version: Number(input.templateVersion) || 1,
    status: CUSTOMIZATION_STATUSES.has(status) ? status : "draft",
    values: asObject(input.values),
    uploaded_files: asObject(input.uploadedFiles),
    selected_options: asObject(input.selectedOptions),
    preview_images: asObject(input.previewImages),
    render_data: withActivePage(input.renderData, input),
    print_files: asObject(input.printFiles),
  };
}

// Build a partial update row — only includes keys present in the patch.
export function customizationUpdateRow(input: any = {}): any {
  const row: any = { updated_at: new Date().toISOString() };
  if (input.status !== undefined) {
    const status = cleanString(input.status).toLowerCase();
    if (CUSTOMIZATION_STATUSES.has(status)) row.status = status;
  }
  if (input.cartItemId !== undefined) row.cart_item_id = cleanOptionalString(input.cartItemId) || null;
  if (input.orderId !== undefined) row.order_id = cleanOptionalString(input.orderId) || null;
  if (input.templateVersion !== undefined) row.template_version = Number(input.templateVersion) || 1;
  if (input.values !== undefined) row.values = asObject(input.values);
  if (input.uploadedFiles !== undefined) row.uploaded_files = asObject(input.uploadedFiles);
  if (input.selectedOptions !== undefined) row.selected_options = asObject(input.selectedOptions);
  if (input.previewImages !== undefined) row.preview_images = asObject(input.previewImages);
  if (input.renderData !== undefined || input.activePage !== undefined) row.render_data = withActivePage(input.renderData, input);
  if (input.printFiles !== undefined) row.print_files = asObject(input.printFiles);
  return row;
}
