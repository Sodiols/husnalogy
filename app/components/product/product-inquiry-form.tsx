"use client";

import { useMemo, useState } from "react";
import { PillDropdown } from "./product-toolbar";

const fallbackFields = [
  { name: "names", label: "Names or wording", type: "text" },
  { name: "venue", label: "Venue or location", type: "text" },
  { name: "colorPreference", label: "Color preference", type: "text" },
  { name: "wordingNote", label: "Wording note", type: "textarea" },
];

function normalizeName(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getHelpFields(product) {
  const sourceFields = product.customizationFields?.length ? product.customizationFields : fallbackFields;
  const blockedTypes = new Set(["date", "time", "image", "file"]);
  const blockedNames = new Set(["eventdate", "eventtime", "date", "time", "photoupload", "photo"]);
  const seen = new Set();

  return sourceFields.filter((field) => {
    const name = normalizeName(field.name || field.label);
    if (!field?.label || blockedTypes.has(field.type) || blockedNames.has(name)) return false;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

export default function ProductInquiryForm({ product, open, onClose }) {
  const fields = useMemo(() => getHelpFields(product), [product]);
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    requestType: "Customize this product",
    message: "",
  });
  const [customizationDetails, setCustomizationDetails] = useState({});
  const [status, setStatus] = useState({ loading: false, success: "", error: "" });

  if (!open) return null;

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateCustomization = (key, value) => {
    setCustomizationDetails((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, success: "", error: "" });

    try {
      const response = await fetch("/api/order-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          productTitle: product.title,
          productSlug: product.slug,
          ...form,
          message: [form.requestType, form.message].filter(Boolean).join(" | "),
          customizationDetails,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Please check the form and try again.");
      }

      setForm({
        customerName: "",
        customerEmail: "",
        customerPhone: "",
        requestType: "Customize this product",
        message: "",
      });
      setCustomizationDetails({});
      setStatus({ loading: false, success: "Your request has been sent. Husnalogy will review it soon.", error: "" });
    } catch (error) {
      setStatus({ loading: false, success: "", error: error.message || "Something went wrong." });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-5 rounded-none border border-[#303839]/15 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold">Request design help</h3>
          <p className="mt-1 text-xs leading-5 text-[#303839]/65">
            Send the product and changes you need. Husnalogy will review your request before confirming the order.
          </p>
        </div>

        <button type="button" onClick={onClose} className="text-2xl leading-none text-[#303839]/60" aria-label="Close request form">
          ×
        </button>
      </div>

      <div className="rounded-none bg-[#E6E6E6] p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#303839]/55">Step 1</p>
        <p className="mt-1 text-sm font-bold">Your contact details</p>
        <div className="mt-4 space-y-3">
          <input
            value={form.customerName}
            onChange={(event) => updateForm("customerName", event.target.value)}
            placeholder="Your name"
            required
            className="h-12 w-full rounded-none border border-[#303839]/20 px-4 text-sm outline-none"
          />

          <input
            type="email"
            value={form.customerEmail}
            onChange={(event) => updateForm("customerEmail", event.target.value)}
            placeholder="Your email"
            required
            className="h-12 w-full rounded-none border border-[#303839]/20 px-4 text-sm outline-none"
          />

          <input
            value={form.customerPhone}
            onChange={(event) => updateForm("customerPhone", event.target.value)}
            placeholder="Phone number"
            className="h-12 w-full rounded-none border border-[#303839]/20 px-4 text-sm outline-none"
          />
        </div>
      </div>

      <div className="rounded-none bg-[#E6E6E6] p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#303839]/55">Step 2</p>
        <p className="mt-1 text-sm font-bold">What do you need?</p>
        <PillDropdown
          value={form.requestType}
          onChange={(value) => updateForm("requestType", value)}
          label="Request type"
          options={[
            "Customize this product",
            "Change wording only",
            "Change color or style",
            "Need help before ordering",
          ]}
          className="mt-4 w-full"
          buttonClassName="h-12 bg-white text-sm font-medium shadow-none"
        />

        <textarea
          value={form.message}
          onChange={(event) => updateForm("message", event.target.value)}
          placeholder="Write the changes you want in simple words"
          required
          className="mt-3 min-h-24 w-full rounded-none border border-[#303839]/20 p-4 text-sm outline-none"
        />
      </div>

      {fields.length > 0 && (
        <div className="rounded-none bg-[#E6E6E6] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#303839]/55">Optional</p>
          <p className="mt-1 text-sm font-bold">Product wording details</p>
          <div className="mt-4 space-y-3">
            {fields.map((field) => {
              const value = customizationDetails[field.name] || "";
              const isTextarea = field.type === "textarea";

              if (isTextarea) {
                return (
                  <textarea
                    key={field.name}
                    value={value}
                    onChange={(event) => updateCustomization(field.name, event.target.value)}
                    placeholder={field.label}
                    required={field.required}
                    className="min-h-24 w-full rounded-none border border-[#303839]/20 p-4 text-sm outline-none"
                  />
                );
              }

              if (field.type === "select") {
                return (
                  <PillDropdown
                    key={field.name}
                    value={value}
                    onChange={(nextValue) => updateCustomization(field.name, nextValue)}
                    label={field.label}
                    placeholder={field.label}
                    options={[
                      { value: "", label: field.label },
                      ...(field.options || []).map((option) => ({ value: option, label: option })),
                    ]}
                    className="w-full"
                    buttonClassName="h-12 bg-white text-sm font-medium shadow-none"
                  />
                );
              }

              if (field.type === "checkbox") {
                return (
                  <label key={field.name} className="flex items-center gap-3 rounded-none border border-[#303839]/20 bg-white px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) => updateCustomization(field.name, event.target.checked)}
                    />
                    {field.label}
                  </label>
                );
              }

              return (
                <input
                  key={field.name}
                  type={field.type || "text"}
                  value={value}
                  onChange={(event) => updateCustomization(field.name, event.target.value)}
                  placeholder={field.label}
                  required={field.required}
                  className="h-12 w-full rounded-none border border-[#303839]/20 px-4 text-sm outline-none"
                />
              );
            })}
          </div>
        </div>
      )}

      {status.error && <p className="text-sm font-semibold text-red-600">{status.error}</p>}
      {status.success && <p className="text-sm font-semibold text-green-700">{status.success}</p>}

      <button
        type="submit"
        disabled={status.loading}
        className="h-12 w-full rounded-full bg-[#303839] text-sm font-bold text-white disabled:opacity-60"
      >
        {status.loading ? "Sending..." : "Send design help request"}
      </button>
    </form>
  );
}
