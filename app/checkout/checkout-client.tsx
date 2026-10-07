"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/currency";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import useAuth from "../lib/useAuth";
import {
  refreshCart,
  getCartTotals,
  openCustomerLogin,
  subscribeToUserCart,
  updateCartQuantity,
} from "../lib/customer-lists";
import { createAddress, useSavedAddresses, type SavedAddress } from "../lib/account-data";
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

const normalized = (value: unknown) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

/** Whether the account already holds this delivery address (so checkout does not save it twice). */
function sameSavedAddress(addresses: SavedAddress[], fullName: string, customer: { customerPhone: string; addressLine1: string; city: string }) {
  return addresses.some(
    (address) =>
      normalized(address.addressLine1) === normalized(customer.addressLine1) &&
      normalized(address.city) === normalized(customer.city) &&
      normalized(address.phone) === normalized(customer.customerPhone) &&
      normalized(address.fullName) === normalized(fullName),
  );
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
  // The cart line whose quantity is being saved, so its stepper waits.
  const [pendingQuantity, setPendingQuantity] = useState<string | null>(null);
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

  // Saved addresses belong to the signed-in account (server + RLS). The form
  // starts from this account's default address; another account's form is
  // never prefilled with it, and a switch clears what was prefilled.
  const { addresses: savedAddresses } = useSavedAddresses(userId);
  const prefilledForRef = useRef("");
  useEffect(() => {
    if (prefilledForRef.current && prefilledForRef.current !== userId) {
      setCustomer(initialCustomer);
      prefilledForRef.current = "";
    }
    const preferred = savedAddresses.find((address) => address.isDefault) || savedAddresses[0];
    if (!userId || !preferred || prefilledForRef.current === userId) return;
    prefilledForRef.current = userId;
    const [firstName, ...rest] = preferred.fullName.split(/\s+/);
    setCustomer((current) =>
      current.addressLine1 || current.customerPhone
        ? current
        : { ...current, firstName: firstName || "", lastName: rest.join(" "), customerPhone: preferred.phone, city: preferred.city, addressLine1: preferred.addressLine1, postalCode: preferred.postalCode },
    );
  }, [userId, savedAddresses]);

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

    // The order itself lives on the server (the orders page reads it there).
    // The address is saved to THIS account's address book, once.
    if (deliveryMethod === "delivery" && saveAddress && !sameSavedAddress(savedAddresses, customerName, customer)) {
      void createAddress({
        fullName: customerName,
        phone: customer.customerPhone,
        addressLine1: customer.addressLine1,
        city: customer.city,
        postalCode: customer.postalCode,
      }).catch((error) => console.warn("Could not save the address to the account:", error));
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
  const locked = status.loading || Boolean(placedOrder);
  // Only a store pickup total is final; delivery adds a charge confirmed later.
  const totalIsFinal = deliveryMethod === "store";

  const changeQuantity = async (item, nextQuantity) => {
    if (!user || nextQuantity < 1 || pendingQuantity || locked) return;
    setPendingQuantity(String(item.id));
    try {
      await updateCartQuantity(user, item.id, nextQuantity);
    } catch {
      setStatus({ loading: false, error: "Could not update the quantity. Please try again.", success: "" });
    } finally {
      setPendingQuantity(null);
    }
  };

  return (
    <main className="checkout-scope bg-white text-ink">
      <div className="page-container pb-16 pt-6 sm:pt-8 lg:pb-20 lg:pt-10">
        <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 lg:mb-8">
          <Link
            href="/cart"
            aria-label="Back to cart"
            data-shape="round"
            className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-ink transition-colors hover:bg-cream"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <ol className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            <li>
              <Link href="/" className="underline-offset-4 hover:underline">Home</Link>
            </li>
            <li aria-hidden="true" className="text-muted">/</li>
            <li>
              <Link href="/cart" className="underline-offset-4 hover:underline">Cart</Link>
            </li>
            <li aria-hidden="true" className="text-muted">/</li>
            <li aria-current="page" className="text-muted">Checkout</li>
          </ol>
        </nav>

        <form onSubmit={handleSubmit} className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:items-start lg:gap-0">
          {/* Details: contact, delivery and payment on one page. */}
          <div className="space-y-10 lg:border-r lg:border-line lg:pr-12 xl:pr-16">
            <header>
              <h1 className="heading-section">Check out your items</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                Check your details and choose how you&rsquo;d like to receive your order before placing it.
              </p>
            </header>

            {!authLoading && !user && (
              <div className="flex flex-col gap-3 rounded-[10px] bg-cream p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[15px] font-semibold text-ink">Sign in before checkout</p>
                  <p className="mt-1 text-[14px] leading-6 text-muted">Your order can only be saved to your account when you are signed in.</p>
                </div>
                <button type="button" onClick={openCustomerLogin} className="checkout-primary-button btn btn-primary shrink-0">
                  Sign in
                </button>
              </div>
            )}

            <section aria-labelledby="checkout-contact" className="space-y-4">
              <SectionHeading id="checkout-contact" title="Contact details" hint="We use these to confirm your order." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" icon={<UserIcon />} value={customer.firstName} onChange={(v) => updateCustomer("firstName", v)} error={fieldErrors.firstName} maxLength={60} autoComplete="given-name" required />
                <Field label="Last name" icon={<UserIcon />} value={customer.lastName} onChange={(v) => updateCustomer("lastName", v)} maxLength={60} autoComplete="family-name" required />
                <Field label="Phone" icon={<PhoneIcon />} type="tel" value={customer.customerPhone} onChange={(v) => updateCustomer("customerPhone", v)} placeholder="01XXXXXXXXX" error={fieldErrors.customerPhone} maxLength={20} autoComplete="tel" inputMode="tel" required />
                <div className="flex gap-3 rounded-[10px] border border-line bg-cream px-4 py-3" title="Orders are placed with your signed-in account email.">
                  <span className="mt-0.5 shrink-0 text-muted"><MailIcon /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-5 text-muted">Account email</span>
                    <span className="mt-0.5 block truncate text-[15px] leading-6 text-ink">{user?.email || "—"}</span>
                  </span>
                </div>
              </div>
            </section>

            <section aria-labelledby="checkout-delivery" className="space-y-4">
              <SectionHeading id="checkout-delivery" title="Delivery method" hint="Have it delivered, or collect it from the store." />
              <div className="grid gap-3 sm:grid-cols-2">
                <OptionRow
                  selected={deliveryMethod === "delivery"}
                  onSelect={() => setDeliveryMethod("delivery")}
                  label="Delivery"
                  description="Delivered to your address"
                  icon={<TruckIcon />}
                />
                <OptionRow
                  selected={deliveryMethod === "store"}
                  onSelect={() => setDeliveryMethod("store")}
                  label="Store pickup"
                  description="No delivery charge"
                  icon={<StoreIcon />}
                />
              </div>

              {deliveryMethod === "delivery" ? (
                <div className="space-y-4">
                  <Field label="Address" icon={<MapIcon />} value={customer.addressLine1} onChange={(v) => updateCustomer("addressLine1", v)} error={fieldErrors.addressLine1} maxLength={300} autoComplete="street-address" placeholder="House, road and area" multiline required />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="City" icon={<CityIcon />} value={customer.city} onChange={(v) => updateCustomer("city", v)} error={fieldErrors.city} maxLength={80} autoComplete="address-level2" required />
                    <Field label="Zip code" icon={<PinIcon />} value={customer.postalCode} onChange={(v) => updateCustomer("postalCode", v)} error={fieldErrors.postalCode} maxLength={4} autoComplete="postal-code" inputMode="numeric" />
                  </div>
                  <Field label="Delivery note" icon={<NoteIcon />} value={customer.deliveryNote} onChange={(v) => updateCustomer("deliveryNote", v)} error={fieldErrors.deliveryNote} maxLength={500} placeholder="Preferred time or special delivery instructions" multiline rows={2} />
                  <label className="flex cursor-pointer items-start gap-3 py-1">
                    <input type="checkbox" checked={saveAddress} onChange={(event) => setSaveAddress(event.target.checked)} className="checkout-checkbox mt-0.5 h-5 w-5 shrink-0 accent-[#303839]" />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[14px] font-semibold text-ink">Save this address</span>
                      <span className="text-[13px] leading-5 text-muted">Keep it on this device for faster checkout.</span>
                    </span>
                  </label>
                  <p className="rounded-[10px] bg-cream px-4 py-3 text-[14px] leading-6 text-muted">{ORDER_POLICY.deliveryCharge}</p>
                </div>
              ) : (
                <p className="rounded-[10px] bg-cream px-4 py-3 text-[14px] leading-6 text-muted">
                  No delivery address or delivery charge is required for store pickup. Husnalogy will confirm when your order is ready to collect.
                </p>
              )}
            </section>

            <section aria-labelledby="checkout-payment" className="space-y-4">
              <SectionHeading id="checkout-payment" title="Payment method" hint="Pay when a delivery order arrives or when you collect a store pickup order." />
              <div className="flex items-center gap-3 rounded-[10px] border border-ink bg-white px-4 py-4 shadow-[0_0_0_1px_var(--color-ink)]">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cream text-ink"><CashIcon /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">{ORDER_POLICY.paymentMethod}</span>
                  <span className="block text-[13px] leading-5 text-muted">The only payment method available right now.</span>
                </span>
                <RadioDot selected />
              </div>
            </section>
          </div>

          {/* Order summary */}
          <aside className="lg:sticky lg:top-[140px] lg:pl-12 xl:pl-16" aria-label="Order summary">
            <div className="rounded-[10px] border border-line bg-cream p-5 sm:p-6">
              {placedOrder && (
                <div role="status" className="notice notice-success mb-5">
                  <p className="font-bold">Order placed</p>
                  <p className="mt-1 text-[#303839]/70">Order ID: {placedOrder.id}. We&apos;ll confirm the details with you soon.</p>
                  <Link href="/orders" className="mt-2 inline-block font-semibold underline underline-offset-2">View your orders</Link>
                </div>
              )}

              <h2 className="font-display text-[1.75rem] font-medium leading-none text-ink">Your order</h2>
              <p className="mt-2 text-[14px] text-muted">Review your items before placing the order.</p>

              <ul className="mt-5 max-h-[360px] space-y-3 overflow-y-auto overscroll-contain">
                {items.map((item) => {
                  const options = item.selectedOptions || {};
                  const trusted = quoteLines.get(String(item.id || ""));
                  const quantity = Number(item.quantity || 1);
                  const meta = [options.size ? `Size: ${options.size}` : "", options.color ? `Color: ${options.color}` : ""].filter(Boolean).join(" · ");
                  const busy = pendingQuantity === String(item.id);
                  return (
                    <li key={item.id} className="flex gap-3 rounded-[10px] border border-line bg-white p-3">
                      <ServerCustomizationImage customizationId={item.customizationId} outputPageId={item.mockupOutputRef?.pageId} fallbackSrc={item.image} alt={item.title} containerClassName="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-[6px] bg-cream" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-start justify-between gap-3">
                          <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink">{item.title}</p>
                          <p className="price shrink-0 text-[14px]">
                            {trusted?.ok
                              ? money(trusted.lineTotal, trusted.currency)
                              : money(Number(item.price || 0) * quantity, item.currency)}
                          </p>
                        </div>
                        {meta && <p className="mt-0.5 text-[13px] text-muted">{meta}</p>}
                        {trusted && !trusted.ok && <p className="mt-0.5 text-[13px] font-medium text-error">{trusted.error}</p>}
                        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                          <span className="text-[13px] text-muted">Quantity</span>
                          <div className={`flex items-center gap-1 ${busy ? "opacity-60" : ""}`} aria-busy={busy || undefined}>
                            <StepButton label={`Decrease quantity of ${item.title}`} disabled={!user || locked || busy || quantity <= 1} onClick={() => changeQuantity(item, quantity - 1)}>
                              <path d="M5 12h14" />
                            </StepButton>
                            <span className="min-w-7 text-center text-[14px] font-semibold tabular-nums" aria-live="polite">
                              <span className="sr-only">Quantity </span>
                              {quantity}
                            </span>
                            <StepButton label={`Increase quantity of ${item.title}`} disabled={!user || locked || busy} onClick={() => changeQuantity(item, quantity + 1)}>
                              <path d="M5 12h14" />
                              <path d="M12 5v14" />
                            </StepButton>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
                {!items.length && (
                  <li className="rounded-[10px] bg-white px-4 py-6 text-center text-[14px] text-muted">Your cart is empty.</li>
                )}
              </ul>

              <div className="mt-6 flex items-baseline justify-between gap-4 border-b border-line pb-4">
                <span className="text-[17px] font-semibold text-ink">Subtotal</span>
                <span className="price text-[1.25rem]">{money(totals.subtotal)}</span>
              </div>

              <dl className="mt-4 space-y-3 text-[14px]">
                <SummaryRow label="Items" value={`${itemCount}`} />
                <SummaryRow label="Delivery" value={deliveryMethod === "store" ? "No charge" : "Confirmed after review"} />
                <SummaryRow label="Payment" value={ORDER_POLICY.paymentMethod} />
              </dl>

              <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-line pt-4">
                <span className="text-[16px] font-semibold text-ink">{totalIsFinal ? "Total" : "Order subtotal"}</span>
                <span className="price text-[1.5rem]">{money(totals.total)}</span>
              </div>
              {!totalIsFinal && <p className="mt-2 text-[13px] leading-5 text-muted">The confirmed delivery charge will be added to the amount due on delivery.</p>}
              {pricesChanged && !placedOrder && (
                <p className="notice mt-3 bg-white text-[13px]">Prices have been updated to our current prices. The total above is what you will pay.</p>
              )}
              {quoteBlocked && !placedOrder && (
                <p role="alert" className="notice notice-error mt-3 text-[13px]">{quote?.error || "Some items in your cart need attention before you can check out."}</p>
              )}

              <label className="mt-5 flex cursor-pointer items-start gap-3 text-[13px] leading-5 text-muted">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(event) => setAcceptTerms(event.target.checked)}
                  required
                  aria-describedby="checkout-terms-label"
                  className="checkout-checkbox mt-0.5 h-5 w-5 shrink-0 accent-[#303839]"
                />
                <span id="checkout-terms-label">
                  I have read and accept the{" "}
                  <Link href="/terms" className="font-semibold text-ink underline underline-offset-2">terms of the user agreement</Link>.
                </span>
              </label>

              <button
                type="submit"
                disabled={status.loading || authLoading || !user || !items.length || !acceptTerms || Boolean(placedOrder) || quoteBlocked}
                aria-busy={status.loading}
                className="checkout-primary-button btn btn-primary btn-lg btn-block mt-5"
              >
                {status.loading ? "Placing order…" : placedOrder ? "Order placed" : !user ? "Sign in to place order" : "Place order"}
                {!status.loading && user && !placedOrder && (
                  totalIsFinal && items.length ? (
                    <span className="price text-white">
                      <span aria-hidden="true" className="mr-2 opacity-60">·</span>
                      {money(totals.total)}
                    </span>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13" /><path d="m12 5 7 7-7 7" /></svg>
                  )
                )}
              </button>
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

function SectionHeading({ id, title, hint }: any) {
  return (
    <div>
      <h2 id={id} className="font-display text-[1.6rem] font-medium leading-tight text-ink">{title}</h2>
      {hint && <p className="mt-1 text-[14px] leading-6 text-muted">{hint}</p>}
    </div>
  );
}

/* A selectable row (icon, label, description, radio dot). Its accessible name
   is the label alone, so "Delivery" stays an exact button name. */
function OptionRow({ selected, onSelect, label, description, icon }: any) {
  const descriptionId = useId();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={label}
      aria-describedby={descriptionId}
      className={`flex min-h-[64px] w-full items-center gap-3 border bg-white px-4 py-3 text-left transition-[border-color,box-shadow] duration-200 ${
        selected ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "border-field hover:border-ink/50"
      }`}
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors ${selected ? "bg-ink text-white" : "bg-cream text-ink"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        <span id={descriptionId} className="block text-[13px] leading-5 text-muted">{description}</span>
      </span>
      <RadioDot selected={selected} />
    </button>
  );
}

function RadioDot({ selected = false }) {
  return (
    <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors ${selected ? "border-ink" : "border-field"}`}>
      <span className={`h-2.5 w-2.5 rounded-full bg-ink transition-transform duration-200 ${selected ? "scale-100" : "scale-0"}`} />
    </span>
  );
}

function StepButton({ label, disabled, onClick, children }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-shape="round"
      className="grid h-8 w-8 place-items-center rounded-full border border-field bg-white text-ink transition-colors hover:border-ink/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-field"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function SummaryRow({ label, value }: any) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

/* A bordered field with its label and icon inside the box. The label is a real
   <label> (accessible name starts with the label text); clicking anywhere in
   the box focuses the input. */
function Field({ label, icon = null, value, onChange, type = "text", required = false, placeholder = "", error = "", maxLength = undefined, autoComplete = undefined, inputMode = undefined, multiline = false, rows = 3 }: any) {
  const id = useId();
  const errorId = `${id}-error`;
  const inputRef = useRef<any>(null);
  const inputProps = {
    id,
    ref: inputRef,
    value,
    onChange: (event) => onChange(event.target.value),
    required,
    placeholder,
    maxLength,
    autoComplete,
    "aria-invalid": error ? true : undefined,
    "aria-required": required || undefined,
    "aria-describedby": error ? errorId : undefined,
    className: "input-bare mt-0.5 block w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-6 text-ink outline-none placeholder:text-[#747b7c]",
  };

  return (
    <div>
      <div
        onClick={() => inputRef.current?.focus()}
        className={`flex cursor-text gap-3 rounded-[10px] border bg-white px-4 py-3 transition-[border-color,box-shadow] duration-200 focus-within:border-ink focus-within:shadow-[0_0_0_1px_var(--color-ink)] ${
          error ? "border-error" : "border-field hover:border-[#aaa4a4]"
        }`}
      >
        {icon && <span className="mt-0.5 shrink-0 text-muted">{icon}</span>}
        <span className="min-w-0 flex-1">
          <label htmlFor={id} className="block cursor-text text-[13px] leading-5 text-muted">
            {label}
            {required ? <span aria-hidden="true"> *</span> : <span> (optional)</span>}
          </label>
          {multiline ? <textarea rows={rows} {...inputProps} /> : <input type={type} inputMode={inputMode} {...inputProps} />}
        </span>
      </div>
      {error && <p id={errorId} className="field-error">{error}</p>}
    </div>
  );
}

const iconProps = { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

function UserIcon() {
  return <svg {...iconProps}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
}
function PhoneIcon() {
  return <svg {...iconProps}><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M11 18h2" /></svg>;
}
function MailIcon() {
  return <svg {...iconProps}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>;
}
function MapIcon() {
  return <svg {...iconProps}><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2Z" /><path d="M9 4v14M15 6v14" /></svg>;
}
function CityIcon() {
  return <svg {...iconProps}><path d="M4 21V8l6-3v16" /><path d="M10 21V10l10 3v8" /><path d="M3 21h18" /></svg>;
}
function PinIcon() {
  return <svg {...iconProps}><path d="M12 21s7-6.1 7-11.5a7 7 0 0 0-14 0C5 14.9 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>;
}
function NoteIcon() {
  return <svg {...iconProps}><path d="M5 4h14v16H5z" /><path d="M9 9h6M9 13h6M9 17h3" /></svg>;
}
function TruckIcon() {
  return <svg {...iconProps}><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.7" /><circle cx="17.5" cy="18" r="1.7" /></svg>;
}
function StoreIcon() {
  return <svg {...iconProps}><path d="M4 9 5 4h14l1 5" /><path d="M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" /><path d="M5 12v8h14v-8" /></svg>;
}
function CashIcon() {
  return <svg {...iconProps}><rect x="3" y="7" width="18" height="10" rx="2" /><circle cx="12" cy="12" r="2.2" /><path d="M6 12h.01M18 12h.01" /></svg>;
}
