"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  removeFromCart,
  removeFromWishlist,
  subscribeToUserCart,
  subscribeToUserWishlist,
  updateCartQuantity,
} from "../lib/customer-lists";

export default function SidePanel({ type, setType, user, openAuth }) {
  const [cart, setCart] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [loading, setLoading] = useState(false);

  const closePanel = () => setType(null);

  useEffect(() => {
    if (!type) return;

    if (!user) {
      setType(null);
      openAuth?.("login");
      return;
    }
  }, [type, user, openAuth, setType]);

  useEffect(() => {
    if (!user) {
      setCart([]);
      setWishlist([]);
      return;
    }

    const unsubscribeCart = subscribeToUserCart(user, setCart);
    const unsubscribeWishlist = subscribeToUserWishlist(user, setWishlist);

    return () => {
      unsubscribeCart();
      unsubscribeWishlist();
    };
  }, [user]);

  const removeItem = async (id) => {
    if (!user) {
      openAuth?.("login");
      return;
    }

    setLoading(true);

    try {
      if (type === "cart") {
        await removeFromCart(user, id);
      } else {
        await removeFromWishlist(user, id);
      }
    } catch (error) {
      console.error("Remove item failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const changeQuantity = async (id, quantity) => {
    if (!user) {
      openAuth?.("login");
      return;
    }

    const safeQuantity = Math.max(1, Number(quantity || 1));

    try {
      await updateCartQuantity(user, id, safeQuantity);
    } catch (error) {
      console.error("Quantity update failed:", error);
    }
  };

  const items = type === "cart" ? cart : wishlist;
  const total = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0
  );
  const panelCopy =
    type === "cart"
      ? {
          title: "Cart",
          emptyTitle: "Your cart is empty.",
          emptyCta: "Browse products",
          emptyHref: "/products",
        }
      : {
          title: "Wishlist",
          emptyTitle: "Your wishlist is empty.",
          emptyCta: "Find favourites",
          emptyHref: "/products",
        };

  if (!type) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[3200] bg-[#303839]/40 backdrop-blur-[2px]"
        onClick={closePanel}
      />

      <aside className="rounded-flush fixed inset-y-0 right-0 z-[3201] flex h-dvh min-h-dvh w-full max-w-none flex-col overflow-hidden bg-white font-body text-[#303839] shadow-[0_0_70px_rgba(48,56,57,0.16)] lg:w-[92%] lg:max-w-[440px]">
        <header className="flex items-center justify-between gap-4 border-b border-[#303839]/10 px-6 py-5">
          <h2 className="min-w-0 text-left text-xl font-bold leading-none text-heading md:text-2xl">
            {panelCopy.title}
          </h2>

          <button
            type="button"
            onClick={closePanel}
            data-shape="round"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-black transition-colors duration-200 hover:bg-[#E6E6E6] active:bg-[#E6E6E6]"
            aria-label="Close panel"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.4"
            >
              <path d="M6 6l12 12" />
              <path d="M18 6 6 18" />
            </svg>
          </button>
        </header>

        {items.length === 0 ? (
          <EmptyBox
            title={panelCopy.emptyTitle}
            cta={panelCopy.emptyCta}
            href={panelCopy.emptyHref}
            onClose={closePanel}
          />
        ) : (
          <div className="flex-1 overflow-y-auto px-6">
            <ul className="divide-y divide-[#303839]/8">
              {items.map((item) => {
                const productHref = item.slug ? `/products/${item.slug}` : "/products";
                const lineTotal = Number(item.price || 0) * Number(item.quantity || 1);

                return (
                  <li key={item.id} className="group py-5">
                    <div className="flex gap-4">
                      <Link
                        href={productHref}
                        onClick={closePanel}
                        className="relative block aspect-square w-[86px] shrink-0 overflow-hidden rounded-[10px] bg-[#f8f6f1] ring-1 ring-[#303839]/8"
                      >
                        <img
                          src={item.image || "/images/weddings.png"}
                          alt={item.title}
                          className="h-full w-full object-contain p-1.5 transition duration-500 group-hover:scale-[1.03]"
                        />
                      </Link>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <Link
                            href={productHref}
                            onClick={closePanel}
                            className="line-clamp-2 text-[13.5px] font-medium leading-5 text-[#303839] transition-colors hover:text-black"
                          >
                            {item.title}
                          </Link>
                          <span className="shrink-0 text-[13.5px] font-semibold text-[#303839]">
                            ${lineTotal.toFixed(2)}
                          </span>
                        </div>

                        <p className="mt-1 text-[12px] text-[#303839]/50">
                          ${Number(item.price || 0).toFixed(2)} each
                        </p>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          {type === "cart" ? (
                            <div className="inline-flex h-9 items-center overflow-hidden rounded-[10px] border border-[#303839]/15">
                              <button
                                type="button"
                                onClick={() => changeQuantity(item.id, Number(item.quantity || 1) - 1)}
                                className="grid h-9 w-9 place-items-center text-[15px] text-[#303839]/70 transition-colors hover:bg-[#E6E6E6] hover:text-[#303839] active:bg-[#E6E6E6] disabled:opacity-30"
                                aria-label="Decrease quantity"
                                disabled={Number(item.quantity || 1) <= 1}
                              >
                                &minus;
                              </button>
                              <span className="grid h-9 min-w-9 place-items-center border-x border-[#303839]/12 px-2 text-[12.5px] font-semibold">
                                {item.quantity || 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => changeQuantity(item.id, Number(item.quantity || 1) + 1)}
                                className="grid h-9 w-9 place-items-center text-[15px] text-[#303839]/70 transition-colors hover:bg-[#E6E6E6] hover:text-[#303839] active:bg-[#E6E6E6]"
                                aria-label="Increase quantity"
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <Link
                              href={productHref}
                              onClick={closePanel}
                              className="rounded-[8px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#303839]/70 transition-colors hover:bg-[#E6E6E6] hover:text-[#303839] active:bg-[#E6E6E6]"
                            >
                              View product
                            </Link>
                          )}

                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => removeItem(item.id)}
                            className="rounded-[8px] px-2 py-1 text-[11px] font-medium uppercase tracking-[0.1em] text-[#303839]/45 transition-colors hover:bg-[#E6E6E6] hover:text-[#303839] active:bg-[#E6E6E6] disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {type === "cart" && items.length > 0 && (
          <footer className="border-t border-[#303839]/10 px-6 py-5">
            <div className="space-y-2.5 text-[13px]">
              <div className="flex items-center justify-between text-[#303839]/70">
                <span>Subtotal</span>
                <span className="font-medium text-[#303839]">${total.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-[#303839]/70">
                <span>Delivery</span>
                <span className="font-medium text-[#303839]/60">Calculated later</span>
              </div>
              <div className="flex items-center justify-between border-t border-[#303839]/10 pt-3 text-[15px] font-semibold text-[#303839]">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>

            <Link
              href="/checkout"
              onClick={closePanel}
              className="mt-5 flex h-12 w-full items-center justify-center rounded-[10px] bg-[#303839] px-6 text-center text-[12.5px] font-semibold uppercase tracking-[0.16em] text-white transition-colors duration-300 hover:bg-[#E6E6E6] hover:text-[#303839] active:bg-[#E6E6E6]"
            >
              Checkout
            </Link>

            <button
              type="button"
              onClick={closePanel}
              className="mt-2.5 h-11 w-full rounded-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-[#303839]/55 transition-colors hover:bg-[#E6E6E6] hover:text-[#303839] active:bg-[#E6E6E6]"
            >
              Continue shopping
            </button>
          </footer>
        )}

        {type === "wishlist" && items.length > 0 && (
          <footer className="border-t border-[#303839]/10 px-6 py-5">
            <Link
              href="/products"
              onClick={closePanel}
              className="flex h-12 w-full items-center justify-center rounded-[10px] bg-[#303839] px-6 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white transition-colors duration-300 hover:bg-[#E6E6E6] hover:text-[#303839] active:bg-[#E6E6E6]"
            >
              Browse more
            </Link>
          </footer>
        )}
      </aside>
    </>
  );
}

function EmptyBox({ title, cta, href, onClose }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-8">
      <div className="w-full text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#f8f6f1] text-[#303839]/70">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-7 w-7"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
          >
            <path d="M6 7h12l1 14H5L6 7Z" />
            <path d="M9 7V6a3 3 0 0 1 6 0v1" />
          </svg>
        </div>
        <p className="mt-5 text-lg font-bold leading-tight text-heading">{title}</p>
        <Link
          href={href}
          onClick={onClose}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-[10px] bg-[#303839] px-7 text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition-colors duration-300 hover:bg-[#E6E6E6] hover:text-[#303839] active:bg-[#E6E6E6]"
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}
