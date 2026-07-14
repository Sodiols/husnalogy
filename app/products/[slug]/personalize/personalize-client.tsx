"use client";

// Full-screen customer customizer (Sections 2–17). One connected system with
// the admin builder: the same template data, the same shared renderer, the
// same save/draft/cart pipeline as before — presented as a professional
// editor. Customers can only touch what the administrator made editable; all
// their changes live in values + editorState, never in the template.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useAuth from "@/app/lib/useAuth";
import {
  addToCart as saveCartItem,
  formatRemoteError,
  getUserCart,
  getOptionsSurcharge,
  getProductBasePrice,
  openCustomerLogin,
  updateCartItem,
} from "@/app/lib/customer-lists";
import { getDefaultOptionCartValue } from "@/lib/products/options";
import CustomizerWorkspace from "@/app/components/customizer/CustomizerWorkspace";
import CustomizerPageThumbnails from "@/app/components/customizer/CustomizerPageThumbnails";
import CustomizerZoomControls, { ZOOM_MAX, ZOOM_MIN } from "@/app/components/customizer/CustomizerZoomControls";
import CustomizerReviewStep from "@/app/components/customizer/CustomizerReviewStep";
import CustomerCustomizerHeader from "@/app/components/customizer/CustomerCustomizerHeader";
import CustomerToolRail, { getCustomerTools, type CustomerTool } from "@/app/components/customizer/CustomerToolRail";
import CustomerContextToolbar from "@/app/components/customizer/CustomerContextToolbar";
import CustomerImageToolbar from "@/app/components/customizer/CustomerImageToolbar";
import CustomerGridToolbar from "@/app/components/customizer/CustomerGridToolbar";
import CustomerMockupPreview from "@/app/components/customizer/CustomerMockupPreview";
import CustomerEditPanel, { mapCustomerFields } from "@/app/components/customizer/CustomerEditPanel";
import CustomerAddTextPanel from "@/app/components/customizer/CustomerAddTextPanel";
import CustomerUploadsPanel from "@/app/components/customizer/CustomerUploadsPanel";
import CustomerElementsPanel, { type LibraryElement } from "@/app/components/customizer/CustomerElementsPanel";
import CustomerElementToolbar from "@/app/components/customizer/CustomerElementToolbar";
import CustomerOptionsPanel, { CUSTOMIZER_FORMAT_OPTIONS } from "@/app/components/customizer/CustomerOptionsPanel";
import CustomizerProtectionOverlay from "@/app/components/customizer/CustomizerProtectionOverlay";
import useCustomizerProtection from "@/app/components/customizer/useCustomizerProtection";
import useCustomizerHistory from "@/app/components/customizer/useCustomizerHistory";
import { isCustomizerFeatureEnabled } from "@/lib/customizer/v2/feature-flags";
import { stripEphemeralAssetUrls } from "@/lib/customizer/v2/asset-references";
import {
  buildInitialValues,
  buildRenderData,
  getEnabledPages,
  getEffectiveLayersForPage,
  getFieldById,
  getLayerPermissions,
  isImageValue,
  normalizeEditorState,
  normalizeUserLayer,
  pageAllowsCustomerText,
  resolveLayerText,
  validateCustomerValues,
  type EditorState,
} from "@/app/components/customizer/customizer-utils";

function firstOf(value: any, fallback = ""): string {
  if (Array.isArray(value)) {
    const first = value[0];
    if (first && typeof first === "object") return String(first.label || fallback);
    return String(first || fallback);
  }
  if (typeof value === "string" && value.trim()) return value.split("\n")[0].trim();
  return fallback;
}

const DRAFT_STORAGE_PREFIX = "husnalogy_customizer_draft";
const GUEST_SESSION_KEY = "husnalogy_guest_session_id";

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function getGuestSessionId() {
  if (!canUseStorage()) return "";
  const existing = window.localStorage.getItem(GUEST_SESSION_KEY);
  if (existing) return existing;
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(GUEST_SESSION_KEY, id);
  return id;
}

function draftStorageKey(productId: string, templateId: string, templateVersion: number) {
  return `${DRAFT_STORAGE_PREFIX}:${productId || "product"}:${templateId || "template"}:${templateVersion || 1}`;
}

function readLocalDraft(key: string) {
  if (!canUseStorage()) return null;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeLocalDraft(key: string, payload: any) {
  if (!canUseStorage()) return payload;
  const current = readLocalDraft(key) || {};
  const next = {
    ...current,
    ...payload,
    id: current.id || `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    guestSessionId: current.guestSessionId || getGuestSessionId(),
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage may be full (preview images are large) — keep editing anyway.
  }
  return next;
}

function safeInternalPath(value: string, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

type HistorySnapshot = {
  values: Record<string, any>;
  editorState: EditorState;
  options: Record<string, any>;
  quantity: number;
};

export default function PersonalizeClient({ product, template }: { product: any; template: any }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, authLoading } = useAuth();
  const gridsEnabled = isCustomizerFeatureEnabled(template, "customizer_v2_grids");

  const enabledPages = useMemo(() => getEnabledPages(template), [template]);
  const requireApproval = template?.settings?.requireApprovalCheckbox !== false;
  const protectionEnabled = template?.settings?.protectedPreview !== false;
  const initialCustomizationId = searchParams.get("customizationId") || "";
  const initialCartItemId = searchParams.get("cartItemId") || "";
  const exitHref = safeInternalPath(
    searchParams.get("returnTo") || "",
    initialCartItemId ? "/cart" : `/products/${product.slug}`,
  );
  const localDraftKey = useMemo(
    () => draftStorageKey(product.id, template?.id || "", template?.version || 1),
    [product.id, template?.id, template?.version],
  );

  /* ----- editor state ----- */
  const [step, setStep] = useState("design");
  const [values, setValues] = useState<Record<string, any>>(() => buildInitialValues(template));
  const [editorState, setEditorState] = useState<EditorState>(() => normalizeEditorState({}));
  const [activePage, setActivePage] = useState(enabledPages[0]?.id || "front");
  const [viewZoom, setViewZoom] = useState(1);
  const [approved, setApproved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [message, setMessage] = useState("");
  const [attemptedNext, setAttemptedNext] = useState(false);
  const [customizationId, setCustomizationId] = useState(initialCustomizationId);
  const [cartItemId, setCartItemId] = useState(initialCartItemId);
  const [restoreReady, setRestoreReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "unsaved" | "saving" | "saved" | "error">("idle");

  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedGridSlotId, setSelectedGridSlotId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<CustomerTool>("edit");
  const [previewMode, setPreviewMode] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  // The settings panel is mounted exactly once (desktop aside OR mobile sheet)
  // so field ids and label associations stay unique in the DOM.
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const [options, setOptions] = useState(() => ({
    format: getDefaultOptionCartValue(product.formatOptions) || CUSTOMIZER_FORMAT_OPTIONS[0],
    size: getDefaultOptionCartValue(product.sizeOptions) || firstOf(product.sizeOptions),
    envelope: getDefaultOptionCartValue(product.envelopeOptions) || firstOf(product.envelopeOptions),
    corner: getDefaultOptionCartValue(product.cornerOptions) || firstOf(product.cornerOptions),
    paperStyle: getDefaultOptionCartValue(product.paperStyleOptions),
    paper: getDefaultOptionCartValue(product.paperOptions) || firstOf(product.paperOptions),
    printing: getDefaultOptionCartValue(product.printingOptions) || firstOf(product.printingOptions),
    logo: true,
  }));
  const [quantity, setQuantity] = useState(Number(firstOf(product.quantityOptions, "1")) || 1);

  const history = useCustomizerHistory<HistorySnapshot>(50);

  const valuesRef = useRef(values);
  const editorStateRef = useRef(editorState);
  const optionsRef = useRef(options);
  const activePageRef = useRef(activePage);
  const quantityRef = useRef(quantity);
  const customizationIdRef = useRef(customizationId);
  const cartItemIdRef = useRef(cartItemId);
  const dirtyRef = useRef(dirty);
  const changeVersionRef = useRef(0);

  valuesRef.current = values;
  editorStateRef.current = editorState;
  optionsRef.current = options;
  activePageRef.current = activePage;
  quantityRef.current = quantity;
  customizationIdRef.current = customizationId;
  cartItemIdRef.current = cartItemId;
  dirtyRef.current = dirty;

  const validation = useMemo(() => validateCustomerValues(template, values), [template, values]);
  const basePrice = getProductBasePrice(product);
  const optionsSurcharge = getOptionsSurcharge(options);
  const unitPrice = Number((basePrice + optionsSurcharge).toFixed(2));
  const uploading = uploadingCount > 0;
  const canAddToCart = validation.ok && (!requireApproval || approved) && !uploading;

  const hasUploadFields = useMemo(
    () => mapCustomerFields(template).some((entry) => entry.field.type === "image" || entry.field.type === "file"),
    [template],
  );
  const anyPageAllowsText = useMemo(
    () => enabledPages.some((page: any) => pageAllowsCustomerText(template, page.id)),
    [template, enabledPages],
  );
  const allowElements = Boolean(template?.settings?.allowCustomerElements);
  const tools = useMemo(
    () => getCustomerTools({ allowAddText: anyPageAllowsText, hasUploads: hasUploadFields, allowElements }),
    [anyPageAllowsText, hasUploadFields, allowElements],
  );

  const { covered } = useCustomizerProtection(protectionEnabled);

  /* ----- dirty tracking + history ----- */
  const markDirty = () => {
    changeVersionRef.current += 1;
    setDirty(true);
    setSaveStatus("unsaved");
  };

  const snapshot = (): HistorySnapshot => ({
    values: valuesRef.current,
    editorState: editorStateRef.current,
    options: optionsRef.current,
    quantity: quantityRef.current,
  });

  const recordHistory = (group?: string) => history.record(snapshot(), group);

  const applySnapshot = (state: HistorySnapshot) => {
    setValues(state.values);
    setEditorState(state.editorState);
    setOptions(state.options as any);
    setQuantity(state.quantity);
    markDirty();
  };

  const undo = useCallback(() => {
    const previous = history.undo(snapshot());
    if (previous) applySnapshot(previous);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  const redo = useCallback(() => {
    const next = history.redo(snapshot());
    if (next) applySnapshot(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  /* ----- change handlers (all record history first) ----- */
  const onFieldChange = (fieldId: string, value: any) => {
    recordHistory(`field-${fieldId}`);
    markDirty();
    setValues((current) => ({ ...current, [fieldId]: value }));
  };

  const onOptionChange = (key: string, value: any) => {
    recordHistory("options");
    markDirty();
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const onQuantityChange = (nextQuantity: any) => {
    recordHistory("options");
    markDirty();
    setQuantity(Math.max(1, Number(nextQuantity || 1)));
  };

  const onActivePageChange = (pageId: string) => {
    setActivePage(pageId);
    setSelectedLayerId(null);
    setCropLayerId(null);
    cropBackupRef.current = null;
  };

  const patchEditorState = (patch: (current: EditorState) => EditorState) => {
    markDirty();
    setEditorState((current) => patch(current));
  };

  const updateLayerOverride = (
    layerId: string,
    kind: "textStyle" | "transform" | "imageTransform",
    updates: any,
    group?: string,
  ) => {
    recordHistory(group);
    patchEditorState((current) => {
      const existing = current.layerOverrides[layerId] || {};
      return {
        ...current,
        layerOverrides: {
          ...current.layerOverrides,
          [layerId]: { ...existing, [kind]: { ...((existing as any)[kind] || {}), ...updates } },
        },
      };
    });
  };

  const updateUserLayer = (layerId: string, patch: any, group?: string) => {
    recordHistory(group);
    patchEditorState((current) => ({
      ...current,
      userLayers: current.userLayers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)),
    }));
  };

  const updateUserLayerStyle = (layerId: string, stylePatch: any, group?: string) => {
    recordHistory(group);
    patchEditorState((current) => ({
      ...current,
      userLayers: current.userLayers.map((layer) =>
        layer.id === layerId ? { ...layer, textStyle: { ...(layer.textStyle || {}), ...stylePatch } } : layer,
      ),
    }));
  };

  const addUserTextLayer = () => {
    if (!pageAllowsCustomerText(template, activePage)) return;
    const canvasW = template?.canvasWidthPx || 1500;
    const canvasH = template?.canvasHeightPx || 2100;
    const safe = template?.safeArea || {};
    const safeLeft = Math.max(0, Number(safe.left) || 0);
    const safeTop = Math.max(0, Number(safe.top) || 0);
    const safeRight = Math.max(0, Number(safe.right) || 0);
    const safeBottom = Math.max(0, Number(safe.bottom) || 0);
    const safeWidth = Math.max(120, canvasW - safeLeft - safeRight);
    const safeHeight = Math.max(80, canvasH - safeTop - safeBottom);
    const layer = normalizeUserLayer({
      page: activePage,
      text: "Your text",
      x: Math.round(safeLeft + safeWidth / 2),
      y: Math.round(safeTop + safeHeight / 2),
      width: Math.round(safeWidth * 0.7),
      height: Math.min(Math.round(canvasH * 0.08), Math.round(safeHeight * 0.2)),
      textStyle: { fontSize: Math.max(36, Math.round(canvasW / 24)), textAlign: "center" },
    });
    if (!layer) return;
    recordHistory();
    patchEditorState((current) => ({ ...current, userLayers: [...current.userLayers, layer] }));
    setSelectedLayerId(layer.id);
    setActiveTool("addText");
  };

  const addElementLayer = (element: LibraryElement) => {
    if (!allowElements || !element?.url) return;
    const canvasW = template?.canvasWidthPx || 1500;
    const canvasH = template?.canvasHeightPx || 2100;
    // Size the element to about a quarter of the canvas width, keeping its
    // aspect ratio when known.
    const width = Math.round(canvasW * 0.25);
    const ratio = element.width > 0 && element.height > 0 ? element.height / element.width : 1;
    const layer = normalizeUserLayer({
      type: "element",
      page: activePage,
      assetId: element.id,
      src: element.url,
      tintColor: element.tintable ? element.defaultColor || "" : "",
      x: Math.round(canvasW / 2),
      y: Math.round(canvasH / 2),
      width,
      height: Math.max(24, Math.round(width * ratio)),
    });
    if (!layer) return;
    recordHistory();
    patchEditorState((current) => ({ ...current, userLayers: [...current.userLayers, layer] }));
    setSelectedLayerId(layer.id);
  };

  const updateElementLayer = (layerId: string, patch: any, group?: string) => {
    recordHistory(group);
    patchEditorState((current) => ({
      ...current,
      userLayers: current.userLayers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)),
    }));
  };

  const duplicateElementLayer = (layerId: string) => {
    const source = editorStateRef.current.userLayers.find((layer) => layer.id === layerId);
    if (!source) return;
    const copy = normalizeUserLayer({ ...source, id: "", x: (source.x || 0) + 40, y: (source.y || 0) + 40 });
    if (!copy) return;
    recordHistory();
    patchEditorState((current) => ({ ...current, userLayers: [...current.userLayers, copy] }));
    setSelectedLayerId(copy.id);
  };

  const deleteUserLayer = (layerId: string) => {
    recordHistory();
    patchEditorState((current) => ({
      ...current,
      userLayers: current.userLayers.filter((layer) => layer.id !== layerId),
    }));
    setSelectedLayerId((current) => (current === layerId ? null : current));
  };

  const duplicateSelectedLayer = () => {
    const layer = selectedLayer;
    if (!layer) return;
    let copySource: any = null;
    if (layer.isUserLayer) {
      copySource = layer;
    } else if (getLayerPermissions(layer).duplicate && layer.type === "text") {
      const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
      copySource = { ...layer, text: resolveLayerText(layer, field, values) };
    }
    if (!copySource) return;
    const copy = normalizeUserLayer({
      ...copySource,
      id: "",
      x: (copySource.x || 0) + 40,
      y: (copySource.y || 0) + 40,
    });
    if (!copy) return;
    recordHistory();
    patchEditorState((current) => ({ ...current, userLayers: [...current.userLayers, copy] }));
    setSelectedLayerId(copy.id);
  };

  /* ----- selection ----- */
  const effectiveLayers = useMemo(
    () => getEffectiveLayersForPage(template, activePage, editorState),
    [template, activePage, editorState],
  );
  const selectedLayer = useMemo(
    () => effectiveLayers.find((layer: any) => layer.id === selectedLayerId) || null,
    [effectiveLayers, selectedLayerId],
  );
  const selectedIsUser = Boolean(selectedLayer?.isUserLayer);
  const selectedPermissions = useMemo(
    () => (selectedLayer && !selectedIsUser ? getLayerPermissions(selectedLayer) : {}),
    [selectedLayer, selectedIsUser],
  );

  /* ----- photo crop mode (spec §11) ----- */
  const [cropLayerId, setCropLayerId] = useState<string | null>(null);
  const [cropGridSlotId, setCropGridSlotId] = useState<string | null>(null);
  const cropBackupRef = useRef<any>(null);

  const onImageTransformChange = (layerId: string, patch: any, phase: "start" | "move") => {
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (!layer || layer.type !== "image" || layer.isUserLayer) return;
    const permissions = getLayerPermissions(layer);
    const cropAllowed = permissions.cropImage || permissions.zoomImage || permissions.repositionImage;
    if (phase === "start") {
      recordHistory(`crop-${layerId}`);
      return;
    }
    const allowed: any = {};
    if (patch.zoom !== undefined && (permissions.zoomImage || cropAllowed)) allowed.zoom = patch.zoom;
    if ((patch.offsetX !== undefined || patch.offsetY !== undefined) && (permissions.repositionImage || cropAllowed)) {
      if (patch.offsetX !== undefined) allowed.offsetX = patch.offsetX;
      if (patch.offsetY !== undefined) allowed.offsetY = patch.offsetY;
    }
    if (patch.rotation !== undefined && cropAllowed) allowed.rotation = patch.rotation;
    if ((patch.flipX !== undefined || patch.flipY !== undefined) && (permissions.flipImage || cropAllowed)) {
      if (patch.flipX !== undefined) allowed.flipX = patch.flipX;
      if (patch.flipY !== undefined) allowed.flipY = patch.flipY;
    }
    if (!Object.keys(allowed).length) return;
    markDirty();
    setEditorState((current) => {
      const existing = current.layerOverrides[layerId] || {};
      return {
        ...current,
        layerOverrides: {
          ...current.layerOverrides,
          [layerId]: { ...existing, imageTransform: { ...((existing as any).imageTransform || {}), ...allowed } },
        },
      };
    });
  };

  const enterCropMode = (layerId: string) => {
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (!layer || layer.type !== "image" || layer.isUserLayer) return;
    const permissions = getLayerPermissions(layer);
    if (!(permissions.cropImage || permissions.zoomImage || permissions.repositionImage)) return;
    cropBackupRef.current = {
      layerId,
      imageTransform: { ...(editorStateRef.current.layerOverrides[layerId]?.imageTransform || {}) },
    };
    recordHistory();
    setSelectedLayerId(layerId);
    setCropLayerId(layerId);
  };

  const confirmCrop = () => {
    cropBackupRef.current = null;
    setCropLayerId(null);
  };

  const cancelCrop = () => {
    const backup = cropBackupRef.current;
    if (backup?.layerId) {
      setEditorState((current) => {
        const existing = current.layerOverrides[backup.layerId] || {};
        return {
          ...current,
          layerOverrides: {
            ...current.layerOverrides,
            [backup.layerId]: { ...existing, imageTransform: backup.imageTransform },
          },
        };
      });
    }
    cropBackupRef.current = null;
    setCropLayerId(null);
  };

  const onGridSlotTransformChange = (layerId: string, slotId: string, patch: any, phase: "start" | "move") => {
    if (!gridsEnabled) return;
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    const slot = layer?.type === "grid" ? (layer.slots || []).find((item: any) => item.id === slotId) : null;
    if (!layer || !slot || !layer.customerEditable) return;
    const permissions = { ...getLayerPermissions(layer), ...(slot.permissions || {}) };
    if (phase === "start") {
      recordHistory(`grid-crop-${layerId}-${slotId}`);
      return;
    }
    const cropAllowed = permissions.cropImage || permissions.zoomImage || permissions.repositionImage;
    if (!cropAllowed) return;
    markDirty();
    setEditorState((current) => {
      const existing = current.layerOverrides[layerId] || {};
      const currentSlot = existing.gridSlots?.[slotId] || {};
      return {
        ...current,
        layerOverrides: {
          ...current.layerOverrides,
          [layerId]: {
            ...existing,
            gridSlots: {
              ...(existing.gridSlots || {}),
              [slotId]: { ...currentSlot, transform: { ...(currentSlot.transform || slot.transform || {}), ...patch } },
            },
          },
        },
      };
    });
  };

  const applyGridSlotAsset = (layerId: string, slotId: string, uploaded: any) => {
    if (!gridsEnabled || !uploaded) return;
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    const slot = layer?.type === "grid" ? (layer.slots || []).find((item: any) => item.id === slotId) : null;
    if (!layer || !slot || !({ ...getLayerPermissions(layer), ...(slot.permissions || {}) }).replaceImage) return;
    recordHistory(`grid-replace-${layerId}-${slotId}`);
    markDirty();
    setEditorState((current) => {
      const existing = current.layerOverrides[layerId] || {};
      return {
        ...current,
        layerOverrides: {
          ...current.layerOverrides,
          [layerId]: {
            ...existing,
            gridSlots: {
              ...(existing.gridSlots || {}),
              [slotId]: {
                assetId: uploaded.id || uploaded.assetId || uploaded.path || "",
                ownerId: uploaded.ownerId || uploaded.assetReference?.ownerId || "",
                src: uploaded.signedUrl || uploaded.url || "",
                bucket: uploaded.bucket || "customer-uploads",
                path: uploaded.path || "",
                originalPath: uploaded.originalPath || uploaded.assetReference?.storagePath || "",
                assetReference: uploaded.assetReference,
                metadata: { width: Number(uploaded.width) || 0, height: Number(uploaded.height) || 0, originalPath: uploaded.originalPath || "" },
                transform: { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false, fitMode: "cover" },
              },
            },
          },
        },
      };
    });
  };

  const replaceGridSlot = async (layerId: string, slotId: string, file: File) => {
    const uploaded = await onUploadPhoto(file);
    applyGridSlotAsset(layerId, slotId, uploaded);
  };

  const clearGridSlot = (layerId: string, slotId: string) => {
    if (!gridsEnabled) return;
    recordHistory(`grid-clear-${layerId}-${slotId}`);
    markDirty();
    setEditorState((current) => {
      const existing = current.layerOverrides[layerId] || {};
      return {
        ...current,
        layerOverrides: {
          ...current.layerOverrides,
          [layerId]: {
            ...existing,
            gridSlots: {
              ...(existing.gridSlots || {}),
              [slotId]: { assetId: "", src: "", bucket: "", path: "", metadata: {}, transform: { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false, fitMode: "cover" } },
            },
          },
        },
      };
    });
  };

  const moveGridSlotPhoto = (layerId: string, slotId: string, direction: number) => {
    if (!gridsEnabled) return;
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    const slots = layer?.type === "grid" ? layer.slots || [] : [];
    const index = slots.findIndex((item: any) => item.id === slotId);
    if (index < 0 || slots.length < 2) return;
    const targetIndex = (index + direction + slots.length) % slots.length;
    const source = slots[index];
    const target = slots[targetIndex];
    const targetPermissions = { ...getLayerPermissions(layer), ...(target.permissions || {}) };
    if (!targetPermissions.replaceImage) return;
    const photoPatch = (slot: any) => ({
      assetId: slot.assetId || "", ownerId: slot.ownerId || slot.assetReference?.ownerId || "", src: slot.src || "", bucket: slot.bucket || "", path: slot.path || "",
      originalPath: slot.originalPath || slot.assetReference?.storagePath || "", assetReference: slot.assetReference,
      metadata: slot.metadata || {}, transform: slot.transform || { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false, fitMode: "cover" },
    });
    recordHistory(`grid-move-${layerId}-${slotId}`);
    markDirty();
    setEditorState((current) => {
      const existing = current.layerOverrides[layerId] || {};
      return { ...current, layerOverrides: { ...current.layerOverrides, [layerId]: { ...existing, gridSlots: { ...(existing.gridSlots || {}), [source.id]: photoPatch(target), [target.id]: photoPatch(source) } } } };
    });
    setSelectedGridSlotId(target.id);
  };

  const enterGridCropMode = (layerId: string, slotId: string) => {
    if (!gridsEnabled) return;
    const currentSlot = editorStateRef.current.layerOverrides[layerId]?.gridSlots?.[slotId];
    cropBackupRef.current = { type: "grid", layerId, slotId, value: currentSlot ? structuredClone(currentSlot) : null };
    recordHistory();
    setSelectedLayerId(layerId);
    setSelectedGridSlotId(slotId);
    setCropLayerId(null);
    setCropGridSlotId(slotId);
  };

  const confirmGridCrop = () => {
    cropBackupRef.current = null;
    setCropGridSlotId(null);
  };

  const cancelGridCrop = () => {
    const backup = cropBackupRef.current;
    if (backup?.type === "grid") {
      setEditorState((current) => {
        const existing = current.layerOverrides[backup.layerId] || {};
        const slots = { ...(existing.gridSlots || {}) };
        if (backup.value) slots[backup.slotId] = backup.value;
        else delete slots[backup.slotId];
        return { ...current, layerOverrides: { ...current.layerOverrides, [backup.layerId]: { ...existing, gridSlots: slots } } };
      });
    }
    cropBackupRef.current = null;
    setCropGridSlotId(null);
  };

  const showImageToolbar =
    !previewMode &&
    step === "design" &&
    activeTool !== "options" &&
    Boolean(selectedLayer) &&
    !selectedIsUser &&
    selectedLayer?.type === "image" &&
    selectedLayer?.customerEditable &&
    !selectedLayer?.hidden &&
    ["replaceImage", "cropImage", "zoomImage", "repositionImage", "flipImage", "rotate"].some(
      (permission) => (selectedPermissions as any)[permission],
    );

  const showGridToolbar =
    gridsEnabled &&
    !previewMode &&
    step === "design" &&
    activeTool !== "options" &&
    Boolean(selectedLayer) &&
    !selectedIsUser &&
    selectedLayer?.type === "grid" &&
    selectedLayer?.customerEditable &&
    !selectedLayer?.hidden;

  const showElementToolbar =
    !previewMode &&
    step === "design" &&
    activeTool !== "options" &&
    Boolean(selectedLayer) &&
    selectedIsUser &&
    selectedLayer?.type === "element";

  const showTextToolbar =
    !previewMode &&
    step === "design" &&
    activeTool !== "options" &&
    Boolean(selectedLayer) &&
    !showImageToolbar &&
    !showElementToolbar &&
    (selectedIsUser ||
      (selectedLayer?.type === "text" &&
        selectedLayer?.customerEditable &&
        !selectedLayer?.hidden &&
        [
          "editContent",
          "editStyle",
          "changeFont",
          "changeFontSize",
          "changeColor",
          "changeAlignment",
          "changeLetterSpacing",
          "duplicate",
          "delete",
        ].some((permission) => selectedPermissions[permission])));

  const onSelectLayer = (layerId: string | null) => {
    setSelectedLayerId(layerId);
    if (!layerId) {
      setSelectedGridSlotId(null);
      return;
    }
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (!layer) return;
    if (layer.isUserLayer) {
      setActiveTool(layer.type === "element" ? "elements" : "addText");
      setMobilePanelOpen(true);
    } else if (layer.type === "image" || layer.type === "frame") {
      setActiveTool("uploads");
      setMobilePanelOpen(true);
    } else if (layer.type === "grid") {
      setSelectedGridSlotId((current) => (layer.slots || []).some((slot: any) => slot.id === current) ? current : layer.slots?.[0]?.id || null);
      setActiveTool("uploads");
      setMobilePanelOpen(true);
    } else if (layer.type === "text") {
      setActiveTool("edit");
      setMobilePanelOpen(true);
    }
  };

  const onLayerTransform = (layerId: string, patch: any, phase: "start" | "move") => {
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (!layer) return;
    if (phase === "start") {
      recordHistory(`transform-${layerId}`);
      return;
    }
    markDirty();
    if (layer.isUserLayer) {
      setEditorState((current) => ({
        ...current,
        userLayers: current.userLayers.map((item) => (item.id === layerId ? { ...item, ...patch } : item)),
      }));
    } else {
      const permissions = getLayerPermissions(layer);
      const allowed: any = {};
      if (permissions.move) {
        if (patch.x !== undefined) allowed.x = patch.x;
        if (patch.y !== undefined) allowed.y = patch.y;
      }
      if (permissions.resize) {
        if (patch.width !== undefined) allowed.width = patch.width;
        if (patch.height !== undefined) allowed.height = patch.height;
      }
      if (permissions.rotate && patch.rotation !== undefined) allowed.rotation = patch.rotation;
      if (!Object.keys(allowed).length) return;
      setEditorState((current) => {
        const existing = current.layerOverrides[layerId] || {};
        return {
          ...current,
          layerOverrides: {
            ...current.layerOverrides,
            [layerId]: { ...existing, transform: { ...(existing.transform || {}), ...allowed } },
          },
        };
      });
    }
  };

  const onToolbarStyleChange = (patch: any, group?: string) => {
    if (!selectedLayer) return;
    const groupKey = group ? `style-${selectedLayer.id}-${group}` : undefined;
    if (selectedIsUser) {
      updateUserLayerStyle(selectedLayer.id, patch, groupKey);
      return;
    }
    // Template layer: keep only the changes the admin allowed.
    const permissions = selectedPermissions as Record<string, boolean>;
    const allowed: any = {};
    Object.entries(patch).forEach(([key, value]) => {
      const gate =
        key === "fontFamily"
          ? permissions.changeFont
          : key === "fontSize"
            ? permissions.changeFontSize
            : key === "color"
              ? permissions.changeColor
              : key === "textAlign"
                ? permissions.changeAlignment
                : key === "letterSpacing"
                  ? permissions.changeLetterSpacing
                  : permissions.editStyle;
      if (gate) allowed[key] = value;
    });
    if (!Object.keys(allowed).length) return;
    updateLayerOverride(selectedLayer.id, "textStyle", allowed, groupKey);
  };

  const onEditTextAction = () => {
    if (!selectedLayer) return;
    if (selectedIsUser) {
      setActiveTool("addText");
      setMobilePanelOpen(true);
      return;
    }
    setActiveTool("edit");
    setMobilePanelOpen(true);
    // Re-trigger the field focus in the Edit panel.
    const id = selectedLayer.id;
    setSelectedLayerId(null);
    window.setTimeout(() => setSelectedLayerId(id), 0);
  };

  const onDeleteSelected = () => {
    if (!selectedLayer) return;
    if (selectedIsUser) deleteUserLayer(selectedLayer.id);
  };

  /* ----- uploads ----- */
  const onUploadPhoto = async (file: File) => {
    if (!user) {
      openCustomerLogin();
      throw new Error("Please sign in to upload a photo.");
    }
    setUploadingCount((count) => count + 1);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", `customizer/${product.slug || "product"}`);
      const res = await fetch("/api/customizer/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Upload failed.");
      return data.file;
    } finally {
      setUploadingCount((count) => Math.max(0, count - 1));
    }
  };

  /* ----- persistence (same pipeline as before, plus editorState) ----- */
  const collectUploadedFiles = (currentValues: Record<string, any>) => {
    const files: Record<string, any> = {};
    (template?.fields || []).forEach((field: any) => {
      if ((field.type === "image" || field.type === "file") && isImageValue(currentValues[field.id])) {
        files[field.id] = currentValues[field.id];
      }
    });
    return files;
  };

  const buildCustomizationPayload = async (status = "draft") => {
    const currentValues = valuesRef.current;
    const currentEditorState = editorStateRef.current;
    const currentOptions = optionsRef.current;
    const currentQuantity = quantityRef.current;
    const currentActivePage = activePageRef.current;
    const selectedOptions = { ...currentOptions, quantity: currentQuantity };
    const ownerId = user?.id || user?.uid || "";
    const permanentValues = stripEphemeralAssetUrls(currentValues, ownerId);
    const permanentEditorState = stripEphemeralAssetUrls(currentEditorState, ownerId);
    const uploadedFiles = stripEphemeralAssetUrls(collectUploadedFiles(currentValues), ownerId);
    const previewImages = {};
    const renderData = stripEphemeralAssetUrls({
      ...buildRenderData(template, permanentValues, selectedOptions, permanentEditorState),
      activePage: currentActivePage,
      productTitle: product.title || "",
      productSlug: product.slug || "",
      productThumbnail: product.thumbnail || product.mockups?.[0] || product.images?.[0] || "",
    }, ownerId);

    return {
      customizationId: customizationIdRef.current && !String(customizationIdRef.current).startsWith("local_")
        ? customizationIdRef.current
        : "",
      productId: product.id,
      templateId: template?.id || "",
      templateVersion: template?.version || 1,
      cartItemId: cartItemIdRef.current || "",
      status,
      values: permanentValues,
      uploadedFiles,
      selectedOptions,
      previewImages,
      renderData,
      activePage: currentActivePage,
    };
  };

  const saveCustomizationDraft = async (status = "draft", { silent = false }: any = {}) => {
    if (!silent) setMessage("");
    setSaveStatus("saving");
    const savingVersion = changeVersionRef.current;

    const payload = await buildCustomizationPayload(status);

    if (!user) {
      const localDraft = writeLocalDraft(localDraftKey, payload);
      setCustomizationId(localDraft.id);
      if (changeVersionRef.current === savingVersion) {
        setDirty(false);
        setSaveStatus("saved");
      }
      return { ok: true, customization: localDraft, local: true };
    }

    const existingId = payload.customizationId || customizationIdRef.current;
    const usePatch = existingId && !String(existingId).startsWith("local_");
    const res = await fetch(usePatch ? `/api/customizations/${existingId}` : "/api/customizations", {
      method: usePatch ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data?.error || "Your changes could not be saved. Please try again.");
    }

    const saved = data.customization || {};
    if (saved.id) setCustomizationId(saved.id);
    if (saved.cartItemId) setCartItemId(saved.cartItemId);
    if (changeVersionRef.current === savingVersion) {
      setDirty(false);
      setSaveStatus("saved");
    }
    return { ok: true, customization: saved, local: false };
  };

  const applySavedCustomization = (saved: any) => {
    if (!saved) return false;
    const savedValues = saved.values || saved.customizationValues || saved.customization || {};
    const savedOptions = saved.selectedOptions || saved.options || {};
    const savedQuantity = Math.max(1, Number(savedOptions.quantity || saved.quantity || quantityRef.current || 1));
    const { quantity: _quantity, activePage: optionActivePage, ...optionPatch } = savedOptions;
    const savedActivePage = saved.renderData?.activePage || saved.activePage || optionActivePage;
    // Old drafts have no editorState — they restore with an empty one.
    const savedEditorState = normalizeEditorState(saved.renderData?.editorState || saved.editorState || {});

    setValues({ ...buildInitialValues(template), ...savedValues });
    setEditorState(savedEditorState);
    setOptions((current) => ({ ...current, ...optionPatch }));
    setQuantity(savedQuantity);

    if (enabledPages.some((page: any) => page.id === savedActivePage)) {
      setActivePage(savedActivePage);
    }
    if (saved.id) setCustomizationId(saved.id);
    if (saved.cartItemId) setCartItemId(saved.cartItemId);
    return true;
  };

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;

    async function restoreDraft() {
      setRestoreReady(false);
      let restored = false;

      try {
        if (user && initialCustomizationId && !initialCustomizationId.startsWith("local_")) {
          const res = await fetch(`/api/customizations/${encodeURIComponent(initialCustomizationId)}`, { cache: "no-store" });
          const data = await res.json().catch(() => ({}));
          if (!cancelled && res.ok && data.ok && data.customization) {
            restored = applySavedCustomization(data.customization);
          }
        }

        if (!restored && user && initialCartItemId) {
          const cart = await getUserCart(user);
          const item = cart.find((entry: any) => String(entry.id) === String(initialCartItemId));
          if (item) {
            setCartItemId(item.id);
            if (item.customizationId) {
              const res = await fetch(`/api/customizations/${encodeURIComponent(item.customizationId)}`, { cache: "no-store" });
              const data = await res.json().catch(() => ({}));
              if (!cancelled && res.ok && data.ok && data.customization) {
                restored = applySavedCustomization({ ...data.customization, cartItemId: item.id });
              }
            }
            if (!restored && !cancelled) {
              restored = applySavedCustomization({
                id: item.customizationId || "",
                cartItemId: item.id,
                values: item.customizationValues || item.previewData || {},
                selectedOptions: item.selectedOptions || {},
                uploadedFiles: item.uploadedFiles || {},
                previewImages: item.previewImages || {},
                renderData: item.renderData || {},
              });
            }
          }
        }

        if (!restored && user) {
          const query = new URLSearchParams({
            productId: product.id,
            status: "draft",
            limit: "1",
          });
          if (template?.id) query.set("templateId", template.id);
          const res = await fetch(`/api/customizations?${query.toString()}`, { cache: "no-store" });
          const data = await res.json().catch(() => ({}));
          const latest = data?.customizations?.[0];
          if (!cancelled && res.ok && data.ok && latest) {
            restored = applySavedCustomization(latest);
          }
        }

        if (!restored) {
          const localDraft = readLocalDraft(localDraftKey);
          if (!cancelled && localDraft) {
            restored = applySavedCustomization(localDraft);
          }
        }
      } catch (error) {
        console.warn("Could not restore customization draft.", error);
      }

      if (cancelled) return;
      setDirty(false);
      setSaveStatus(restored ? "saved" : "idle");
      setRestoreReady(true);
      history.reset();
    }

    restoreDraft();

    return () => {
      cancelled = true;
    };
    // Run once after auth resolves for this product/template. Avoid depending on
    // mutable form state, otherwise a field edit would re-apply the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, user?.uid, product.id, template?.id, template?.version, initialCustomizationId, initialCartItemId, localDraftKey]);

  useEffect(() => {
    if (!restoreReady || !dirty) return;
    if (template?.settings?.autosave === false) return;
    const timer = window.setTimeout(() => {
      saveCustomizationDraft("draft", { silent: true }).catch((error) => {
        console.warn("Autosave failed:", error);
        setSaveStatus("error");
      });
    }, 900);

    return () => window.clearTimeout(timer);
    // Snapshot refs keep the latest values/options/page at save time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, editorState, options, quantity, activePage, restoreReady, dirty, user?.id, user?.uid]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  /* ----- keyboard shortcuts ----- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      const key = String(event.key).toLowerCase();

      if ((event.ctrlKey || event.metaKey) && !typing) {
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          undo();
          return;
        }
        if (key === "y" || (key === "z" && event.shiftKey)) {
          event.preventDefault();
          redo();
          return;
        }
      }
      if (typing) return;
      if (event.key === "Escape") {
        if (cropLayerId) cancelCrop();
        else if (cropGridSlotId) cancelGridCrop();
        else if (previewMode) setPreviewMode(false);
        else setSelectedLayerId(null);
        return;
      }
      if (event.key === "Enter" && cropLayerId) {
        event.preventDefault();
        confirmCrop();
        return;
      }
      if (event.key === "Enter" && cropGridSlotId) {
        event.preventDefault();
        confirmGridCrop();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedLayer?.isUserLayer) {
        event.preventDefault();
        deleteUserLayer(selectedLayer.id);
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && selectedLayer) {
        const movable = selectedLayer.isUserLayer || getLayerPermissions(selectedLayer).move;
        if (!movable) return;
        event.preventDefault();
        const amount = event.shiftKey ? 40 : 8;
        const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
        const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
        onLayerTransform(selectedLayer.id, {}, "start");
        onLayerTransform(selectedLayer.id, { x: (selectedLayer.x || 0) + dx, y: (selectedLayer.y || 0) + dy }, "move");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ----- step navigation ----- */
  const pageIndex = enabledPages.findIndex((page: any) => page.id === activePage);
  const nextPage = pageIndex >= 0 ? enabledPages[pageIndex + 1] : null;

  const primaryLabel =
    step === "review"
      ? adding
        ? "Adding…"
        : "Add to Cart"
      : step === "options"
        ? "Next: Review"
        : nextPage
          ? `Next: Design ${nextPage.label}`
          : "Next: Options";

  const enterStep = (nextStep: string) => {
    if (nextStep === "review" && !validation.ok) {
      setAttemptedNext(true);
      setActiveTool("edit");
      setStep("design");
      setMessage("Please complete the required details before reviewing.");
      return;
    }
    setMessage("");
    setSelectedLayerId(null);
    setPreviewMode(false);
    setStep(nextStep);
    if (nextStep === "options") setActiveTool("options");
    if (nextStep === "design" && activeTool === "options") setActiveTool("edit");
  };

  const goNext = () => {
    if (step === "design") {
      if (nextPage) {
        onActivePageChange(nextPage.id);
        return;
      }
      if (!validation.ok) {
        setAttemptedNext(true);
        setMessage("Please complete the required details before continuing.");
        return;
      }
      setAttemptedNext(false);
      enterStep("options");
    } else if (step === "options") {
      enterStep("review");
    } else if (step === "review") {
      handleAddToCart();
    }
  };

  /* ----- cart ----- */
  const handleAddToCart = async () => {
    if (!user) {
      try {
        await saveCustomizationDraft("draft", { silent: true });
      } catch {
        // Best-effort local protection before showing login.
      }
      setMessage("Your design is saved on this device. Please sign in to add it to cart.");
      openCustomerLogin();
      return;
    }
    if (!canAddToCart) {
      setAttemptedNext(true);
      setMessage(
        !validation.ok
          ? "Please complete the required details."
          : uploading
            ? "Please wait for your photo to finish uploading."
            : "Please confirm the approval checkbox.",
      );
      return;
    }

    setAdding(true);
    setMessage("");

    try {
      const saved = await saveCustomizationDraft("in_cart", { silent: true });
      const savedCustomization = saved.customization || {};

      // Server preflight (spec §30): blocking print problems stop the add.
      if (savedCustomization.id && !String(savedCustomization.id).startsWith("local_")) {
        try {
          const preflightRes = await fetch("/api/customizer/preflight", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customizationId: savedCustomization.id, context: "cart" }),
          });
          const preflightData = await preflightRes.json().catch(() => ({}));
          if (preflightRes.ok && preflightData.ok && preflightData.preflight?.blocking) {
            const firstIssue = (preflightData.preflight.issues || []).find((issue: any) => issue.severity === "error");
            setMessage(firstIssue?.message || "Please fix the highlighted problems before adding to cart.");
            setAdding(false);
            return;
          }
        } catch {
          // Preflight service unavailable — the order snapshot re-runs it.
        }
      }
      const latestValues = valuesRef.current;
      const latestEditorState = editorStateRef.current;
      const latestOptions = optionsRef.current;
      const latestQuantity = quantityRef.current;
      const selectedOptions = { ...latestOptions, quantity: latestQuantity };
      const ownerId = user?.id || user?.uid || "";
      const permanentValues = stripEphemeralAssetUrls(latestValues, ownerId);
      const uploadedFiles = stripEphemeralAssetUrls(collectUploadedFiles(latestValues), ownerId);
      const previewImages = {};
      let mockupOutputRef: Record<string, any> | null = null;
      if (savedCustomization.id && !String(savedCustomization.id).startsWith("local_")) {
        try {
          const mockupResponse = await fetch("/api/customizer/render", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customizationId: savedCustomization.id, jobType: "mockup" }),
          });
          const mockupPayload = await mockupResponse.json().catch(() => ({}));
          const firstMockup = mockupResponse.ok ? (mockupPayload.outputs || []).find((output: any) => String(output.pageId || "").startsWith("mockup:")) : null;
          if (firstMockup) {
            mockupOutputRef = {
              id: firstMockup.id,
              pageId: firstMockup.pageId,
              bucket: firstMockup.bucket,
              path: firstMockup.path,
              format: firstMockup.format,
              mimeType: firstMockup.mimeType,
              checksum: firstMockup.checksum,
              inputHash: firstMockup.inputHash,
            };
          }
        } catch {
          // The cart keeps a product-image fallback; reopening it retries the
          // cached server mockup without persisting a temporary signed URL.
        }
      }
      const renderData = stripEphemeralAssetUrls(savedCustomization.renderData || {
        ...buildRenderData(template, latestValues, selectedOptions, latestEditorState),
        activePage: activePageRef.current,
        previewImages,
        mockupOutputRef,
      }, ownerId);
      const savedCustomizationId = savedCustomization.id || customizationIdRef.current || "";
      const cartPayload = {
        selectedOptions,
        customizationValues: permanentValues,
        uploadedFiles,
        previewData: permanentValues,
        previewImages,
        renderData,
        customizationId: savedCustomizationId,
        templateId: template?.id || "",
        templateVersion: template?.version || 1,
        unitPrice,
      };
      const existingCartItemId = cartItemIdRef.current;
      let cartItem: any = null;

      if (existingCartItemId) {
        await updateCartItem(user, existingCartItemId, {
          ...cartPayload,
          quantity: latestQuantity,
          price: unitPrice,
          image: product.thumbnail || product.mockups?.[0] || product.images?.[0],
        });
        cartItem = { id: existingCartItemId };
      } else {
        cartItem = await saveCartItem(user, product, latestQuantity, cartPayload);
        if (cartItem?.id) setCartItemId(cartItem.id);
      }

      if (savedCustomizationId && cartItem?.id) {
        await fetch(`/api/customizations/${savedCustomizationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cartItemId: cartItem.id, status: "in_cart" }),
        });
      }

      router.push("/cart");
    } catch (error: any) {
      console.error("Add personalized item failed:", formatRemoteError(error));
      if (error?.code === "auth-required") openCustomerLogin();
      else setMessage("Could not add this item. Please try again.");
      setAdding(false);
    }
  };

  const handleSaveExit = async () => {
    setSavingDraft(true);
    setMessage("");
    try {
      await saveCustomizationDraft("draft");
      router.push(exitHref);
    } catch (error) {
      console.error("Save draft failed:", error);
      setSaveStatus("error");
      setMessage("Your changes could not be saved. Please try again.");
      setSavingDraft(false);
    }
  };

  const handleClose = () => {
    if (dirtyRef.current) {
      const leave = window.confirm("Leave without saving? Your latest changes will be lost.");
      if (!leave) return;
    }
    router.push(exitHref);
  };

  /* ----- render ----- */
  const saveStatusLabel =
    savingDraft || saveStatus === "saving"
      ? "Saving"
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "unsaved"
          ? "Unsaved changes"
          : saveStatus === "error"
            ? "Save failed"
            : restoreReady
              ? ""
              : "Loading design";

  const showSafeArea = template?.settings?.showSafeArea !== false && !previewMode;
  const showPanels = step !== "review" && !previewMode;

  const panelTitle =
    activeTool === "edit"
      ? "Edit your details"
      : activeTool === "addText"
        ? "Add text"
        : activeTool === "uploads"
          ? "Your photos"
          : activeTool === "elements"
            ? "Elements"
            : "Product options";

  const panelContent =
    activeTool === "edit" ? (
      <CustomerEditPanel
        template={template}
        values={values}
        errors={attemptedNext ? validation.errors : {}}
        onChange={onFieldChange}
        activePage={activePage}
        onFocusPage={onActivePageChange}
        selectedLayerId={selectedLayerId}
        onSelectLayer={setSelectedLayerId}
        onOpenUploads={() => setActiveTool("uploads")}
      />
    ) : activeTool === "addText" ? (
      <CustomerAddTextPanel
        template={template}
        activePage={activePage}
        userLayers={editorState.userLayers}
        selectedLayerId={selectedLayerId}
        onAddText={addUserTextLayer}
        onSelectLayer={setSelectedLayerId}
        onUpdateText={(layerId, text) => updateUserLayer(layerId, { text }, `usertext-${layerId}`)}
        onDeleteLayer={deleteUserLayer}
      />
    ) : activeTool === "uploads" ? (
      <CustomerUploadsPanel
        template={template}
        values={values}
        errors={attemptedNext ? validation.errors : {}}
        onChange={onFieldChange}
        onUploadPhoto={onUploadPhoto}
        selectedLayerId={selectedLayerId}
        onSelectLayer={setSelectedLayerId}
        onFocusPage={onActivePageChange}
        selectedGridLayer={gridsEnabled && selectedLayer?.type === "grid" ? selectedLayer : null}
        selectedGridSlotId={selectedGridSlotId}
        onPickGridAsset={(asset: any) => gridsEnabled && selectedLayer?.type === "grid" && selectedGridSlotId && applyGridSlotAsset(selectedLayer.id, selectedGridSlotId, { ...asset, assetId: asset.id, signedUrl: asset.signedUrl || asset.url })}
      />
    ) : activeTool === "elements" ? (
      <CustomerElementsPanel onInsertElement={addElementLayer} />
    ) : (
      <CustomerOptionsPanel
        product={product}
        options={options}
        onOptionChange={onOptionChange}
        quantity={quantity}
        onQuantityChange={onQuantityChange}
        unitPrice={unitPrice}
      />
    );

  return (
    <div data-customizer-root className="fixed inset-0 z-[100] flex flex-col bg-[#F8F6F1] text-[#303839]">
      <CustomerCustomizerHeader
        productTitle={product.title}
        step={step}
        onStepChange={enterStep}
        canEnterReview={validation.ok}
        saveStatusLabel={saveStatusLabel}
        saveStatus={savingDraft ? "saving" : saveStatus}
        onClose={handleClose}
        onSaveExit={handleSaveExit}
        savingDraft={savingDraft}
        restoreReady={restoreReady}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={undo}
        onRedo={redo}
        previewMode={previewMode}
        onTogglePreview={() => {
          setSelectedLayerId(null);
          setPreviewMode((current) => !current);
        }}
        primaryLabel={primaryLabel}
        primaryDisabled={adding || (step === "review" && !canAddToCart)}
        onPrimary={goNext}
      />

      <div className="flex min-h-0 flex-1">
        {step === "review" ? (
          <div className="min-h-0 flex-1 overflow-y-auto" data-customizer-protected>
            <CustomizerReviewStep
              template={template}
              values={values}
              editorState={editorState}
              options={options}
              quantity={quantity}
              basePrice={basePrice}
              optionsSurcharge={optionsSurcharge}
              unitPrice={unitPrice}
              approved={approved}
              onApprove={setApproved}
              requireApproval={requireApproval}
              validationErrors={attemptedNext ? validation.errors : {}}
              uploading={uploading}
              saveStatus={saveStatus}
              currency={product.currency}
              customizationId={customizationId}
            />
          </div>
        ) : (
          <>
            {/* Left tool rail (desktop) */}
            {showPanels && isDesktop && (
              <div className="hidden lg:block">
                <CustomerToolRail
                  tools={tools}
                  activeTool={activeTool}
                  onSelect={(tool) => {
                    setActiveTool(tool);
                    if (tool === "options") setStep("options");
                    else if (step === "options") setStep("design");
                  }}
                />
              </div>
            )}

            {/* Left settings panel (desktop) */}
            {showPanels && isDesktop && (
              <aside className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-r border-[#303839]/10 bg-white lg:flex">
                <h2 className="border-b border-[#303839]/8 px-4 py-3 font-display text-xl text-[#303839]">{panelTitle}</h2>
                <div className="min-h-0 flex-1 overflow-y-auto">{panelContent}</div>
              </aside>
            )}

            {/* Central workspace */}
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-customizer-protected>
              {showTextToolbar && selectedLayer && (
                <div className="pointer-events-none absolute inset-x-2 top-2 z-40 flex justify-center">
                  <CustomerContextToolbar
                    layer={selectedLayer}
                    permissions={selectedPermissions as Record<string, boolean>}
                    isUserLayer={selectedIsUser}
                    onStyleChange={onToolbarStyleChange}
                    onEditText={onEditTextAction}
                    onDuplicate={
                      selectedIsUser || (selectedPermissions as any).duplicate ? duplicateSelectedLayer : undefined
                    }
                    onDelete={selectedIsUser ? onDeleteSelected : undefined}
                  />
                </div>
              )}

              {showElementToolbar && selectedLayer && (
                <div className="pointer-events-none absolute inset-x-2 top-2 z-40 flex justify-center">
                  <CustomerElementToolbar
                    layer={selectedLayer}
                    onPatch={(patch, group) => updateElementLayer(selectedLayer.id, patch, group)}
                    onDuplicate={() => duplicateElementLayer(selectedLayer.id)}
                    onDelete={() => deleteUserLayer(selectedLayer.id)}
                  />
                </div>
              )}

              {showImageToolbar && selectedLayer && (
                <div className="pointer-events-none absolute inset-x-2 top-2 z-40 flex justify-center">
                  <CustomerImageToolbar
                    layer={selectedLayer}
                    permissions={selectedPermissions as Record<string, boolean>}
                    cropping={cropLayerId === selectedLayer.id}
                    hasImage={Boolean(
                      (selectedLayer.fieldId && values[selectedLayer.fieldId]) || selectedLayer.src,
                    )}
                    onReplace={() => {
                      setActiveTool("uploads");
                      setMobilePanelOpen(true);
                    }}
                    onEnterCrop={() => enterCropMode(selectedLayer.id)}
                    onConfirmCrop={confirmCrop}
                    onCancelCrop={cancelCrop}
                    onImagePatch={(patch, group) => {
                      onImageTransformChange(selectedLayer.id, {}, "start");
                      onImageTransformChange(selectedLayer.id, patch, "move");
                    }}
                    onLayerRotate={
                      (selectedPermissions as any).rotate
                        ? (rotation) => {
                            onLayerTransform(selectedLayer.id, {}, "start");
                            onLayerTransform(selectedLayer.id, { rotation }, "move");
                          }
                        : undefined
                    }
                  />
                </div>
              )}

              {showGridToolbar && selectedLayer && selectedGridSlotId && (
                <div className="pointer-events-none absolute inset-x-2 top-2 z-40 flex justify-center">
                  <CustomerGridToolbar
                    layer={selectedLayer}
                    selectedSlotId={selectedGridSlotId}
                    onSelectSlot={setSelectedGridSlotId}
                    onUpload={(file: File) => replaceGridSlot(selectedLayer.id, selectedGridSlotId, file)}
                    onClear={() => clearGridSlot(selectedLayer.id, selectedGridSlotId)}
                    onReset={() => {
                      onGridSlotTransformChange(selectedLayer.id, selectedGridSlotId, {}, "start");
                      onGridSlotTransformChange(selectedLayer.id, selectedGridSlotId, { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false, fitMode: "cover" }, "move");
                    }}
                    onMove={(direction: number) => moveGridSlotPhoto(selectedLayer.id, selectedGridSlotId, direction)}
                    cropping={cropGridSlotId === selectedGridSlotId}
                    onEnterCrop={() => enterGridCropMode(selectedLayer.id, selectedGridSlotId)}
                    onConfirmCrop={confirmGridCrop}
                    onCancelCrop={cancelGridCrop}
                    onTransform={(patch: any) => {
                      onGridSlotTransformChange(selectedLayer.id, selectedGridSlotId, {}, "start");
                      onGridSlotTransformChange(selectedLayer.id, selectedGridSlotId, patch, "move");
                    }}
                  />
                </div>
              )}

              <div className="min-h-0 flex-1">
                <CustomizerWorkspace
                  template={template}
                  values={values}
                  editorState={editorState}
                  pageId={activePage}
                  zoom={viewZoom}
                  selectedLayerId={previewMode ? null : selectedLayerId}
                  onSelectLayer={previewMode ? undefined : onSelectLayer}
                  onLayerTransform={onLayerTransform}
                  cropLayerId={previewMode ? null : cropLayerId}
                  onImageTransform={onImageTransformChange}
                  cropGridSlotId={previewMode || !gridsEnabled ? null : cropGridSlotId}
                  onGridSlotTransform={gridsEnabled ? onGridSlotTransformChange : undefined}
                  onGridSlotSelect={gridsEnabled ? (_layerId, slotId) => setSelectedGridSlotId(slotId) : undefined}
                  onGridSlotAssetDrop={gridsEnabled ? (layerId, slotId, asset) => applyGridSlotAsset(layerId, slotId, { ...asset, assetId: asset.id, signedUrl: asset.signedUrl || asset.url }) : undefined}
                  onTextLayerActivate={() => onEditTextAction()}
                  onImageLayerActivate={(layerId) => enterCropMode(layerId)}
                  previewMode={previewMode}
                  showWatermark={protectionEnabled}
                  showSafeArea={showSafeArea}
                  showBleed={Boolean(template?.settings?.showBleed) && !previewMode}
                />
              </div>

              {/* Bottom controls */}
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex items-end justify-center gap-2 px-3">
                <div className="pointer-events-auto flex items-center gap-2">
                  <CustomizerZoomControls
                    zoom={viewZoom}
                    onZoomChange={(z) => setViewZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)))}
                    onFit={() => setViewZoom(1)}
                  />
                  <a
                    href="/support"
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Help"
                    className="grid h-9 w-9 place-items-center rounded-full border border-[#303839]/12 bg-white text-sm font-bold text-[#303839]/70 shadow-[0_4px_18px_rgba(48,56,57,0.10)] hover:bg-[#F8F6F1]"
                  >
                    ?
                  </a>
                </div>
              </div>
              <div className="pointer-events-none absolute bottom-3 right-3 z-30 hidden xl:block">
                <CustomerMockupPreview
                  template={template}
                  values={values}
                  editorState={editorState}
                  customizationId={customizationId}
                  saveStatus={saveStatus}
                />
              </div>

              {protectionEnabled && (
                <p className="pointer-events-none absolute bottom-1 left-2 z-30 hidden text-[10px] text-[#303839]/40 sm:block">
                  Protected preview. Copying, downloading, and printing are disabled.
                </p>
              )}
            </main>

            {/* Right page thumbnails (desktop) */}
            <aside className="hidden w-[128px] shrink-0 overflow-y-auto border-l border-[#303839]/10 bg-white p-3 lg:block" data-customizer-protected>
              <CustomizerPageThumbnails
                template={template}
                values={values}
                editorState={editorState}
                activePage={activePage}
                onSelect={onActivePageChange}
                showSinglePage
              />
            </aside>
          </>
        )}
      </div>

      {/* Mobile: horizontal thumbnails + bottom tool rail + slide-up panel */}
      {step !== "review" && !previewMode && !isDesktop && (
        <div className="lg:hidden">
          <div className="overflow-x-auto border-t border-[#303839]/10 bg-white px-3 py-2 no-scrollbar" data-customizer-protected>
            <CustomizerPageThumbnails
              template={template}
              values={values}
              editorState={editorState}
              activePage={activePage}
              onSelect={onActivePageChange}
              orientation="horizontal"
              showSinglePage
            />
          </div>
          <CustomerToolRail
            tools={tools}
            activeTool={mobilePanelOpen ? activeTool : null}
            orientation="horizontal"
            onSelect={(tool) => {
              if (mobilePanelOpen && activeTool === tool) {
                setMobilePanelOpen(false);
                return;
              }
              setActiveTool(tool);
              setMobilePanelOpen(true);
              if (tool === "options") setStep("options");
              else if (step === "options") setStep("design");
            }}
          />
          {mobilePanelOpen && (
            <div className="fixed inset-x-0 bottom-0 z-50 max-h-[68vh] overflow-hidden rounded-t-2xl border-t border-[#303839]/12 bg-white shadow-[0_-12px_40px_rgba(48,56,57,0.18)]">
              <div className="flex items-center justify-between border-b border-[#303839]/8 px-4 py-2.5">
                <h2 className="font-display text-lg text-[#303839]">{panelTitle}</h2>
                <button
                  type="button"
                  aria-label="Close panel"
                  onClick={() => setMobilePanelOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-full text-[#303839]/60 hover:bg-[#F8F6F1]"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="max-h-[58vh] overflow-y-auto">{panelContent}</div>
            </div>
          )}
        </div>
      )}

      {/* Preview-mode notice */}
      {previewMode && (
        <div className="pointer-events-none absolute inset-x-0 top-28 z-40 flex justify-center sm:top-16">
          <span className="rounded-full bg-[#303839] px-4 py-1.5 text-xs font-bold text-white">
            Preview — your card exactly as designed
          </span>
        </div>
      )}

      {/* Messages */}
      {message && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-50 flex justify-center px-4">
          <p className="pointer-events-auto rounded-lg border border-[#303839]/15 bg-white px-4 py-3 text-center text-sm font-bold text-[#303839] shadow-[0_10px_30px_rgba(48,56,57,0.15)]">
            {message}
          </p>
        </div>
      )}

      {protectionEnabled && <CustomizerProtectionOverlay covered={covered} />}
    </div>
  );
}
