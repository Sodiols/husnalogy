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
import CustomizerZoomControls from "@/app/components/customizer/CustomizerZoomControls";
import { ZOOM_MAX, ZOOM_MIN, clampZoom } from "@/lib/customizer/v2/zoom";
import { isTypingTarget } from "@/lib/customizer/v2/viewport-pan";
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
import CustomerGroupToolbar from "@/app/components/customizer/CustomerGroupToolbar";
import CustomerLayersPanel from "@/app/components/customizer/CustomerLayersPanel";
import CustomerInsertPanel from "@/app/components/customizer/CustomerInsertPanel";
import CustomerSelectionPanel from "@/app/components/customizer/CustomerSelectionPanel";
import CustomerProductEditingPreview from "@/app/components/customizer/CustomerProductEditingPreview";
import CustomerShortcutHelp from "@/app/components/customizer/CustomerShortcutHelp";
import CustomerOptionsPanel, { CUSTOMIZER_FORMAT_OPTIONS } from "@/app/components/customizer/CustomerOptionsPanel";
import CustomizerProtectionOverlay from "@/app/components/customizer/CustomizerProtectionOverlay";
import useCustomizerProtection from "@/app/components/customizer/useCustomizerProtection";
import useCustomizerHistory from "@/app/components/customizer/useCustomizerHistory";
import {
  createSaveQueue,
  saveStatusLabel as formatSaveStatus,
  type SaveQueue,
  type SaveQueueStatus,
} from "@/lib/customizer/save-queue";
import { isCustomizerFeatureEnabled } from "@/lib/customizer/v2/feature-flags";
import { stripEphemeralAssetUrls } from "@/lib/customizer/v2/asset-references";
import { anyGridSlotGrantsPhotoEditing, createGridSlotsFromPreset, GRID_PRESETS } from "@/lib/customizer/v2/grids";
import CustomerCanvasContextMenu from "@/app/components/customizer/CustomerCanvasContextMenu";
import { buildCustomerContextMenu, type ContextMenuActionId } from "@/lib/customizer/v2/context-menu";
import { resolveImageCropCapabilities } from "@/lib/customizer/v2/image-permissions";
import { alignCustomerLayers, arrangeLayers, removeCustomerLayers, reorderLayerByDrop, type AlignAction, type ArrangeAction } from "@/lib/customizer/v2/customer-actions";
import { evaluateGroupAction, getDescendantIds, groupLayers, transformGroupChildren, ungroupLayers } from "@/lib/customizer/v2/groups";
import { DEFAULT_LINE_HEIGHT, createCanvasMeasure, getSingleLineTextBox, isSingleLineAutoSizeText } from "@/lib/customizer/v2/text-layout";
import { resolveLayerSelectionGeometry } from "@/lib/customizer/v2/selection-geometry";
import { resolveSelection, sanitizeSelection } from "@/lib/customizer/v2/selection";
import {
  canonicalTextLayerUpdate,
  getTextPlacementStyle,
  normalizeCanonicalText,
  type TextPlacementPreset,
} from "@/lib/customizer/v2/text-editing";
import {
  buildInitialValues,
  buildRenderData,
  getEnabledPages,
  getEffectiveLayersForPage,
  getFieldById,
  getLayerPermissions,
  isImageValue,
  isLayerCustomerInteractive,
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
const customerTextMeasure = createCanvasMeasure();

// Easy Personalize (spec §1): the only tools a normal wedding customer needs
// — their own details and photos, then product options. Everything else
// (Add Text, Elements, Shapes, Lines, Frames, Grids, QR, Background, Layers)
// is professional canvas authoring, gated behind an explicit "Advanced
// Customize" switch so it never confronts someone who just wants to change a
// name and a date.
const EASY_PERSONALIZE_TOOL_IDS = new Set<CustomerTool>(["edit", "uploads", "options"]);

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
  activePage: string;
  selectedLayerIds: string[];
  editingGroupId: string | null;
};

export default function PersonalizeClient({ product, template }: { product: any; template: any }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, authLoading } = useAuth();
  const gridsEnabled = isCustomizerFeatureEnabled(template, "customizer_v2_grids") || isCustomizerFeatureEnabled(template, "customizer_v2_customer_grids");
  const customerLayersEnabled = Boolean(template?.settings?.showCustomerLayers) && isCustomizerFeatureEnabled(template, "customizer_v2_customer_layers");
  const multiselectEnabled = isCustomizerFeatureEnabled(template, "customizer_v2_customer_multiselect");
  const customerGroupingEnabled = Boolean(template?.settings?.allowCustomerGrouping) && isCustomizerFeatureEnabled(template, "customizer_v2_customer_grouping");
  const customerShapesEnabled = Boolean(template?.settings?.allowCustomerShapes) && isCustomizerFeatureEnabled(template, "customizer_v2_customer_shapes");
  const customerLinesEnabled = Boolean(template?.settings?.allowCustomerLines) && isCustomizerFeatureEnabled(template, "customizer_v2_customer_lines");
  const customerFramesEnabled = Boolean(template?.settings?.allowCustomerFrames) && isCustomizerFeatureEnabled(template, "customizer_v2_customer_frames");
  const customerGridsEnabled = Boolean(template?.settings?.allowCustomerGrids) && isCustomizerFeatureEnabled(template, "customizer_v2_customer_grids");
  const qrEnabled = Boolean(template?.settings?.allowCustomerQRCodes) && isCustomizerFeatureEnabled(template, "customizer_v2_qr_codes");
  const imageFiltersEnabled = isCustomizerFeatureEnabled(template, "customizer_v2_image_filters");
  const productPreviewEditingEnabled = isCustomizerFeatureEnabled(template, "customizer_v2_product_preview_editing");
  const splitViewEnabled = isCustomizerFeatureEnabled(template, "customizer_v2_split_view");
  const allowedCustomerFonts: string[] = Array.isArray(template?.settings?.allowedCustomerFonts) ? template.settings.allowedCustomerFonts : [];
  const allowedCustomerColors: string[] = Array.isArray(template?.settings?.allowedCustomerColors) ? template.settings.allowedCustomerColors : [];
  const allowedCustomerShapes: string[] = Array.isArray(template?.settings?.allowedCustomerShapes) ? template.settings.allowedCustomerShapes : [];
  const allowedCustomerElementIds: string[] = Array.isArray(template?.settings?.allowedCustomerElementIds) ? template.settings.allowedCustomerElementIds : [];
  const allowedCustomerFrameMasks: string[] = Array.isArray(template?.settings?.allowedCustomerFrameMasks) ? template.settings.allowedCustomerFrameMasks : [];
  const allowedCustomerGridPresets: string[] = Array.isArray(template?.settings?.allowedCustomerGridPresets) ? template.settings.allowedCustomerGridPresets : [];
  const allowedCustomerImageFilters: string[] = Array.isArray(template?.settings?.allowedCustomerImageFilters) ? template.settings.allowedCustomerImageFilters : [];
  const allowedCustomerPages: string[] = Array.isArray(template?.settings?.allowedCustomerPages) ? template.settings.allowedCustomerPages : [];

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
  // Real Fit (spec §9): reported by the workspace from its measured box, so the
  // Fit button always lands on a zoom where the whole page is visible on the
  // current screen — not a hardcoded 100%.
  const [fitZoom, setFitZoom] = useState<number | null>(null);
  // Until the customer chooses their own zoom, the canvas follows Fit — so the
  // whole card is visible on load and stays visible when a panel opens, the
  // keyboard appears, or the device rotates.
  const userChoseZoomRef = useRef(false);
  const setZoomSafely = useCallback((nextZoom: number) => {
    userChoseZoomRef.current = true;
    setViewZoom(clampZoom(nextZoom, ZOOM_MIN, ZOOM_MAX));
  }, []);
  const onWorkspaceFitZoom = useCallback((next: number) => {
    setFitZoom(next);
    if (!userChoseZoomRef.current) setViewZoom(next);
  }, []);
  const fitToPage = useCallback(() => {
    // Explicit Fit hands control back to the automatic behaviour.
    userChoseZoomRef.current = false;
    if (fitZoom !== null) setViewZoom(fitZoom);
  }, [fitZoom]);
  const actualSizeZoom = useCallback(() => {
    userChoseZoomRef.current = true;
    setViewZoom(1);
  }, []);
  const [approved, setApproved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [message, setMessage] = useState("");
  const [attemptedNext, setAttemptedNext] = useState(false);
  const [customizationId, setCustomizationId] = useState(initialCustomizationId);
  const [cartItemId, setCartItemId] = useState(initialCartItemId);
  const [restoreReady, setRestoreReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveQueueStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [selectedGridSlotId, setSelectedGridSlotId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<CustomerTool>("edit");
  const [textPlacementPreset, setTextPlacementPreset] = useState<TextPlacementPreset>("body");
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const [editTextRequest, setEditTextRequest] = useState<{ layerId: string; requestId: number; created?: boolean } | null>(null);
  // Easy Personalize vs Advanced Customize (spec §1/§2): a display-only
  // toggle over the SAME values/editorState — never a second document. Easy
  // mode simply narrows which tools are reachable so ordinary wedding
  // customers never see professional design controls unless they ask for them.
  const [customizeMode, setCustomizeMode] = useState<"easy" | "advanced">("easy");
  const [previewMode, setPreviewMode] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"print" | "product" | "split">("print");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
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
  const selectedLayerIdsRef = useRef(selectedLayerIds);
  const editingGroupIdRef = useRef(editingGroupId);
  const quantityRef = useRef(quantity);
  const customizationIdRef = useRef(customizationId);
  const cartItemIdRef = useRef(cartItemId);
  const dirtyRef = useRef(dirty);
  const changeVersionRef = useRef(0);
  const customerClipboardRef = useRef<any[]>([]);
  const activeTextHistoryIdRef = useRef<string | null>(null);
  const activeTextSessionRef = useRef<{
    layerId: string;
    snapshot: HistorySnapshot;
    dirty: boolean;
    changeVersion: number;
  } | null>(null);

  valuesRef.current = values;
  editorStateRef.current = editorState;
  optionsRef.current = options;
  activePageRef.current = activePage;
  selectedLayerIdsRef.current = selectedLayerIds;
  editingGroupIdRef.current = editingGroupId;
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
  const pageAllowsCustomerObjects = !allowedCustomerPages.length || allowedCustomerPages.includes(activePage);
  const tools = useMemo(
    () => getCustomerTools({ allowAddText: pageAllowsCustomerObjects && anyPageAllowsText, hasUploads: hasUploadFields, allowElements: pageAllowsCustomerObjects && allowElements, allowShapes: pageAllowsCustomerObjects && customerShapesEnabled, allowLines: pageAllowsCustomerObjects && customerLinesEnabled, allowFrames: pageAllowsCustomerObjects && customerFramesEnabled, allowGrids: pageAllowsCustomerObjects && customerGridsEnabled, allowQRCode: pageAllowsCustomerObjects && qrEnabled, allowBackground: pageAllowsCustomerObjects && Boolean(template?.settings?.allowCustomerBackground), showLayers: customerLayersEnabled }),
    [pageAllowsCustomerObjects, anyPageAllowsText, hasUploadFields, allowElements, customerShapesEnabled, customerLinesEnabled, customerFramesEnabled, customerGridsEnabled, qrEnabled, customerLayersEnabled, template?.settings?.allowCustomerBackground],
  );

  const hasAdvancedTools = tools.some((tool) => !EASY_PERSONALIZE_TOOL_IDS.has(tool.id));
  const visibleTools = useMemo(
    () => (customizeMode === "easy" ? tools.filter((tool) => EASY_PERSONALIZE_TOOL_IDS.has(tool.id)) : tools),
    [customizeMode, tools],
  );
  const setCustomizeModeSafely = (mode: "easy" | "advanced") => {
    setCustomizeMode(mode);
    if (mode === "easy" && !EASY_PERSONALIZE_TOOL_IDS.has(activeTool)) setActiveTool("edit");
  };

  useEffect(() => {
    if (!selectedLayerId) {
      if (selectedLayerIds.length) setSelectedLayerIds([]);
      return;
    }
    if (!selectedLayerIds.includes(selectedLayerId)) setSelectedLayerIds([selectedLayerId]);
    // selectedLayerIds is deliberately read as the current selection guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId]);

  const { covered } = useCustomizerProtection(protectionEnabled);

  /* ----- dirty tracking + history ----- */
  const markDirty = () => {
    changeVersionRef.current += 1;
    setDirty(true);
  };

  const snapshot = (): HistorySnapshot => ({
    values: valuesRef.current,
    editorState: editorStateRef.current,
    options: optionsRef.current,
    quantity: quantityRef.current,
    activePage: activePageRef.current,
    selectedLayerIds: selectedLayerIdsRef.current.slice(),
    editingGroupId: editingGroupIdRef.current,
  });

  const recordHistory = (group?: string) => history.record(snapshot(), group);

  const applySnapshot = (state: HistorySnapshot) => {
    setValues(state.values);
    setEditorState(state.editorState);
    setOptions(state.options as any);
    setQuantity(state.quantity);
    setActivePage(state.activePage);
    setEditingGroupId(state.editingGroupId);
    setSelectedLayerIds(state.selectedLayerIds);
    setSelectedLayerId(state.selectedLayerIds[state.selectedLayerIds.length - 1] || null);
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

    // A new photo must never inherit the previous photo's crop/zoom/pan/flip.
    // Frame geometry is untouched (values live separately from layerOverrides),
    // but the persisted imageTransform override has to be cleared here or
    // resolveLayerImage() will keep applying the old photo's dialed-in crop to
    // whatever image now fills the frame.
    const field = (template?.fields || []).find((f: any) => f.id === fieldId);
    if (field && (field.type === "image" || field.type === "file")) {
      const boundLayerIds = (template?.layers || [])
        .filter((layer: any) => layer.fieldId === fieldId && (layer.type === "image" || layer.type === "frame"))
        .map((layer: any) => layer.id);
      if (boundLayerIds.length) {
        patchEditorState((current) => {
          const nextOverrides = { ...current.layerOverrides };
          let changed = false;
          for (const layerId of boundLayerIds) {
            const existing = nextOverrides[layerId];
            if (existing?.imageTransform) {
              const { imageTransform: _drop, ...rest } = existing;
              nextOverrides[layerId] = rest;
              changed = true;
            }
          }
          return changed ? { ...current, layerOverrides: nextOverrides } : current;
        });
      }
    }
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
    activeTextHistoryIdRef.current = null;
    setEditingTextLayerId(null);
    setSelectedLayerIds([]);
    setSelectedLayerId(null);
    setEditingGroupId(null);
    setCropLayerId(null);
    cropBackupRef.current = null;
  };

  const patchEditorState = (patch: (current: EditorState) => EditorState) => {
    markDirty();
    setEditorState((current) => patch(current));
  };

  const updateLayerOverride = (
    layerId: string,
    kind: "textStyle" | "transform" | "imageTransform" | "imageFilters" | "properties",
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

  const canAddCustomerObject = () => {
    if (!pageAllowsCustomerObjects) return false;
    const limit = Math.max(0, Math.round(Number(template?.settings?.maxCustomerObjectsPerPage) || 0));
    if (!limit) return true;
    return editorStateRef.current.userLayers.filter((layer) => layer.page === activePage && layer.type !== "group").length < limit;
  };

  const applyCustomerObjectLimits = (base: Record<string, any>, patch: Record<string, any>, pageId = activePage) => {
    const limits = template?.settings?.customerObjectLimits;
    if (!limits || typeof limits !== "object" || !Object.keys(limits).length) return patch;
    const page = (template?.pages || []).find((entry: any) => entry.id === pageId) || {};
    const pageWidth = Number(page.widthPx || template?.canvasWidthPx) || 1500;
    const pageHeight = Number(page.heightPx || template?.canvasHeightPx) || 2100;
    const next = { ...patch };
    const minWidth = Math.max(1, Number(limits.minWidth) || 1);
    const maxWidth = Number(limits.maxWidth) > 0 ? Number(limits.maxWidth) : pageWidth;
    const minHeight = Math.max(1, Number(limits.minHeight) || 1);
    const maxHeight = Number(limits.maxHeight) > 0 ? Number(limits.maxHeight) : pageHeight;
    const width = Math.min(maxWidth, Math.max(minWidth, Number(next.width ?? base.width) || minWidth));
    const height = Math.min(maxHeight, Math.max(minHeight, Number(next.height ?? base.height) || minHeight));
    const left = Math.max(0, Number(limits.insetLeft) || 0);
    const top = Math.max(0, Number(limits.insetTop) || 0);
    const right = Math.max(0, Number(limits.insetRight) || 0);
    const bottom = Math.max(0, Number(limits.insetBottom) || 0);
    if (next.width !== undefined) next.width = width;
    if (next.height !== undefined) next.height = height;
    if (next.x !== undefined) next.x = Math.min(Math.max(left + width / 2, Number(next.x)), Math.max(left + width / 2, pageWidth - right - width / 2));
    if (next.y !== undefined) next.y = Math.min(Math.max(top + height / 2, Number(next.y)), Math.max(top + height / 2, pageHeight - bottom - height / 2));
    if (next.rotation !== undefined) next.rotation = Math.min(Number.isFinite(Number(limits.maxRotation)) ? Number(limits.maxRotation) : 360, Math.max(Number.isFinite(Number(limits.minRotation)) ? Number(limits.minRotation) : -360, Number(next.rotation)));
    return next;
  };

  /**
   * One-shot text insertion (spec §11, §18). The Text tool creates exactly one
   * object at the centre of the card, selects it and opens its editor — it
   * never arms a mode, so later taps on the card can never create a second
   * text object by accident.
   */
  const addUserTextLayer = (
    position?: { x: number; y: number },
    preset: TextPlacementPreset = textPlacementPreset,
  ): string | null => {
    if (!pageAllowsCustomerText(template, activePage) || !canAddCustomerObject()) return null;
    const canvasW = template?.canvasWidthPx || 1500;
    const canvasH = template?.canvasHeightPx || 2100;
    const style = getTextPlacementStyle(preset, canvasW, canvasH);
    const placement = position || { x: Math.round(canvasW / 2), y: Math.round(canvasH / 2) };
    const maxZ = Math.max(
      999,
      ...editorStateRef.current.userLayers
        .filter((item) => item.page === activePage)
        .map((item) => Number(item.zIndex) || 0),
    );
    const draft = {
      page: activePage,
      name: style.name,
      text: "",
      x: placement.x,
      y: placement.y,
      width: style.width,
      height: style.height,
      zIndex: maxZ + 1,
      textStyle: {
        fontFamily: allowedCustomerFonts[0] || "Cormorant Garamond",
        color: allowedCustomerColors[0] || "#303839",
        fontSize: style.fontSize,
        textAlign: style.textAlign,
        verticalAlign: "middle",
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        multiline: style.multiline,
        autoSizeMode: style.multiline ? "height" : "width",
      },
    };
    const layer = normalizeUserLayer(applyCustomerObjectLimits(draft, draft));
    if (!layer) return null;
    activeTextSessionRef.current = {
      layerId: layer.id,
      snapshot: snapshot(),
      dirty: dirtyRef.current,
      changeVersion: changeVersionRef.current,
    };
    recordHistory();
    activeTextHistoryIdRef.current = layer.id;
    patchEditorState((current) => ({ ...current, userLayers: [...current.userLayers, layer] }));
    setSelectedLayerIds([layer.id]);
    setSelectedLayerId(layer.id);
    setActiveTool("addText");
    // Hand the new object to the canvas so typing can start straight away; an
    // object left empty is discarded again.
    setEditTextRequest((request) => ({ layerId: layer.id, requestId: (request?.requestId || 0) + 1, created: true }));
    return layer.id;
  };

  /** Toolbar action: insert one text object and stay in the resting state. */
  const insertCustomerText = (preset: TextPlacementPreset = textPlacementPreset) => {
    setWorkspaceMode("print");
    setActiveTool("addText");
    if (step === "options") setStep("design");
    addUserTextLayer(undefined, preset);
  };

  const addElementLayer = (element: LibraryElement, position?: { x: number; y: number }) => {
    if (!allowElements || !element?.url || !canAddCustomerObject() || (allowedCustomerElementIds.length && !allowedCustomerElementIds.includes(element.id))) return;
    const canvasW = template?.canvasWidthPx || 1500;
    const canvasH = template?.canvasHeightPx || 2100;
    // Size the element to about a quarter of the canvas width, keeping its
    // aspect ratio when known.
    const width = Math.round(canvasW * 0.25);
    const ratio = element.width > 0 && element.height > 0 ? element.height / element.width : 1;
    const draft = {
      type: "element",
      page: activePage,
      assetId: element.id,
      src: element.url,
      tintColor: element.tintable ? element.defaultColor || "" : "",
      x: Math.round(position?.x ?? canvasW / 2),
      y: Math.round(position?.y ?? canvasH / 2),
      width,
      height: Math.max(24, Math.round(width * ratio)),
    };
    const layer = normalizeUserLayer(applyCustomerObjectLimits(draft, draft));
    if (!layer) return;
    recordHistory();
    patchEditorState((current) => ({ ...current, userLayers: [...current.userLayers, layer] }));
    setSelectedLayerId(layer.id);
  };

  const addCustomerObject = (input: Record<string, any>) => {
    if (!canAddCustomerObject()) return;
    const canvasW = Number(template?.canvasWidthPx) || 1500;
    const canvasH = Number(template?.canvasHeightPx) || 2100;
    const maxZ = Math.max(999, ...editorStateRef.current.userLayers.filter((item) => item.page === activePage).map((item) => Number(item.zIndex) || 0));
    const draft = {
      page: activePage,
      x: Math.round(canvasW / 2),
      y: Math.round(canvasH / 2),
      width: Math.round(canvasW * 0.28),
      height: Math.round(canvasW * 0.28),
      zIndex: maxZ + 1,
      opacity: 1,
      ...input,
    };
    const layer = normalizeUserLayer(applyCustomerObjectLimits(draft, draft));
    if (!layer) return;
    recordHistory();
    patchEditorState((current) => ({ ...current, userLayers: [...current.userLayers, layer] }));
    setSelectedLayerIds([layer.id]);
    setSelectedLayerId(layer.id);
  };

  const addCustomerShape = (shape: string) => {
    if (!customerShapesEnabled || (allowedCustomerShapes.length && !allowedCustomerShapes.includes(shape))) return;
    addCustomerObject({ type: "shape", name: "Customer shape", shape, fill: allowedCustomerColors[0] || "#F8F6F1", stroke: allowedCustomerColors[1] || allowedCustomerColors[0] || "#303839", strokeWidth: 2, borderRadius: shape === "rounded-rectangle" ? 36 : 0, points: shape === "polygon" ? [{ x: 0.5, y: 0 }, { x: 1, y: 0.38 }, { x: 0.82, y: 1 }, { x: 0.18, y: 1 }, { x: 0, y: 0.38 }] : [] });
  };

  const addCustomerLine = (lineStyle: string) => {
    if (!customerLinesEnabled) return;
    addCustomerObject({ type: "shape", name: "Customer line", shape: "line", fill: "none", stroke: allowedCustomerColors[0] || "#303839", strokeWidth: 4, lineStyle, lineCap: "round", lineStartCap: "none", lineEndCap: "none", width: Math.round((Number(template?.canvasWidthPx) || 1500) * 0.5), height: 8 });
  };

  const addCustomerFrame = (maskShape: string) => {
    if (!customerFramesEnabled || (allowedCustomerFrameMasks.length && !allowedCustomerFrameMasks.includes(maskShape))) return;
    addCustomerObject({ type: "frame", name: "Customer photo frame", src: "", maskShape, fitMode: "cover", borderColor: allowedCustomerColors[0] || "#303839", borderWidth: 0, backgroundColor: allowedCustomerColors[1] || allowedCustomerColors[0] || "#F8F6F1" });
  };

  const addCustomerGrid = (presetId: string) => {
    if (!customerGridsEnabled || (allowedCustomerGridPresets.length && !allowedCustomerGridPresets.includes(presetId))) return;
    const slots = createGridSlotsFromPreset(presetId);
    const preset = GRID_PRESETS.find((item) => item.id === presetId);
    addCustomerObject({ type: "grid", presetId, name: preset?.label || "Customer photo grid", columns: preset?.columns || 1, rows: preset?.rows || slots.length, slots, gap: 12, padding: 0, cornerRadius: 0, borderColor: "", borderWidth: 0, backgroundColor: allowedCustomerColors[0] || "#F8F6F1", width: Math.round((Number(template?.canvasWidthPx) || 1500) * 0.68), height: Math.round((Number(template?.canvasHeightPx) || 2100) * 0.45) });
  };

  const addCustomerQRCode = (value: string) => {
    if (!qrEnabled) return;
    const size = Math.max(225, Math.round((Number(template?.canvasWidthPx) || 1500) * 0.2));
    addCustomerObject({ type: "qrCode", name: "Customer QR code", value, foregroundColor: allowedCustomerColors[0] || "#303839", backgroundColor: allowedCustomerColors[1] || "#ffffff", errorCorrection: "M", margin: 4, moduleStyle: "square", width: size, height: size });
  };

  const setCustomerBackground = (color: string) => {
    if (!template?.settings?.allowCustomerBackground || !pageAllowsCustomerObjects || (allowedCustomerColors.length && !allowedCustomerColors.includes(color))) return;
    const existing = editorStateRef.current.userLayers.find((item) => item.page === activePage && item.type === "background");
    if (existing) {
      updateUserLayer(existing.id, { color, width: Number(template?.canvasWidthPx) || 1500, height: Number(template?.canvasHeightPx) || 2100 }, `background-${activePage}`);
      setSelectedLayerId(existing.id);
      return;
    }
    addCustomerObject({ type: "background", name: "Customer background", color, src: "", fitMode: "cover", width: Number(template?.canvasWidthPx) || 1500, height: Number(template?.canvasHeightPx) || 2100, zIndex: -1000, locked: true });
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
      userLayers: removeCustomerLayers(current.userLayers, [layerId]),
    }));
    setSelectedLayerIds([]);
    setSelectedLayerId(null);
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
  const selectedLayers = useMemo(
    () => effectiveLayers.filter((layer: any) => selectedLayerIds.includes(layer.id)),
    [effectiveLayers, selectedLayerIds],
  );
  const selectedActionLayers = useMemo(() => {
    const ids = new Set(selectedLayerIds);
    for (const layer of selectedLayers) {
      if (layer.type === "group") {
        getDescendantIds(effectiveLayers, layer.id).forEach((id) => ids.add(id));
      }
    }
    return effectiveLayers.filter((layer: any) => ids.has(layer.id));
  }, [effectiveLayers, selectedLayerIds, selectedLayers]);
  const customerSelectableLayers = useMemo(
    () =>
      effectiveLayers
        .filter((layer: any) => !layer.hidden)
        .filter((layer: any) => layer.isUserLayer || isLayerCustomerInteractive(layer))
        .filter((layer: any) => {
          if (layer.type === "group" && editingGroupId === layer.id) return false;
          if (layer.groupId && layer.groupId !== editingGroupId) {
            const parent = effectiveLayers.find((candidate: any) => candidate.id === layer.groupId);
            if (parent && (parent.isUserLayer || isLayerCustomerInteractive(parent))) return false;
          }
          return true;
        }),
    [effectiveLayers, editingGroupId],
  );
  const resolvedSelectedLayers = useMemo(() => {
    const safeBounds = {
      left: Number(template?.safeArea?.left) || 0,
      top: Number(template?.safeArea?.top) || 0,
      right: (Number(template?.canvasWidthPx) || 1500) - (Number(template?.safeArea?.right) || 0),
      bottom: (Number(template?.canvasHeightPx) || 2100) - (Number(template?.safeArea?.bottom) || 0),
    };
    return selectedLayers.map((layer: any) => {
      const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
      return resolveLayerSelectionGeometry(layer, {
        text: String(resolveLayerText(layer, field, values)),
        measure: customerTextMeasure,
        safeBounds,
      });
    });
  }, [selectedLayers, template, values]);
  const canMoveCustomerLayer = (layer: any) =>
    !((layer.isUserLayer && layer.locked) || layer.customerLocked || layer.positionLocked || layer.customerInteractionDisabled) &&
    (layer.isUserLayer || getLayerPermissions(layer).move);
  const canMoveSelection =
    selectedLayers.length === selectedLayerIds.length &&
    selectedLayers.length > 0 &&
    selectedActionLayers.every(canMoveCustomerLayer);
  const canDuplicateSelection =
    selectedLayers.length === selectedLayerIds.length &&
    selectedLayers.length > 0 &&
    selectedActionLayers.every((layer: any) => layer.isUserLayer || getLayerPermissions(layer).duplicate);
  const canDeleteSelection =
    selectedLayers.length === selectedLayerIds.length &&
    selectedLayers.length > 0 &&
    selectedActionLayers.every((layer: any) => layer.isUserLayer || getLayerPermissions(layer).delete);
  const canArrangeSelection =
    selectedLayers.length === selectedLayerIds.length &&
    selectedLayers.length > 0 &&
    selectedActionLayers.every(
      (layer: any) =>
        !layer.positionLocked &&
        !layer.customerLocked &&
        !(layer.isUserLayer && layer.locked) &&
        !layer.customerInteractionDisabled &&
        (layer.isUserLayer || getLayerPermissions(layer).changeLayerOrder),
    );
  const canGroupSelection =
    customerGroupingEnabled &&
    selectedLayers.length === selectedLayerIds.length &&
    selectedLayers.length > 1 &&
    selectedLayers.every(
      (layer: any) =>
        !layer.positionLocked &&
        !layer.customerLocked &&
        !(layer.isUserLayer && layer.locked) &&
        !layer.customerInteractionDisabled &&
        (layer.isUserLayer || getLayerPermissions(layer).group),
    );
  const canUngroupSelection =
    selectedLayers.length === 1 &&
    selectedLayers[0]?.type === "group" &&
    (selectedLayers[0]?.isUserLayer || selectedLayers[0]?.allowCustomerUngroup);
  const selectedIsUser = Boolean(selectedLayer?.isUserLayer);
  const selectedPermissions = useMemo(
    () => (selectedLayer ? getLayerPermissions(selectedLayer) : {}),
    [selectedLayer],
  );

  /* ---- canvas context menu (spec §20) ------------------------------------ */
  // The canvas already suppresses the browser menu for copy protection, so a
  // right click used to do nothing. Every capability below is the same flag the
  // toolbars use, so the menu can never offer more than the rest of the editor.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // A menu must never outlive the object it acts on: switching page, changing
  // the selection, or entering preview closes it.
  useEffect(() => {
    setContextMenu(null);
  }, [activePage, selectedLayerIds, previewMode]);
  const contextMenuGroups = useMemo(() => {
    if (!contextMenu || !selectedLayer) return [];
    const imageLike = selectedLayer.type === "image" || selectedLayer.type === "frame";
    const cropCapabilities = resolveImageCropCapabilities(selectedPermissions as any);
    return buildCustomerContextMenu({
      selectionCount: selectedLayerIds.length,
      primaryType: selectedLayer.type,
      canEditText:
        selectedLayer.type === "text" && (selectedIsUser || Boolean((selectedPermissions as any).editContent)),
      canReplacePhoto: imageLike && (selectedIsUser || Boolean((selectedPermissions as any).replaceImage)),
      canCrop: imageLike && cropCapabilities.canEnterCrop,
      canEnterGroup: selectedLayerIds.length === 1 && selectedLayer.type === "group",
      canDuplicate: canDuplicateSelection,
      canDelete: canDeleteSelection,
      canArrange: canArrangeSelection,
      canGroup: canGroupSelection,
      canUngroup: canUngroupSelection,
      canHide: selectedIsUser || Boolean((selectedPermissions as any).hide),
      isHidden: Boolean(selectedLayer.hidden),
      // Locking is a customer-layer affordance; template layers are governed by
      // the administrator's own lock state.
      canLock: selectedIsUser,
      isLocked: Boolean(selectedLayer.locked),
    });
  }, [
    contextMenu,
    selectedLayer,
    selectedLayerIds.length,
    selectedPermissions,
    selectedIsUser,
    canDuplicateSelection,
    canDeleteSelection,
    canArrangeSelection,
    canGroupSelection,
    canUngroupSelection,
  ]);

  const runContextMenuAction = (id: ContextMenuActionId) => {
    if (!selectedLayer) return;
    switch (id) {
      case "editText": onEditTextAction(); break;
      case "replacePhoto": setActiveTool("uploads"); setMobilePanelOpen(true); break;
      case "crop": enterCropMode(selectedLayer.id); break;
      case "enterGroup": enterGroup(selectedLayer.id); break;
      case "duplicate": duplicateSelection(); break;
      case "delete": deleteSelection(); break;
      case "bringToFront": arrangeSelection("bringToFront"); break;
      case "bringForward": arrangeSelection("bringForward"); break;
      case "sendBackward": arrangeSelection("sendBackward"); break;
      case "sendToBack": arrangeSelection("sendToBack"); break;
      case "group": groupSelection(); break;
      case "ungroup": ungroupSelection(); break;
      case "hide": toggleLayerVisibility(selectedLayer.id, true); break;
      case "show": toggleLayerVisibility(selectedLayer.id, false); break;
      case "lock": toggleLayerLock(selectedLayer.id, true); break;
      case "unlock": toggleLayerLock(selectedLayer.id, false); break;
    }
  };

  const applySelection = (ids: string[]) => {
    const permitted = multiselectEnabled ? ids : ids.slice(-1);
    setSelectedLayerIds(permitted);
    setSelectedLayerId(permitted[permitted.length - 1] || null);
    if (permitted.length > 1) setMobilePanelOpen(false);
  };

  const onSelectionChange = (ids: string[], groupScope?: string | null) => {
    const scope = groupScope === undefined ? editingGroupId : groupScope;
    const selectable = new Set(
      effectiveLayers
        .filter((layer: any) => !layer.hidden)
        .filter((layer: any) => layer.isUserLayer || isLayerCustomerInteractive(layer))
        .filter((layer: any) => {
          if (layer.type === "group" && scope === layer.id) return false;
          if (layer.groupId && layer.groupId !== scope) {
            const parent = effectiveLayers.find((candidate: any) => candidate.id === layer.groupId);
            if (parent && (parent.isUserLayer || isLayerCustomerInteractive(parent))) return false;
          }
          return true;
        })
        .map((layer: any) => layer.id),
    );
    applySelection(sanitizeSelection(ids, selectable));
  };

  const transformCustomerGroupState = (
    current: EditorState,
    groupId: string,
    patch: Record<string, any>,
  ): EditorState => {
    const descendantIds = new Set([groupId, ...getDescendantIds(effectiveLayers, groupId)]);
    const transformed = transformGroupChildren(effectiveLayers, groupId, patch);
    const transformedById = new Map(transformed.map((layer: any) => [layer.id, layer]));
    const transformKeys = ["x", "y", "width", "height", "rotation", "zIndex"] as const;
    const pickTransform = (layer: any) =>
      Object.fromEntries(transformKeys.filter((key) => layer?.[key] !== undefined).map((key) => [key, layer[key]]));

    const userLayers = current.userLayers.map((layer) => {
      if (!descendantIds.has(layer.id)) return layer;
      const next = transformedById.get(layer.id);
      return next ? { ...layer, ...pickTransform(next) } : layer;
    });
    const layerOverrides = { ...current.layerOverrides };
    for (const layer of effectiveLayers) {
      if (!descendantIds.has(layer.id) || layer.isUserLayer) continue;
      const next = transformedById.get(layer.id);
      if (!next) continue;
      const existing = layerOverrides[layer.id] || {};
      layerOverrides[layer.id] = {
        ...existing,
        transform: { ...(existing.transform || {}), ...pickTransform(next) },
      };
    }
    return { ...current, userLayers, layerOverrides };
  };

  const arrangeSelection = (action: ArrangeAction) => {
    if (!selectedLayerIds.length) return;
    if (!canArrangeSelection) return;
    const actionIds = selectedActionLayers.map((layer: any) => layer.id);
    const arranged = arrangeLayers(effectiveLayers, actionIds, action);
    const zById = new Map(arranged.map((layer: any) => [layer.id, Number(layer.zIndex) || 0]));
    recordHistory(`arrange-${action}`);
    patchEditorState((current) => ({
      ...current,
      userLayers: current.userLayers.map((layer) => zById.has(layer.id) ? { ...layer, zIndex: zById.get(layer.id) } : layer),
      layerOverrides: Object.fromEntries(Object.entries(current.layerOverrides).concat(
        effectiveLayers.filter((layer: any) => !layer.isUserLayer && actionIds.includes(layer.id) && zById.has(layer.id)).map((layer: any) => {
          const existing = current.layerOverrides[layer.id] || {};
          return [layer.id, { ...existing, transform: { ...(existing.transform || {}), zIndex: zById.get(layer.id) } }];
        }),
      )),
    }));
  };

  const reorderLayerFromPanel = (sourceId: string, targetId: string) => {
    const source = effectiveLayers.find((layer: any) => layer.id === sourceId);
    const target = effectiveLayers.find((layer: any) => layer.id === targetId);
    if (!source || !target || String(source.groupId || "") !== String(target.groupId || "")) return;
    const arranged = reorderLayerByDrop(effectiveLayers, sourceId, targetId);
    if (arranged === effectiveLayers) return;
    const zById = new Map(arranged.map((layer: any) => [layer.id, Number(layer.zIndex) || 0]));
    recordHistory("drag-layer-order");
    patchEditorState((current) => ({
      ...current,
      userLayers: current.userLayers.map((layer) => zById.has(layer.id) ? { ...layer, zIndex: zById.get(layer.id) } : layer),
      layerOverrides: Object.fromEntries(Object.entries(current.layerOverrides).concat(
        effectiveLayers.filter((layer: any) => !layer.isUserLayer && layer.id === sourceId && zById.has(layer.id)).map((layer: any) => {
          const existing = current.layerOverrides[layer.id] || {};
          return [layer.id, { ...existing, transform: { ...(existing.transform || {}), zIndex: zById.get(layer.id) } }];
        }),
      )),
    }));
    onSelectionChange([sourceId]);
  };

  const alignSelection = (action: AlignAction) => {
    if (!canMoveSelection) return;
    const activePageEntry = (template?.pages || []).find((entry: any) => entry.id === activePage);
    const card = {
      width: Number(activePageEntry?.widthPx || template?.canvasWidthPx) || 1500,
      height: Number(activePageEntry?.heightPx || template?.canvasHeightPx) || 2100,
    };
    const patches = alignCustomerLayers(resolvedSelectedLayers, selectedLayerIds, action, card);
    if (!Object.keys(patches).length) return;
    recordHistory(`align-${action}`);
    patchEditorState((current) => {
      let nextState = current;
      for (const [layerId, transform] of Object.entries(patches)) {
        const layer = selectedLayers.find((item: any) => item.id === layerId);
        const geometry = resolvedSelectedLayers.find((item: any) => item.id === layerId) || layer;
        if (!layer) continue;
        const translated = {
          ...(transform.x === undefined ? {} : { x: Math.round(Number(layer.x) + Number(transform.x) - Number(geometry.x)) }),
          ...(transform.y === undefined ? {} : { y: Math.round(Number(layer.y) + Number(transform.y) - Number(geometry.y)) }),
        };
        if (layer.type === "group") {
          nextState = transformCustomerGroupState(nextState, layerId, translated);
        } else if (layer.isUserLayer) {
          nextState = {
            ...nextState,
            userLayers: nextState.userLayers.map((item) => item.id === layerId ? { ...item, ...translated } : item),
          };
        } else {
          const existing = nextState.layerOverrides[layerId] || {};
          nextState = {
            ...nextState,
            layerOverrides: {
              ...nextState.layerOverrides,
              [layerId]: { ...existing, transform: { ...(existing.transform || {}), ...translated } },
            },
          };
        }
      }
      return nextState;
    });
  };

  // Spec §76/§98/§111: a customer group can mix the customer's own inserted
  // objects with pre-existing template objects the admin explicitly allowed
  // to be grouped (e.g. selecting "Bride Name" + "&" + "Groom Name" and
  // grouping them). The group container itself always lives in userLayers;
  // a permitted TEMPLATE layer joins it via a server-validated `groupId`
  // override rather than by mutating the trusted template.
  const groupSelection = () => {
    if (!canGroupSelection) return;
    const eligible = selectedLayers.filter(
      (layer: any) =>
        !layer.positionLocked &&
        !layer.customerLocked &&
        !(layer.isUserLayer && layer.locked) &&
        !layer.customerInteractionDisabled &&
        (layer.isUserLayer || getLayerPermissions(layer).group),
    );
    if (eligible.length < 2 || eligible.length !== selectedLayerIds.length) return;
    const groupId = `customer_group_${Date.now().toString(36)}`;
    const eligibleIds = eligible.map((layer: any) => layer.id);
    const grouped = groupLayers(effectiveLayers, eligibleIds, groupId, "Customer group");
    if (grouped === effectiveLayers) return; // rejected: cycle, mixed pages, etc.
    const newGroup = grouped.find((layer: any) => layer.id === groupId);
    if (!newGroup) return;
    recordHistory();
    patchEditorState((current) => {
      const userLayerIds = new Set(eligible.filter((layer: any) => layer.isUserLayer).map((layer: any) => layer.id));
      const templateLayerIds = eligible.filter((layer: any) => !layer.isUserLayer).map((layer: any) => layer.id);

      const userLayers = current.userLayers.map((layer) => (userLayerIds.has(layer.id) ? { ...layer, groupId } : layer));
      userLayers.push({ ...newGroup, isUserLayer: true, customerEditable: true, allowCustomerUngroup: true });

      const layerOverrides = { ...current.layerOverrides };
      for (const layerId of templateLayerIds) {
        layerOverrides[layerId] = { ...(layerOverrides[layerId] || {}), groupId };
      }

      return { ...current, userLayers, layerOverrides };
    });
    applySelection([groupId]);
  };

  const ungroupSelection = () => {
    const group = selectedLayers.find((layer: any) => layer.type === "group");
    if (!canUngroupSelection || !group) return;
    const children = effectiveLayers.filter((layer: any) => layer.groupId === group.id);
    const childIds = children.map((layer: any) => layer.id);
    const ungrouped = ungroupLayers(effectiveLayers, group.id);
    if (ungrouped === effectiveLayers) return;
    recordHistory();
    const parentGroupId = group.groupId || "";
    patchEditorState((current) => {
      const templateChildIds = children.filter((layer: any) => !layer.isUserLayer).map((layer: any) => layer.id);
      const userLayers = current.userLayers
        .filter((layer) => layer.id !== group.id)
        .map((layer) => (layer.groupId === group.id ? { ...layer, groupId: parentGroupId } : layer));

      const layerOverrides = { ...current.layerOverrides };
      for (const layerId of templateChildIds) {
        layerOverrides[layerId] = { ...(layerOverrides[layerId] || {}), groupId: parentGroupId || null };
      }

      return { ...current, userLayers, layerOverrides };
    });
    setEditingGroupId(null);
    onSelectionChange(childIds);
  };

  const enterGroup = (groupId: string) => {
    const children = effectiveLayers.filter((layer: any) => layer.groupId === groupId && !layer.hidden);
    if (!children.length) return;
    setEditingGroupId(groupId);
    onSelectionChange([children[0].id], groupId);
  };

  const exitGroup = () => {
    if (!editingGroupId) return;
    const groupId = editingGroupId;
    setEditingGroupId(null);
    onSelectionChange([groupId]);
  };

  const renameLayer = (layerId: string, name: string) => updateUserLayer(layerId, { name }, `rename-${layerId}`);
  const toggleLayerVisibility = (layerId: string, hidden: boolean) => {
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (!layer) return;
    if (layer.isUserLayer) updateUserLayer(layerId, { hidden }, `visibility-${layerId}`);
    else if (getLayerPermissions(layer).hide) {
      recordHistory(`visibility-${layerId}`);
      patchEditorState((current) => ({ ...current, layerOverrides: { ...current.layerOverrides, [layerId]: { ...(current.layerOverrides[layerId] || {}), hidden } } }));
    }
  };
  const toggleLayerLock = (layerId: string, customerLocked: boolean) => updateUserLayer(layerId, { locked: customerLocked }, `lock-${layerId}`);

  const duplicateSelection = () => {
    if (!canDuplicateSelection) return;
    const allowed = selectedLayers;
    const expandedIds = new Set(allowed.map((layer: any) => layer.id));
    for (const layer of allowed) {
      if (layer.type === "group") getDescendantIds(effectiveLayers, layer.id).forEach((id) => expandedIds.add(id));
    }
    const sources = effectiveLayers.filter((layer: any) => expandedIds.has(layer.id));
    const preliminaries = sources.map((source: any) => normalizeUserLayer({ ...source, id: "", fieldId: "", name: `${source.name || "Object"} copy`, x: Number(source.x || 0) + 32, y: Number(source.y || 0) + 32, locked: false, hidden: false, positionLocked: false, customerInteractionDisabled: false })).filter(Boolean);
    const idMap = new Map<string, string>();
    sources.forEach((source: any, index: number) => { if (preliminaries[index]?.id) idMap.set(source.id, String(preliminaries[index].id)); });
    const copies = preliminaries.map((copy: any, index: number) => ({
      ...copy,
      groupId: idMap.get(sources[index]?.groupId) || "",
      ...(copy.type === "group" ? { childIds: (sources[index]?.childIds || []).map((id: string) => idMap.get(id)).filter(Boolean) } : {}),
    }));
    if (!copies.length) return;
    recordHistory();
    patchEditorState((current) => ({ ...current, userLayers: [...current.userLayers, ...copies] }));
    applySelection(allowed.map((layer: any) => idMap.get(layer.id)).filter(Boolean) as string[]);
  };

  const duplicateLayer = (layerId: string) => {
    const source = effectiveLayers.find((layer: any) => layer.id === layerId);
    if (!source || (!source.isUserLayer && !getLayerPermissions(source).duplicate)) return;
    const expandedIds = new Set([source.id, ...(source.type === "group" ? getDescendantIds(effectiveLayers, source.id) : [])]);
    const sources = effectiveLayers.filter((layer: any) => expandedIds.has(layer.id));
    const preliminaries = sources.map((layer: any) => normalizeUserLayer({ ...layer, id: "", fieldId: "", name: `${layer.name || "Object"} copy`, x: Number(layer.x || 0) + 32, y: Number(layer.y || 0) + 32, locked: false, hidden: false, positionLocked: false, customerInteractionDisabled: false })).filter(Boolean);
    const idMap = new Map<string, string>();
    sources.forEach((layer: any, index: number) => { if (preliminaries[index]?.id) idMap.set(layer.id, String(preliminaries[index].id)); });
    const copies = preliminaries.map((copy: any, index: number) => ({ ...copy, groupId: idMap.get(sources[index]?.groupId) || "", ...(copy.type === "group" ? { childIds: (sources[index]?.childIds || []).map((id: string) => idMap.get(id)).filter(Boolean) } : {}) }));
    recordHistory();
    patchEditorState((current) => ({ ...current, userLayers: [...current.userLayers, ...copies] }));
    applySelection([idMap.get(source.id)!]);
  };

  const deleteSelection = () => {
    if (!canDeleteSelection) return;
    const removableIds = selectedActionLayers.filter((layer: any) => layer.isUserLayer).map((layer: any) => layer.id);
    const hiddenTemplateIds = selectedActionLayers.filter((layer: any) => !layer.isUserLayer).map((layer: any) => layer.id);
    recordHistory();
    patchEditorState((current) => ({
      ...current,
      userLayers: removeCustomerLayers(current.userLayers, removableIds),
      layerOverrides: hiddenTemplateIds.reduce(
        (overrides, layerId) => ({
          ...overrides,
          [layerId]: { ...(overrides[layerId] || {}), hidden: true },
        }),
        current.layerOverrides,
      ),
    }));
    onSelectionChange([]);
  };

  /**
   * Opacity for the whole selection.
   *
   * Every permitted member is updated, and every member shares ONE history
   * group key, so dragging the slider across a multi-selection collapses into a
   * single undo step instead of one per object per frame. Members the customer
   * may not restyle are skipped rather than blocking the others: unlike a
   * geometric transform, changing one object's opacity does not disturb the
   * arrangement of the rest.
   */
  const setSelectionOpacity = (opacity: number) => {
    if (!selectedLayers.length) return;
    const historyGroup = `opacity-${selectedLayers.map((layer: any) => layer.id).join("-")}`;
    for (const layer of selectedLayers) {
      if (layer.isUserLayer) updateUserLayer(layer.id, { opacity }, historyGroup);
      else if (getLayerPermissions(layer).changeOpacity) {
        updateLayerOverride(layer.id, "transform", { opacity }, historyGroup);
      }
    }
  };

  const patchSelectedProperties = (patch: Record<string, any>) => {
    if (selectedLayers.length !== 1) return;
    const layer = selectedLayers[0];
    if (layer.isUserLayer) updateUserLayer(layer.id, patch, `properties-${layer.id}`);
    else updateLayerOverride(layer.id, "properties", patch, `properties-${layer.id}`);
  };

  /* ----- photo crop mode (spec §11) ----- */
  const [cropLayerId, setCropLayerId] = useState<string | null>(null);
  const [cropGridSlotId, setCropGridSlotId] = useState<string | null>(null);
  const cropBackupRef = useRef<any>(null);

  const onImageTransformChange = (layerId: string, patch: any, phase: "start" | "move") => {
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (!layer || (layer.type !== "image" && layer.type !== "frame")) return;
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
    if (layer.isUserLayer) {
      setEditorState((current) => ({ ...current, userLayers: current.userLayers.map((item) => item.id === layerId ? { ...item, imageTransform: { ...(item.imageTransform || {}), ...allowed } } : item) }));
      return;
    }
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
    if (!layer || (layer.type !== "image" && layer.type !== "frame")) return;
    const permissions = getLayerPermissions(layer);
    if (!(permissions.cropImage || permissions.zoomImage || permissions.repositionImage)) return;
    cropBackupRef.current = {
      layerId,
      isUserLayer: Boolean(layer.isUserLayer),
      imageTransform: layer.isUserLayer ? { ...(layer.imageTransform || {}) } : { ...(editorStateRef.current.layerOverrides[layerId]?.imageTransform || {}) },
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
      if (backup.isUserLayer) {
        setEditorState((current) => ({ ...current, userLayers: current.userLayers.map((item) => item.id === backup.layerId ? { ...item, imageTransform: backup.imageTransform } : item) }));
        cropBackupRef.current = null;
        setCropLayerId(null);
        return;
      }
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
    // Deliberately NOT gated on the container's own customerEditable: a fixed
    // grid may still expose editable slots (spec §17). The merged permissions
    // below are the real gate, and they already refuse a slot that grants
    // nothing — matching applyGridSlotAsset and the save validator.
    if (!layer || !slot || layer.customerInteractionDisabled) return;
    const permissions = { ...getLayerPermissions(layer), ...(slot.permissions || {}) };
    if (phase === "start") {
      recordHistory(`grid-crop-${layerId}-${slotId}`);
      return;
    }
    const cropAllowed = permissions.cropImage || permissions.zoomImage || permissions.repositionImage;
    if (!cropAllowed) return;
    markDirty();
    if (layer.isUserLayer) {
      setEditorState((current) => ({ ...current, userLayers: current.userLayers.map((item) => item.id === layerId ? { ...item, slots: (item.slots || []).map((currentSlot: any) => currentSlot.id === slotId ? { ...currentSlot, transform: { ...(currentSlot.transform || {}), ...patch } } : currentSlot) } : item) }));
      return;
    }
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
    const slotPatch = {
      assetId: uploaded.id || uploaded.assetId || uploaded.path || "",
      ownerId: uploaded.ownerId || uploaded.assetReference?.ownerId || "",
      src: uploaded.signedUrl || uploaded.url || "",
      bucket: uploaded.bucket || "customer-uploads",
      path: uploaded.path || "",
      originalPath: uploaded.originalPath || uploaded.assetReference?.storagePath || "",
      assetReference: uploaded.assetReference,
      metadata: { width: Number(uploaded.width) || 0, height: Number(uploaded.height) || 0, originalPath: uploaded.originalPath || "" },
      transform: { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false, fitMode: "cover" as const },
    };
    if (layer.isUserLayer) {
      setEditorState((current) => ({ ...current, userLayers: current.userLayers.map((item) => item.id === layerId ? { ...item, slots: (item.slots || []).map((currentSlot: any) => currentSlot.id === slotId ? { ...currentSlot, ...slotPatch } : currentSlot) } : item) }));
      return;
    }
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
              [slotId]: slotPatch,
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
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (layer?.isUserLayer) {
      setEditorState((current) => ({ ...current, userLayers: current.userLayers.map((item) => item.id === layerId ? { ...item, slots: (item.slots || []).map((slot: any) => slot.id === slotId ? { ...slot, assetId: "", src: "", bucket: "", path: "" } : slot) } : item) }));
      return;
    }
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
    if (layer.isUserLayer) {
      setEditorState((current) => ({ ...current, userLayers: current.userLayers.map((item) => item.id === layerId ? { ...item, slots: (item.slots || []).map((slot: any) => slot.id === source.id ? { ...slot, ...photoPatch(target) } : slot.id === target.id ? { ...slot, ...photoPatch(source) } : slot) } : item) }));
      setSelectedGridSlotId(target.id);
      return;
    }
    setEditorState((current) => {
      const existing = current.layerOverrides[layerId] || {};
      return { ...current, layerOverrides: { ...current.layerOverrides, [layerId]: { ...existing, gridSlots: { ...(existing.gridSlots || {}), [source.id]: photoPatch(target), [target.id]: photoPatch(source) } } } };
    });
    setSelectedGridSlotId(target.id);
  };

  const enterGridCropMode = (layerId: string, slotId: string) => {
    if (!gridsEnabled) return;
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    const currentSlot = layer?.isUserLayer ? layer.slots?.find((slot: any) => slot.id === slotId) : editorStateRef.current.layerOverrides[layerId]?.gridSlots?.[slotId];
    cropBackupRef.current = { type: "grid", layerId, slotId, isUserLayer: Boolean(layer?.isUserLayer), value: currentSlot ? structuredClone(currentSlot) : null };
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
      if (backup.isUserLayer) {
        setEditorState((current) => ({ ...current, userLayers: current.userLayers.map((item) => item.id === backup.layerId ? { ...item, slots: (item.slots || []).map((slot: any) => slot.id === backup.slotId ? backup.value : slot) } : item) }));
        cropBackupRef.current = null;
        setCropGridSlotId(null);
        return;
      }
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
    selectedLayers.length === 1 &&
    (selectedLayer?.type === "image" || selectedLayer?.type === "frame") &&
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
    selectedLayers.length === 1 &&
    selectedLayer?.type === "grid" &&
    // A fixed container with individually editable slots still needs its
    // toolbar — that is where Replace and Crop live (spec §17). The toolbar
    // merges the slot's own permissions, so each control stays correctly gated.
    (selectedLayer?.customerEditable || anyGridSlotGrantsPhotoEditing(selectedLayer)) &&
    !selectedLayer?.customerInteractionDisabled &&
    !selectedLayer?.hidden;

  const showElementToolbar =
    !previewMode &&
    step === "design" &&
    activeTool !== "options" &&
    Boolean(selectedLayer) &&
    selectedLayers.length === 1 &&
    selectedIsUser &&
    selectedLayer?.type === "element";

  const showTextToolbar =
    !previewMode &&
    step === "design" &&
    activeTool !== "options" &&
    Boolean(selectedLayer) &&
    selectedLayers.length === 1 &&
    !showImageToolbar &&
    !showElementToolbar &&
    selectedLayer?.type === "text" &&
    (selectedIsUser ||
      (selectedLayer?.customerEditable &&
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

  const showSelectionPanel = !previewMode && step === "design" && selectedLayers.length > 0;

  // Grouping toolbar: shown for a multiple selection, or for one selected
  // group so Ungroup and Edit group are reachable from the canvas.
  const selectionIsGroup = selectedLayers.length === 1 && selectedLayers[0]?.type === "group";
  const showGroupToolbar =
    !previewMode &&
    step === "design" &&
    activeTool !== "options" &&
    ((customerGroupingEnabled && multiselectEnabled && selectedLayers.length > 1) ||
      (selectionIsGroup && canUngroupSelection));
  // The shared rule engine explains a blocked action instead of leaving a dead
  // control; the customer's own permission bundle supplies the per-layer veto.
  const groupActionState = useMemo(
    () =>
      evaluateGroupAction(effectiveLayers, selectedLayerIds, {
        groupingAllowed: customerGroupingEnabled,
        ungroupingAllowed: true,
        blockedReason: (layer: any) => {
          if (layer.positionLocked || layer.customerLocked) return `"${layer.name || "An object"}" is locked by the template.`;
          if (layer.customerInteractionDisabled) return `"${layer.name || "An object"}" cannot be changed.`;
          if (!layer.isUserLayer && !getLayerPermissions(layer).group) {
            return `"${layer.name || "An object"}" cannot be grouped in this design.`;
          }
          return null;
        },
      }),
    [effectiveLayers, selectedLayerIds, customerGroupingEnabled],
  );

  const onSelectLayer = (layerId: string | null, additive = false) => {
    let targetId = layerId;
    let targetLayer = targetId ? effectiveLayers.find((item: any) => item.id === targetId) : null;
    const visited = new Set<string>();
    while (targetLayer?.groupId && targetLayer.groupId !== editingGroupId && !visited.has(targetLayer.groupId)) {
      visited.add(targetLayer.groupId);
      const parent = effectiveLayers.find((item: any) => item.id === targetLayer.groupId);
      if (!parent) break;
      targetLayer = parent;
      targetId = parent.id;
    }
    if (targetId && !customerSelectableLayers.some((layer: any) => layer.id === targetId)) return;
    // Same reducer as the canvas, so a panel row and a card click agree.
    const nextIds = resolveSelection(
      selectedLayerIds,
      targetId,
      additive && multiselectEnabled ? "toggle" : "replace",
    );
    setSelectedLayerIds(nextIds);
    setSelectedLayerId(nextIds[nextIds.length - 1] || null);
    if (!targetId) {
      setSelectedGridSlotId(null);
      return;
    }
    if (nextIds.length > 1) return;
    const layer = targetLayer;
    if (!layer) return;
    if (layer.isUserLayer) {
      // Selecting a customer-inserted advanced object (added while in
      // Advanced Customize) surfaces its real tool tab rather than leaving
      // Easy mode's narrowed rail out of sync with the open panel.
      setCustomizeMode("advanced");
      if (layer.type === "text") setActiveTool("addText");
      else if (layer.type === "element") setActiveTool("elements");
      else if (layer.type === "image" || layer.type === "frame" || layer.type === "grid") setActiveTool("uploads");
      else if (layer.type === "shape") setActiveTool("shapes");
      else if (layer.type === "qrCode") setActiveTool("qr");
      else if (layer.type === "background") setActiveTool("background");
      else if (layer.type === "group") setActiveTool("layers");
      setMobilePanelOpen(layer.type !== "group");
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
    const { textStyle: requestedTextStyle, ...transformPatch } = patch || {};
    if (layer.isUserLayer) {
      const constrainedPatch = applyCustomerObjectLimits(layer, transformPatch, layer.page || activePage);
      if (layer.type === "group") {
        setEditorState((current) => transformCustomerGroupState(current, layerId, constrainedPatch));
        return;
      }
      setEditorState((current) => ({
        ...current,
        userLayers: current.userLayers.map((item) => (item.id === layerId ? {
              ...item,
              ...constrainedPatch,
              ...(requestedTextStyle ? { textStyle: { ...(item.textStyle || {}), ...requestedTextStyle } } : {}),
            } : item)),
      }));
    } else {
      const permissions = getLayerPermissions(layer);
      const allowed: any = {};
      if (permissions.move) {
        if (transformPatch.x !== undefined) allowed.x = transformPatch.x;
        if (transformPatch.y !== undefined) allowed.y = transformPatch.y;
      }
      if (permissions.resize) {
        if (transformPatch.width !== undefined) allowed.width = transformPatch.width;
        if (transformPatch.height !== undefined) allowed.height = transformPatch.height;
      }
      if (permissions.rotate && transformPatch.rotation !== undefined) allowed.rotation = transformPatch.rotation;
      // Template layers obey the template's position/size/rotation limits too.
      // Only user layers were being constrained here, while the save validator
      // constrains BOTH — so dragging a template object past the limits looked
      // fine on screen and then came back clamped, with a
      // `customer-object-limit` violation, once the server had its say.
      const constrained = applyCustomerObjectLimits(layer, allowed, layer.page || activePage);
      Object.assign(allowed, constrained);
      // Corner scaling carries the letter spacing with the font size, so each
      // property is gated by its own administrator permission.
      const styleUpdate: Record<string, unknown> = {};
      if (requestedTextStyle?.fontSize !== undefined && permissions.changeFontSize) {
        styleUpdate.fontSize = requestedTextStyle.fontSize;
      }
      if (requestedTextStyle?.letterSpacing !== undefined && permissions.changeLetterSpacing) {
        styleUpdate.letterSpacing = requestedTextStyle.letterSpacing;
      }
      const allowedTextStyle = Object.keys(styleUpdate).length ? styleUpdate : null;
      if (!Object.keys(allowed).length && !allowedTextStyle) return;
      setEditorState((current) => {
        const existing = current.layerOverrides[layerId] || {};
        return {
          ...current,
          layerOverrides: {
            ...current.layerOverrides,
            [layerId]: {
              ...existing,
              ...(Object.keys(allowed).length ? { transform: { ...(existing.transform || {}), ...allowed } } : {}),
              ...(allowedTextStyle ? { textStyle: { ...(existing.textStyle || {}), ...allowedTextStyle } } : {}),
            },
          },
        };
      });
    }
  };

  const onToolbarStyleChange = (patch: any, group?: string) => {
    if (!selectedLayer) return;
    const textSessionActive = activeTextHistoryIdRef.current === selectedLayer.id;
    const groupKey = group ? `style-${selectedLayer.id}-${group}` : undefined;
    const resizeSingleLineBox = (stylePatch: any) => {
      const selectedField = selectedLayer.fieldId ? getFieldById(template, selectedLayer.fieldId) : null;
      const selectedText = resolveLayerText(selectedLayer, selectedField, values);
      if (
        stylePatch.fontSize === undefined ||
        !isSingleLineAutoSizeText(selectedLayer.textStyle, selectedText)
      ) return null;
      const nextStyle = { ...(selectedLayer.textStyle || {}), ...stylePatch };
      const minFontSize = Math.max(4, Number(nextStyle.minFontSize) || 4);
      const maxFontSize = Math.max(minFontSize, Number(nextStyle.maxFontSize) || 500);
      nextStyle.fontSize = Math.min(maxFontSize, Math.max(minFontSize, Number(nextStyle.fontSize) || minFontSize));
      const text = selectedText;
      const box = getSingleLineTextBox({
        text: String(text),
        fontFamily: nextStyle.fontFamily || "Cormorant Garamond",
        fontSize: nextStyle.fontSize,
        minFontSize,
        fontWeight: nextStyle.fontWeight || "400",
        fontStyle: nextStyle.fontStyle === "italic" ? "italic" : "normal",
        letterSpacing: Number(nextStyle.letterSpacing) || 0,
        lineHeight: Number(nextStyle.lineHeight) || DEFAULT_LINE_HEIGHT,
        uppercase: Boolean(nextStyle.uppercase),
      }, customerTextMeasure);
      return { style: { ...stylePatch, fontSize: nextStyle.fontSize }, box };
    };
    if (selectedIsUser) {
      const resized = resizeSingleLineBox(patch);
      if (resized) {
        if (!textSessionActive) recordHistory(groupKey);
        patchEditorState((current) => ({
          ...current,
          userLayers: current.userLayers.map((layer) => layer.id === selectedLayer.id ? {
            ...layer,
            width: resized.box.width,
            height: resized.box.height,
            textStyle: { ...(layer.textStyle || {}), ...resized.style },
          } : layer),
        }));
        return;
      }
      if (textSessionActive) {
        patchEditorState((current) => ({
          ...current,
          userLayers: current.userLayers.map((layer) => layer.id === selectedLayer.id
            ? { ...layer, textStyle: { ...(layer.textStyle || {}), ...patch } }
            : layer),
        }));
      } else {
        updateUserLayerStyle(selectedLayer.id, patch, groupKey);
      }
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
                : key === "verticalAlign"
                  ? permissions.changeAlignment || permissions.editStyle
                : key === "letterSpacing"
                  ? permissions.changeLetterSpacing
                  : key === "lineHeight"
                    ? permissions.changeLineHeight || permissions.editStyle
                  : permissions.editStyle;
      if (gate) allowed[key] = value;
    });
    if (!Object.keys(allowed).length) return;
    const resized = resizeSingleLineBox(allowed);
    if (resized) {
      if (!textSessionActive) recordHistory(groupKey);
      patchEditorState((current) => {
        const existing = current.layerOverrides[selectedLayer.id] || {};
        return {
          ...current,
          layerOverrides: {
            ...current.layerOverrides,
            [selectedLayer.id]: {
              ...existing,
              textStyle: { ...(existing.textStyle || {}), ...resized.style },
              transform: { ...(existing.transform || {}), width: resized.box.width, height: resized.box.height },
            },
          },
        };
      });
      return;
    }
    if (textSessionActive) {
      patchEditorState((current) => {
        const existing = current.layerOverrides[selectedLayer.id] || {};
        return {
          ...current,
          layerOverrides: {
            ...current.layerOverrides,
            [selectedLayer.id]: {
              ...existing,
              textStyle: { ...(existing.textStyle || {}), ...allowed },
            },
          },
        };
      });
    } else {
      updateLayerOverride(selectedLayer.id, "textStyle", allowed, groupKey);
    }
  };

  const onEditTextAction = () => {
    if (!selectedLayer) return;
    setEditTextRequest((current) => ({
      layerId: selectedLayer.id,
      requestId: (current?.requestId || 0) + 1,
    }));
    setMobilePanelOpen(false);
  };

  const onCanvasTextEditStart = (layerId: string) => {
    if (activeTextHistoryIdRef.current === layerId) return;
    activeTextSessionRef.current = {
      layerId,
      snapshot: snapshot(),
      dirty: dirtyRef.current,
      changeVersion: changeVersionRef.current,
    };
    recordHistory();
    activeTextHistoryIdRef.current = layerId;
  };

  const onCanvasTextDraftChange = (layerId: string, rawText: string) => {
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (!layer || layer.type !== "text") return;
    if (!layer.isUserLayer && !getLayerPermissions(layer).editContent) return;
    const update = canonicalTextLayerUpdate(rawText, layer.textStyle);
    const text = update.text;
    markDirty();
    if (layer.isUserLayer) {
      setEditorState((current) => ({
        ...current,
        userLayers: current.userLayers.map((item) =>
          item.id === layerId
            ? {
                ...item,
                text,
                textStyle: {
                  ...(item.textStyle || {}),
                  ...update.textStyle,
                },
              }
            : item,
        ),
      }));
    } else if (layer.fieldId) {
      setValues((current) => ({ ...current, [layer.fieldId]: text }));
    } else {
      setEditorState((current) => {
        const existing = current.layerOverrides[layerId] || {};
        return {
          ...current,
          layerOverrides: {
            ...current.layerOverrides,
            [layerId]: {
              ...existing,
              properties: { ...(existing.properties || {}), text },
            },
          },
        };
      });
    }
  };

  const onCanvasTextMultilineActivate = (layerId: string) => {
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (!layer?.isUserLayer || layer.type !== "text") return;
    const style = layer.textStyle || {};
    if (style.multiline && style.autoSizeMode === "height" && style.fitMode === "auto-height") return;
    markDirty();
    setEditorState((current) => ({
      ...current,
      userLayers: current.userLayers.map((item) => item.id === layerId
        ? {
            ...item,
            textStyle: {
              ...(item.textStyle || {}),
              multiline: true,
              autoSizeMode: "height",
              fitMode: "auto-height",
            },
          }
        : item),
    }));
  };

  const onCanvasTextCommit = (layerId: string, rawText: string) => {
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (layer) {
      const currentText = String(resolveLayerText(
        layer,
        layer.fieldId ? getFieldById(template, layer.fieldId) : null,
        valuesRef.current,
      ));
      const text = normalizeCanonicalText(rawText);
      if (currentText !== text) onCanvasTextDraftChange(layerId, text);
    }
    if (activeTextHistoryIdRef.current === layerId) activeTextHistoryIdRef.current = null;
    if (activeTextSessionRef.current?.layerId === layerId) activeTextSessionRef.current = null;
  };

  const restoreCancelledTextSession = (layerId: string) => {
    const session = activeTextSessionRef.current;
    if (!session || session.layerId !== layerId) return false;
    setValues(session.snapshot.values);
    setEditorState(session.snapshot.editorState);
    setDirty(session.dirty);
    changeVersionRef.current = session.changeVersion;
    history.discardLast();
    activeTextHistoryIdRef.current = null;
    activeTextSessionRef.current = null;
    return true;
  };

  const onCanvasTextCancel = (
    layerId: string,
    _initial: {
      text: string;
      textStyle: Record<string, any>;
      x: number;
      y: number;
      width: number;
      height: number;
    },
  ) => {
    restoreCancelledTextSession(layerId);
  };

  const onCanvasTextDiscard = (layerId: string) => {
    if (restoreCancelledTextSession(layerId)) {
      setSelectedLayerIds([]);
      setSelectedLayerId(null);
      return;
    }
    const layer = editorStateRef.current.userLayers.find((item) => item.id === layerId);
    if (!layer || activeTextHistoryIdRef.current !== layerId) return;
    patchEditorState((current) => ({
      ...current,
      userLayers: current.userLayers.filter((item) => item.id !== layerId),
    }));
    history.discardLast();
    activeTextHistoryIdRef.current = null;
    setSelectedLayerIds([]);
    setSelectedLayerId(null);
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

  // The raw save. Status reporting belongs to the save queue (spec §11) so
  // "Saved" is only ever shown after the server confirmed it — this function
  // just performs one write and reports what happened.
  const saveCustomizationDraft = async (status = "draft", { silent = false }: any = {}) => {
    if (!silent) setMessage("");
    const savingVersion = changeVersionRef.current;

    const payload = await buildCustomizationPayload(status);

    if (!user) {
      const localDraft = writeLocalDraft(localDraftKey, payload);
      setCustomizationId(localDraft.id);
      if (changeVersionRef.current === savingVersion) setDirty(false);
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
    if (changeVersionRef.current === savingVersion) setDirty(false);
    return { ok: true, customization: saved, local: false };
  };

  /* ----- autosave queue (spec §11) -----
     Debounced, single-flight and retrying. Single-flight matters most: the old
     bare setTimeout could start a second POST while the first was still in
     flight, creating a duplicate draft for the same design. */
  const saveDraftRef = useRef(saveCustomizationDraft);
  saveDraftRef.current = saveCustomizationDraft;
  // An explicit save (Save & Exit, Add to cart) owns the write while it runs;
  // the queue backs off and retries rather than racing it.
  const explicitSaveRef = useRef(false);
  const saveQueueRef = useRef<SaveQueue | null>(null);
  if (!saveQueueRef.current) {
    saveQueueRef.current = createSaveQueue({
      save: async () => {
        if (explicitSaveRef.current) {
          return { ok: false, error: new Error("explicit-save-in-flight"), retryable: true };
        }
        try {
          const result = await saveDraftRef.current("draft", { silent: true });
          return { ok: true, local: Boolean(result?.local) };
        } catch (error) {
          console.warn("Autosave failed:", error);
          return { ok: false, error };
        }
      },
      onStatusChange: (status, detail) => {
        setSaveStatus(status);
        setLastSavedAt(detail.lastSavedAt);
      },
    });
  }
  const saveQueue = saveQueueRef.current;

  useEffect(() => () => saveQueue.destroy(), [saveQueue]);

  // One tracked explicit save, used by Save & Exit and Add to cart so their
  // status reporting matches the queue's exactly.
  const runExplicitSave = async (status: string) => {
    explicitSaveRef.current = true;
    setSaveStatus("saving");
    try {
      const result = await saveDraftRef.current(status, { silent: true });
      setLastSavedAt(Date.now());
      setSaveStatus(result?.local ? "saved-local" : "saved");
      return result;
    } catch (error) {
      setSaveStatus("error");
      throw error;
    } finally {
      explicitSaveRef.current = false;
    }
  };

  const applySavedCustomization = (
    saved: any,
    { requireCurrentTemplateVersion = false }: { requireCurrentTemplateVersion?: boolean } = {},
  ) => {
    if (!saved) return false;
    const savedTemplateVersion = Math.max(
      0,
      Number(saved.templateVersion || saved.renderData?.templateVersion || 0),
    );
    if (
      requireCurrentTemplateVersion &&
      savedTemplateVersion &&
      savedTemplateVersion !== Number(template?.version || 1)
    ) {
      return false;
    }
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
            templateVersion: String(Number(template?.version) || 1),
          });
          if (template?.id) query.set("templateId", template.id);
          const res = await fetch(`/api/customizations?${query.toString()}`, { cache: "no-store" });
          const data = await res.json().catch(() => ({}));
          const latest = data?.customizations?.[0];
          if (!cancelled && res.ok && data.ok && latest) {
            restored = applySavedCustomization(latest, { requireCurrentTemplateVersion: true });
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
    if (editingTextLayerId) return;
    if (template?.settings?.autosave === false) return;
    // The queue owns debouncing, single-flight and retry — this only tells it
    // that something changed. Snapshot refs give it the latest state at save
    // time, so a coalesced save never writes stale values.
    saveQueue.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, editorState, options, quantity, activePage, restoreReady, dirty, editingTextLayerId, user?.id, user?.uid]);

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
      // ONE shared rule for "is the user typing" (spec §33). While the DOM text
      // editor has focus, Delete, Backspace and the arrow keys are caret
      // controls — routing them to the canvas would delete the object being
      // edited instead of a character.
      const typing = isTypingTarget(event.target) || isTypingTarget(document.activeElement);
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
        if (key === "a") {
          event.preventDefault();
          onSelectionChange(customerSelectableLayers.map((layer: any) => layer.id));
          return;
        }
        if (key === "d") {
          event.preventDefault();
          duplicateSelection();
          return;
        }
        if (key === "c") {
          event.preventDefault();
          if (canDuplicateSelection) customerClipboardRef.current = selectedLayers.map((layer: any) => structuredClone(layer));
          return;
        }
        if (key === "v" && customerClipboardRef.current.length) {
          event.preventDefault();
          const copies = customerClipboardRef.current.map((layer: any) => normalizeUserLayer({ ...layer, id: "", groupId: "", x: Number(layer.x || 0) + 32, y: Number(layer.y || 0) + 32 })).filter(Boolean);
          recordHistory();
          patchEditorState((current) => ({ ...current, userLayers: [...current.userLayers, ...copies] }));
          applySelection(copies.map((copy: any) => copy.id));
          return;
        }
        // Ctrl/Cmd+G groups, Ctrl/Cmd+Shift+G ungroups. Both run through the
        // same permission-checked handlers as the buttons, so a shortcut can
        // never bypass a template restriction.
        if (key === "g") {
          event.preventDefault();
          if (event.shiftKey) ungroupSelection(); else groupSelection();
          return;
        }
        if (key === "]") {
          event.preventDefault();
          arrangeSelection(event.shiftKey ? "bringToFront" : "bringForward");
          return;
        }
        if (key === "[") {
          event.preventDefault();
          arrangeSelection(event.shiftKey ? "sendToBack" : "sendBackward");
          return;
        }
      }
      if (typing) return;
      if (event.key === "Escape") {
        if (cropLayerId) cancelCrop();
        else if (cropGridSlotId) cancelGridCrop();
        else if (previewMode) setPreviewMode(false);
        else if (editingGroupId) exitGroup();
        else onSelectionChange([]);
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
      if (event.key === "Enter" && selectedLayers.length === 1 && selectedLayers[0]?.type === "group") {
        event.preventDefault();
        enterGroup(selectedLayers[0].id);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && canDeleteSelection) {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && selectedLayers.length) {
        if (!canMoveSelection) return;
        event.preventDefault();
        const amount = event.shiftKey ? 40 : 8;
        const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
        const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
        onLayerTransform(selectedLayers[0].id, {}, "start");
        selectedLayers.forEach((layer: any) => onLayerTransform(layer.id, { x: (layer.x || 0) + dx, y: (layer.y || 0) + dy }, "move"));
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
        await runExplicitSave("draft");
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
      await saveQueue.flush();
      const saved = await runExplicitSave("in_cart");
      const savedCustomization = saved?.customization || {};

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

  // Save and Exit (spec §11): finish the latest save, confirm success, and only
  // then leave — the design id is preserved in the saved draft.
  const handleSaveExit = async () => {
    setSavingDraft(true);
    setMessage("");
    try {
      await saveQueue.flush();
      await runExplicitSave("draft");
      router.push(exitHref);
    } catch (error) {
      console.error("Save draft failed:", error);
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
  const saveStatusLabel = !restoreReady
    ? "Loading design"
    : savingDraft
      ? "Saving…"
      : formatSaveStatus(saveStatus, lastSavedAt);

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
        : activeTool === "layers"
          ? "Layers"
          : activeTool === "shapes"
            ? "Shapes"
            : activeTool === "frames"
                ? "Frames"
                : activeTool === "grids"
                  ? "Photo grids"
                  : activeTool === "qr"
                    ? "QR code"
                    : activeTool === "background"
                      ? "Background"
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
        onSelectLayer={onSelectLayer}
        onOpenUploads={() => setActiveTool("uploads")}
      />
    ) : activeTool === "addText" ? (
      <CustomerAddTextPanel
        template={template}
        activePage={activePage}
        userLayers={editorState.userLayers}
        selectedLayerId={selectedLayerId}
        selectedPreset={textPlacementPreset}
        onSelectPreset={(preset) => {
          setTextPlacementPreset(preset);
          insertCustomerText(preset);
          if (!isDesktop) setMobilePanelOpen(false);
        }}
        onSelectLayer={onSelectLayer}
        onUpdateText={(layerId, text) => {
          const layer = editorStateRef.current.userLayers.find((item) => item.id === layerId);
          const update = canonicalTextLayerUpdate(text, layer?.textStyle);
          updateUserLayer(
            layerId,
            update,
            `usertext-${layerId}`,
          );
        }}
        onEnableMultiline={(layerId) => updateUserLayerStyle(
          layerId,
          { multiline: true, autoSizeMode: "height", fitMode: "auto-height" },
          `usertext-${layerId}`,
        )}
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
        selectedUserFrame={selectedLayer?.isUserLayer && (selectedLayer.type === "frame" || selectedLayer.type === "image") ? selectedLayer : null}
        onPickUserFrame={(asset: any) => selectedLayer?.isUserLayer && updateUserLayer(selectedLayer.id, { src: asset.signedUrl || asset.url || "", assetId: asset.id || asset.assetId || "", bucket: asset.bucket || "customer-uploads", path: asset.path || "", assetReference: asset.assetReference, imageTransform: { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false, fitMode: "cover" } }, `frame-photo-${selectedLayer.id}`)}
      />
    ) : activeTool === "elements" ? (
      <CustomerElementsPanel onInsertElement={addElementLayer} allowedElementIds={allowedCustomerElementIds} />
    ) : activeTool === "layers" ? (
      <CustomerLayersPanel
        layers={effectiveLayers}
        selectedIds={selectedLayerIds}
        selectedGridSlotId={selectedGridSlotId}
        onSelectionChange={onSelectLayer}
        onGridSlotSelect={(_layerId: string, slotId: string) => { setSelectedGridSlotId(slotId); setActiveTool("uploads"); }}
        onEnterGroup={enterGroup}
        onArrange={arrangeSelection}
        onReorder={reorderLayerFromPanel}
        onToggleVisibility={toggleLayerVisibility}
        onToggleLock={toggleLayerLock}
        onRename={renameLayer}
        onDuplicate={duplicateLayer}
        onDelete={deleteUserLayer}
      />
    ) : ["shapes", "frames", "grids", "qr", "background"].includes(activeTool) ? (
      <CustomerInsertPanel
        tool={activeTool}
        onAddShape={addCustomerShape}
        onAddLine={addCustomerLine}
        onAddFrame={addCustomerFrame}
        onAddGrid={addCustomerGrid}
        onAddQRCode={addCustomerQRCode}
        onSetBackground={setCustomerBackground}
        allowShapes={pageAllowsCustomerObjects && customerShapesEnabled}
        allowLines={pageAllowsCustomerObjects && customerLinesEnabled}
        allowedShapes={allowedCustomerShapes}
        allowedFrameMasks={allowedCustomerFrameMasks}
        allowedGridPresets={allowedCustomerGridPresets}
        allowedColors={allowedCustomerColors}
      />
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

  const selectionPanel = showSelectionPanel ? (
    <CustomerSelectionPanel
      layers={selectedLayers}
      permissions={selectedPermissions}
      isUserLayer={selectedIsUser}
      onOpacity={setSelectionOpacity}
      onPatch={patchSelectedProperties}
      onArrange={arrangeSelection}
      onAlign={alignSelection}
      onGroup={groupSelection}
      onUngroup={ungroupSelection}
      onDuplicate={duplicateSelection}
      onDelete={deleteSelection}
      canDelete={canDeleteSelection}
      canArrange={canArrangeSelection}
      canAlign={canMoveSelection}
      canGroup={canGroupSelection}
      canUngroup={canUngroupSelection}
      canDuplicate={canDuplicateSelection}
    />
  ) : null;

  const panelBody = (
    <>
      {selectionPanel}
      {panelContent}
    </>
  );

  const printCanvas = (
    <CustomizerWorkspace
      template={template}
      values={values}
      editorState={editorState}
      pageId={activePage}
      zoom={viewZoom}
      onZoomChange={setZoomSafely}
      onFitZoomChange={onWorkspaceFitZoom}
      selectedLayerId={previewMode ? null : selectedLayerId}
      selectedLayerIds={previewMode ? [] : selectedLayerIds}
      onSelectLayer={previewMode ? undefined : onSelectLayer}
      onSelectionChange={previewMode ? undefined : onSelectionChange}
      onLayerTransform={onLayerTransform}
      onTextEditStart={onCanvasTextEditStart}
      onTextDraftChange={onCanvasTextDraftChange}
      onTextMultilineActivate={onCanvasTextMultilineActivate}
      onTextCancel={onCanvasTextCancel}
      onTextDiscard={onCanvasTextDiscard}
      onEditingTextChange={setEditingTextLayerId}
      onExitTextTool={() => setActiveTool("edit")}
      editTextRequest={editTextRequest}
      onTextCommit={onCanvasTextCommit}
      cropLayerId={previewMode ? null : cropLayerId}
      onImageTransform={onImageTransformChange}
      cropGridSlotId={previewMode || !gridsEnabled ? null : cropGridSlotId}
      onGridSlotTransform={gridsEnabled ? onGridSlotTransformChange : undefined}
      onGridSlotSelect={gridsEnabled ? (_layerId, slotId) => setSelectedGridSlotId(slotId) : undefined}
      onGridSlotAssetDrop={gridsEnabled ? (layerId, slotId, asset) => applyGridSlotAsset(layerId, slotId, { ...asset, assetId: asset.id, signedUrl: asset.signedUrl || asset.url }) : undefined}
      onElementDrop={allowElements ? (element, position) => addElementLayer(element, position) : undefined}
      onImageLayerActivate={(layerId) => enterCropMode(layerId)}
      previewMode={previewMode}
      showWatermark={protectionEnabled}
      showSafeArea={showSafeArea}
      showBleed={Boolean(template?.settings?.showBleed) && !previewMode}
      editingGroupId={editingGroupId}
      onEnterGroup={enterGroup}
      onLayerContextMenu={(_layerId, position) => setContextMenu(position)}
    />
  );

  const canvasContextMenu = contextMenu && contextMenuGroups.length ? (
    <CustomerCanvasContextMenu
      groups={contextMenuGroups}
      x={contextMenu.x}
      y={contextMenu.y}
      onAction={runContextMenuAction}
      onClose={() => setContextMenu(null)}
    />
  ) : null;

  return (
    <div data-customizer-root className="fixed inset-0 z-[100] flex flex-col bg-[#F0EDED] text-[#303839]">
      <CustomerCustomizerHeader
        productTitle={product.title}
        activePageLabel={(template.pages || []).find((page: any) => page.id === activePage)?.label || activePage}
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
        onHelp={() => setShortcutHelpOpen(true)}
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
              onFixIssue={(issue) => {
                // Take the customer straight to the object that needs work
                // rather than leaving them to find it (spec §28).
                setStep("design");
                setPreviewMode(false);
                // Go through the normal page-change path so crop mode, group
                // scope and any in-progress text edit from the page we are
                // leaving are cleared, then select the object that needs work.
                if (issue.pageId) onActivePageChange(issue.pageId);
                if (issue.layerId) {
                  setSelectedLayerId(issue.layerId);
                  setSelectedLayerIds([issue.layerId]);
                }
                setActiveTool("edit");
                setMobilePanelOpen(true);
              }}
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
                  tools={visibleTools}
                  activeTool={activeTool}
                  onSelect={(tool) => {
                    // Text is an insertion command, not a mode.
                    if (tool === "addText") {
                      insertCustomerText();
                      return;
                    }
                    setActiveTool(tool);
                    if (tool === "options") setStep("options");
                    else if (step === "options") setStep("design");
                  }}
                />
              </div>
            )}

            {/* Left settings panel (desktop) */}
            {showPanels && isDesktop && (
              <aside className="hidden w-[340px] shrink-0 flex-col overflow-hidden border-r border-[#303839]/8 bg-white lg:flex">
                <div className="shrink-0 px-4 pb-2 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-[22px] leading-tight text-[#303839]">{panelTitle}</h2>
                    {hasAdvancedTools && (
                      <button
                        type="button"
                        onClick={() => setCustomizeModeSafely(customizeMode === "easy" ? "advanced" : "easy")}
                        className="shrink-0 rounded-full border border-[#303839]/15 px-3 py-1 text-[11px] font-bold text-[#303839] hover:bg-[#303839]/5"
                      >
                        {customizeMode === "easy" ? "Advanced Customize" : "Simple View"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-color:rgba(48,56,57,0.18)_transparent] [scrollbar-width:thin]">{panelBody}</div>
              </aside>
            )}

            {/* Central workspace */}
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[#F0EDED]" data-customizer-protected>
              {(showTextToolbar || showElementToolbar || showImageToolbar || showGridToolbar || showGroupToolbar) && (
                <div
                  data-customer-toolbar-dock
                  className="pointer-events-none absolute inset-x-0 top-3 z-40 flex min-w-0 justify-center px-3"
                >
                  {showGroupToolbar && (
                    <CustomerGroupToolbar
                      selectionCount={selectedLayers.length}
                      isGroup={selectionIsGroup}
                      groupingAllowed={customerGroupingEnabled && multiselectEnabled}
                      ungroupingAllowed={canUngroupSelection}
                      group={groupActionState.group}
                      ungroup={groupActionState.ungroup}
                      onGroup={groupSelection}
                      onUngroup={ungroupSelection}
                      onEnterGroup={selectionIsGroup ? () => enterGroup(selectedLayers[0].id) : undefined}
                      onDuplicate={canDuplicateSelection ? duplicateSelection : undefined}
                      onDelete={canDeleteSelection ? deleteSelection : undefined}
                    />
                  )}

                  {showTextToolbar && selectedLayer && (
                    <CustomerContextToolbar
                      layer={selectedLayer}
                      permissions={selectedPermissions as Record<string, boolean>}
                      isUserLayer={selectedIsUser}
                      editingText={editingTextLayerId === selectedLayer.id}
                      onStyleChange={onToolbarStyleChange}
                      onEditText={onEditTextAction}
                      onDuplicate={
                        selectedIsUser || (selectedPermissions as any).duplicate ? duplicateSelectedLayer : undefined
                      }
                      onDelete={selectedIsUser ? onDeleteSelected : undefined}
                      allowedFonts={allowedCustomerFonts}
                      allowedColors={allowedCustomerColors}
                    />
                  )}

                  {showElementToolbar && selectedLayer && (
                    <CustomerElementToolbar
                      layer={selectedLayer}
                      onPatch={(patch, group) => updateElementLayer(selectedLayer.id, patch, group)}
                      onDuplicate={() => duplicateElementLayer(selectedLayer.id)}
                      onDelete={() => deleteUserLayer(selectedLayer.id)}
                    />
                  )}

                  {showImageToolbar && selectedLayer && (
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
                      onImagePatch={(patch) => {
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
                      filtersEnabled={imageFiltersEnabled}
                      allowedFilters={allowedCustomerImageFilters}
                      onFilterPatch={(patch, group) => selectedIsUser ? updateUserLayer(selectedLayer.id, { filters: { ...(selectedLayer.filters || {}), ...patch } }, group) : updateLayerOverride(selectedLayer.id, "imageFilters", patch, group)}
                    />
                  )}

                  {showGridToolbar && selectedLayer && selectedGridSlotId && (
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
                  )}
                </div>
              )}

              {(showTextToolbar || showElementToolbar || showImageToolbar || showGridToolbar) && (
                <div data-customer-toolbar-spacer className="h-[72px] shrink-0" aria-hidden />
              )}

              <div className="relative min-h-0 flex-1">
                {(productPreviewEditingEnabled || splitViewEnabled) && !previewMode && (
                  <div className="absolute right-3 top-3 z-30 flex rounded-xl border border-[#303839]/12 bg-white p-1 shadow-[0_8px_24px_rgba(48,56,57,0.12)] xl:hidden" role="group" aria-label="Workspace view">
                    {(["print", ...(productPreviewEditingEnabled ? ["product"] : []), ...(splitViewEnabled ? ["split"] : [])] as string[]).map((mode) => (
                      <button key={mode} type="button" aria-pressed={workspaceMode === mode} onClick={() => setWorkspaceMode(mode as any)} className={`min-h-10 rounded-lg px-3 text-[10px] font-extrabold capitalize ${workspaceMode === mode ? "bg-[#303839] text-white" : "text-[#303839]/60 hover:bg-[#303839]/5"}`}>{mode === "print" ? "Print Canvas" : mode === "product" ? "Product Preview" : "Split View"}</button>
                    ))}
                  </div>
                )}
                {workspaceMode === "product" && productPreviewEditingEnabled ? (
                  <CustomerProductEditingPreview template={template} values={values} editorState={editorState} pageId={activePage} zoom={viewZoom} onZoomChange={setZoomSafely} selectedLayerIds={selectedLayerIds} onSelectLayer={onSelectLayer} onSelectionChange={onSelectionChange} onLayerTransform={onLayerTransform} editingGroupId={editingGroupId} onEnterGroup={enterGroup} showWatermark={protectionEnabled} />
                ) : workspaceMode === "split" && splitViewEnabled ? (
                  <div className="grid h-full min-h-0 grid-rows-2 divide-y divide-[#303839]/10 xl:grid-cols-2 xl:grid-rows-1 xl:divide-x xl:divide-y-0"><div className="min-h-0 min-w-0">{printCanvas}</div><div className="min-h-0 min-w-0"><CustomerProductEditingPreview template={template} values={values} editorState={editorState} pageId={activePage} zoom={viewZoom} onZoomChange={setZoomSafely} selectedLayerIds={selectedLayerIds} onSelectLayer={onSelectLayer} onSelectionChange={onSelectionChange} onLayerTransform={onLayerTransform} editingGroupId={editingGroupId} onEnterGroup={enterGroup} showWatermark={protectionEnabled} /></div></div>
                ) : printCanvas}
              </div>

              {/* Bottom controls */}
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex items-end justify-center gap-2 px-3">
                <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full no-scrollbar">
                  {enabledPages.length > 1 && (
                    <div className="flex min-h-11 items-center rounded-full border border-[#303839]/8 bg-white px-1 shadow-[0_2px_12px_rgba(48,56,57,0.08)]" role="group" aria-label="Page navigation">
                      <button type="button" aria-label="Previous page" disabled={pageIndex <= 0} onClick={() => onActivePageChange(enabledPages[Math.max(0, pageIndex - 1)].id)} className="grid h-9 w-9 place-items-center rounded-full text-[#303839]/70 transition-colors hover:bg-[#303839]/5 hover:text-[#303839] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-25">‹</button>
                      <span className="min-w-14 text-center text-[11px] font-bold tabular-nums text-[#303839]/50">{pageIndex + 1} / {enabledPages.length}</span>
                      <button type="button" aria-label="Next page" disabled={pageIndex >= enabledPages.length - 1} onClick={() => onActivePageChange(enabledPages[Math.min(enabledPages.length - 1, pageIndex + 1)].id)} className="grid h-9 w-9 place-items-center rounded-full text-[#303839]/70 transition-colors hover:bg-[#303839]/5 hover:text-[#303839] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-25">›</button>
                    </div>
                  )}
                  <CustomizerZoomControls
                    zoom={viewZoom}
                    onZoomChange={setZoomSafely}
                    fitZoom={fitZoom}
                    onFit={fitToPage}
                    onActualSize={actualSizeZoom}
                  />
                  {(productPreviewEditingEnabled || splitViewEnabled) && !previewMode && (
                    <div className="hidden min-h-11 items-center gap-0.5 rounded-full border border-[#303839]/8 bg-white p-1 shadow-[0_2px_12px_rgba(48,56,57,0.08)] xl:flex" role="group" aria-label="Canvas view">
                      {(["print", ...(productPreviewEditingEnabled ? ["product"] : []), ...(splitViewEnabled ? ["split"] : [])] as string[]).map((mode) => (
                        <button key={mode} type="button" aria-pressed={workspaceMode === mode} onClick={() => setWorkspaceMode(mode as any)} className={`min-h-9 rounded-full px-3.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${workspaceMode === mode ? "bg-[#303839] text-white" : "text-[#303839]/50 hover:bg-[#303839]/5 hover:text-[#303839]"}`}>{mode === "print" ? "Print Canvas" : mode === "product" ? "Product Preview" : "Split View"}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <CustomerShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
              {workspaceMode === "print" && <div className="pointer-events-none absolute bottom-3 right-3 z-30 hidden xl:block">
                <CustomerMockupPreview
                  template={template}
                  values={values}
                  editorState={editorState}
                  customizationId={customizationId}
                  saveStatus={saveStatus}
                />
              </div>}

              {protectionEnabled && (
                <p className="pointer-events-none absolute bottom-1 left-2 z-30 hidden text-[10px] text-[#303839]/40 sm:block">
                  Protected preview. Copying, downloading, and printing are disabled.
                </p>
              )}
            </main>

            {/* Right page thumbnails (desktop) */}
            <aside className="hidden w-[132px] shrink-0 overflow-y-auto border-l border-[#303839]/8 bg-white px-3 py-4 [scrollbar-color:rgba(48,56,57,0.18)_transparent] [scrollbar-width:thin] lg:block" data-customizer-protected>
              <p className="mb-3 px-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#303839]/40">Pages</p>
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
          {/* Page thumbnails render at the card's own aspect ratio, so the strip
              is ~174px tall — a third of a 568px phone. On phones the compact
              "‹ 1 / 2 ›" pager below the canvas does the same job, so the strip
              only appears from md up where there is room for it (spec §8:
              prioritise the canvas). */}
          <div className="hidden overflow-x-auto border-t border-[#303839]/8 bg-white px-3 py-2.5 no-scrollbar md:block" data-customizer-protected>
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
            tools={visibleTools}
            activeTool={mobilePanelOpen ? activeTool : null}
            orientation="horizontal"
            onSelect={(tool) => {
              // Tapping Text always inserts exactly one object, so a second tap
              // adds a second text box instead of collapsing the panel.
              if (tool === "addText") {
                insertCustomerText();
                setMobilePanelOpen(false);
                return;
              }
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
            <div className="fixed inset-x-0 bottom-0 z-50 max-h-[68vh] overflow-hidden rounded-t-2xl border-t border-[#303839]/10 bg-white shadow-[0_-8px_32px_rgba(48,56,57,0.14)]">
              {/* Drag affordance */}
              <div className="flex justify-center pt-2" aria-hidden>
                <span className="h-1 w-9 rounded-full bg-[#303839]/15" />
              </div>
              <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-2">
                <h2 className="min-w-0 truncate font-display text-xl text-[#303839]">{panelTitle}</h2>
                <div className="flex shrink-0 items-center gap-2">
                  {hasAdvancedTools && (
                    <button
                      type="button"
                      onClick={() => setCustomizeModeSafely(customizeMode === "easy" ? "advanced" : "easy")}
                      className="rounded-full border border-[#303839]/15 px-2.5 py-1 text-[10px] font-bold text-[#303839] hover:bg-[#303839]/5"
                    >
                      {customizeMode === "easy" ? "Advanced" : "Simple"}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Close panel"
                    onClick={() => setMobilePanelOpen(false)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#303839]/50 transition-colors hover:bg-[#303839]/5 hover:text-[#303839] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="max-h-[58vh] overflow-y-auto overflow-x-hidden">{panelBody}</div>
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

      {canvasContextMenu}

      {protectionEnabled && <CustomizerProtectionOverlay covered={covered} />}
    </div>
  );
}
