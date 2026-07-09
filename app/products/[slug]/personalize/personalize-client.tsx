"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import CustomizerFieldsPanel from "@/app/components/customizer/CustomizerFieldsPanel";
import CustomizerPageThumbnails from "@/app/components/customizer/CustomizerPageThumbnails";
import CustomizerOptionsStep, { CUSTOMIZER_FORMAT_OPTIONS } from "@/app/components/customizer/CustomizerOptionsStep";
import CustomizerReviewStep from "@/app/components/customizer/CustomizerReviewStep";
import {
  buildInitialValues,
  buildRenderData,
  getEnabledPages,
  getImageUrl,
  isImageValue,
  svgToPngDataUrl,
  validateCustomerValues,
} from "@/app/components/customizer/customizer-utils";

const STEPS = [
  { id: "design", label: "Design" },
  { id: "options", label: "Options" },
  { id: "review", label: "Review" },
];

function firstOf(value: any, fallback = ""): string {
  if (Array.isArray(value)) return String(value[0] || fallback);
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
  window.localStorage.setItem(key, JSON.stringify(next));
  return next;
}

function safeInternalPath(value: string, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export default function PersonalizeClient({ product, template }: { product: any; template: any }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, authLoading } = useAuth();

  const enabledPages = useMemo(() => getEnabledPages(template), [template]);
  const requireApproval = template?.settings?.requireApprovalCheckbox !== false;
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

  const [step, setStep] = useState("design");
  const [values, setValues] = useState<Record<string, any>>(() => buildInitialValues(template));
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

  const [options, setOptions] = useState(() => ({
    format: CUSTOMIZER_FORMAT_OPTIONS[0],
    size: firstOf(product.sizeOptions),
    envelope: firstOf(product.envelopeOptions),
    corner: firstOf(product.cornerOptions),
    paper: firstOf(product.paperOptions),
    printing: firstOf(product.printingOptions),
    logo: true,
  }));
  const [quantity, setQuantity] = useState(Number(firstOf(product.quantityOptions, "1")) || 1);

  const pageSvgRefs = useRef<Record<string, SVGSVGElement | null>>({});
  const valuesRef = useRef(values);
  const optionsRef = useRef(options);
  const activePageRef = useRef(activePage);
  const quantityRef = useRef(quantity);
  const customizationIdRef = useRef(customizationId);
  const cartItemIdRef = useRef(cartItemId);
  const dirtyRef = useRef(dirty);

  valuesRef.current = values;
  optionsRef.current = options;
  activePageRef.current = activePage;
  quantityRef.current = quantity;
  customizationIdRef.current = customizationId;
  cartItemIdRef.current = cartItemId;
  dirtyRef.current = dirty;

  const validation = useMemo(() => validateCustomerValues(template, values), [template, values]);
  const basePrice = getProductBasePrice(product);
  const unitPrice = Number((basePrice + getOptionsSurcharge(options)).toFixed(2));
  const canAddToCart = validation.ok && (!requireApproval || approved);

  const markDirty = () => {
    setDirty(true);
    setSaveStatus("unsaved");
  };

  const onFieldChange = (fieldId: string, value: any) => {
    markDirty();
    setValues((current) => ({ ...current, [fieldId]: value }));
  };

  const onOptionChange = (key: string, value: any) => {
    markDirty();
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const onQuantityChange = (nextQuantity: any) => {
    markDirty();
    setQuantity(Math.max(1, Number(nextQuantity || 1)));
  };

  const onActivePageChange = (pageId: string) => {
    setActivePage(pageId);
    markDirty();
  };

  const onUploadPhoto = async (file: File) => {
    if (!user) {
      openCustomerLogin();
      throw new Error("Please sign in to upload a photo.");
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", `customizer/${product.slug || "product"}`);
    const res = await fetch("/api/customizer/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data?.error || "Upload failed.");
    return data.file;
  };

  const buildPreviewImages = async () => {
    const width = template?.canvasWidthPx || 1500;
    const height = template?.canvasHeightPx || 2100;
    const out: Record<string, string> = {};
    for (const page of enabledPages) {
      const svg = pageSvgRefs.current[page.id];
      if (!svg) continue;
      try {
        const str = new XMLSerializer().serializeToString(svg);
        const png = await svgToPngDataUrl(str, width, height);
        if (png) out[page.id] = png;
      } catch {
        // A tainted canvas (cross-origin photo) just means no data-URL preview;
        // the render data still captures everything to recreate the design.
      }
    }
    return out;
  };

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
    const currentOptions = optionsRef.current;
    const currentQuantity = quantityRef.current;
    const currentActivePage = activePageRef.current;
    const selectedOptions = { ...currentOptions, quantity: currentQuantity };
    const uploadedFiles = collectUploadedFiles(currentValues);
    const previewImages = await buildPreviewImages();
    const renderData = {
      ...buildRenderData(template, currentValues, selectedOptions),
      activePage: currentActivePage,
      previewImages,
      productTitle: product.title || "",
      productSlug: product.slug || "",
      productThumbnail: product.thumbnail || product.mockups?.[0] || product.images?.[0] || "",
    };

    return {
      customizationId: customizationIdRef.current && !String(customizationIdRef.current).startsWith("local_")
        ? customizationIdRef.current
        : "",
      productId: product.id,
      templateId: template?.id || "",
      templateVersion: template?.version || 1,
      cartItemId: cartItemIdRef.current || "",
      status,
      values: currentValues,
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

    const payload = await buildCustomizationPayload(status);

    if (!user) {
      const localDraft = writeLocalDraft(localDraftKey, payload);
      setCustomizationId(localDraft.id);
      setDirty(false);
      setSaveStatus("saved");
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
    setDirty(false);
    setSaveStatus("saved");
    return { ok: true, customization: saved, local: false };
  };

  const applySavedCustomization = (saved: any) => {
    if (!saved) return false;
    const savedValues = saved.values || saved.customizationValues || saved.customization || {};
    const savedOptions = saved.selectedOptions || saved.options || {};
    const savedQuantity = Math.max(1, Number(savedOptions.quantity || saved.quantity || quantityRef.current || 1));
    const { quantity: _quantity, activePage: optionActivePage, ...optionPatch } = savedOptions;
    const savedActivePage = saved.renderData?.activePage || saved.activePage || optionActivePage;

    setValues({ ...buildInitialValues(template), ...savedValues });
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
    const timer = window.setTimeout(() => {
      saveCustomizationDraft("draft", { silent: true }).catch((error) => {
        console.warn("Autosave failed:", error);
        setSaveStatus("error");
      });
    }, 900);

    return () => window.clearTimeout(timer);
    // Snapshot refs keep the latest values/options/page at save time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, options, quantity, activePage, restoreReady, dirty, user?.id, user?.uid]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  const goNext = () => {
    if (step === "design") {
      if (!validation.ok) {
        setAttemptedNext(true);
        return;
      }
      setAttemptedNext(false);
      setStep("options");
    } else if (step === "options") {
      setStep("review");
    }
  };

  const goBack = () => {
    if (step === "review") setStep("options");
    else if (step === "options") setStep("design");
  };

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
      setMessage(validation.ok ? "Please confirm the approval checkbox." : "Please complete the required details.");
      return;
    }

    setAdding(true);
    setMessage("");

    try {
      const saved = await saveCustomizationDraft("in_cart", { silent: true });
      const savedCustomization = saved.customization || {};
      const latestValues = valuesRef.current;
      const latestOptions = optionsRef.current;
      const latestQuantity = quantityRef.current;
      const selectedOptions = { ...latestOptions, quantity: latestQuantity };
      const uploadedFiles = collectUploadedFiles(latestValues);
      const previewImages = savedCustomization.previewImages || (await buildPreviewImages());
      const renderData = savedCustomization.renderData || {
        ...buildRenderData(template, latestValues, selectedOptions),
        activePage: activePageRef.current,
        previewImages,
      };
      const savedCustomizationId = savedCustomization.id || customizationIdRef.current || "";
      const cartPayload = {
        selectedOptions,
        customizationValues: latestValues,
        uploadedFiles,
        previewData: latestValues,
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
          image: previewImages.front || product.thumbnail || product.mockups?.[0] || product.images?.[0],
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
    } catch (error) {
      console.error("Add personalized item failed:", formatRemoteError(error));
      if (error?.code === "auth-required") openCustomerLogin();
      else setMessage("Could not add this item. Please try again.");
      setAdding(false);
    }
  };

  const handleSaveExitLegacy = async () => {
    setSavingDraft(true);
    try {
      await fetch("/api/customizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          templateId: template?.id || "",
          templateVersion: template?.version || 1,
          status: "draft",
          values,
          uploadedFiles: collectUploadedFiles(values),
          selectedOptions: options,
          renderData: buildRenderData(template, values, options),
        }),
      });
    } catch {
      // Non-fatal — leaving without a saved draft is fine.
    } finally {
      router.push(`/products/${product.slug}`);
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

  const width = template?.canvasWidthPx || 1500;
  const height = template?.canvasHeightPx || 2100;
  const saveStatusLabel =
    savingDraft || saveStatus === "saving"
      ? "Saving"
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "unsaved"
          ? "Unsaved changes"
          : saveStatus === "error"
            ? "Could not save"
            : restoreReady
              ? ""
              : "Loading saved design";

  return (
    <div className="min-h-screen bg-white text-[#303839]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-[#303839]/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={handleSaveExit} className="text-sm font-bold text-[#303839]/60 hover:text-[#303839]">
              ← Back
            </button>
            <h1 className="truncate font-display text-lg text-[#303839]">{product.title}</h1>
          </div>

          <div className="hidden items-center gap-1 sm:flex">
            {STEPS.map((s, index) => (
              <button
                key={s.id}
                onClick={() => setStep(s.id)}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold transition ${
                  step === s.id ? "text-[#303839]" : "text-[#303839]/40 hover:text-[#303839]/70"
                }`}
              >
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${step === s.id ? "bg-[#303839] text-white" : "bg-[#303839]/10"}`}>{index + 1}</span>
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {saveStatusLabel && (
              <span className={`hidden text-[11px] font-bold sm:inline ${saveStatus === "error" ? "text-red-700" : "text-[#303839]/50"}`}>
                {saveStatusLabel}
              </span>
            )}
            <button onClick={handleSaveExit} disabled={savingDraft || !restoreReady} className="hidden rounded-full border border-[#303839]/15 px-4 py-2 text-xs font-bold text-[#303839] transition hover:bg-[#F4ECEC] disabled:opacity-50 sm:block">
              {savingDraft ? "Saving…" : "Save & Exit"}
            </button>
            {step === "review" ? (
              <button
                onClick={handleAddToCart}
                disabled={adding || !canAddToCart}
                className="rounded-full bg-[#303839] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#303839]/90 disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add to Cart"}
              </button>
            ) : (
              <button onClick={goNext} className="rounded-full bg-[#303839] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#303839]/90">
                Next
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hidden full-size previews for PNG export */}
      <div aria-hidden style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
        {enabledPages.map((page: any) => (
          <div key={page.id} style={{ width }}>
            <CustomizerPreview
              template={template}
              values={values}
              page={page.id}
              showSafeArea={false}
              showBleed={false}
              svgRef={(el: SVGSVGElement | null) => {
                pageSvgRefs.current[page.id] = el;
              }}
            />
          </div>
        ))}
      </div>

      <main className="mx-auto max-w-[1400px] px-4 py-6">
        {step === "review" ? (
          <CustomizerReviewStep
            template={template}
            values={values}
            options={options}
            quantity={quantity}
            unitPrice={unitPrice}
            approved={approved}
            onApprove={setApproved}
            requireApproval={requireApproval}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)_120px]">
            {/* Left: editing */}
            <div className="order-2 lg:order-1">
              {step === "design" ? (
                <>
                  <CustomizerFieldsPanel
                    template={template}
                    values={values}
                    errors={attemptedNext ? validation.errors : {}}
                    onChange={onFieldChange}
                    onUploadPhoto={onUploadPhoto}
                    activePage={activePage}
                    onFocusPage={onActivePageChange}
                  />
                  {attemptedNext && !validation.ok && (
                    <p className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                      Please complete the required details before continuing.
                    </p>
                  )}
                </>
              ) : (
                <CustomizerOptionsStep
                  product={product}
                  options={options}
                  onOptionChange={onOptionChange}
                  quantity={quantity}
                  onQuantityChange={onQuantityChange}
                />
              )}
            </div>

            {/* Center: live preview */}
            <div className="order-1 lg:order-2">
              <div className="lg:sticky lg:top-20">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex gap-1">
                    {enabledPages.map((page: any) => (
                      <button
                        key={page.id}
                        onClick={() => onActivePageChange(page.id)}
                        className={`px-3 py-1 text-xs font-bold transition ${activePage === page.id ? "bg-[#303839] text-white" : "bg-[#F4ECEC] text-[#303839]"}`}
                      >
                        {page.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setViewZoom((z) => Math.max(0.5, z - 0.1))} className="grid h-7 w-7 place-items-center border border-[#303839]/15 text-sm">−</button>
                    <button onClick={() => setViewZoom((z) => Math.min(2, z + 0.1))} className="grid h-7 w-7 place-items-center border border-[#303839]/15 text-sm">+</button>
                  </div>
                </div>
                <div className="overflow-auto border border-[#303839]/10 bg-[#F4ECEC] p-4">
                  <div style={{ width: `${viewZoom * 100}%`, margin: "0 auto", maxWidth: "560px", transition: "width 0.15s" }}>
                    <CustomizerPreview template={template} values={values} page={activePage} />
                  </div>
                </div>
                <p className="mt-2 text-center text-xs text-[#303839]/50">Live preview · edit only the fields shown</p>
              </div>
            </div>

            {/* Right: page thumbnails */}
            <div className="order-3 hidden lg:block">
              <div className="lg:sticky lg:top-20">
                <CustomizerPageThumbnails template={template} values={values} activePage={activePage} onSelect={onActivePageChange} />
              </div>
            </div>
          </div>
        )}

        {message && <p className="mx-auto mt-5 max-w-md border border-[#303839]/15 bg-[#F4ECEC] px-4 py-3 text-center text-sm font-bold text-[#303839]">{message}</p>}

        {/* Bottom navigation */}
        <div className="mt-8 flex items-center justify-between border-t border-[#303839]/10 pt-5">
          <button onClick={goBack} disabled={step === "design"} className="rounded-full border border-[#303839]/15 px-5 py-2 text-sm font-bold text-[#303839] transition hover:bg-[#F4ECEC] disabled:opacity-40">
            Back
          </button>
          {step === "review" ? (
            <button onClick={handleAddToCart} disabled={adding || !canAddToCart} className="rounded-full bg-[#303839] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#303839]/90 disabled:opacity-50">
              {adding ? "Adding…" : `Add to Cart · $${(unitPrice * quantity).toFixed(2)}`}
            </button>
          ) : (
            <button onClick={goNext} className="rounded-full bg-[#303839] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#303839]/90">
              {step === "design" ? "Continue to options" : "Review design"}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
