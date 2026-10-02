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
    <main className="text-ink">
      <section className="page-container grid gap-8 pb-16 pt-8 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12 lg:pb-20 lg:pt-12">
        <div>
          <h1 className="heading-page">Cart</h1>
          <p className="text-lead mt-3">Review your personalized products before checkout.</p>

          {!authLoading && !user && (
            <div className="mt-6 rounded-[10px] bg-cream p-6">
              <p className="text-[15px] font-semibold text-ink">Sign in to view your cart.</p>
              <button type="button" onClick={openCustomerLogin} className="btn btn-primary mt-4">
                Sign in
              </button>
            </div>
          )}

          <div className="mt-8 space-y-4">
            {items.map((item) => (
              <article key={item.id} className="grid gap-4 rounded-[10px] border border-line p-4 sm:grid-cols-[120px_1fr_auto]">
                <Link href={item.slug ? `/products/${item.slug}` : "/products"}>
                  <ServerCustomizationImage customizationId={item.customizationId} outputPageId={item.mockupOutputRef?.pageId} fallbackSrc={item.image} alt={item.title} containerClassName="relative h-28 w-28 overflow-hidden bg-cream" />
                </Link>

                <div>
                  <h2 className="heading-card">{item.title}</h2>
                  <p className="mt-1 text-[14px] text-muted">{formatCurrency(item.price, item.currency)} each</p>

                  {/* Keep the cart clean: no raw field keys or option flags — just a
                      quiet marker that the item is personalized. */}
                  {(item.customizationId || item.previewImages?.front) && (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37]" /> Personalized design
                      </p>
                      {item.slug && (
                        <Link
                          href={`/products/${item.slug}/personalize?cartItemId=${encodeURIComponent(item.id)}${item.customizationId ? `&customizationId=${encodeURIComponent(item.customizationId)}` : ""}&returnTo=/cart`}
                          className="inline-flex min-h-6 items-center text-[13px] font-semibold text-ink underline underline-offset-4"
                        >
                          Edit design
                        </Link>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-start gap-3 sm:items-end">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => updateCartQuantity(user, item.id, Number(item.quantity || 1) - 1)} data-shape="round" aria-label={`Decrease quantity of ${item.title}`} className="grid h-10 w-10 place-items-center rounded-full border border-field transition-colors hover:border-ink/50">−</button>
                    <span className="min-w-8 text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
                      <span className="sr-only">Quantity </span>
                      {item.quantity || 1}
                    </span>
                    <button type="button" onClick={() => updateCartQuantity(user, item.id, Number(item.quantity || 1) + 1)} data-shape="round" aria-label={`Increase quantity of ${item.title}`} className="grid h-10 w-10 place-items-center rounded-full border border-field transition-colors hover:border-ink/50">+</button>
                  </div>

                  <p className="price">{formatCurrency(Number(item.price || 0) * Number(item.quantity || 1), item.currency)}</p>
                  <button type="button" onClick={() => removeFromCart(user, item.id)} aria-label={`Remove ${item.title} from cart`} className="btn btn-text text-[13px]">Remove</button>
                </div>
              </article>
            ))}

            {!items.length && (
              <div className="rounded-[10px] bg-cream p-8 text-center">
                <p className="font-display text-[1.75rem] font-medium text-ink">Your cart is empty</p>
                <p className="mt-2 text-[15px] text-muted">Find a design you love and personalize it for your occasion.</p>
                <Link href="/products" className="btn btn-primary mt-5">Continue shopping</Link>
              </div>
            )}
          </div>
        </div>

        <aside className="h-fit rounded-[10px] border border-line bg-white p-6 lg:sticky lg:top-[140px]" aria-label="Order summary">
          <h2 className="font-display text-[1.75rem] font-medium leading-none">Order summary</h2>
          <div className="mt-5 space-y-3 text-[14px]">
            <div className="flex justify-between gap-4"><span className="text-muted">Subtotal</span><span className="price">{formatCurrency(totals.subtotal, totals.currency)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted">Delivery charge</span><span className="text-right">{totals.deliveryCharge ? formatCurrency(totals.deliveryCharge, totals.currency) : "Confirmed after order review"}</span></div>
            <div className="flex justify-between gap-4 border-t border-line pt-3 text-[16px] font-semibold"><span>Order subtotal</span><span className="price">{formatCurrency(totals.total, totals.currency)}</span></div>
            <p className="text-[13px] leading-5 text-muted">Store pickup has no delivery charge. For delivery, Husnalogy confirms the charge after reviewing the destination.</p>
          </div>

          {items.length ? (
            <Link href="/checkout" className="btn btn-primary btn-lg btn-block mt-6">
              Go to checkout
            </Link>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="btn btn-primary btn-lg btn-block mt-6"
            >
              Go to checkout
            </button>
          )}
          <Link href="/products" className="btn btn-secondary btn-block mt-3">
            Continue shopping
          </Link>
        </aside>
      </section>
    </main>
  );
}
