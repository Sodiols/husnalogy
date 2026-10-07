"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useAuth from "../lib/useAuth";
import { purgeLegacyAccountStorage } from "../lib/account-data";
import { formatCurrency, normalizeCurrency } from "@/lib/currency";
import ServerCustomizationImage from "@/app/components/customizer/ServerCustomizationImage";

function normalizeOrder(order: any = {}) {
  return {
    ...order,
    id: order.id || `local_${order.createdAt || Date.now()}`,
    items: Array.isArray(order.items) ? order.items : [],
    status: order.status || "pending",
    paymentStatus: order.paymentStatus || "unpaid",
    total: Number(order.total || 0),
    currency: normalizeCurrency(order.currency),
    createdAt: order.createdAt || order.updatedAt || "",
  };
}

function mergeOrders(serverOrders = [], localOrders = []) {
  const allowedIds = new Set(serverOrders.map((order) => String(order.id)));
  const merged = new Map();

  [localOrders, serverOrders].forEach((source) => {
    source.map(normalizeOrder).forEach((order) => {
      const id = String(order.id);
      if (!allowedIds.has(id)) return;
      merged.set(id, order);
    });
  });

  return Array.from(merged.values()).sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
}

function formatOrderDate(value) {
  if (!value) return "Recently";

  try {
    return new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "Recently";
  }
}

// Same customer-facing order number as the account page (#HUS-…).
const orderCode = (value) => String(value || "order").replace(/^order[-_]?/i, "#HUS-").toUpperCase();

// "in_production" -> "In production"
function statusLabel(value) {
  const text = String(value || "pending").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const openSignIn = () => window.dispatchEvent(new CustomEvent("husnalogy-open-auth", { detail: { mode: "login" } }));

export default function OrdersClient() {
  const { user, authLoading } = useAuth();
  const [serverOrders, setServerOrders] = useState([]);
  const [serverLoaded, setServerLoaded] = useState(false);
  // Orders come only from the signed-in account on the server. A browser copy
  // used to be merged in here — shared by every account on the browser.
  useEffect(() => purgeLegacyAccountStorage(), []);

  // Live status straight from the admin source of truth.
  useEffect(() => {
    if (authLoading) return undefined;

    setServerLoaded(false);

    if (!user?.uid) {
      setServerOrders([]);
      setServerLoaded(true);
      return undefined;
    }

    let active = true;

    const loadServerOrders = async () => {
      try {
        const response = await fetch("/api/order-requests", {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));

        if (active && response.ok && Array.isArray(data.orders)) {
          setServerOrders(data.orders);
        }
      } catch (error) {
        // Keep the last known admin list if a refresh fails.
      } finally {
        if (active) setServerLoaded(true);
      }
    };

    loadServerOrders();
    const interval = window.setInterval(loadServerOrders, 20000);
    const onFocus = () => loadServerOrders();
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [authLoading, user?.uid]);

  const orders = useMemo(
    () => mergeOrders(serverOrders),
    [serverOrders]
  );

  const loadingOrders = authLoading || (!!user && !serverLoaded);

  return (
    <main className="bg-cream text-ink">
      <section className="page-container pb-16 pt-8 sm:pt-10 lg:pb-20 lg:pt-12">
        <div className="mx-auto max-w-[960px]">
          <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-[13px] text-muted">
            <Link href="/account" className="hover:text-ink hover:underline hover:underline-offset-4">Your account</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-ink">Orders</span>
          </nav>

          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="heading-page">Your orders</h1>
              {/* Same text for everyone: the server cannot know who is signed in
                  here, so user-dependent copy would not match on hydration. */}
              <p className="text-lead mt-2 max-w-[600px]">
                Orders placed with your account appear here, and their status updates automatically.
              </p>
            </div>
            {user && !loadingOrders && orders.length > 0 && (
              <p className="text-[14px] text-muted">
                <span className="font-semibold text-ink">{orders.length}</span> {orders.length === 1 ? "order" : "orders"}
              </p>
            )}
          </header>

          <div className="mt-8 space-y-4" aria-live="polite" aria-busy={loadingOrders}>
            {!authLoading && !user && (
              <div className="rounded-[10px] border border-line bg-white p-8 text-center">
                <p className="font-display text-[1.75rem] font-medium leading-tight text-ink">Sign in to view your orders</p>
                <p className="mx-auto mt-2 max-w-[440px] text-[15px] leading-7 text-muted">
                  Orders placed while signed in are saved to your account so you can follow them here.
                </p>
                <button type="button" onClick={openSignIn} className="btn btn-primary mt-6">
                  Sign in
                </button>
              </div>
            )}

            {loadingOrders && !orders.length && (
              <div role="status" className="space-y-4">
                <span className="sr-only">Loading your orders…</span>
                {[0, 1].map((row) => (
                  <div key={row} className="animate-pulse rounded-[10px] border border-line bg-white p-5">
                    <div className="h-3 w-32 rounded bg-cream" />
                    <div className="mt-3 h-5 w-2/3 rounded bg-cream" />
                    <div className="mt-5 flex gap-3">
                      <div className="h-16 w-16 rounded-[6px] bg-cream" />
                      <div className="flex-1 space-y-2 pt-2">
                        <div className="h-3 w-1/2 rounded bg-cream" />
                        <div className="h-3 w-1/4 rounded bg-cream" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {orders.map((order) => {
              const items = Array.isArray(order.items) ? order.items : [];
              const isPickup = order.deliveryMethod === "store";
              const totalIsFinal = isPickup || order.deliveryChargeConfirmed;

              return (
                <article key={order.id} aria-labelledby={`order-${order.id}-title`} className="rounded-[10px] border border-line bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
                    <div className="min-w-0">
                      <p className="text-[13px] text-muted">
                        <span className="font-semibold text-ink">{orderCode(order.id)}</span>
                        <span aria-hidden="true"> · </span>
                        <time dateTime={order.createdAt || undefined}>Placed {formatOrderDate(order.createdAt)}</time>
                      </p>
                      <h2 id={`order-${order.id}-title`} className="mt-1 font-display text-[1.5rem] font-medium leading-tight text-ink">
                        {order.productTitle || items[0]?.productTitle || items[0]?.title || "Order request"}
                      </h2>
                    </div>
                    <span className="badge badge-ink shrink-0">
                      <span className="sr-only">Status: </span>
                      {statusLabel(order.status)}
                    </span>
                  </div>

                  {!!items.length && (
                    <ul className="divide-y divide-line px-5 sm:px-6">
                      {items.map((item) => (
                        <li key={item.id || item.productId || item.productSlug || item.slug} className="flex items-center gap-4 py-4">
                          <ServerCustomizationImage
                            customizationId={item.customizationId}
                            outputPageId={item.mockupOutputRef?.pageId}
                            fallbackSrc={item.image || "/images/weddings.png"}
                            alt={item.title || item.productTitle || "Product"}
                            containerClassName="relative h-16 w-16 shrink-0 overflow-hidden rounded-[6px] bg-cream"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-[15px] font-semibold text-ink">{item.title || item.productTitle}</p>
                            <p className="mt-0.5 text-[13px] text-muted">Quantity {item.quantity || 1}</p>
                          </div>
                          {item.slug && (
                            <Link href={`/products/${item.slug}`} className="btn btn-text hidden text-[13px] sm:inline-flex">
                              View product
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <dl className="grid gap-x-8 gap-y-3 border-t border-line bg-cream/60 px-5 py-4 text-[14px] sm:grid-cols-2 sm:px-6">
                    <div className="flex justify-between gap-4 sm:block">
                      <dt className="text-muted">Fulfilment</dt>
                      <dd className="font-medium text-ink sm:mt-0.5">{isPickup ? "Store pickup" : "Delivery"}</dd>
                    </div>
                    <div className="flex justify-between gap-4 sm:block">
                      <dt className="text-muted">Payment</dt>
                      <dd className="font-medium text-ink sm:mt-0.5">{order.paymentMethod || "Cash on Delivery"}</dd>
                    </div>
                    <div className="flex justify-between gap-4 sm:block">
                      <dt className="text-muted">Delivery charge</dt>
                      <dd className="font-medium text-ink sm:mt-0.5">
                        {isPickup ? "No charge" : order.deliveryChargeConfirmed ? formatCurrency(order.deliveryCharge || 0, order.currency) : "Confirmed after review"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 sm:block">
                      <dt className="text-muted">{totalIsFinal ? "Total" : "Order subtotal"}</dt>
                      <dd className="price text-[16px] sm:mt-0.5">{formatCurrency(order.total, order.currency)}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}

            {user && !loadingOrders && !orders.length && (
              <div className="rounded-[10px] border border-line bg-white p-8 text-center sm:p-10">
                <p className="font-display text-[1.75rem] font-medium leading-tight text-ink">No orders yet</p>
                <p className="mx-auto mt-2 max-w-[440px] text-[15px] leading-7 text-muted">
                  When you place an order, it will appear here with its status.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link href="/products" className="btn btn-primary">
                    Start shopping
                  </Link>
                  <Link href="/account" className="btn btn-secondary">
                    Back to your account
                  </Link>
                </div>
              </div>
            )}
          </div>

          {user && orders.length > 0 && (
            <p className="mt-8 text-center text-[14px] text-muted">
              Questions about an order?{" "}
              <Link href="/contact" className="font-semibold text-ink underline underline-offset-4">
                Contact us
              </Link>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
