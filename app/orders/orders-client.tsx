"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useAuth from "../lib/useAuth";
import { subscribeToLocalOrders } from "../lib/customer-lists";
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

export default function OrdersClient() {
  const { user, authLoading } = useAuth();
  const [serverOrders, setServerOrders] = useState([]);
  const [serverLoaded, setServerLoaded] = useState(false);
  const [localOrders, setLocalOrders] = useState([]);

  useEffect(() => subscribeToLocalOrders(setLocalOrders), []);

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
    () => mergeOrders(serverOrders, localOrders),
    [serverOrders, localOrders]
  );

  const loadingOrders = authLoading || (!!user && !serverLoaded);
  const headingText = user ? "Orders confirmed by Husnalogy" : "Sign in to view your orders";
  const helperText = user
    ? "Only orders received by Husnalogy appear here. When your order status is updated, the new status shows automatically."
    : "Sign in before checkout so your orders are saved and tracked here with live status updates.";

  return (
    <main className="px-4 py-12 text-[#303839]">
      <section className="mx-auto max-w-[980px]">
        <h1 className="font-display text-4xl">My Orders</h1>
        <p className="mt-2 text-sm text-[#303839]/65">{headingText}</p>
        <p className="mt-1 text-sm leading-6 text-[#303839]/60">{helperText}</p>

        <div className="mt-8 space-y-4">
          {loadingOrders && !orders.length && (
            <div className="rounded-none border border-[#303839]/10 bg-white p-6 text-sm font-bold text-[#303839]/60">
              Loading your orders...
            </div>
          )}

          {orders.map((order) => {
            const items = Array.isArray(order.items) ? order.items : [];

            return (
              <article key={order.id} className="rounded-none border border-[#303839]/10 bg-white p-5 shadow-[0_10px_30px_rgba(48,56,57,0.04)]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#303839]/45">Order {order.id}</p>
                    <h2 className="mt-1 text-lg font-bold">{order.productTitle || items[0]?.productTitle || items[0]?.title || "Order request"}</h2>
                    <p className="mt-1 text-xs text-[#303839]/55">Placed {formatOrderDate(order.createdAt)}</p>
                  </div>

                  <span className="rounded-full bg-[#E6E6E6] px-4 py-2 text-xs font-bold uppercase tracking-[0.1em] text-[#303839]">
                    {order.status || "pending"}
                  </span>
                </div>

                {!!items.length && (
                  <div className="mt-4 space-y-3">
                    {items.map((item) => (
                      <div key={item.id || item.productId || item.productSlug || item.slug} className="flex items-center gap-3">
                        <ServerCustomizationImage customizationId={item.customizationId} outputPageId={item.mockupOutputRef?.pageId} fallbackSrc={item.image || "/images/weddings.png"} alt={item.title || item.productTitle || "Product"} containerClassName="relative h-14 w-14 shrink-0 overflow-hidden bg-[#F8F6F1]" />
                        <div className="flex-1">
                          <p className="text-sm font-bold">{item.title || item.productTitle}</p>
                          <p className="text-xs text-[#303839]/60">Qty {item.quantity || 1}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-[#303839]/10 pt-4 text-sm font-bold">
                  <span>{order.paymentStatus || "unpaid"}</span>
                  <span>{formatCurrency(order.total, order.currency)}</span>
                </div>
              </article>
            );
          })}

          {!loadingOrders && !orders.length && (
            <div className="rounded-none border border-[#303839]/10 bg-[#E6E6E6] p-8 text-center">
              <p className="font-bold">No order requests found yet.</p>
              <Link href="/products" className="mt-4 inline-flex rounded-none bg-[#303839] px-6 py-3 text-sm font-bold text-white">Start Shopping</Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
