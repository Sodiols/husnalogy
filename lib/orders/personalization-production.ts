import type { CheckoutDeps } from "@/lib/orders/checkout";
import { makeProductionInput, productionIntegrityHash, readProductionSnapshot } from "@/lib/customizer/production-input";
import { pinProductionInput, productionStorage } from "@/lib/customizer/server/production-assets";
import { loadTrustedImageBuffer } from "@/lib/customizer/v2/server/render";

export function personalizationFreezer(supabase: any): NonNullable<CheckoutDeps["freezePersonalization"]> {
  return async ({ orderId, product, line, values, files, lineNumber }) => {
    const sources = new Map<string, Buffer>();
    const layers: any[] = [];
    const references = [...new Set([product.thumbnail, ...(Array.isArray(product.images) ? product.images.map((image: any) => typeof image === "string" ? image : image?.url || image?.src) : [])].filter((source): source is string => typeof source === "string" && !!source))];
    if (references.length > 20) throw new Error("Too many production reference images.");
    for (const [fieldId, value] of Object.entries(files)) {
      const file = value as any;
      // The checkout resolver has already verified upload ownership and identity.
      const { data, error } = await supabase.storage.from(file.bucket).download(file.path);
      if (error || !data || data.size > 30 * 1024 * 1024) throw new Error("Production upload unavailable.");
      const source = `checkout-upload:${fieldId}`;
      sources.set(source, Buffer.from(await data.arrayBuffer()));
      layers.push({ id: fieldId, page: "instructions", type: "image", src: source, x: 0, y: 0, width: 1, height: 1 });
    }
    const referenceIds = references.map((source, index) => {
      let id = `__production_reference_${index}`;
      while (Object.hasOwn(files, id)) id = `_${id}`;
      layers.push({ id, page: "instructions", type: "image", src: source, x: 0, y: 0, width: 1, height: 1 });
      return id;
    });
    const input = makeProductionInput({ pages: [{ id: "instructions", enabled: true }], layers, fields: [], featureFlags: { customizer_v2_server_rendering: false } }, {}, null);
    const pinned = await pinProductionInput(orderId, input, productionStorage(supabase), { loadImage: async (source) => {
      const bytes = sources.get(source); if (bytes) return bytes;
      if (references.includes(source)) return loadTrustedImageBuffer(source);
      throw new Error("Untrusted production upload source.");
    } });
    const durableFiles = Object.fromEntries(Object.entries(files).map(([fieldId, file]: [string, any]) => {
      const key = String(pinned.template.layers.find((entry: any) => entry.id === fieldId)?.src || "").replace("order-asset:", "");
      const asset = pinned.assets.find((entry) => entry.key === key);
      if (!asset) throw new Error("Production upload not pinned.");
      return [fieldId, { bucket: asset.bucket, path: asset.path, checksum: asset.checksum, name: String(file.name || ""), mimeType: asset.mimeType, size: asset.size }];
    }));
    const productSpecification = JSON.parse(JSON.stringify(product));
    for (const key of ["createdBy", "created_by", "assignedDesignerId", "assigned_designer_id", "updatedAt", "updated_at", "deletedAt", "deleted_at"]) delete productSpecification[key];
    const pinnedReferences = referenceIds.map(id => pinned.template.layers.find((layer: any) => layer.id === id)?.src);
    const sourceToPinned = new Map(references.map((source, index) => [source, pinnedReferences[index]]));
    if (productSpecification.thumbnail) productSpecification.thumbnail = sourceToPinned.get(productSpecification.thumbnail) || productSpecification.thumbnail;
    productSpecification.images = pinnedReferences;
    pinned.instructions = { productTitle: product.title, productSku: product.sku || product.slug || product.id, productSpecification, referenceImages: pinnedReferences, selectedOptions: line.options, quantity: line.quantity, fields: product.customizationFields || [], values, files: durableFiles };
    const snapshot = { snapshotSchemaVersion: 1, orderLineNumber: lineNumber, production: pinned };
    readProductionSnapshot({snapshot,snapshot_schema_version:1,production_mode:"manual",order_id:orderId,integrity_hash:productionIntegrityHash(snapshot)});
    return { ...snapshot, integrityHash: productionIntegrityHash(snapshot) };
  };
}
