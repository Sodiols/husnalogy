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
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  area: "",
  postalCode: "",
  deliveryNote: "",
};


export default function CheckoutClient() {
  const { user, authLoading } = useAuth();
  const [items, setItems] = useState([]);
  const [customer, setCustomer] = useState(initialCustomer);
  const [saveAddress, setSaveAddress] = useState(true);
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  useEffect(() => {
    if (authLoading) return undefined;
    return subscribeToUserCart(user, setItems);
  }, [authLoading, user]);

  useEffect(() => {
    if (!user) return;

    setCustomer((current) => ({
      ...current,
      customerName: current.customerName || user.name || "",
      customerEmail: current.customerEmail || user.email || "",
    }));
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

    setStatus({ loading: true, error: "", success: "" });

    try {
      const response = await fetch("/api/order-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...customer,
          customerId: user?.uid || "",
          items,
          subtotal: totals.subtotal,
          deliveryCharge: totals.deliveryCharge,
          total: totals.total,
          paymentStatus: "unpaid",
          status: "pending",
          message: customer.deliveryNote,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Could not place the order.");
      }

      if (saveAddress) {
        saveCustomerAddress({
          customerName: customer.customerName,
          customerPhone: customer.customerPhone,
          addressLine1: customer.addressLine1,
          addressLine2: customer.addressLine2,
          city: customer.city,
          area: customer.area,
          postalCode: customer.postalCode,
        });
      }

      const savedOrder = {
        id: data.order?.id,
        customerId: user.uid,
        customerName: customer.customerName,
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
      setStatus({ loading: false, error: "", success: `Order request placed. Order ID: ${data.order?.id || "created"}` });
    } catch (error) {
      setStatus({ loading: false, error: error.message || "Something went wrong.", success: "" });
    }
  };

  return (
    <main className="px-4 py-12 text-[#303839]">
      <section className="mx-auto grid max-w-[1180px] gap-8 lg:grid-cols-[1fr_380px]">
        <form onSubmit={handleSubmit} className="rounded-none border border-[#303839]/10 bg-white p-6">
          <h1 className="font-display text-4xl">Checkout</h1>
          <p className="mt-2 text-sm leading-6 text-[#303839]/65">
            Payment is manual for now. Your order will be saved as unpaid and pending so Husnalogy can review it.
          </p>

          {!authLoading && !user && (
            <div className="mt-6 rounded-none border border-[#303839]/10 bg-[#E6E6E6] p-5">
              <p className="text-sm font-bold text-[#303839]">Sign in before checkout</p>
              <p className="mt-1 text-sm leading-6 text-[#303839]/65">Your order status can only be saved to your account when you are signed in.</p>
              <button
                type="button"
                onClick={openCustomerLogin}
                className="mt-4 rounded-full bg-[#303839] px-6 py-3 text-sm font-bold text-white"
              >
                Sign in
              </button>
            </div>
          )}

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Field label="Full name" value={customer.customerName} onChange={(value) => updateCustomer("customerName", value)} required />
            <Field label="Email" type="email" value={customer.customerEmail} onChange={(value) => updateCustomer("customerEmail", value)} required />
            <Field label="Phone" value={customer.customerPhone} onChange={(value) => updateCustomer("customerPhone", value)} />
            <Field label="City" value={customer.city} onChange={(value) => updateCustomer("city", value)} required />
            <Field label="Area" value={customer.area} onChange={(value) => updateCustomer("area", value)} />
            <Field label="Postal code" value={customer.postalCode} onChange={(value) => updateCustomer("postalCode", value)} />
          </div>

          <div className="mt-4 space-y-4">
            <Field label="Address line 1" value={customer.addressLine1} onChange={(value) => updateCustomer("addressLine1", value)} required />
            <Field label="Address line 2" value={customer.addressLine2} onChange={(value) => updateCustomer("addressLine2", value)} />
            <label className="block text-sm font-bold">
              Delivery note
              <textarea
                value={customer.deliveryNote}
                onChange={(event) => updateCustomer("deliveryNote", event.target.value)}
                className="mt-2 min-h-28 w-full rounded-none border border-[#303839]/15 px-4 py-3 text-sm font-normal outline-none"
              />
            </label>
          </div>

          <label className="mt-5 flex items-center gap-3 text-sm font-bold">
            <input type="checkbox" checked={saveAddress} onChange={(event) => setSaveAddress(event.target.checked)} />
            Save this address on this device
          </label>

          {status.error && <p className="mt-5 rounded-none bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{status.error}</p>}
          {status.success && <p className="mt-5 rounded-none bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{status.success}</p>}

          <button
            type="submit"
            disabled={status.loading || authLoading || !user || !items.length}
            className="mt-6 w-full rounded-full bg-[#303839] px-6 py-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {status.loading ? "Placing order..." : !user ? "Sign in to place order" : "Place Order"}
          </button>
        </form>

        <aside className="h-fit rounded-none border border-[#303839]/10 bg-[#E6E6E6] p-6">
          <h2 className="text-xl font-bold">Order review</h2>
          <div className="mt-5 space-y-4">
            {items.map((item) => (
              <div key={item.id} className="flex gap-3">
                <img src={item.image} alt={item.title} className="h-16 w-16 rounded-none object-cover" />
                <div className="flex-1">
                  <p className="line-clamp-2 text-sm font-bold">{item.title}</p>
                  <p className="mt-1 text-xs text-[#303839]/60">Qty {item.quantity || 1}</p>
                </div>
                <p className="text-sm font-bold">${(Number(item.price || 0) * Number(item.quantity || 1)).toFixed(2)}</p>
              </div>
            ))}
            {!items.length && <p className="text-sm text-[#303839]/60">Your cart is empty.</p>}
          </div>

          <div className="mt-6 space-y-3 border-t border-[#303839]/10 pt-5 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>${totals.subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Delivery</span><span>Calculated later</span></div>
            <div className="flex justify-between font-bold"><span>Total</span><span>${totals.total.toFixed(2)}</span></div>
          </div>

          <Link href="/cart" className="mt-5 block rounded-none border border-[#303839]/15 px-6 py-3 text-center text-sm font-bold">
            Back to Cart
          </Link>
        </aside>
      </section>
    </main>
  );
}

function Field({ label, value, onChange, type = "text", required = false }) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-2 h-12 w-full rounded-none border border-[#303839]/15 px-4 text-sm font-normal outline-none"
      />
    </label>
  );
}
