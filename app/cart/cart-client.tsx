"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useAuth from "../lib/useAuth";
import {
  getCartTotals,
  openCustomerLogin,
  removeFromCart,
  subscribeToUserCart,
  updateCartQuantity,
} from "../lib/customer-lists";
import { formatCurrency } from "@/lib/currency";
import ServerCustomizationImage from "@/app/components/customizer/ServerCustomizationImage";

export default function CartClient() {
  const { user, authLoading } = useAuth();
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (authLoading) return undefined;
    return subscribeToUserCart(user, setItems);
  }, [authLoading, user]);

  const totals = getCartTotals(items);

  return (
    <main className="px-4 py-12 text-[#303839]">
      <section className="mx-auto grid max-w-[1180px] gap-8 lg:grid-cols-[1fr_360px]">
        <div>
          <h1 className="font-display text-4xl">Cart</h1>
          <p className="mt-2 text-sm text-[#303839]/65">Review your personalized products before checkout.</p>

          {!authLoading && !user && (
            <div className="mt-6 rounded-none border border-[#303839]/10 bg-[#E6E6E6] p-5">
              <p className="text-sm font-bold text-[#303839]">Sign in to view your cart.</p>
              <button type="button" onClick={openCustomerLogin} className="mt-4 rounded-full bg-[#303839] px-6 py-3 text-sm font-bold text-white">
                Sign in
              </button>
            </div>
          )}

          <div className="mt-8 space-y-4">
            {items.map((item) => (
              <article key={item.id} className="grid gap-4 rounded-none border border-[#303839]/10 p-4 sm:grid-cols-[120px_1fr_auto]">
                <Link href={item.slug ? `/products/${item.slug}` : "/products"}>
                  <ServerCustomizationImage customizationId={item.customizationId} outputPageId={item.mockupOutputRef?.pageId} fallbackSrc={item.image} alt={item.title} containerClassName="relative h-28 w-28 overflow-hidden bg-[#F8F6F1]" />
                </Link>

                <div>
                  <h2 className="font-bold">{item.title}</h2>
                  <p className="mt-1 text-sm text-[#303839]/60">{formatCurrency(item.price, item.currency)} each</p>

                  {/* Keep the cart clean: no raw field keys or option flags — just a
                      quiet marker that the item is personalized. */}
                  {(item.customizationId || item.previewImages?.front) && (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <p className="inline-flex items-center gap-1.5 text-xs font-bold text-[#303839]/70">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37]" /> Personalized design
                      </p>
                      {item.slug && (
                        <Link
                          href={`/products/${item.slug}/personalize?cartItemId=${encodeURIComponent(item.id)}${item.customizationId ? `&customizationId=${encodeURIComponent(item.customizationId)}` : ""}&returnTo=/cart`}
                          className="text-xs font-bold text-[#303839] underline underline-offset-4"
                        >
                          Edit design
                        </Link>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-start gap-3 sm:items-end">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => updateCartQuantity(user, item.id, Number(item.quantity || 1) - 1)} data-shape="round" className="grid h-9 w-9 place-items-center rounded-full border border-[#303839]/15">−</button>
                    <span className="min-w-8 text-center text-sm font-bold">{item.quantity || 1}</span>
                    <button type="button" onClick={() => updateCartQuantity(user, item.id, Number(item.quantity || 1) + 1)} data-shape="round" className="grid h-9 w-9 place-items-center rounded-full border border-[#303839]/15">+</button>
                  </div>

                  <p className="font-bold">{formatCurrency(Number(item.price || 0) * Number(item.quantity || 1), item.currency)}</p>
                  <button type="button" onClick={() => removeFromCart(user, item.id)} className="text-xs font-bold text-red-600">Remove</button>
                </div>
              </article>
            ))}

            {!items.length && (
              <div className="rounded-none border border-[#303839]/10 bg-[#E6E6E6] p-8 text-center">
                <p className="font-bold">Your cart is empty.</p>
                <Link href="/products" className="mt-4 inline-flex rounded-none bg-[#303839] px-6 py-3 text-sm font-bold text-white">Continue Shopping</Link>
              </div>
            )}
          </div>
        </div>

        <aside className="h-fit rounded-none border border-[#303839]/10 bg-white p-6 shadow-[0_18px_60px_rgba(48,56,57,0.06)]">
          <h2 className="text-xl font-bold">Order summary</h2>
          <div className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(totals.subtotal, totals.currency)}</span></div>
            <div className="flex justify-between"><span>Delivery</span><span>{totals.deliveryCharge ? formatCurrency(totals.deliveryCharge, totals.currency) : "Calculated later"}</span></div>
            <div className="border-t border-[#303839]/10 pt-3 flex justify-between font-bold"><span>Total</span><span>{formatCurrency(totals.total, totals.currency)}</span></div>
          </div>

          {items.length ? (
            <Link href="/checkout" className="mt-6 block rounded-none bg-[#303839] px-6 py-4 text-center text-sm font-bold text-white">
              Go to Checkout
            </Link>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="mt-6 block w-full cursor-not-allowed rounded-full bg-[#303839]/30 px-6 py-4 text-center text-sm font-bold text-white"
            >
              Go to Checkout
            </button>
          )}
          <Link href="/products" className="mt-3 block rounded-none border border-[#303839]/15 px-6 py-4 text-center text-sm font-bold">
            Continue Shopping
          </Link>
        </aside>
      </section>
    </main>
  );
}
