"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/currency";
import { useEffect, useMemo, useRef, useState } from "react";
import useAuth from "../lib/useAuth";
import {
  refreshCart,
  getCartTotals,
  saveCustomerAddress,
  openCustomerLogin,
  saveLocalOrder,
  subscribeToUserCart,
} from "../lib/customer-lists";
import ServerCustomizationImage from "@/app/components/customizer/ServerCustomizationImage";
import { ORDER_POLICY } from "@/lib/launch-config";
import { CURRENT_TERMS_VERSION } from "@/lib/orders/checkout-policy";
import { normalizeBangladeshPhone } from "@/lib/orders/bd-contact";
import {
  attemptForCart,
  buildCheckoutItems,
  cartFingerprint,
  readAttempt,
  writeAttempt,
  type CheckoutAttempt,
} from "@/lib/orders/checkout-client";

const initialCustomer = {
  firstName: "",
  lastName: "",
  customerPhone: "",
  city: "",
  addressLine1: "",
  postalCode: "",
  deliveryNote: "",
};

// Shared by every tab of this browser (UX coordination only; the server's
// transactional cart consumption is what prevents duplicate orders).
function attemptStore(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// Server field names that map onto a differently named form input.
const FIELD_ALIASES: Record<string, string> = { customerName: "firstName" };

export default function CheckoutClient({ initialUser = undefined }: any) {
  const { user, authLoading } = useAuth(initialUser);
  const [items, setItems] = useState([]);
  const [customer, setCustomer] = useState(initialCustomer);
  const [deliveryMethod, setDeliveryMethod] = useState("delivery");
  const [saveAddress, setSaveAddress] = useState(true);
  // Terms are accepted explicitly, every time; the server re-checks both the
  // acceptance and the terms version.
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [placedOrder, setPlacedOrder] = useState<{ id: string } | null>(null);
  const [quote, setQuote] = useState<any>(null);
  // Synchronous guard: React state updates are async, so a fast double click
  // or Enter + click could otherwise start two submissions before the button
  // re-renders as disabled. The server's idempotency key is the real
  // protection; this is the UX layer.
  const submittingRef = useRef(false);
  const attemptRef = useRef<CheckoutAttempt | null>(null);

  useEffect(() => {
    if (authLoading) return undefined;
    return subscribeToUserCart(user, setItems);
  }, [authLoading, user]);

  const fingerprint = useMemo(() => cartFingerprint(items), [items]);
  const userId = user?.uid || user?.id || "";

  // A checkout that already succeeded for exactly this cart (refresh after
  // success, a cart cleanup that failed, the back button) shows the
  // confirmation instead of offering to place the same order again.
  useEffect(() => {
    if (!userId || !items.length) return undefined;
    const check = () => {
      const previous = readAttempt(attemptStore(), userId);
      if (previous?.status === "placed" && previous.fingerprint === fingerprint && previous.orderId) {
        setPlacedOrder({ id: previous.orderId });
        refreshCart(user);
      }
    };
    check();
    // Another tab of this browser placed the order: reflect it here too.
    window.addEventListener("storage", check);
    return () => window.removeEventListener("storage", check);
  }, [userId, fingerprint, items.length, user]);

  // Trusted prices from the server: the amount that will actually be charged.
  useEffect(() => {
    if (!userId || !items.length) {
      setQuote(null);
      return undefined;
    }
    const controller = new AbortController();
    fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryMethod, items: buildCheckoutItems(items) }),
      signal: controller.signal,
    })
      .then((response) => response.json().catch(() => ({})))
      .then((data) => {
        if (controller.signal.aborted) return;
        setQuote(data?.ok ? data.quote : { ok: false, error: data?.error || "We could not confirm current prices.", lines: [] });
      })
      .catch(() => {
        if (!controller.signal.aborted) setQuote({ ok: false, error: "We could not confirm current prices.", lines: [] });
      });
    return () => controller.abort();
  }, [userId, fingerprint, items, deliveryMethod]);

  useEffect(() => {
    if (!user) return;

    setCustomer((current) => {
      const parts = String(user.name || "").trim().split(/\s+/).filter(Boolean);
      return {
        ...current,
        firstName: current.firstName || parts[0] || "",
        lastName: current.lastName || parts.slice(1).join(" ") || "",
      };
    });
  }, [user]);

  const cartTotals = getCartTotals(items);
  const totals = quote?.ok
    ? { subtotal: quote.subtotal, deliveryCharge: quote.deliveryCharge, total: quote.total, currency: quote.currency }
    : cartTotals;
  const quoteLines = new Map<string, any>((quote?.lines || []).map((line: any) => [String(line.cartItemId || ""), line]));
  const pricesChanged = Boolean(quote?.ok && Math.abs(Number(quote.subtotal) - Number(cartTotals.subtotal)) >= 0.01);
  const quoteBlocked = Boolean(quote && !quote.ok);

  const updateCustomer = (key, value) => {
    setCustomer((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current || placedOrder) return;

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

    const customerName = `${customer.firstName} ${customer.lastName}`.trim();
    const localErrors: Record<string, string> = {};
    if (customerName.length < 2) localErrors.firstName = "Enter your full name.";
    if (!normalizeBangladeshPhone(customer.customerPhone)) localErrors.customerPhone = "Enter a valid Bangladesh mobile number, e.g. 01XXXXXXXXX.";
    if (deliveryMethod === "delivery" && customer.addressLine1.trim().length < 5) localErrors.addressLine1 = "Enter a complete delivery address.";
    if (deliveryMethod === "delivery" && customer.city.trim().length < 2) localErrors.city = "Enter your city.";
    if (deliveryMethod === "delivery" && customer.postalCode.trim() && !/^\d{4}$/.test(customer.postalCode.trim())) localErrors.postalCode = "Enter a 4-digit postcode.";
    if (Object.keys(localErrors).length) {
      setFieldErrors(localErrors);
      setStatus({ loading: false, error: Object.values(localErrors)[0], success: "" });
      return;
    }

    // One idempotency key per cart: reused by every retry of this cart,
    // rotated only when the cart itself changes.
    const { attempt, alreadyPlaced } = attemptForCart(attemptRef.current || readAttempt(attemptStore(), userId), fingerprint);
    if (alreadyPlaced && attempt.orderId) {
      setPlacedOrder({ id: attempt.orderId });
      return;
    }
    attemptRef.current = attempt;
    writeAttempt(attemptStore(), userId, attempt);

    submittingRef.current = true;
    setFieldErrors({});
    setStatus({ loading: true, error: "", success: "" });

    let data: any = null;
    let response: Response | null = null;
    try {
      response = await fetch("/api/order-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkoutSubmissionId: attempt.submissionId,
          customerName,
          customerPhone: customer.customerPhone,
          deliveryMethod,
          ...(deliveryMethod === "delivery"
            ? { addressLine1: customer.addressLine1, city: customer.city, postalCode: customer.postalCode }
            : {}),
          deliveryNote: customer.deliveryNote,
          acceptTerms: true,
          termsVersion: CURRENT_TERMS_VERSION,
          items: buildCheckoutItems(items),
        }),
      });
      data = await response.json().catch(() => ({}));
    } catch {
      // The request may or may not have reached the server. The attempt (and
      // its submission id) is kept, so pressing Place order again is a safe,
      // idempotent retry that can never create a second order.
      submittingRef.current = false;
      setStatus({ loading: false, error: "Connection lost. Your order may already be placed — press Place order again to check safely.", success: "" });
      return;
    }

    // Already placed — by this submission with other details, or by another
    // tab/device that consumed the same cart lines. Either way it is the
    // customer's own finalized order: show it instead of failing.
    const alreadyPlacedId =
      response.status === 409 && (data?.code === "SUBMISSION_REUSED" || data?.code === "CART_ALREADY_ORDERED") ? String(data?.orderId || "") : "";
    if ((!response.ok || data?.ok === false) && !alreadyPlacedId) {
      submittingRef.current = false;
      const errors = data?.errors && typeof data.errors === "object" ? data.errors : {};
      const mapped: Record<string, string> = Object.fromEntries(
        Object.entries(errors).map(([key, value]) => [FIELD_ALIASES[key] || key, String(value)]),
      );
      setFieldErrors(mapped);
      if (data?.code === "PRICE_CHANGED") setQuote(null);
      setStatus({ loading: false, error: Object.values(mapped)[0] || data?.error || "Could not place the order.", success: "" });
      return;
    }

    /* The order is FINALIZED on the server from here on. Nothing below may
       report failure or allow the same cart to be submitted again. */
    const orderId = String(data?.order?.id || alreadyPlacedId || "");
    const placedAttempt: CheckoutAttempt = { ...attempt, status: "placed", orderId };
    attemptRef.current = placedAttempt;
    writeAttempt(attemptStore(), userId, placedAttempt);
    setPlacedOrder({ id: orderId });
    setStatus({ loading: false, error: "", success: `Order request placed. Order ID: ${orderId || "created"}` });

    try {
      if (data?.order) {
        saveLocalOrder({
          id: orderId,
          customerId: userId,
          customerName: data.order.customerName,
          customerEmail: data.order.customerEmail,
          productTitle: data.order.productTitle,
          items: data.order.items,
          subtotal: data.order.subtotal,
          deliveryCharge: data.order.deliveryCharge,
          total: data.order.total,
          currency: data.order.currency,
          paymentStatus: data.order.paymentStatus,
          paymentMethod: data.order.paymentMethod || ORDER_POLICY.paymentMethod,
          deliveryMethod: data.order.deliveryMethod,
          deliveryChargeConfirmed: Boolean(data.order.deliveryChargeConfirmed),
          status: data.order.status,
          createdAt: data.order.createdAt,
          updatedAt: data.order.updatedAt,
        });
      }
      if (deliveryMethod === "delivery" && saveAddress) {
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
    } catch (error) {
      console.warn("Could not save the order locally:", error);
    }

    // The server consumed exactly the ordered cart lines inside the order
    // transaction. Only refresh the view — deleting the whole cart here would
    // also remove lines added in another tab after this order was placed.
    setCustomer(initialCustomer);
    try {
      refreshCart(user);
    } catch (error) {
      console.warn("Cart refresh after a placed order failed; it will refresh on the next visit.", error);
    } finally {
      submittingRef.current = false;
    }
  };

  const money = (value, currency = totals.currency) => formatCurrency(value, currency);
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

  return (
    <main className="checkout-scope bg-white text-ink">
      <div className="page-container pb-16 pt-8 sm:pt-10 lg:pb-20 lg:pt-12">
        <div className="mb-7 flex items-center gap-3 sm:mb-8 lg:mb-9">
          <Link
            href="/cart"
            aria-label="Back to cart"
            className="grid h-11 w-11 place-items-center rounded-full border border-field bg-white text-ink transition-colors hover:border-ink/50"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="heading-page">Checkout</h1>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-12">
          {/* Details */}
          <div className="space-y-8 lg:space-y-9">
            {!authLoading && !user && (
              <div className="flex flex-col gap-3 rounded-[10px] bg-cream p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[15px] font-semibold text-ink">Sign in before checkout</p>
                  <p className="mt-1 text-[14px] leading-6 text-muted">Your order can only be saved to your account when you are signed in.</p>
                </div>
                <button
                  type="button"
                  onClick={openCustomerLogin}
                  className="checkout-primary-button btn btn-primary shrink-0"
                >
                  Sign in
                </button>
              </div>
            )}

            {/* 1. Contact Information */}
            <Section n="1" title="Contact Information">
              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                <Field label="First name" value={customer.firstName} onChange={(v) => updateCustomer("firstName", v)} error={fieldErrors.firstName} maxLength={60} autoComplete="given-name" required />
                <Field label="Last name" value={customer.lastName} onChange={(v) => updateCustomer("lastName", v)} maxLength={60} autoComplete="family-name" required />
                <Field label="Phone" type="tel" value={customer.customerPhone} onChange={(v) => updateCustomer("customerPhone", v)} placeholder="01XXXXXXXXX" error={fieldErrors.customerPhone} maxLength={20} autoComplete="tel" inputMode="tel" required />
                <label className="block">
                  <span className="field-label">Account email</span>
                  <span className="flex min-h-12 w-full cursor-not-allowed items-center rounded-[6px] border border-line bg-cream px-4 text-[15px] text-muted">
                    {user?.email || "—"}
                  </span>
                  <span className="field-hint block">Orders are placed with your signed-in account email and can&apos;t be changed here.</span>
                </label>
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

              {deliveryMethod === "delivery" ? (
                <>
                  <p className="mt-4 rounded-[10px] bg-cream px-4 py-3 text-[14px] leading-6 text-muted">{ORDER_POLICY.deliveryCharge}</p>
                  <div className="mt-4 grid gap-x-4 gap-y-4 sm:grid-cols-3">
                    <Field label="City" value={customer.city} onChange={(v) => updateCustomer("city", v)} error={fieldErrors.city} maxLength={80} autoComplete="address-level2" required />
                    <Field label="Address" value={customer.addressLine1} onChange={(v) => updateCustomer("addressLine1", v)} error={fieldErrors.addressLine1} maxLength={300} autoComplete="street-address" required />
                    <Field label="Zip code" value={customer.postalCode} onChange={(v) => updateCustomer("postalCode", v)} error={fieldErrors.postalCode} maxLength={4} autoComplete="postal-code" inputMode="numeric" />
                  </div>
                  <label className="mt-4 block">
                    <span className="field-label">
                      Delivery note <span className="field-optional">(optional)</span>
                    </span>
                    <textarea value={customer.deliveryNote} maxLength={500} onChange={(event) => updateCustomer("deliveryNote", event.target.value)} placeholder="Preferred time or special delivery instructions" aria-invalid={fieldErrors.deliveryNote ? true : undefined} className="checkout-field field min-h-24" />
                    {fieldErrors.deliveryNote && <span className="field-error">{fieldErrors.deliveryNote}</span>}
                  </label>
                  <label className="mt-4 flex cursor-pointer items-center gap-3 py-2 text-[14px] text-ink">
                    <input type="checkbox" checked={saveAddress} onChange={(event) => setSaveAddress(event.target.checked)} className="checkout-checkbox h-5 w-5 shrink-0 accent-[#303839]" />
                    <span className="flex min-w-0 flex-col"><span className="text-[14px] font-semibold text-ink">Save this address</span><span className="text-[13px] leading-5 text-muted">Keep it on this device for faster checkout.</span></span>
                  </label>
                </>
              ) : (
                <p className="mt-4 rounded-[10px] bg-cream px-4 py-3 text-[14px] leading-6 text-muted">No delivery address or delivery charge is required for store pickup. Husnalogy will confirm when your order is ready to collect.</p>
              )}
            </Section>

            {/* 3. Payment method */}
            <Section n="3" title="Payment method">
              <div className="max-w-[380px]">
                <div className="flex items-center gap-3 rounded-[10px] border border-ink/60 bg-white px-4 py-4">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#303839] text-white">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="10" rx="2" /><circle cx="12" cy="12" r="2.2" /><path d="M6 12h.01M18 12h.01" /></svg>
                  </span>
                  <div className="flex-1">
                    <p className="text-[15px] font-semibold text-ink">{ORDER_POLICY.paymentMethod}</p>
                    <p className="text-[13px] leading-5 text-muted">Pay when a delivery order arrives or when collecting a store pickup order.</p>
                  </div>
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#303839] text-white">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-11" /></svg>
                  </span>
                </div>
              </div>
            </Section>
          </div>

          {/* Order summary */}
          <aside className="lg:sticky lg:top-[140px]" aria-label="Order summary">
            <div className="rounded-[10px] border border-line bg-white p-5 sm:p-6">
              {placedOrder && (
                <div role="status" className="notice notice-success mb-5">
                  <p className="font-bold">Order placed</p>
                  <p className="mt-1 text-[#303839]/70">Order ID: {placedOrder.id}. We&apos;ll confirm the details with you soon.</p>
                  <Link href="/orders" className="mt-2 inline-block font-semibold underline underline-offset-2">View your orders</Link>
                </div>
              )}
              <div className="flex items-center justify-between">
                <h2 className="font-display text-[1.75rem] font-medium leading-none text-ink">Your order</h2>
                {itemCount > 0 && (
                  <span className="badge">
                    {itemCount} {itemCount === 1 ? "item" : "items"}
                  </span>
                )}
              </div>

              <div className="mt-4 max-h-[300px] space-y-4 overflow-y-auto">
                {items.map((item) => {
                  const options = item.selectedOptions || {};
                  const trusted = quoteLines.get(String(item.id || ""));
                  const meta = [options.size ? `Size: ${options.size}` : "", options.color ? `Color: ${options.color}` : ""].filter(Boolean).join("   ");
                  return (
                    <div key={item.id} className="flex items-center gap-3">
                      <ServerCustomizationImage customizationId={item.customizationId} outputPageId={item.mockupOutputRef?.pageId} fallbackSrc={item.image} alt={item.title} containerClassName="relative h-16 w-16 shrink-0 overflow-hidden rounded-[6px] bg-cream" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink">{item.title}</p>
                        {meta && <p className="mt-0.5 text-[13px] text-muted">{meta}</p>}
                        <p className="mt-0.5 text-[13px] text-muted">Qty {item.quantity || 1}</p>
                        {trusted && !trusted.ok && <p className="mt-0.5 text-[13px] font-medium text-error">{trusted.error}</p>}
                      </div>
                      <p className="price shrink-0 text-[14px]">
                        {trusted?.ok
                          ? money(trusted.lineTotal, trusted.currency)
                          : money(Number(item.price || 0) * Number(item.quantity || 1), item.currency)}
                      </p>
                    </div>
                  );
                })}
                {!items.length && (
                  <p className="rounded-[10px] bg-cream px-4 py-6 text-center text-[14px] text-muted">Your cart is empty.</p>
                )}
              </div>

              <div className="mt-5 space-y-2.5 border-t border-line pt-5 text-[14px]">
                <div className="flex justify-between gap-4 text-muted">
                  <span>Subtotal</span>
                  <span className="price">{money(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between gap-4 text-muted">
                  <span>Delivery charge</span>
                  <span>{deliveryMethod === "store" ? "No charge" : "Confirmed after review"}</span>
                </div>
              </div>

              <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
                <span className="text-[16px] font-semibold text-ink">{deliveryMethod === "store" ? "Total" : "Order subtotal"}</span>
                <span className="price text-[1.5rem]">{money(totals.total)}</span>
              </div>
              {deliveryMethod === "delivery" && <p className="mt-2 text-[13px] leading-5 text-muted">The confirmed delivery charge will be added to the amount due on delivery.</p>}
              {pricesChanged && !placedOrder && (
                <p className="notice mt-3 bg-cream text-[13px]">Prices have been updated to our current prices. The total above is what you will pay.</p>
              )}
              {quoteBlocked && !placedOrder && (
                <p role="alert" className="notice notice-error mt-3 text-[13px]">{quote?.error || "Some items in your cart need attention before you can check out."}</p>
              )}

              <button
                type="submit"
                disabled={status.loading || authLoading || !user || !items.length || !acceptTerms || Boolean(placedOrder) || quoteBlocked}
                aria-busy={status.loading}
                className="checkout-primary-button btn btn-primary btn-lg btn-block mt-5"
              >
                {status.loading ? "Placing order…" : placedOrder ? "Order placed" : !user ? "Sign in to place order" : "Place order"}
                {!status.loading && user && !placedOrder && (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13" /><path d="m12 5 7 7-7 7" /></svg>
                )}
              </button>

              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[13px] leading-5 text-muted">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(event) => setAcceptTerms(event.target.checked)}
                  required
                  aria-describedby="checkout-terms-label"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[#303839]"
                />
                <span id="checkout-terms-label">
                  I have read and accept the{" "}
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
      className={`fixed bottom-24 right-4 z-[2600] w-[calc(100vw-2rem)] max-w-[360px] rounded-[10px] border bg-white px-4 py-3 text-sm font-semibold text-ink shadow-[var(--shadow-overlay)] transition-all duration-300 sm:right-6 lg:bottom-20 ${
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
      <h2 className="mb-4 text-[17px] font-semibold text-ink">
        <span className="text-muted">{n}.</span> {title}
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
      className={`relative flex min-h-[56px] items-center justify-center gap-2.5 border px-4 py-3.5 text-[15px] font-semibold transition-colors ${
        selected
          ? "border-ink/60 bg-cream text-ink"
          : "border-field bg-white text-ink hover:border-ink/50"
      }`}
    >
      <span className={`grid h-7 w-7 place-items-center rounded-full ${selected ? "bg-ink text-white" : "bg-cream text-ink"}`}>
        {icon}
      </span>
      {label}
      {selected && <span className="sr-only">(selected)</span>}
    </button>
  );
}

function Field({ label, value, onChange, type = "text", required = false, placeholder = "", className = "", error = "", maxLength = undefined, autoComplete = undefined, inputMode = undefined }: any) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">
        {label} {required ? <span aria-hidden="true">*</span> : <span className="field-optional">(optional)</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        className="checkout-field field"
      />
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
