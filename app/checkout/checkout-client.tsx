"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useAuth from "../lib/useAuth";
import {
  clearCart,
  getCartTotals,
  saveCustomerAddress,
  openCustomerLogin,
  saveLocalOrder,
  subscribeToUserCart,
} from "../lib/customer-lists";

const initialCustomer = {
  firstName: "",
  lastName: "",
  customerEmail: "",
  customerPhone: "",
  city: "",
  addressLine1: "",
  postalCode: "",
  deliveryNote: "",
};

export default function CheckoutClient({ initialUser = undefined }: any) {
  const { user, authLoading } = useAuth(initialUser);
  const [items, setItems] = useState([]);
  const [customer, setCustomer] = useState(initialCustomer);
  const [deliveryMethod, setDeliveryMethod] = useState("delivery");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [saveAddress, setSaveAddress] = useState(true);
  const [acceptTerms, setAcceptTerms] = useState(true);
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  useEffect(() => {
    if (authLoading) return undefined;
    return subscribeToUserCart(user, setItems);
  }, [authLoading, user]);

  useEffect(() => {
    if (!user) return;

    setCustomer((current) => {
      const parts = String(user.name || "").trim().split(/\s+/).filter(Boolean);
      return {
        ...current,
        firstName: current.firstName || parts[0] || "",
        lastName: current.lastName || parts.slice(1).join(" ") || "",
        customerEmail: current.customerEmail || user.email || "",
      };
    });
  }, [user]);

  const totals = getCartTotals(items);

  const updateCustomer = (key, value) => {
    setCustomer((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!items.length) {
      setStatus({ loading: false, error: "Your cart is empty.", success: "" });
      return;
    }

    if (!user) {
      setStatus({ loading: false, error: "Please sign in before checkout so this order can be saved to your account.", success: "" });
      openCustomerLogin();
      return;
    }

    if (!acceptTerms) {
      setStatus({ loading: false, error: "Please accept the terms to place your order.", success: "" });
      return;
    }

    setStatus({ loading: true, error: "", success: "" });

    const customerName = `${customer.firstName} ${customer.lastName}`.trim();
    const methodLabel = deliveryMethod === "store" ? "Store pickup" : "Home delivery";
    const message = [
      `Delivery: ${methodLabel}`,
      deliveryDate ? `Preferred date: ${deliveryDate}` : "",
      customer.deliveryNote ? `Note: ${customer.deliveryNote}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    try {
      const response = await fetch("/api/order-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerName,
          customerEmail: customer.customerEmail,
          customerPhone: customer.customerPhone,
          addressLine1: customer.addressLine1,
          addressLine2: "",
          city: customer.city,
          area: "",
          postalCode: customer.postalCode,
          deliveryNote: customer.deliveryNote,
          deliveryMethod,
          deliveryDate,
          customerId: user?.uid || "",
          items,
          subtotal: totals.subtotal,
          deliveryCharge: totals.deliveryCharge,
          total: totals.total,
          paymentStatus: "unpaid",
          paymentMethod: "Cash on Delivery",
          status: "pending",
          message,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Could not place the order.");
      }

      if (saveAddress) {
        saveCustomerAddress({
          customerName,
          customerPhone: customer.customerPhone,
          addressLine1: customer.addressLine1,
          addressLine2: "",
          city: customer.city,
          area: "",
          postalCode: customer.postalCode,
        });
      }

      const savedOrder = {
        id: data.order?.id,
        customerId: user.uid,
        customerName,
        customerEmail: customer.customerEmail,
        customerPhone: customer.customerPhone,
        productTitle: data.order?.productTitle || items[0]?.title || "Order request",
        items,
        subtotal: totals.subtotal,
        deliveryCharge: totals.deliveryCharge,
        total: totals.total,
        paymentStatus: data.order?.paymentStatus || "unpaid",
        status: data.order?.status || "pending",
        createdAt: data.order?.createdAt || new Date().toISOString(),
        updatedAt: data.order?.updatedAt || new Date().toISOString(),
      };

      saveLocalOrder(savedOrder);

      await clearCart(user);
      setCustomer(initialCustomer);
      setDeliveryDate("");
      setStatus({ loading: false, error: "", success: `Order request placed. Order ID: ${data.order?.id || "created"}` });
    } catch (error) {
      setStatus({ loading: false, error: error.message || "Something went wrong.", success: "" });
    }
  };

  const money = (value) => `$${Number(value || 0).toFixed(2)}`;
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

  return (
    <main className="checkout-scope relative bg-[#fbfaf7] px-4 py-8 text-[#303839] sm:px-6 lg:px-10 lg:py-10 xl:py-12">
      {/* Soft neutral wash over a white base */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(75%_58%_at_46%_-8%,rgba(230,230,230,0.72),transparent_58%),radial-gradient(64%_52%_at_105%_100%,rgba(230,230,230,0.48),transparent_60%)]"
      />
      <div className="relative mx-auto max-w-[1180px]">
        <div className="mb-7 flex items-center gap-3 sm:mb-8 lg:mb-9">
          <Link
            href="/cart"
            aria-label="Back to cart"
            className="grid h-10 w-10 place-items-center rounded-full border border-[#303839]/10 bg-white/80 text-[#303839] shadow-[0_10px_24px_-18px_rgba(48,56,57,0.55)] transition-all hover:bg-[#E6E6E6]"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="font-body text-4xl font-extrabold leading-none tracking-normal sm:text-[2.75rem]">Checkout</h1>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-9 xl:grid-cols-[minmax(0,1fr)_384px]">
          {/* Details */}
          <div className="space-y-8 lg:space-y-9">
            {!authLoading && !user && (
              <div className="flex flex-col gap-3 rounded-[18px] border border-white/80 bg-white/85 p-5 shadow-[0_22px_48px_-32px_rgba(48,56,57,0.5)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-[#303839]">Sign in before checkout</p>
                  <p className="mt-1 text-sm leading-6 text-[#303839]/60">Your order can only be saved to your account when you are signed in.</p>
                </div>
                <button
                  type="button"
                  onClick={openCustomerLogin}
                  className="checkout-primary-button shrink-0 px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white duration-200"
                >
                  Sign in
                </button>
              </div>
            )}

            {/* 1. Contact Information */}
            <Section n="1" title="Contact Information">
              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                <Field label="First name" value={customer.firstName} onChange={(v) => updateCustomer("firstName", v)} required />
                <Field label="Last name" value={customer.lastName} onChange={(v) => updateCustomer("lastName", v)} required />
                <Field label="Phone" value={customer.customerPhone} onChange={(v) => updateCustomer("customerPhone", v)} placeholder="+880 1XXX-XXXXXX" />
                <Field label="E-mail" type="email" value={customer.customerEmail} onChange={(v) => updateCustomer("customerEmail", v)} required />
              </div>
            </Section>

            {/* 2. Delivery method */}
            <Section n="2" title="Delivery method">
              <div className="grid max-w-[380px] grid-cols-2 gap-3">
                <ChoiceTile
                  selected={deliveryMethod === "store"}
                  onClick={() => setDeliveryMethod("store")}
                  label="Store"
                  icon={
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9 5 4h14l1 5" /><path d="M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" /><path d="M5 12v8h14v-8" /></svg>
                  }
                />
                <ChoiceTile
                  selected={deliveryMethod === "delivery"}
                  onClick={() => setDeliveryMethod("delivery")}
                  label="Delivery"
                  icon={
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.7" /><circle cx="17.5" cy="18" r="1.7" /></svg>
                  }
                />
              </div>

              <div className="mt-4 max-w-[380px]">
                <Field label="Delivery date" type="date" value={deliveryDate} onChange={setDeliveryDate} />
              </div>

              <div className="mt-4 grid gap-x-4 gap-y-4 sm:grid-cols-3">
                <Field label="City" value={customer.city} onChange={(v) => updateCustomer("city", v)} required />
                <Field label="Address" value={customer.addressLine1} onChange={(v) => updateCustomer("addressLine1", v)} required />
                <Field label="Zip code" value={customer.postalCode} onChange={(v) => updateCustomer("postalCode", v)} />
              </div>

              <label className="mt-4 block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#303839]/45">Delivery note</span>
                <textarea
                  value={customer.deliveryNote}
                  onChange={(event) => updateCustomer("deliveryNote", event.target.value)}
                  placeholder="Gift message, preferred time, special instructions…"
                  className="checkout-field min-h-24 w-full px-4 py-3.5 text-sm text-[#303839] outline-none placeholder:text-[#303839]/35"
                />
              </label>

              <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-[14px] px-4 py-3 text-sm font-medium text-[#303839]/80">
                <input
                  type="checkbox"
                  checked={saveAddress}
                  onChange={(event) => setSaveAddress(event.target.checked)}
                  className="checkout-checkbox h-5 w-5 shrink-0 accent-[#303839]"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-bold text-[#303839]">Save this address</span>
                  <span className="text-[12px] leading-5 text-[#303839]/55">Keep it on this device for faster checkout.</span>
                </span>
              </label>
            </Section>

            {/* 3. Payment method */}
            <Section n="3" title="Payment method">
              <div className="max-w-[380px]">
                <div className="flex items-center gap-3 rounded-[18px] border border-[#303839]/75 bg-white/95 px-4 py-4 shadow-[0_14px_30px_-20px_rgba(48,56,57,0.5)]">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#303839] text-white">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="10" rx="2" /><circle cx="12" cy="12" r="2.2" /><path d="M6 12h.01M18 12h.01" /></svg>
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-[#303839]">Cash on Delivery</p>
                    <p className="text-xs text-[#303839]/55">Pay when your order arrives.</p>
                  </div>
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#303839] text-white">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-11" /></svg>
                  </span>
                </div>
              </div>
            </Section>
          </div>

          {/* Order summary */}
          <aside className="lg:sticky lg:top-6">
            <div className="rounded-[22px] border border-white/80 bg-white/90 p-5 shadow-[0_34px_80px_-48px_rgba(48,56,57,0.58)] backdrop-blur sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-[#303839]">Order</h2>
                {itemCount > 0 && (
                  <span className="rounded-full bg-[#E6E6E6] px-2.5 py-1 text-[11px] font-bold text-[#303839]">
                    {itemCount} {itemCount === 1 ? "item" : "items"}
                  </span>
                )}
              </div>

              <div className="mt-4 max-h-[300px] space-y-4 overflow-y-auto">
                {items.map((item) => {
                  const options = item.selectedOptions || {};
                  const meta = [options.size ? `Size: ${options.size}` : "", options.color ? `Color: ${options.color}` : ""].filter(Boolean).join("   ");
                  return (
                    <div key={item.id} className="flex items-center gap-3">
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[14px] bg-[#E6E6E6] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                        {item.image ? <img src={item.image} alt={item.title} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[13px] font-bold leading-snug text-[#303839]">{item.title}</p>
                        {meta && <p className="mt-0.5 text-[11px] text-[#303839]/55">{meta}</p>}
                        <p className="mt-0.5 text-[11px] text-[#303839]/55">Qty {item.quantity || 1}</p>
                      </div>
                      <p className="shrink-0 text-sm font-bold text-[#303839]">
                        {money(Number(item.price || 0) * Number(item.quantity || 1))}
                      </p>
                    </div>
                  );
                })}
                {!items.length && (
                  <p className="rounded-[14px] bg-[#E6E6E6]/60 px-4 py-6 text-center text-sm text-[#303839]/55">Your cart is empty.</p>
                )}
              </div>

              <div className="mt-5 space-y-2.5 border-t border-[#303839]/10 pt-5 text-[13px]">
                <div className="flex justify-between text-[#303839]/60">
                  <span className="uppercase tracking-[0.06em]">Subtotal</span>
                  <span className="font-bold text-[#303839]">{money(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-[#303839]/60">
                  <span className="uppercase tracking-[0.06em]">Shipping</span>
                  <span>Calculated later</span>
                </div>
              </div>

              <div className="mt-4 flex items-baseline justify-between border-t border-[#303839]/10 pt-4">
                <span className="text-base font-bold uppercase tracking-[0.04em] text-[#303839]">Total</span>
                <span className="text-2xl font-bold text-[#303839]">{money(totals.total)}</span>
              </div>

              <button
                type="submit"
                disabled={status.loading || authLoading || !user || !items.length || !acceptTerms}
                className="checkout-primary-button mt-5 flex w-full items-center justify-center gap-2 px-6 py-4 text-sm font-bold text-white duration-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {status.loading ? "Placing order…" : !user ? "Sign in to place order" : "Place order"}
                {!status.loading && user && (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13" /><path d="m12 5 7 7-7 7" /></svg>
                )}
              </button>

              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[12px] leading-5 text-[#303839]/60">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(event) => setAcceptTerms(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#303839]"
                />
                <span>
                  By confirming the order, I accept the{" "}
                  <Link href="/terms" className="font-semibold text-[#303839] underline underline-offset-2">terms of the user agreement</Link>.
                </span>
              </label>
            </div>
          </aside>
        </form>
      </div>

      <CheckoutNotification status={status} />
    </main>
  );
}

function CheckoutNotification({ status }: any) {
  const message = status.success || status.error;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return undefined;
    }

    setVisible(true);
    const timeout = window.setTimeout(() => setVisible(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  if (!message) return null;

  const isSuccess = Boolean(status.success);
  const orderPrefix = "Order request placed. Order ID: ";
  const hasOrderId = isSuccess && String(status.success).startsWith(orderPrefix);
  const title = hasOrderId ? "Order request placed" : message;
  const detail = hasOrderId ? `Order ID: ${String(status.success).slice(orderPrefix.length)}` : "";

  return (
    <div
      role={isSuccess ? "status" : "alert"}
      aria-live={isSuccess ? "polite" : "assertive"}
      className={`fixed bottom-24 right-4 z-[2600] w-[calc(100vw-2rem)] max-w-[360px] rounded-[14px] border bg-white px-4 py-3 text-sm font-semibold text-[#303839] shadow-[0_18px_44px_-26px_rgba(48,56,57,0.65)] transition-all duration-300 sm:right-6 lg:bottom-6 ${
        isSuccess ? "border-green-200" : "border-red-200"
      } ${visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white ${
            isSuccess ? "bg-green-600" : "bg-red-600"
          }`}
        >
          {isSuccess ? (
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 12 4 4 10-10" />
            </svg>
          ) : (
            <span className="text-[10px]">!</span>
          )}
        </span>
        <span className="min-w-0 leading-5">
          <span className="block">{title}</span>
          {detail ? (
            <span className="mt-0.5 block text-xs font-medium text-[#303839]/45">{detail}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function Section({ n, title, children }: any) {
  return (
    <section>
      <h2 className="mb-5 text-[15px] font-bold text-[#303839] lg:mb-3">
        <span className="text-[#303839]/45">{n}.</span> {title}
      </h2>
      {children}
    </section>
  );
}

function ChoiceTile({ selected, onClick, icon, label }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-[56px] items-center justify-center gap-2.5 border px-4 py-3.5 text-sm font-semibold transition-all duration-200 sm:min-h-[58px] ${
        selected
          ? "border-[#303839]/45 bg-[#d8d8d8] text-[#303839] shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]"
          : "border-white/50 bg-[#E6E6E6] text-[#303839]/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] hover:bg-[#dddddd]"
      }`}
    >
      <span className={`grid h-7 w-7 place-items-center rounded-full ${selected ? "bg-[#303839] text-white" : "bg-white/80 text-[#303839]/45"}`}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function Field({ label, value, onChange, type = "text", required = false, placeholder = "", className = "" }: any) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#303839]/45">
        {label} {required && <span className="text-[#303839]/35">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        className="checkout-field h-[52px] w-full px-4 text-sm font-medium text-[#303839] outline-none placeholder:text-[#303839]/35 sm:h-[54px]"
      />
    </label>
  );
}
