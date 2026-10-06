// Which customer fields a layer may bind, and when a field is truly required.
// Pure; shared by the flat template (lib/customizer), the builder, the
// customer form and preflight so they cannot disagree.

import { resolveCustomerPermissions } from "./permissions";

/* ---------------------------------------------------------------------------
   A customer field is bound to one or more customer-editable layers through
   layer.fieldId. Several COMPATIBLE layers may share one field on purpose
   (spec §15 "Linked Wedding Fields": the couple's names on Front and Back are
   typed once and both update). Text layers share text fields; photo layers
   (image / frame) share image fields. */

export type CustomerFieldKind = "text" | "image";

/** The kind of field a layer can bind to, or null when it cannot bind one. */
export function customerFieldKindForLayer(layer: any): CustomerFieldKind | null {
  if (!layer) return null;
  if (layer.type === "text") return "text";
  if (layer.type === "image" || layer.type === "frame") return "image";
  return null;
}

export function customerFieldKind(field: any): CustomerFieldKind {
  return field?.type === "image" || field?.type === "file" ? "image" : "text";
}

/** True when `layer` may bind (or share) `field` without changing its type. */
export function isFieldCompatibleWithLayer(field: any, layer: any): boolean {
  const kind = customerFieldKindForLayer(layer);
  return Boolean(field && kind && customerFieldKind(field) === kind);
}

/**
 * Whether a customer must fill this field before review/checkout.
 *
 * Rule (enforced identically by the customer form, preflight and checkout):
 * a field is only REQUIRED when the customer can actually reach it — it is
 * visible to customers AND at least one bound layer is customer editable, not
 * hidden, on an enabled page, not interaction-disabled, and grants the content
 * permission (editContent for text, replaceImage for photos). A field the
 * customer cannot see or change is treated as optional, so a hidden required
 * field can never block a submission the customer has no way to complete.
 */
export function isCustomerFieldRequired(
  field: any,
  layers: any[] = [],
  enabledPageIds: Set<string> | null = null,
): boolean {
  if (!field?.required || field.customerVisible === false) return false;
  return (layers || []).some((layer: any) => {
    if (!layer || layer.fieldId !== field.id || !layer.customerEditable || layer.hidden) return false;
    const pageId = layer.page ?? layer.pageId;
    if (enabledPageIds && !enabledPageIds.has(pageId)) return false;
    const permissions = resolveCustomerPermissions(layer);
    return customerFieldKindForLayer(layer) === "image" ? permissions.replaceImage : permissions.editContent;
  });
}

