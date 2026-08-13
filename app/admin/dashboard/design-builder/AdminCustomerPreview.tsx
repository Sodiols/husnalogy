"use client";

// Preview-as-Customer tab (Section 34). Renders the REAL customer customizer
// components (tool rail, edit panel, uploads, options, workspace, review) with
// local throw-away state. Nothing here creates a customer customization —
// test uploads go through the admin asset upload, and nothing is saved.

import { useCallback, useMemo, useRef, useState } from "react";
import CustomizerWorkspace from "@/app/components/customizer/CustomizerWorkspace";
import CustomizerPageThumbnails from "@/app/components/customizer/CustomizerPageThumbnails";
import CustomizerZoomControls from "@/app/components/customizer/CustomizerZoomControls";
import CustomizerReviewStep from "@/app/components/customizer/CustomizerReviewStep";
import CustomerToolRail, { getCustomerTools, type CustomerTool } from "@/app/components/customizer/CustomerToolRail";
import CustomerContextToolbar from "@/app/components/customizer/CustomerContextToolbar";
import CustomerEditPanel, { mapCustomerFields } from "@/app/components/customizer/CustomerEditPanel";
import CustomerAddTextPanel from "@/app/components/customizer/CustomerAddTextPanel";
import CustomerUploadsPanel from "@/app/components/customizer/CustomerUploadsPanel";
import CustomerOptionsPanel, { CUSTOMIZER_FORMAT_OPTIONS } from "@/app/components/customizer/CustomerOptionsPanel";
import {
  buildInitialValues,
  getEnabledPages,
  getEffectiveLayersForPage,
  getLayerPermissions,
  normalizeEditorState,
  normalizeUserLayer,
  pageAllowsCustomerText,
  validateCustomerValues,
  type EditorState,
} from "@/app/components/customizer/customizer-utils";
import { getDefaultOptionCartValue } from "@/lib/products/options";
import { getOptionsSurcharge } from "@/app/lib/customer-lists";
import { uploadBuilderImage } from "./builder-utils";
import {
  canonicalTextLayerUpdate,
  getTextPlacementStyle,
  type TextPlacementPreset,
} from "@/lib/customizer/v2/text-editing";

export default function AdminCustomerPreview({ template, product }: { template: any; product: any }) {
  const enabledPages = useMemo(() => getEnabledPages(template), [template]);

  const [step, setStep] = useState<"design" | "review">("design");
  const [values, setValues] = useState<Record<string, any>>(() => buildInitialValues(template));
  const [editorState, setEditorState] = useState<EditorState>(() => normalizeEditorState({}));
  const [activePage, setActivePage] = useState(enabledPages[0]?.id || "front");
  const [zoom, setZoom] = useState(1);
  // The admin preview must behave exactly like the customer editor, including
  // its measured Fit (spec §9/§16 "Do not use an approximate preview").
  const [fitZoom, setFitZoom] = useState<number | null>(null);
  const userChoseZoomRef = useRef(false);
  const onWorkspaceFitZoom = useCallback((next: number) => {
    setFitZoom(next);
    if (!userChoseZoomRef.current) setZoom(next);
  }, []);
  const setZoomManually = useCallback((next: number) => {
    userChoseZoomRef.current = true;
    setZoom(next);
  }, []);
  const [approved, setApproved] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<CustomerTool>("edit");
  const [textPlacementPreset, setTextPlacementPreset] = useState<TextPlacementPreset>("body");
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const [editTextRequest, setEditTextRequest] = useState<{ layerId: string; requestId: number; created?: boolean } | null>(null);

  const validation = useMemo(() => validateCustomerValues(template, values), [template, values]);
  const basePrice = Number(product?.salePrice ?? product?.price ?? 0);
  const [options, setOptions] = useState(() => ({
    format: getDefaultOptionCartValue(product?.formatOptions) || CUSTOMIZER_FORMAT_OPTIONS[0],
    size: getDefaultOptionCartValue(product?.sizeOptions),
    envelope: getDefaultOptionCartValue(product?.envelopeOptions),
    corner: getDefaultOptionCartValue(product?.cornerOptions),
    paperStyle: getDefaultOptionCartValue(product?.paperStyleOptions),
    paper: getDefaultOptionCartValue(product?.paperOptions),
    printing: getDefaultOptionCartValue(product?.printingOptions),
    logo: true,
  }));
  const [quantity, setQuantity] = useState(1);
  const optionsSurcharge = getOptionsSurcharge(options);
  const unitPrice = Number((basePrice + optionsSurcharge).toFixed(2));

  const hasUploadFields = useMemo(
    () => mapCustomerFields(template).some((entry) => entry.field.type === "image" || entry.field.type === "file"),
    [template],
  );
  const anyPageAllowsText = useMemo(
    () => enabledPages.some((page: any) => pageAllowsCustomerText(template, page.id)),
    [template, enabledPages],
  );
  const tools = useMemo(
    () => getCustomerTools({ allowAddText: anyPageAllowsText, hasUploads: hasUploadFields }),
    [anyPageAllowsText, hasUploadFields],
  );

  const effectiveLayers = useMemo(
    () => getEffectiveLayersForPage(template, activePage, editorState),
    [template, activePage, editorState],
  );
  const selectedLayer = effectiveLayers.find((layer: any) => layer.id === selectedLayerId) || null;
  const selectedIsUser = Boolean(selectedLayer?.isUserLayer);
  const selectedPermissions = selectedLayer && !selectedIsUser ? getLayerPermissions(selectedLayer) : ({} as any);

  const onFieldChange = (fieldId: string, value: any) => setValues((current) => ({ ...current, [fieldId]: value }));

  const onLayerTransform = (layerId: string, patch: any, phase: string) => {
    if (phase === "start") return;
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (!layer) return;
    if (layer.isUserLayer) {
      setEditorState((current) => ({
        ...current,
        userLayers: current.userLayers.map((item: any) => (item.id === layerId ? { ...item, ...patch } : item)),
      }));
      return;
    }
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
  };

  const onStyleChange = (patch: any) => {
    if (!selectedLayer) return;
    if (selectedIsUser) {
      setEditorState((current) => ({
        ...current,
        userLayers: current.userLayers.map((item: any) =>
          item.id === selectedLayer.id ? { ...item, textStyle: { ...(item.textStyle || {}), ...patch } } : item,
        ),
      }));
      return;
    }
    const allowed: any = {};
    Object.entries(patch).forEach(([key, value]) => {
      const gate =
        key === "fontFamily"
          ? selectedPermissions.changeFont
          : key === "fontSize"
            ? selectedPermissions.changeFontSize
            : key === "color"
              ? selectedPermissions.changeColor
              : key === "textAlign"
                ? selectedPermissions.changeAlignment
                : key === "letterSpacing"
                  ? selectedPermissions.changeLetterSpacing
                  : selectedPermissions.editStyle;
      if (gate) allowed[key] = value;
    });
    if (!Object.keys(allowed).length) return;
    setEditorState((current) => {
      const existing = current.layerOverrides[selectedLayer.id] || {};
      return {
        ...current,
        layerOverrides: {
          ...current.layerOverrides,
          [selectedLayer.id]: { ...existing, textStyle: { ...(existing.textStyle || {}), ...allowed } },
        },
      };
    });
  };

  // Mirrors the live customer editor: Text inserts exactly one object at the
  // centre of the card and never arms a placement mode (spec §11).
  const addUserText = (preset: TextPlacementPreset = textPlacementPreset): string | null => {
    const canvasW = template?.canvasWidthPx || 1500;
    const canvasH = template?.canvasHeightPx || 2100;
    const style = getTextPlacementStyle(preset, canvasW, canvasH);
    const layer = normalizeUserLayer({
      page: activePage,
      name: style.name,
      text: "",
      x: Math.round(canvasW / 2),
      y: Math.round(canvasH / 2),
      width: style.width,
      height: style.height,
      textStyle: {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textAlign: style.textAlign,
        multiline: style.multiline,
        autoSizeMode: style.multiline ? "height" : "width",
      },
    });
    if (!layer) return null;
    setEditorState((current) => ({ ...current, userLayers: [...current.userLayers, layer] }));
    setSelectedLayerId(layer.id);
    setEditTextRequest((current) => ({ layerId: layer.id, requestId: (current?.requestId || 0) + 1, created: true }));
    return layer.id;
  };

  const insertPreviewText = (preset: TextPlacementPreset = textPlacementPreset) => {
    if (!pageAllowsCustomerText(template, activePage)) return;
    setActiveTool("addText");
    addUserText(preset);
  };

  const updateCanvasText = (layerId: string, rawText: string) => {
    const layer = effectiveLayers.find((item: any) => item.id === layerId);
    if (!layer || layer.type !== "text") return;
    const update = canonicalTextLayerUpdate(rawText, layer.textStyle);
    const text = update.text;
    if (layer.isUserLayer) {
      setEditorState((current) => ({
        ...current,
        userLayers: current.userLayers.map((item: any) =>
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

  const showTextToolbar =
    step === "design" &&
    Boolean(selectedLayer) &&
    (selectedIsUser || (selectedLayer?.type === "text" && selectedLayer?.customerEditable));

  const panelContent =
    activeTool === "edit" ? (
      <CustomerEditPanel
        template={template}
        values={values}
        onChange={onFieldChange}
        activePage={activePage}
        onFocusPage={setActivePage}
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
        selectedPreset={textPlacementPreset}
        onSelectPreset={(preset) => {
          setTextPlacementPreset(preset);
          insertPreviewText(preset);
        }}
        onSelectLayer={setSelectedLayerId}
        onUpdateText={updateCanvasText}
        onEnableMultiline={(layerId) =>
          setEditorState((current) => ({
            ...current,
            userLayers: current.userLayers.map((item: any) => item.id === layerId
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
          }))
        }
        onDeleteLayer={(layerId) =>
          setEditorState((current) => ({
            ...current,
            userLayers: current.userLayers.filter((item: any) => item.id !== layerId),
          }))
        }
      />
    ) : activeTool === "uploads" ? (
      <CustomerUploadsPanel
        template={template}
        values={values}
        onChange={onFieldChange}
        onUploadPhoto={async (file: File) => {
          // Admin test uploads use the same permanent asset system as the
          // studio; only the preview field value itself remains unsaved.
          const asset = await uploadBuilderImage(file, "image");
          return { url: asset.editorUrl || asset.url, signedUrl: asset.editorUrl || asset.url, name: file.name, assetId: asset.id };
        }}
        selectedLayerId={selectedLayerId}
        onSelectLayer={setSelectedLayerId}
        onFocusPage={setActivePage}
      />
    ) : (
      <CustomerOptionsPanel
        product={product}
        options={options}
        onOptionChange={(key, value) => setOptions((current: any) => ({ ...current, [key]: value }))}
        quantity={quantity}
        onQuantityChange={setQuantity}
        unitPrice={unitPrice}
      />
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#D4AF37]/40 bg-[#D4AF37]/10 px-4 py-2">
        <p className="text-xs font-bold text-[#8a701d]">
          Customer preview — exactly what customers can see and edit. Nothing here is saved.
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setStep("design")}
            className={`rounded-full px-3 py-1 text-xs font-bold ${step === "design" ? "bg-[#303839] text-white" : "text-[#303839]/60 hover:text-[#303839]"}`}
          >
            Design
          </button>
          <button
            type="button"
            onClick={() => setStep("review")}
            className={`rounded-full px-3 py-1 text-xs font-bold ${step === "review" ? "bg-[#303839] text-white" : "text-[#303839]/60 hover:text-[#303839]"}`}
          >
            Review
          </button>
        </div>
      </div>

      {step === "review" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
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
            requireApproval={template?.settings?.requireApprovalCheckbox !== false}
            validationErrors={validation.errors}
            currency={product?.currency}
          />
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <CustomerToolRail
            tools={tools}
            activeTool={activeTool}
            onSelect={(tool) => {
              if (tool === "addText") {
                insertPreviewText();
                return;
              }
              setActiveTool(tool);
            }}
          />
          <aside className="flex w-[clamp(280px,20vw,390px)] shrink-0 flex-col overflow-y-auto border-r border-[#303839]/10 bg-white shadow-[8px_0_24px_rgba(48,56,57,0.035)]">
            {panelContent}
          </aside>
          <main className="relative min-h-0 min-w-0 flex-1">
            {showTextToolbar && selectedLayer && (
              <div className="pointer-events-none absolute inset-x-2 top-2 z-40 flex justify-center">
                <CustomerContextToolbar
                  layer={selectedLayer}
                  permissions={selectedPermissions}
                  isUserLayer={selectedIsUser}
                  editingText={editingTextLayerId === selectedLayer.id}
                  onStyleChange={onStyleChange}
                  onEditText={() => setEditTextRequest((current) => ({ layerId: selectedLayer.id, requestId: (current?.requestId || 0) + 1 }))}
                  onDuplicate={undefined}
                  onDelete={
                    selectedIsUser
                      ? () =>
                          setEditorState((current) => ({
                            ...current,
                            userLayers: current.userLayers.filter((item: any) => item.id !== selectedLayer.id),
                          }))
                      : undefined
                  }
                />
              </div>
            )}
            <CustomizerWorkspace
              template={template}
              values={values}
              editorState={editorState}
              pageId={activePage}
              zoom={zoom}
              onZoomChange={setZoomManually}
              onFitZoomChange={onWorkspaceFitZoom}
              selectedLayerId={selectedLayerId}
              onSelectLayer={setSelectedLayerId}
              onLayerTransform={onLayerTransform}
              onTextDraftChange={updateCanvasText}
              onTextMultilineActivate={(layerId) =>
                setEditorState((current) => ({
                  ...current,
                  userLayers: current.userLayers.map((item: any) =>
                    item.id === layerId
                      ? {
                          ...item,
                          textStyle: {
                            ...(item.textStyle || {}),
                            multiline: true,
                            autoSizeMode: "height",
                            fitMode: "auto-height",
                          },
                        }
                      : item,
                  ),
                }))
              }
              onTextCommit={updateCanvasText}
              onTextDiscard={(layerId) => setEditorState((current) => ({
                ...current,
                userLayers: current.userLayers.filter((item: any) => item.id !== layerId),
              }))}
              onEditingTextChange={setEditingTextLayerId}
              onExitTextTool={() => setActiveTool("edit")}
              editTextRequest={editTextRequest}
              showWatermark={template?.settings?.protectedPreview !== false}
              showSafeArea={false}
              showBleed={false}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
              <div className="pointer-events-auto">
                <CustomizerZoomControls zoom={zoom} onZoomChange={setZoomManually} fitZoom={fitZoom} onFit={() => { userChoseZoomRef.current = false; if (fitZoom !== null) setZoom(fitZoom); }} onActualSize={() => setZoomManually(1)} />
              </div>
            </div>
          </main>
          <aside className="hidden w-[clamp(120px,9vw,180px)] shrink-0 overflow-y-auto border-l border-[#303839]/10 bg-white p-3 xl:block">
            <CustomizerPageThumbnails
              template={template}
              values={values}
              editorState={editorState}
              activePage={activePage}
              onSelect={setActivePage}
              showSinglePage
            />
          </aside>
        </div>
      )}
    </div>
  );
}
