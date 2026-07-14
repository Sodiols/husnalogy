"use client";

// Preview-as-Customer tab (Section 34). Renders the REAL customer customizer
// components (tool rail, edit panel, uploads, options, workspace, review) with
// local throw-away state. Nothing here creates a customer customization —
// test uploads go through the admin asset upload, and nothing is saved.

import { useMemo, useState } from "react";
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

export default function AdminCustomerPreview({ template, product }: { template: any; product: any }) {
  const enabledPages = useMemo(() => getEnabledPages(template), [template]);

  const [step, setStep] = useState<"design" | "review">("design");
  const [values, setValues] = useState<Record<string, any>>(() => buildInitialValues(template));
  const [editorState, setEditorState] = useState<EditorState>(() => normalizeEditorState({}));
  const [activePage, setActivePage] = useState(enabledPages[0]?.id || "front");
  const [zoom, setZoom] = useState(1);
  const [approved, setApproved] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<CustomerTool>("edit");

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

  const addUserText = () => {
    const canvasW = template?.canvasWidthPx || 1500;
    const layer = normalizeUserLayer({
      page: activePage,
      text: "Your text",
      x: Math.round(canvasW / 2),
      y: Math.round((template?.canvasHeightPx || 2100) / 2),
      width: Math.round(canvasW * 0.6),
      height: 100,
      textStyle: { fontSize: Math.max(36, Math.round(canvasW / 24)) },
    });
    if (!layer) return;
    setEditorState((current) => ({ ...current, userLayers: [...current.userLayers, layer] }));
    setSelectedLayerId(layer.id);
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
        onAddText={addUserText}
        onSelectLayer={setSelectedLayerId}
        onUpdateText={(layerId, text) =>
          setEditorState((current) => ({
            ...current,
            userLayers: current.userLayers.map((item: any) => (item.id === layerId ? { ...item, text } : item)),
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
          // Admin test upload: goes to the admin asset bucket, never to
          // customer uploads, and is not persisted anywhere.
          const url = await uploadBuilderImage(file);
          return { url, signedUrl: url, name: file.name };
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
        <div className="flex min-h-0 flex-1">
          <CustomerToolRail tools={tools} activeTool={activeTool} onSelect={setActiveTool} />
          <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-r border-[#303839]/10 bg-white">
            {panelContent}
          </aside>
          <main className="relative min-h-0 min-w-0 flex-1">
            {showTextToolbar && selectedLayer && (
              <div className="pointer-events-none absolute inset-x-2 top-2 z-40 flex justify-center">
                <CustomerContextToolbar
                  layer={selectedLayer}
                  permissions={selectedPermissions}
                  isUserLayer={selectedIsUser}
                  onStyleChange={onStyleChange}
                  onEditText={() => setActiveTool(selectedIsUser ? "addText" : "edit")}
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
              selectedLayerId={selectedLayerId}
              onSelectLayer={setSelectedLayerId}
              onLayerTransform={onLayerTransform}
              showWatermark={template?.settings?.protectedPreview !== false}
              showSafeArea={false}
              showBleed={false}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
              <div className="pointer-events-auto">
                <CustomizerZoomControls zoom={zoom} onZoomChange={setZoom} onFit={() => setZoom(1)} />
              </div>
            </div>
          </main>
          <aside className="hidden w-[120px] shrink-0 overflow-y-auto border-l border-[#303839]/10 bg-white p-3 xl:block">
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
