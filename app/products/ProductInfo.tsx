"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PillDropdown } from "@/app/components/product/product-toolbar";
import RightArrowIcon from "../components/RightArrowIcon";
import useAuth from "../lib/useAuth";
import {
  addToCart as saveCartItem,
  formatRemoteError,
  getOptionsSurcharge,
  getProductBasePrice,
  openCustomerLogin,
  uploadCustomerFile,
} from "../lib/customer-lists";
import {
  getLocalProductOptions,
  getSavedProductOptions,
  saveLocalProductOptions,
  saveProductOptions,
} from "../lib/product-options";
import { parseProductOption } from "@/lib/products/options";
import { formatCurrency, formatCurrencySurcharge, normalizeCurrency } from "@/lib/currency";

const FORMAT_OPTIONS = [
  {
    value: "printed-flat-save-the-date-card",
    label: "Printed Flat Save The Date Card",
    description: "Printed and shipped to your address.",
    icon: "fa-solid fa-print",
  },
  {
    value: "prints-plus-instant-download",
    label: "Prints + Instant Download",
    description: "Get printed cards and a digital copy.",
    icon: "fa-solid fa-cloud-arrow-down",
  },
  {
    value: "instant-download",
    label: "Instant Download",
    description: "Download the design after customization.",
    icon: "fa-solid fa-bolt",
  },
];

const SIZE_OPTIONS = [
  {
    value: "classic-5x7",
    label: 'Classic (5" × 7")',
    displayLabel: 'Classic (5" x 7")',
    description: "The most popular card size.",
    badge: "Best Seller",
    price: "+$0.35",
    icon: "fa-solid fa-ruler-combined",
  },
  {
    value: "petite-4-5x6-25",
    label: 'Petite (4.5" × 6.25")',
    displayLabel: 'Petite (4.5" x 6.25")',
    description: "A smaller refined card size.",
    icon: "fa-regular fa-object-group",
  },
];

const ENVELOPE_OPTIONS = [
  {
    value: "no-envelopes",
    label: "No Envelopes",
    cartLabel: "No Envelopes",
    description: "Cards only.",
    icon: "fa-solid fa-ban",
  },
  {
    value: "blank-white-envelopes",
    label: "Blank White Envelopes",
    cartLabel: "Blank White Envelopes",
    description: "Simple blank white envelopes.",
    icon: "fa-regular fa-envelope",
  },
  {
    value: "addressed-envelopes",
    label: "NEW Addressed Envelopes With FREE Guest Addressing Available",
    cartLabel: "Addressed Envelopes",
    description: "Save time with guest addressing.",
    icon: "fa-regular fa-envelope-open",
  },
];

const CORNER_OPTIONS = [
  {
    value: "squared",
    label: "Squared",
    cartLabel: "Squared",
    icon: "square",
    price: "",
  },
  {
    value: "rounded",
    label: "Rounded",
    cartLabel: "Rounded",
    icon: "rounded",
    price: "+$0.20",
  },
  {
    value: "arch",
    label: "Arch",
    cartLabel: "Arch",
    icon: "arch",
    price: "+$0.25",
  },
  {
    value: "scallop",
    label: "Scallop",
    cartLabel: "Scallop",
    icon: "scallop",
    price: "+$0.25",
  },
  {
    value: "bracket",
    label: "Bracket",
    cartLabel: "Bracket",
    icon: "bracket",
    price: "+$0.25",
  },
  {
    value: "ticket",
    label: "Ticket",
    cartLabel: "Ticket",
    icon: "ticket",
    price: "+$0.25",
  },
];

const PAPER_OPTIONS = [
  {
    value: "signature-matte",
    label: "Signature Matte",
    cartLabel: "Signature Matte",
    description:
      "18 pt thickness / 120 lb weight. Soft white paper with a gentle eggshell texture.",
    price: "",
    icon: "fa-regular fa-file-lines",
  },
  {
    value: "premium-linen",
    label: "Premium Linen",
    cartLabel: "Premium Linen",
    description: "A refined paper with a subtle linen texture.",
    price: "+$1.44",
    icon: "fa-solid fa-grip-lines",
  },
  {
    value: "pearl-shimmer",
    label: "Pearl Shimmer",
    cartLabel: "Pearl Shimmer",
    description: "A soft shimmer finish for a more elegant printed feel.",
    price: "+$0.59",
    icon: "fa-regular fa-star",
  },
  {
    value: "soft-touch",
    label: "Soft Touch",
    cartLabel: "Soft Touch",
    description: "A smooth, soft finish with a modern touch.",
    price: "+$0.59",
    icon: "fa-regular fa-hand-pointer",
  },
];

const PRINTING_OPTIONS = [
  {
    value: "standard",
    label: "Standard",
    cartLabel: "Standard",
    icon: "fa-solid fa-print",
  },
  {
    value: "high-definition",
    label: "High Definition",
    cartLabel: "High Definition +$0.40",
    price: "+$0.40",
    icon: "fa-solid fa-wand-magic-sparkles",
  },
];

function getDefaultValue(field) {
  if (field.type === "checkbox") return false;
  if (field.type === "color") return field.options?.[0] || "#303839";
  if (field.type === "select") return field.options?.[0] || "";
  return "";
}

function buildInitialCustomization(fields = []) {
  return Object.fromEntries(
    fields.map((field) => [field.name, getDefaultValue(field)]),
  );
}

function hasSubmittedCustomizationValue(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasSubmittedCustomizationValue);
  if (typeof value === "object") return Object.values(value).some(hasSubmittedCustomizationValue);
  return Boolean(value);
}

function buildSubmittedCustomization(values = {}, fields = []) {
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) => {
      if (!hasSubmittedCustomizationValue(value)) return false;

      const field = fields.find((item) => item.name === key);
      if (!field) return true;

      return value !== getDefaultValue(field);
    }),
  );
}

function getReviewSummary(reviews = []) {
  const publishedReviews = Array.isArray(reviews)
    ? reviews.filter((review) => review.status !== "deleted")
    : [];

  const count = publishedReviews.length;

  const average = count
    ? publishedReviews.reduce(
        (sum, review) => sum + Number(review.rating || 0),
        0,
      ) / count
    : 0;

  return {
    count,
    average,
    displayAverage: average ? average.toFixed(1) : "New",
    stars: average ? Math.round(average) : 0,
  };
}

function findOption(options, value) {
  return options.find((item) => item.value === value) || options[0];
}

function normalizeOptionLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function optionValueFromLabel(label) {
  return normalizeOptionLabel(label).replace(/\s+/g, "-") || "option";
}

function toConfiguredOptionArray(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function localizeOptionCartLabel(label, surcharge, currency) {
  if (!surcharge) return label || "";
  const base = String(label || "")
    .replace(/\s*\+\s*(?:৳|\$|BDT\s*)?\s*\d+(?:\.\d+)?\s*$/i, "")
    .trim();
  return `${base} ${formatCurrencySurcharge(surcharge, currency)}`.trim();
}

// Option lists may hold plain label strings (legacy) or rich option objects
// configured in the admin Product Options manager. Both render here; inactive
// or customer-hidden options never reach the page.
function buildConfiguredOptions(value, defaults, fallbackIcon, currency = "BDT") {
  return toConfiguredOptionArray(value)
    .map((entry) => parseProductOption(entry))
    .filter((option) => option && option.active && option.customerVisible)
    .map((option) => {
      const normalizedLabel = normalizeOptionLabel(option.label);
      const preset = defaults.find((item) =>
        [item.label, item.cartLabel, item.value].some((candidate) => normalizeOptionLabel(candidate) === normalizedLabel)
      );

      // Legacy string entries keep their exact preset behaviour.
      if (preset && option.kind === "string") {
        const surcharge = Number(String(preset.price || "").replace(/[^0-9.]/g, "")) || 0;
        return {
          ...preset,
          cartLabel: localizeOptionCartLabel(preset.cartLabel || preset.label, surcharge, currency),
          price: surcharge ? formatCurrencySurcharge(surcharge, currency) : "",
        };
      }

      return {
        value: option.value,
        label: option.displayLabel,
        cartLabel: localizeOptionCartLabel(option.cartValue, option.surcharge, currency),
        description: option.description || preset?.description || "",
        badge: option.badge || preset?.badge || "",
        image: option.image || "",
        price: option.surcharge ? formatCurrencySurcharge(option.surcharge, currency) : "",
        icon: preset?.icon || fallbackIcon,
      };
    });
}

function decorateSizeOption(option) {
  const normalized = normalizeOptionLabel(`${option.label} ${option.value}`);

  if (normalized.includes("5 x 7")) {
    return {
      ...option,
      displayLabel: 'Classic (5" x 7")',
      badge: "Best Seller",
      price: option.price || "+$0.35",
    };
  }

  if (normalized.includes("4 5 x 6 25")) {
    return {
      ...option,
      displayLabel: 'Petite (4.5" x 6.25")',
    };
  }

  return option;
}

function fallbackOption(label = "") {
  return { value: "", label, cartLabel: label, description: "", icon: "fa-regular fa-circle" };
}

export default function ProductInfo({ product, initialUser = undefined }) {
  const router = useRouter();
  const { user } = useAuth(initialUser);
  const currency = normalizeCurrency(product.currency);

  const fields = useMemo(
    () =>
      Array.isArray(product.customizationFields)
        ? product.customizationFields
        : [],
    [product.customizationFields],
  );

  // The full live customizer is available when the product has an enabled
  // template, or (backward compatible) when it has legacy personalization
  // fields — the /personalize route builds a fallback template for those.
  const hasCustomizer =
    Boolean(product.customizerTemplate?.enabled) ||
    (product.customizeEnabled !== false && fields.length > 0);

  const quantityOptions = product.quantityOptions?.length
    ? product.quantityOptions
    : ["1", "10", "20", "30", "40", "50"];
  const sizeOptions = useMemo(
    () => buildConfiguredOptions(product.sizeOptions, SIZE_OPTIONS, "fa-solid fa-ruler-combined", currency).map(decorateSizeOption),
    [product.sizeOptions, currency],
  );
  const envelopeOptions = useMemo(() => buildConfiguredOptions(product.envelopeOptions, ENVELOPE_OPTIONS, "fa-regular fa-envelope", currency), [product.envelopeOptions, currency]);
  const cornerOptions = useMemo(() => buildConfiguredOptions(product.cornerOptions, CORNER_OPTIONS, "square", currency), [product.cornerOptions, currency]);
  const paperOptions = useMemo(() => buildConfiguredOptions(product.paperOptions, PAPER_OPTIONS, "fa-regular fa-file-lines", currency), [product.paperOptions, currency]);
  const printingOptions = useMemo(() => buildConfiguredOptions(product.printingOptions, PRINTING_OPTIONS, "fa-solid fa-print", currency), [product.printingOptions, currency]);
  // Configured format options replace the built-in list when the admin set any.
  const formatOptions = useMemo(() => {
    const configured = buildConfiguredOptions(product.formatOptions, FORMAT_OPTIONS, "fa-solid fa-print", currency);
    return configured.length ? configured : FORMAT_OPTIONS;
  }, [product.formatOptions, currency]);
  const paperStyleOptions = useMemo(
    () => buildConfiguredOptions(product.paperStyleOptions, [], "fa-regular fa-file-lines", currency),
    [product.paperStyleOptions, currency],
  );

  const [format, setFormat] = useState(FORMAT_OPTIONS[0].value);
  const [paperStyle, setPaperStyle] = useState("");
  const [size, setSize] = useState(SIZE_OPTIONS[0].value);
  const [quantity, setQuantity] = useState(String(quantityOptions[0] || "1"));
  const [customQty, setCustomQty] = useState("");
  const [envelope, setEnvelope] = useState(ENVELOPE_OPTIONS[0].value);
  const [corner, setCorner] = useState(CORNER_OPTIONS[0].value);
  const [paper, setPaper] = useState(PAPER_OPTIONS[0].value);
  const [printing, setPrinting] = useState(PRINTING_OPTIONS[0].value);
  const [logo, setLogo] = useState(true);

  const [customizationValues, setCustomizationValues] = useState(() =>
    buildInitialCustomization(fields),
  );
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [personalizationOpen, setPersonalizationOpen] = useState(false);
  const [cartLoading, setCartLoading] = useState(false);
  const [cartMessage, setCartMessage] = useState("");
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");

  const mountedRef = useRef(false);
  const cartMessageTimeoutRef = useRef(null);
  const saveMessageTimeoutRef = useRef(null);

  const reviewSummary = getReviewSummary(product.reviews);

  const selectedQty = quantity === "custom" ? customQty || 1 : quantity;
  const safeQuantity = Math.max(1, Number(selectedQty || 1));

  const selectedFormat = findOption(formatOptions, format);
  const selectedSize = findOption(sizeOptions, size) || fallbackOption();
  const selectedEnvelope = findOption(envelopeOptions, envelope) || fallbackOption();
  const selectedCorner = findOption(cornerOptions, corner) || fallbackOption();
  const selectedPaper = findOption(paperOptions, paper) || fallbackOption();
  const selectedPaperStyle = findOption(paperStyleOptions, paperStyle) || fallbackOption();
  const selectedPrinting = findOption(printingOptions, printing) || fallbackOption();

  const selectedOptions = {
    format: selectedFormat.cartLabel || selectedFormat.label,
    // cartLabel first so rich size options carry their configured surcharge;
    // presets keep no size surcharge exactly as before.
    size: selectedSize.price && selectedSize.cartLabel ? selectedSize.cartLabel : selectedSize.displayLabel || selectedSize.label,
    envelope: selectedEnvelope.cartLabel,
    corner: selectedCorner.cartLabel,
    ...(paperStyleOptions.length ? { paperStyle: selectedPaperStyle.cartLabel } : {}),
    paper: selectedPaper.cartLabel,
    printing: selectedPrinting.cartLabel,
    logo,
  };

  const hasPrice = product.price !== null && product.price !== undefined;
  const basePrice = getProductBasePrice(product);
  const optionsSurcharge = getOptionsSurcharge(selectedOptions);
  const unitPrice = Number((basePrice + optionsSurcharge).toFixed(2));
  const lineTotal = Number((unitPrice * safeQuantity).toFixed(2));

  const oldPriceValue =
    product.oldPrice !== null && product.oldPrice !== undefined
      ? Number(product.oldPrice)
      : null;
  const hasOldPrice =
    oldPriceValue !== null && Number.isFinite(oldPriceValue) && oldPriceValue > 0;
  const savePercent =
    hasOldPrice && oldPriceValue > basePrice
      ? Math.round(((oldPriceValue - basePrice) / oldPriceValue) * 100)
      : 0;

  const filledFieldCount = fields.reduce(
    (count, field) => (customizationValues[field.name] ? count + 1 : count),
    0,
  );
  const requiredRemaining = fields.reduce(
    (count, field) =>
      field.required && !customizationValues[field.name] ? count + 1 : count,
    0,
  );

  const getCurrentOptionData = () => ({
    format,
    size,
    quantity,
    customQty,
    envelope,
    corner,
    paper,
    paperStyle,
    printing,
    logo,
  });

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (cartMessageTimeoutRef.current) {
        window.clearTimeout(cartMessageTimeoutRef.current);
      }

      if (saveMessageTimeoutRef.current) {
        window.clearTimeout(saveMessageTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setCustomizationValues(buildInitialCustomization(fields));
  }, [fields]);

  useEffect(() => {
    if (sizeOptions.length && !sizeOptions.some((item) => item.value === size)) setSize(sizeOptions[0].value);
  }, [sizeOptions, size]);

  useEffect(() => {
    if (envelopeOptions.length && !envelopeOptions.some((item) => item.value === envelope)) setEnvelope(envelopeOptions[0].value);
  }, [envelopeOptions, envelope]);

  useEffect(() => {
    if (cornerOptions.length && !cornerOptions.some((item) => item.value === corner)) setCorner(cornerOptions[0].value);
  }, [cornerOptions, corner]);

  useEffect(() => {
    if (paperOptions.length && !paperOptions.some((item) => item.value === paper)) setPaper(paperOptions[0].value);
  }, [paperOptions, paper]);

  useEffect(() => {
    if (printingOptions.length && !printingOptions.some((item) => item.value === printing)) setPrinting(printingOptions[0].value);
  }, [printingOptions, printing]);

  useEffect(() => {
    if (formatOptions.length && !formatOptions.some((item) => item.value === format)) setFormat(formatOptions[0].value);
  }, [formatOptions, format]);

  useEffect(() => {
    if (paperStyleOptions.length && !paperStyleOptions.some((item) => item.value === paperStyle)) setPaperStyle(paperStyleOptions[0].value);
  }, [paperStyleOptions, paperStyle]);

  useEffect(() => {
    let active = true;

    async function loadSavedOptions() {
      setSavedLoaded(false);
      setLogo(true);

      const localSaved = getLocalProductOptions(product);

      if (localSaved) {
        if (localSaved.format) setFormat(localSaved.format);
        if (localSaved.size) setSize(localSaved.size);
        if (localSaved.quantity) setQuantity(localSaved.quantity);
        if (localSaved.customQty) setCustomQty(localSaved.customQty);
        if (localSaved.envelope) setEnvelope(localSaved.envelope);
        if (localSaved.corner) setCorner(localSaved.corner);
        if (localSaved.paper) setPaper(localSaved.paper);
        if (localSaved.paperStyle) setPaperStyle(localSaved.paperStyle);
        if (localSaved.printing) setPrinting(localSaved.printing);
        if (typeof localSaved.logo === "boolean") setLogo(localSaved.logo);

        if (active) {
          setSavedLoaded(true);
          setSaveStatus("local");
        }

        return;
      }

      if (!user || !product) {
        if (active) setSavedLoaded(true);
        return;
      }

      try {
        const saved = await getSavedProductOptions(user, product);

        if (!active) return;

        if (saved) {
          if (saved.format) setFormat(saved.format);
          if (saved.size) setSize(saved.size);
          if (saved.quantity) setQuantity(saved.quantity);
          if (saved.customQty) setCustomQty(saved.customQty);
          if (saved.envelope) setEnvelope(saved.envelope);
          if (saved.corner) setCorner(saved.corner);
          if (saved.paper) setPaper(saved.paper);
          if (saved.paperStyle) setPaperStyle(saved.paperStyle);
          if (saved.printing) setPrinting(saved.printing);
          if (typeof saved.logo === "boolean") setLogo(saved.logo);

          saveLocalProductOptions(product, saved);
          setSaveStatus("permanent-saved");
        }
      } catch (error) {
        console.error("Could not load saved product options:", error);
      } finally {
        if (active) {
          setSavedLoaded(true);
        }
      }
    }

    loadSavedOptions();

    return () => {
      active = false;
    };
  }, [user, product]);

  useEffect(() => {
    if (!savedLoaded || !product) return;

    const timeout = window.setTimeout(() => {
      saveLocalProductOptions(product, getCurrentOptionData());

      if (mountedRef.current) {
        setSaveStatus("local");
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    savedLoaded,
    product,
    format,
    size,
    quantity,
    customQty,
    envelope,
    corner,
    paper,
    printing,
    logo,
  ]);

  const saveCurrentOptionsPermanently = async () => {
    const data = getCurrentOptionData();

    saveLocalProductOptions(product, data);

    if (!user || !product) {
      setSaveStatus("local");
      return;
    }

    try {
      setSaveStatus("permanent-saving");

      await saveProductOptions(user, product, data);

      if (!mountedRef.current) return;

      setSaveStatus("permanent-saved");

      if (saveMessageTimeoutRef.current) {
        window.clearTimeout(saveMessageTimeoutRef.current);
      }

      saveMessageTimeoutRef.current = window.setTimeout(() => {
        if (mountedRef.current) {
          setSaveStatus("idle");
        }
      }, 1800);
    } catch (error) {
      console.error("Could not save product options permanently:", error);

      if (mountedRef.current) {
        setSaveStatus("error");
      }
    }
  };

  const updateCustomization = (field, value) => {
    setCustomizationValues((current) => ({
      ...current,
      [field.name]: value,
    }));
  };

  const updateFile = async (field, file) => {
    if (!file) return;

    if (!user) {
      openCustomerLogin();
      return;
    }

    setUploadedFiles((current) => ({
      ...current,
      [field.name]: {
        name: file.name,
        type: file.type,
        size: file.size,
      },
    }));

    try {
      const uploaded = await uploadCustomerFile(user, file, product?.slug || "product");
      if (!mountedRef.current || !uploaded) return;

      setCustomizationValues((current) => ({
        ...current,
        [field.name]: uploaded.signedUrl || uploaded.path,
      }));

      setUploadedFiles((current) => ({
        ...current,
        [field.name]: uploaded,
      }));
    } catch (error) {
      console.error("Customer file upload failed:", error);
      if (mountedRef.current) setCartMessage("Could not upload this file. Please try again.");
    }
  };

  const buildCartPayload = () => {
    const submittedCustomization = buildSubmittedCustomization(customizationValues, fields);

    return {
      selectedOptions,
      optionValues: {
        format,
        size,
        quantity,
        customQty,
        envelope,
        corner,
        paper,
        printing,
        logo,
      },
      customizationValues: submittedCustomization,
      uploadedFiles,
      previewData: submittedCustomization,
      unitPrice,
    };
  };

  const addToCart = async ({ goToCheckout = false } = {}) => {
    if (product.isStockOut) {
      setCartMessage("This product is currently stock out and cannot be ordered.");
      return;
    }

    if (!user) {
      openCustomerLogin();
      return;
    }

    setCartLoading(true);
    setCartMessage("");

    try {
      await saveCurrentOptionsPermanently();

      await saveCartItem(user, product, safeQuantity, buildCartPayload());

      setCartMessage(goToCheckout ? "Added. Opening checkout." : "Added to cart.");

      if (goToCheckout) {
        router.push("/checkout");
      }

      if (cartMessageTimeoutRef.current) {
        window.clearTimeout(cartMessageTimeoutRef.current);
      }

      cartMessageTimeoutRef.current = window.setTimeout(() => {
        if (mountedRef.current) {
          setCartMessage("");
        }
      }, 2500);
    } catch (error) {
      console.error("Add to cart failed:", formatRemoteError(error));

      if (mountedRef.current) {
        if (error?.code === "auth-required") {
          openCustomerLogin();
          setCartMessage("");
        } else {
          setCartMessage("Could not add this item. Please try again.");
        }
      }
    } finally {
      if (mountedRef.current) {
        setCartLoading(false);
      }
    }
  };

  const setQuantityFromNumber = (nextValue) => {
    const nextQuantity = String(Math.max(1, Math.round(Number(nextValue) || 1)));
    const configuredQuantity = quantityOptions
      .map((item) => String(item))
      .find((item) => item === nextQuantity);

    if (configuredQuantity) {
      setQuantity(configuredQuantity);
      setCustomQty("");
      return;
    }

    setQuantity("custom");
    setCustomQty(nextQuantity);
  };

  return (
    <>
    <aside className="mx-auto mt-0 w-full min-w-0 max-w-full self-start rounded-none bg-white p-3 text-[#303839] sm:p-4 lg:mx-0 lg:max-w-none lg:px-4">
      <div className="rounded-none bg-white p-4 sm:p-5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
              {hasPrice && (
                <h2 className="text-[28px] font-extrabold leading-none tracking-[-0.01em] sm:text-[30px]">
                  {formatCurrency(unitPrice, currency)}
                </h2>
              )}

              {product.oldPrice !== null && product.oldPrice !== undefined && (
                <p className="pb-0.5 text-sm font-semibold text-[#303839]/42 line-through">
                  {formatCurrency(product.oldPrice, currency)}
                </p>
              )}
            </div>

            {savePercent > 0 && (
              <p className="mt-2 text-xs font-extrabold text-red-600">
                You save {savePercent}%
              </p>
            )}
          </div>

          <QuantityStepper
            quantity={safeQuantity}
            onDecrease={() => setQuantityFromNumber(safeQuantity - 1)}
            onIncrease={() => setQuantityFromNumber(safeQuantity + 1)}
          />
        </div>

        {hasPrice && (
          <p className="mt-2 text-xs font-medium leading-5 text-[#303839]/62">
            per card
            {optionsSurcharge > 0 && (
              <span>
                {" "}
                ({formatCurrency(basePrice, currency)} base + {formatCurrency(optionsSurcharge, currency)} options)
              </span>
            )}
          </p>
        )}

        <h1 className="mt-4 font-display text-[1.55rem] leading-tight text-[#303839]">
          {product.title}
        </h1>

        <p className="mt-3 text-sm font-semibold leading-6">
          {reviewSummary.count > 0 ? (
            <>
              {"★".repeat(reviewSummary.stars)}
              {"☆".repeat(5 - reviewSummary.stars)}{" "}
              <span className="font-normal">
                {reviewSummary.displayAverage} ({reviewSummary.count} review
                {reviewSummary.count === 1 ? "" : "s"})
              </span>
            </>
          ) : (
            <span className="font-normal">No reviews yet</span>
          )}{" "}
          | by <span className="text-blue-700">Husnalogy</span>
        </p>

        <div className="mt-4 flex min-h-6 items-center gap-2 text-xs font-bold text-[#303839]/55">
          <i
            className={`fa-solid ${
              saveStatus === "permanent-saving"
                ? "fa-circle-notch animate-spin"
                : saveStatus === "permanent-saved"
                  ? "fa-cloud-circle-check text-green-600"
                  : saveStatus === "error"
                    ? "fa-triangle-exclamation text-red-600"
                    : saveStatus === "local"
                      ? "fa-computer text-[#303839]"
                      : "fa-cloud"
            }`}
          />

          <span>
            {saveStatus === "permanent-saving"
              ? "Saving choices to your account"
              : saveStatus === "permanent-saved"
                ? "Choices saved to your account"
                : saveStatus === "error"
                  ? "Could not save choices"
                  : saveStatus === "local"
                    ? "Choices saved on this device"
                    : user
                      ? "Add to cart or wishlist to save to your account"
                      : "Log in to save choices across devices"}
          </span>
        </div>

        {product.isStockOut && (
          <div className="mt-5 border border-[#303839]/15 bg-[#f8f6f1] px-4 py-3.5">
            <p className="text-sm font-extrabold uppercase tracking-[0.08em] text-[#303839]">Stock Out</p>
            <p className="mt-1 text-sm leading-6 text-[#303839]/70">
              {Number(product.comingInDays) > 0
                ? `This product is currently unavailable. Coming in ${Number(product.comingInDays)} day${Number(product.comingInDays) === 1 ? "" : "s"}.`
                : "This product is currently unavailable. Please check back soon."}
            </p>
          </div>
        )}

        <div className="mt-5 grid gap-2.5">
          {quantity === "custom" && (
            <label className="block text-xs font-bold text-[#303839]/70">
              Quantity
              <input
                type="number"
                min="1"
                value={customQty}
                onChange={(event) => setCustomQty(event.target.value)}
                placeholder="Enter custom quantity"
                className="mt-2 h-11 w-full rounded-none border border-[#303839]/12 bg-white px-4 text-sm font-bold outline-none transition focus:border-[#303839]/40 focus:ring-2 focus:ring-[#303839]/10"
              />
            </label>
          )}

          <div className="grid gap-2.5 min-[420px]:grid-cols-2">
            <button
              type="button"
              onClick={() => addToCart()}
              disabled={cartLoading || Boolean(product.isStockOut)}
              className="h-12 w-full rounded-full bg-[#E6E6E6] px-5 text-sm font-extrabold text-[#303839] transition-colors duration-300 ease-out hover:bg-[#dcdcdc] active:scale-[0.98] disabled:opacity-70"
            >
              {product.isStockOut ? "Stock Out" : cartLoading ? "Adding..." : "Add to Cart"}
            </button>

            <button
              type="button"
              onClick={() => addToCart({ goToCheckout: true })}
              disabled={cartLoading || Boolean(product.isStockOut)}
              className="h-12 w-full rounded-full bg-[#303839] px-5 text-sm font-extrabold text-white transition hover:bg-[#303839] active:scale-[0.98] disabled:opacity-70"
            >
              Buy Now
            </button>
          </div>

          {hasCustomizer && (
            <button
              type="button"
              onClick={() => router.push(`/products/${product.slug}/personalize`)}
              className="h-11 w-full rounded-full border border-[#303839]/18 bg-white px-5 text-sm font-extrabold text-[#303839] transition-colors duration-300 ease-out hover:bg-[#F4F4F4] active:scale-[0.98]"
            >
              <i className="fa-solid fa-wand-magic-sparkles mr-2 text-xs" />
              Personalize This Product
            </button>
          )}

          {cartMessage && (
            <p className="rounded-none bg-white px-4 py-3 text-sm font-bold leading-6 text-[#303839]">
              {cartMessage}
            </p>
          )}

          {hasPrice && (
            <div className="flex items-center justify-between gap-3 rounded-none bg-white px-4 py-3 text-xs sm:text-sm">
              <span className="min-w-0 text-[#303839]/60">
                Estimated total ({safeQuantity} × {formatCurrency(unitPrice, currency)})
              </span>

              <span className="shrink-0 text-lg font-extrabold">{formatCurrency(lineTotal, currency)}</span>
            </div>
          )}
        </div>

      </div>

      <div className="mt-4 grid gap-4">
      <OptionSection title="Choose Your Format">
        <AnimatedSelect
          value={format}
          onChange={setFormat}
          options={formatOptions}
          showIcon={false}
        />
      </OptionSection>

      {!!sizeOptions.length && (
        <OptionSection title="Size">
          <AnimatedSelect
            value={size}
            onChange={setSize}
            options={sizeOptions}
            showBadge
            showIcon={false}
            showDescription={false}
          />
        </OptionSection>
      )}

      {!!envelopeOptions.length && (
        <OptionSection title="Envelopes">
          <div className="grid gap-2">
            {envelopeOptions.map((item) => (
              <LargeOptionButton
                key={item.value}
                option={item}
                active={envelope === item.value}
                onClick={() => setEnvelope(item.value)}
              />
            ))}
          </div>
        </OptionSection>
      )}

      {!!cornerOptions.length && (
        <OptionSection title="Corner Style" selectedText={selectedCorner.label}>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3 2xl:grid-cols-6">
            {cornerOptions.map((item) => (
              <CornerOptionButton
                key={item.value}
                option={item}
                active={corner === item.value}
                onClick={() => setCorner(item.value)}
              />
            ))}
          </div>
        </OptionSection>
      )}

      {!!paperStyleOptions.length && (
        <OptionSection title="Paper Style" selectedText={selectedPaperStyle.label}>
          <div className="grid gap-2 min-[520px]:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
            {paperStyleOptions.map((item) => (
              <LargeOptionButton
                key={item.value}
                option={item}
                active={paperStyle === item.value}
                onClick={() => setPaperStyle(item.value)}
                compact
                showIcon={false}
              />
            ))}
          </div>
        </OptionSection>
      )}

      {!!paperOptions.length && (
        <OptionSection
          title="Paper Type"
          selectedText={selectedPaper.label}
        >
          <PaperPreview selectedPaper={paper} options={paperOptions} />

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
            {paperOptions.map((item) => (
              <PaperOption
                key={item.value}
                option={item}
                active={paper === item.value}
                onClick={() => setPaper(item.value)}
              />
            ))}
          </div>
        </OptionSection>
      )}

      {!!printingOptions.length && (
        <OptionSection title="Printing Process">
          <div className="grid gap-2 min-[520px]:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
            {printingOptions.map((item) => (
              <LargeOptionButton
                key={item.value}
                option={item}
                active={printing === item.value}
                onClick={() => setPrinting(item.value)}
                compact
                showIcon={false}
              />
            ))}
          </div>
        </OptionSection>
      )}

      <div className="rounded-none bg-white p-4">
        <h3 className="text-xs font-extrabold uppercase tracking-[0.04em] text-[#303839]">Husnalogy Logo</h3>

        <button
          type="button"
          onClick={() => setLogo((current) => !current)}
          className={`mt-3 flex w-full items-center justify-between gap-3 rounded-none border p-3 text-left text-sm transition ${
            logo
              ? "border-[#303839] bg-[#303839] text-white"
              : "border-[#303839]/10 bg-white text-[#303839] hover:bg-[#E6E6E6]"
          }`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span
              className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border transition ${
                logo ? "border-white/20 bg-white" : "border-[#303839]/10 bg-white"
              }`}
            >
              <img
                src="/Brand Kit/Logo-2.png"
                alt="Husnalogy logo"
                className="h-8 w-8 scale-[1.85] object-contain"
              />
            </span>
            <span className="min-w-0">
              <span className="block font-bold">Add to back of card</span>
              <span className={`mt-0.5 block text-xs ${logo ? "text-white/68" : "text-[#303839]/58"}`}>
                A subtle mark of quality.
              </span>
            </span>
          </span>

          <span className={`relative h-7 w-12 shrink-0 rounded-none transition ${logo ? "bg-white" : "bg-[#303839]/16"}`}>
            <span className={`absolute top-1 grid h-5 w-5 place-items-center rounded-none transition ${logo ? "left-6 bg-[#303839] text-white" : "left-1 bg-white text-[#303839]"}`}>
              {logo && <i className="fa-solid fa-check text-[10px]" />}
            </span>
          </span>
        </button>
      </div>

      </div>
    </aside>

    <PersonalizationModal
      open={personalizationOpen}
      product={product}
      fields={fields}
      customizationValues={customizationValues}
      filledFieldCount={filledFieldCount}
      requiredRemaining={requiredRemaining}
      onClose={() => setPersonalizationOpen(false)}
      onChange={updateCustomization}
      onFile={updateFile}
      onProceed={() => addToCart({ goToCheckout: true })}
      loading={cartLoading}
      message={cartMessage}
    />
    </>
  );
}

function QuantityStepper({ quantity, onDecrease, onIncrease }) {
  return (
    <div className="flex h-10 shrink-0 items-center rounded-none border border-[#303839]/12 bg-white px-1">
      <button
        type="button"
        onClick={onDecrease}
        disabled={quantity <= 1}
        data-shape="round"
        className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-[#303839] transition hover:bg-[#E6E6E6] disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Decrease quantity"
      >
        -
      </button>
      <span className="grid min-w-10 place-items-center px-2 text-sm font-extrabold text-[#303839]">
        {quantity}
      </span>
      <button
        type="button"
        onClick={onIncrease}
        data-shape="round"
        className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-[#303839] transition hover:bg-[#E6E6E6]"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}

function PersonalizationModal({
  open,
  product,
  fields,
  customizationValues,
  filledFieldCount,
  requiredRemaining,
  onClose,
  onChange,
  onFile,
  onProceed,
  loading,
  message,
}) {
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const hasAnyDetails = Object.values(customizationValues || {}).some(Boolean);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) setAttemptedSubmit(false);
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setAttemptedSubmit(true);

    if (requiredRemaining > 0) return;

    await onProceed();
  };

  return (
    <div className="fixed inset-0 z-[3600] overflow-y-auto bg-[#303839]/35 px-3 py-5 backdrop-blur-md sm:px-5 sm:py-8">
      <button
        type="button"
        aria-label="Close personalization form"
        onClick={onClose}
        className="fixed inset-0 cursor-default"
      />

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-[760px] items-center">
        <form
          onSubmit={handleSubmit}
          className="relative w-full rounded-none border border-white/45 bg-white p-4 text-[#303839] shadow-[0_30px_90px_rgba(48,56,57,0.24)] sm:p-6"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[#303839]/10 pb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#303839]/45">
                {product?.title || "Husnalogy design"}
              </p>
              <h2 className="mt-1 font-display text-3xl leading-tight">
                Personalize this design
              </h2>
              <p className="mt-2 max-w-[560px] text-sm leading-6 text-[#303839]/68">
                Add your wording and photos below. When everything looks correct,
                continue to checkout.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              data-shape="round"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#303839]/12 bg-[#E6E6E6] text-[#303839] transition hover:bg-white"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-5 rounded-none border border-[#303839]/10 bg-[#E6E6E6] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#303839]/55">
              Your details so far
            </p>

            <div className="mt-3 space-y-1 text-sm leading-6 text-[#303839]/75">
              {Object.entries(customizationValues || {})
                .filter(([, value]) => Boolean(value))
                .slice(0, 8)
                .map(([key, value]) => (
                  <p key={key} className="line-clamp-1">
                    <span className="font-bold">{key.replace(/_/g, " ")}:</span>{" "}
                    {String(value).startsWith("data:image")
                      ? "Photo added"
                      : String(value)}
                  </p>
                ))}

              {!hasAnyDetails && (
                <p>
                  Nothing added yet. Your text and photo choices will show up here
                  as you fill in the fields below.
                </p>
              )}
            </div>
          </div>

          {fields.length > 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-full bg-[#E6E6E6] px-3 py-1.5 text-xs font-semibold text-[#303839]/65">
              <i
                className="fa-solid fa-wand-magic-sparkles text-[#303839]/45"
                aria-hidden="true"
              />
              <span>
                {filledFieldCount} of {fields.length} detail
                {fields.length === 1 ? "" : "s"} added
                {requiredRemaining > 0
                  ? ` · ${requiredRemaining} required left`
                  : " · all set"}
              </span>
            </div>
          )}

          <div className="mt-5 grid max-h-[48vh] gap-4 overflow-y-auto pr-1 sm:max-h-[52vh]">
            {fields.map((field, index) => (
              <DynamicField
                key={field.name}
                index={index + 1}
                field={field}
                value={customizationValues[field.name]}
                onChange={(value) => onChange(field, value)}
                onFile={(file) => onFile(field, file)}
              />
            ))}

            {fields.length === 0 && (
              <p className="rounded-none border border-dashed border-[#303839]/20 bg-[#E6E6E6] px-4 py-5 text-center text-sm text-[#303839]/60">
                This design does not need extra wording. Continue to checkout and
                Husnalogy will process the order.
              </p>
            )}
          </div>

          {attemptedSubmit && requiredRemaining > 0 && (
            <p className="mt-4 rounded-none bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
              Please complete the required details before checkout.
            </p>
          )}

          {message && (
            <p className="mt-4 rounded-none bg-[#E6E6E6] px-4 py-3 text-sm font-bold leading-6 text-[#303839]">
              {message}
            </p>
          )}

          <div className="mt-5 flex flex-col-reverse gap-3 border-t border-[#303839]/10 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="h-12 rounded-full border border-[#303839]/15 bg-white px-6 text-sm font-bold text-[#303839] transition hover:bg-[#E6E6E6]"
            >
              Keep editing later
            </button>

            <button
              type="submit"
              disabled={loading}
              className="h-12 rounded-full bg-[#303839] px-7 text-sm font-bold text-white transition hover:bg-[#303839] disabled:opacity-60"
            >
              {loading ? "Preparing checkout..." : "Proceed to Checkout"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AnimatedSelect({
  value,
  onChange,
  options,
  showBadge = false,
  showIcon = true,
  showDescription = true,
}) {
  const selectId = useId();
  const listId = useId();
  const wrapperRef = useRef(null);
  const [open, setOpen] = useState(false);

  const selected = findOption(options, value);
  const selectedLabel = selected.displayLabel || selected.label;

  useEffect(() => {
    function handleClickOutside(event) {
      if (!wrapperRef.current) return;

      if (!wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="relative min-w-0">
      <button
        id={selectId}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        className={`group flex min-h-[58px] w-full items-center justify-between gap-3 rounded-none border px-3 py-3 text-left outline-none transition ${
          open
            ? "border-[#303839] bg-white ring-2 ring-[#303839]/10"
            : "border-[#303839]/10 bg-white hover:bg-[#E6E6E6]"
        }`}
      >
        <span className="flex min-w-0 items-center gap-3">
          {showIcon && (
            <span
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all duration-300 ${
                open
                  ? "bg-[#303839] text-white"
                  : "bg-white text-[#303839]"
              }`}
            >
              <i className={selected.icon} />
            </span>
          )}

          <span className="min-w-0">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="block truncate text-sm font-bold text-[#303839]">
                {selectedLabel}
              </span>

              {selected.price && (
                <span className="shrink-0 text-sm font-extrabold text-[#303839]">
                  {selected.price}
                </span>
              )}

              {showBadge && selected.badge && (
                <span className="shrink-0 rounded-full bg-[#303839] px-2 py-0.5 text-[10px] font-bold text-white">
                  {selected.badge}
                </span>
              )}
            </span>

            {showDescription && selected.description && (
              <span className="mt-0.5 block truncate text-xs text-[#303839]/55">
                {selected.description}
              </span>
            )}
          </span>
        </span>

        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-[#303839] transition ${open ? "rotate-180" : "rotate-0"}`}>
          <i className="fa-solid fa-chevron-down text-xs" />
        </span>
      </button>

      <div
          className={`absolute left-0 right-0 top-full z-50 mt-2 origin-top overflow-hidden rounded-none border border-[#303839]/10 bg-white shadow-[0_18px_40px_rgba(48,56,57,0.12)] transition-all duration-200 ${
          open
            ? "visible translate-y-0 scale-100 opacity-100"
            : "invisible -translate-y-2 scale-[0.98] opacity-0"
        }`}
      >
        <div
          id={listId}
          role="listbox"
          className={`grid gap-1.5 overflow-hidden p-2 transition-all duration-300 ${
            open ? "max-h-[340px]" : "max-h-0"
          }`}
        >
          {options.map((item) => {
            const active = item.value === value;
            const itemLabel = item.displayLabel || item.label;

            return (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                  className={`group flex items-center justify-between gap-3 rounded-none px-3 py-3 text-left transition ${
                  active
                    ? "bg-[#303839] text-white"
                    : "bg-white text-[#303839] hover:bg-[#E6E6E6]"
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  {showIcon && (
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition ${
                        active ? "bg-white/15" : "bg-[#E6E6E6]"
                      }`}
                    >
                      <i className={item.icon} />
                    </span>
                  )}

                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="block truncate text-sm font-bold">
                        {itemLabel}
                      </span>

                      {item.price && (
                        <span className={`shrink-0 text-sm font-extrabold ${active ? "text-white" : "text-[#303839]"}`}>
                          {item.price}
                        </span>
                      )}

                      {showBadge && item.badge && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            active
                              ? "bg-white text-[#303839]"
                              : "bg-[#303839] text-white"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </span>

                    {showDescription && item.description && (
                      <span
                        className={`mt-0.5 block truncate text-xs ${
                          active ? "text-white/70" : "text-[#303839]/55"
                        }`}
                      >
                        {item.description}
                      </span>
                    )}
                  </span>
                </span>

                <i
                  className={`fa-solid fa-circle-check transition-all duration-200 ${
                    active ? "scale-100 opacity-100" : "scale-75 opacity-0"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OptionSection({
  title,
  subtitle,
  selectedText,
  actionText,
  icon,
  children,
  noTopBorder = false,
}: any) {
  return (
    <section
      className={`rounded-none bg-white p-4 ${
        noTopBorder ? "" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E6E6E6] text-xs text-[#303839]">
              <i className={icon} />
            </span>
          )}
          <div className="min-w-0">
          <h3 className="truncate text-xs font-extrabold uppercase tracking-[0.04em] text-[#303839]">{title}</h3>

          {selectedText && (
            <p className="mt-1 text-xs text-[#303839]/70">{selectedText}</p>
          )}

          {subtitle && (
            <p className="mt-1 max-w-[320px] text-xs leading-5 text-[#303839]/70">
              {subtitle}
            </p>
          )}
          </div>
        </div>

        {actionText && (
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-[#303839] hover:underline"
          >
            {actionText}
          </button>
        )}
      </div>

      <div className="mt-3">{children}</div>
    </section>
  );
}

function LargeOptionButton({ option, active, onClick, compact = false, showIcon = true }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full min-w-0 items-center justify-between gap-3 rounded-none border px-3 text-left transition active:scale-[0.99] ${
        compact ? "py-2.5" : "py-3"
      } ${
        active
          ? "border-[#303839] bg-[#303839] text-white"
          : "border-[#303839]/10 bg-white text-[#303839] hover:bg-[#E6E6E6]"
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        {showIcon && (
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm transition ${
              active
                ? "bg-white/15 text-white"
                : "bg-white text-[#303839]"
            }`}
          >
            <i className={option.icon} />
          </span>
        )}

        <span className="min-w-0">
          <span className="block text-sm font-extrabold leading-5">{option.label}</span>

          {option.description && (
            <span
              className={`mt-0.5 block text-xs leading-5 ${
                active ? "text-white/70" : "text-[#303839]/55"
              }`}
            >
              {option.description}
            </span>
          )}

          {option.price && (
            <span
              className={`mt-1 block text-xs font-bold ${
                active ? "text-white" : "text-[#303839]"
              }`}
            >
              {option.price}
            </span>
          )}
        </span>
      </span>

      <span
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition ${
          active
            ? "border-white bg-white text-[#303839]"
            : "border-[#303839]/25 bg-white text-transparent"
        }`}
      >
        <i className="fa-solid fa-check text-[10px]" />
      </span>
    </button>
  );
}

function CornerOptionButton({ option, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className="group min-w-0 text-center">
      <span
        className={`relative grid min-h-[72px] place-items-center rounded-none border px-2 py-3 transition active:scale-95 ${
          active
            ? "border-[#303839] bg-[#303839] text-white"
            : "border-[#303839]/10 bg-white text-[#303839] hover:bg-[#E6E6E6]"
        }`}
      >
        <CornerIcon type={option.icon} active={active} />

        {active && (
          <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-white text-[9px] text-[#303839]">
            <i className="fa-solid fa-check" />
          </span>
        )}

        <span className={`mt-1.5 block text-[10px] font-bold ${active ? "text-white/80" : "text-[#303839]/58"}`}>
          {option.price || "Included"}
        </span>
      </span>

      <span className="mt-1.5 block truncate text-[10px] font-bold text-[#303839]/70">
        {option.label}
      </span>
    </button>
  );
}

function CornerIcon({ type, active = false }) {
  const color = active ? "currentColor" : "#303839";

  const common = {
    fill: "none",
    stroke: color,
    strokeWidth: "1.7",
  };

  if (type === "rounded") {
    return (
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="5" y="5" width="22" height="22" rx="5" {...common} />
      </svg>
    );
  }

  if (type === "arch") {
    return (
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M6 27V15C6 9.5 10.5 5 16 5C21.5 5 26 9.5 26 15V27H6Z"
          {...common}
        />
      </svg>
    );
  }

  if (type === "scallop") {
    return (
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M8 6C9.5 3.8 12.5 3.8 14 6C15.5 3.8 18.5 3.8 20 6C21.5 3.8 24.5 3.8 26 6C28.2 7.5 28.2 10.5 26 12C28.2 13.5 28.2 16.5 26 18C28.2 19.5 28.2 22.5 26 24C24.5 26.2 21.5 26.2 20 24C18.5 26.2 15.5 26.2 14 24C12.5 26.2 9.5 26.2 8 24C5.8 22.5 5.8 19.5 8 18C5.8 16.5 5.8 13.5 8 12C5.8 10.5 5.8 7.5 8 6Z"
          {...common}
        />
      </svg>
    );
  }

  if (type === "bracket") {
    return (
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M8 6H24V10C21 10.5 21 14 24 14.5V17.5C21 18 21 21.5 24 22V26H8V22C11 21.5 11 18 8 17.5V14.5C11 14 11 10.5 8 10V6Z"
          {...common}
        />
      </svg>
    );
  }

  if (type === "ticket") {
    return (
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M7 7H25V12C22.5 12 22.5 16 25 16V21C22.5 21 22.5 25 25 25H7V20C9.5 20 9.5 16 7 16V12C9.5 12 9.5 7 7 7Z"
          {...common}
        />
      </svg>
    );
  }

  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="6" width="20" height="20" {...common} />
    </svg>
  );
}

function PaperPreview({ selectedPaper, options }) {
  const selected = findOption(options, selectedPaper) || fallbackOption();

  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-none border border-[#303839]/10 bg-white p-3">
      <span className="grid h-11 w-11 place-items-center rounded-none border border-[#303839]/10 bg-white text-base text-[#303839]">
        <i className={selected.icon} />
      </span>

      <div className="min-w-0">
        <p className="truncate text-xs font-extrabold text-[#303839]">{selected.label}</p>

        <p className="mt-1 text-xs leading-5 text-[#303839]/65">
          {selected.description}
        </p>

        <button
          type="button"
          className="hidden items-center gap-1"
        >
          Details <RightArrowIcon />
        </button>
      </div>

      <span className="rounded-full bg-[#303839] px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white">
        Selected
      </span>
    </div>
  );
}

function PaperOption({ option, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className="group min-w-0 text-left">
      <span
        className={`relative flex min-h-[86px] flex-col justify-between rounded-none border p-3 transition active:scale-[0.98] ${
          active
            ? "border-[#303839] bg-[#303839] text-white"
            : "border-[#303839]/10 bg-white text-[#303839] hover:bg-[#E6E6E6]"
        }`}
      >
        <span className="flex items-center justify-between">
          <i className={`${option.icon} text-lg`} />

          {active && <i className="fa-solid fa-circle-check text-sm" />}
        </span>

        <span>
          <span className="block text-xs font-bold leading-4">{option.label}</span>

          {option.price && (
            <span
              className={`mt-1 block text-[10px] font-bold ${
                active ? "text-white/80" : "text-[#303839]/65"
              }`}
            >
              {option.price}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function DynamicField({ field, value, onChange, onFile, index }) {
  const inputId = `cf-${field.name}`;
  const baseClass =
    "w-full rounded-none border border-[#303839]/15 bg-white px-4 text-sm outline-none transition focus:border-[#303839]/40 focus:ring-2 focus:ring-[#303839]/10";
  const hint = field.helper || field.help || field.hint || field.description || "";
  const hasValue = Boolean(value);

  const fieldHeader = (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <label
        htmlFor={inputId}
        className="flex items-center gap-2 text-sm font-semibold text-[#303839]"
      >
        {index ? (
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#303839] text-[10px] font-bold text-white">
            {index}
          </span>
        ) : null}
        <span>
          {field.label}
          {field.required && <span className="text-red-600"> *</span>}
        </span>
      </label>

      {hasValue ? (
        <span className="shrink-0 text-[11px] font-semibold text-green-600">
          <i className="fa-solid fa-check" aria-hidden="true" /> Added
        </span>
      ) : field.required ? (
        <span className="shrink-0 text-[11px] font-semibold text-[#303839]/45">
          Required
        </span>
      ) : null}
    </div>
  );

  const hintNode = hint ? (
    <p className="mt-1 text-xs leading-5 text-[#303839]/55">{hint}</p>
  ) : null;

  if (field.type === "textarea") {
    return (
      <div>
        {fieldHeader}
        <textarea
          id={inputId}
          value={value || ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder || "Type your wording here"}
          required={field.required}
          className={`${baseClass} min-h-24 py-3`}
        />
        {hintNode}
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div>
        {fieldHeader}
        <PillDropdown
          value={value || ""}
          onChange={onChange}
          label={field.label}
          placeholder="Select an option..."
          options={[
            { value: "", label: "Select an option..." },
            ...(field.options || []).map((option) => ({ value: option, label: option })),
          ]}
          className="w-full"
          buttonClassName="h-12 bg-white text-sm font-medium shadow-none"
        />
        {hintNode}
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label className="flex cursor-pointer items-start gap-3 rounded-none border border-[#303839]/15 bg-white px-4 py-3 text-sm transition hover:border-[#303839]/30">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#303839]"
        />
        <span className="min-w-0">
          <span className="font-semibold text-[#303839]">
            {field.label}
            {field.required && <span className="text-red-600"> *</span>}
          </span>
          {hint && (
            <span className="mt-0.5 block text-xs leading-5 text-[#303839]/55">
              {hint}
            </span>
          )}
        </span>
      </label>
    );
  }

  if (field.type === "image" || field.type === "file") {
    const isImage = field.type === "image";

    return (
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-[#303839]">
            {index ? (
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#303839] text-[10px] font-bold text-white">
                {index}
              </span>
            ) : null}
            <span>
              {field.label}
              {field.required && <span className="text-red-600"> *</span>}
            </span>
          </span>

          {hasValue && (
            <span className="shrink-0 text-[11px] font-semibold text-green-600">
              <i className="fa-solid fa-check" aria-hidden="true" /> Added
            </span>
          )}
        </div>

        <label
          className={`flex cursor-pointer items-center gap-3 rounded-none border border-dashed px-4 py-4 text-sm transition ${
            hasValue
              ? "border-green-500/50 bg-green-50/50"
              : "border-[#303839]/25 bg-white hover:border-[#303839]/45 hover:bg-[#E6E6E6]"
          }`}
        >
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
              hasValue ? "bg-green-600 text-white" : "bg-[#E6E6E6] text-[#303839]"
            }`}
          >
            <i
              className={`fa-solid ${hasValue ? "fa-check" : "fa-arrow-up-from-bracket"}`}
              aria-hidden="true"
            />
          </span>

          <span className="min-w-0">
            <span className="block font-semibold text-[#303839]">
              {hasValue
                ? `${isImage ? "Photo" : "File"} added — tap to replace`
                : `Upload ${isImage ? "a photo" : "a file"}`}
            </span>
            <span className="block text-xs text-[#303839]/55">
              {isImage ? "JPG, PNG or HEIC" : "Any file type"}
              {field.required ? " · required" : ""}
            </span>
          </span>

          <input
            type="file"
            accept={isImage ? "image/*" : undefined}
            required={field.required && !hasValue}
            onChange={(event) => onFile(event.target.files?.[0])}
            className="sr-only"
          />
        </label>
        {hintNode}
      </div>
    );
  }

  return (
    <div>
      {fieldHeader}
      <input
        id={inputId}
        type={field.type || "text"}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder || "Type here"}
        required={field.required}
        className={`${baseClass} h-12`}
      />
      {hintNode}
    </div>
  );
}
