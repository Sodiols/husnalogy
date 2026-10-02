"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import RightArrowIcon from "../components/RightArrowIcon";
import useAuth from "../lib/useAuth";
import { logoutUser } from "../lib/auth";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/currency";
import ServerCustomizationImage from "@/app/components/customizer/ServerCustomizationImage";
import {
  subscribeToUserWishlist,
  removeFromWishlist,
  subscribeToSavedAddresses,
  saveCustomerAddress,
  updateCustomerAddress,
  setDefaultAddress,
  removeCustomerAddress,
  getLocalProfile,
  saveLocalProfile,
} from "../lib/customer-lists";

const NAV = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "orders", label: "Orders", icon: "bag" },
  { id: "requests", label: "Personalized designs", icon: "edit" },
  { id: "wishlist", label: "Wishlist", icon: "heart" },
  { id: "addresses", label: "Saved addresses", icon: "pin" },
  { id: "history", label: "Order history", icon: "history" },
  { id: "profile", label: "Profile", icon: "settings" },
];

const initials = (v) => {
  const p = String(v || "").trim().split(/\s+/).filter(Boolean);
  return p.length ? (p[0][0] + (p[1]?.[0] || "")).toUpperCase() : "U";
};
const money = (v, currency = "BDT") => formatCurrency(v, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const shortDate = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
};
const orderCode = (v) => String(v || "order").replace(/^order[-_]?/i, "#HUS-").toUpperCase();
const designCode = (v) => `#PD-${String(v || "design").replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase()}`;
const orderImage = (o) => o?.items?.[0]?.image || o?.image || "/images/weddings/classic.png";
const customerName = (profile) => profile.name || profile.email?.split("@")?.[0] || "Husnalogy customer";

// Normalize a saved customization (personalized design) into the shape the
// account UI renders. Customizations come from /api/customizations.
function personalizedFromCustomization(c) {
  const render = c?.renderData || {};
  const preview = c?.previewImages || {};
  const image =
    preview.front ||
    preview[render.activePage] ||
    Object.values(preview).find(Boolean) ||
    render.productThumbnail ||
    "/images/weddings/classic.png";
  return {
    id: c.id,
    productTitle: render.productTitle || "Personalized design",
    productSlug: render.productSlug || "",
    image,
    status: c.status || "draft",
    createdAt: c.updatedAt || c.createdAt,
    values: c.values || {},
    uploadedFiles: c.uploadedFiles || {},
    selectedOptions: c.selectedOptions || {},
    previewImages: preview,
  };
}

// Human-friendly status label for a personalized design.
const designStatusLabel = (status) => {
  const s = String(status || "").toLowerCase();
  if (s === "draft") return "Draft";
  if (s === "in_cart") return "In cart";
  if (s === "ordered") return "Ordered";
  if (s === "archived") return "Archived";
  return status || "Draft";
};

function filesFromOrder(order) {
  const out = [];
  const push = (val, label) => {
    (Array.isArray(val) ? val : [val]).filter(Boolean).forEach((url) => {
      if (typeof url === "string") out.push({ url, name: label, orderId: order.id, date: order.createdAt });
    });
  };
  const uf = order?.uploadedFiles || {};
  if (uf && typeof uf === "object") Object.entries(uf).forEach(([key, val]) => push(val, key));
  return out;
}

export default function AccountClient() {
  const { user, authLoading } = useAuth();
  const router = useRouter();

  const [view, setView] = useState("overview");
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [personalized, setPersonalized] = useState([]);
  const [personalizedLoading, setPersonalizedLoading] = useState(true);
  const [wishlist, setWishlist] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [profile, setProfile] = useState({ name: "", email: "", phone: "", photoURL: "" });
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailRequest, setDetailRequest] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (authLoading) return undefined;
    return subscribeToUserWishlist(user, (i) => setWishlist(Array.isArray(i) ? i : []));
  }, [authLoading, user]);
  useEffect(() => subscribeToSavedAddresses((i) => setAddresses(Array.isArray(i) ? i : [])), []);

  useEffect(() => {
    if (!user) return;
    const local = getLocalProfile();
    setProfile({
      name: user.name || "",
      email: user.email || "",
      phone: local.phone || "",
      photoURL: user.photoURL || local.photoURL || "",
    });
  }, [user]);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!user?.uid) {
      setOrders([]);
      setOrdersLoading(false);
      return undefined;
    }
    let live = true;
    setOrdersLoading(true);
    setOrdersError("");
    (async () => {
      try {
        const res = await fetch("/api/order-requests", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Could not load your orders.");
        if (live) setOrders(Array.isArray(data.orders) ? data.orders : []);
      } catch (error) {
        if (live) setOrdersError(error.message || "Could not load your orders.");
      } finally {
        if (live) setOrdersLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [authLoading, user?.uid]);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!user?.uid) {
      setPersonalized([]);
      setPersonalizedLoading(false);
      return undefined;
    }
    let live = true;
    setPersonalizedLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/customizations?limit=50", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const list = res.ok && data.ok && Array.isArray(data.customizations) ? data.customizations : [];
        if (live) setPersonalized(list.map(personalizedFromCustomization));
      } catch {
        if (live) setPersonalized([]);
      } finally {
        if (live) setPersonalizedLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [authLoading, user?.uid]);

  useEffect(() => {
    if (!authLoading && !user) {
      window.dispatchEvent(new CustomEvent("husnalogy-open-auth", { detail: { mode: "login" } }));
    }
  }, [authLoading, user]);

  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    [orders]
  );
  const personalizedDesigns = useMemo(
    () => [...personalized].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    [personalized]
  );
  const activeDesigns = personalizedDesigns.filter(
    (d) => !["ordered", "archived"].includes(String(d.status || "").toLowerCase())
  );

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutUser();
    } catch {
      /* ignore */
    }
    router.push("/");
    router.refresh();
  };

  const removeWish = async (id) => {
    try {
      await removeFromWishlist(user, id);
    } catch {
      /* subscription will reflect actual state */
    }
  };

  if (authLoading) {
    return (
      <main className="grid min-h-[60vh] place-items-center bg-cream px-4 text-ink">
        <div className="flex items-center gap-3 text-sm font-semibold text-muted">
          <Spinner /> Loading your account...
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="grid min-h-[60vh] place-items-center bg-cream px-4 text-ink">
        <div className="w-full max-w-[460px] rounded-[10px] border border-line bg-white p-8 text-center">
          <h1 className="heading-page">Your account</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Please sign in to view your orders, personalized designs, wishlist, and saved addresses.</p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("husnalogy-open-auth", { detail: { mode: "login" } }))}
            className="btn btn-primary btn-lg mt-6"
          >
            Sign in
          </button>
        </div>
      </main>
    );
  }

  const name = customerName(profile);
  const firstName = name.split(" ")[0];

  return (
    <main className="bg-cream text-ink">
      <div className="page-container pb-16 pt-6 lg:pb-20 lg:pt-8">
        <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-[13px] text-muted">
          <Link href="/" className="hover:text-ink hover:underline hover:underline-offset-4">Home</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="text-ink">Your account</span>
        </nav>

        {/* Mobile profile header + tabs */}
        <div className="mb-4 lg:hidden">
          <div className="flex items-center gap-3 rounded-[10px] border border-line bg-white p-4">
            <Avatar profile={profile} size="h-12 w-12 text-base" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-ink">{name}</p>
              <p className="truncate text-xs text-muted">{profile.email}</p>
            </div>
          </div>
          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Account sections">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={view === item.id}
                onClick={() => setView(item.id)}
                className={`min-h-10 shrink-0 border px-4 text-[14px] font-medium transition-colors ${
                  view === item.id ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-cream"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Desktop sidebar */}
          <aside className="hidden h-fit rounded-[10px] border border-line bg-white p-5 lg:sticky lg:top-[140px] lg:block" aria-label="Account navigation">
            <div className="flex flex-col items-center text-center">
              <Avatar profile={profile} size="h-20 w-20 text-2xl" />
              <p className="mt-3 font-display text-[1.375rem] font-medium leading-tight text-ink">{name}</p>
              <p className="mt-1 max-w-full truncate text-[13px] text-muted">{profile.email}</p>
            </div>
            <div className="my-5 h-px bg-line" />
            <div className="grid gap-1">
              {NAV.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  aria-current={view === item.id ? "page" : undefined}
                  className={`relative flex min-h-11 items-center gap-3 px-3 text-left text-[14px] transition-colors ${
                    view === item.id
                      ? "bg-cream font-semibold text-ink before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-ink"
                      : "font-medium text-muted hover:bg-cream hover:text-ink"
                  }`}
                >
                  <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="mt-4 flex min-h-11 items-center gap-3 border-t border-line px-3 pt-4 text-left text-[14px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-60"
              >
                {loggingOut ? <Spinner small /> : <Icon name="logout" className="h-[18px] w-[18px] shrink-0" />}
                {loggingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </aside>

          {/* Content */}
          <div className="min-w-0 space-y-6">
            {view === "overview" && (
              <Overview
                firstName={firstName}
                profile={profile}
                orders={sortedOrders}
                ordersLoading={ordersLoading}
                ordersError={ordersError}
                personalizedDesigns={personalizedDesigns}
                activeDesigns={activeDesigns}
                personalizedLoading={personalizedLoading}
                wishlist={wishlist}
                addresses={addresses}
                onView={setView}
                onOpenOrder={setDetailOrder}
                onOpenRequest={setDetailRequest}
              />
            )}
            {view === "orders" && (
              <OrdersView orders={sortedOrders} loading={ordersLoading} error={ordersError} onOpen={setDetailOrder} />
            )}
            {view === "requests" && (
              <RequestsView requests={personalizedDesigns} loading={personalizedLoading} onOpen={setDetailRequest} />
            )}
            {view === "wishlist" && <WishlistView items={wishlist} onRemove={removeWish} />}
            {view === "addresses" && <AddressesView addresses={addresses} />}
            {view === "history" && <HistoryView orders={sortedOrders} loading={ordersLoading} error={ordersError} onOpen={setDetailOrder} />}
            {view === "profile" && <ProfileView profile={profile} setProfile={setProfile} addresses={addresses} />}
          </div>
        </div>
      </div>

      {detailOrder && <OrderDetailModal order={detailOrder} onClose={() => setDetailOrder(null)} />}
      {detailRequest && <RequestDetailModal request={detailRequest} onClose={() => setDetailRequest(null)} />}
    </main>
  );
}

/* ------------------------------ Overview ------------------------------ */

function Overview({ firstName, profile, orders, ordersLoading, ordersError, personalizedDesigns, activeDesigns, personalizedLoading, wishlist, addresses, onView, onOpenOrder, onOpenRequest }) {
  const stats = [
    { label: "Orders", value: orders.length, icon: "bag", action: "View orders", to: "orders" },
    { label: "Designs in progress", value: activeDesigns.length, icon: "edit", action: "View designs", to: "requests" },
    { label: "Wishlist items", value: wishlist.length, icon: "heart", action: "View wishlist", to: "wishlist" },
    { label: "Saved addresses", value: addresses.length, icon: "pin", action: "Manage addresses", to: "addresses" },
  ];

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="heading-page">Welcome back{firstName ? `, ${firstName}` : ""}</h1>
          <p className="text-lead mt-2">Your orders, saved designs and details in one place.</p>
        </div>
        <Link href="/products" className="btn btn-primary shrink-0">
          Shop new designs
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <button key={s.label} type="button" onClick={() => onView(s.to)} className="group flex flex-col rounded-[10px] border border-line bg-white p-5 text-left transition-colors hover:border-ink/40">
            <span className="flex items-center justify-between gap-3">
              <span className="text-[14px] font-medium text-muted">{s.label}</span>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-cream text-ink">
                <Icon name={s.icon} className="h-[18px] w-[18px]" />
              </span>
            </span>
            <span className="mt-3 font-display text-[2.5rem] font-medium leading-none text-ink">{s.value}</span>
            <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-ink group-hover:underline group-hover:underline-offset-4">
              {s.action} <Arrow />
            </span>
          </button>
        ))}
      </div>

      <Panel title="Recent orders" actionLabel="View all orders" onAction={() => onView("orders")}>
        {ordersLoading ? (
          <LoadingRows />
        ) : ordersError ? (
          <ErrorState text={ordersError} />
        ) : orders.length ? (
          <div className="divide-y divide-line">
            {orders.slice(0, 3).map((o) => (
              <OrderRow key={o.id} order={o} onOpen={() => onOpenOrder(o)} />
            ))}
          </div>
        ) : (
          <EmptyState icon="bag" title="No orders yet" text="Your orders will appear here after checkout." cta />
        )}
      </Panel>

      <Panel title="Personalized designs" actionLabel="View all designs" onAction={() => onView("requests")}>
        {personalizedLoading ? (
          <LoadingRows />
        ) : personalizedDesigns.length ? (
          <div className="divide-y divide-line">
            {personalizedDesigns.slice(0, 3).map((d) => (
              <RequestRow key={d.id} request={d} onOpen={() => onOpenRequest(d)} />
            ))}
          </div>
        ) : (
          <EmptyState icon="edit" title="No personalized designs yet" text="Personalize any design from a product page and it will be saved here." linkLabel="Browse products" linkHref="/products" />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AccountSummaryCard icon="heart" title="Wishlist" subtitle="Designs you saved" count={wishlist.length} buttonLabel="View wishlist" onButton={() => onView("wishlist")}>
          {wishlist.length ? (
            <div className="grid w-full grid-cols-3 gap-2">
              {wishlist.slice(0, 3).map((item, i) => (
                <img key={item.id || i} src={item.image || "/images/weddings/classic.png"} alt="" className="h-16 w-full rounded-[10px] object-cover" />
              ))}
            </div>
          ) : (
            <SummaryEmpty text="No saved items yet" />
          )}
        </AccountSummaryCard>

        <AccountSummaryCard icon="pin" title="Saved addresses" subtitle="Delivery details for checkout" count={addresses.length} buttonLabel="Manage addresses" onButton={() => onView("addresses")}>
          <div className="flex w-full gap-2">
            {addresses.slice(0, 2).map((a) => (
              <div key={a.id} className="grid h-16 flex-1 place-items-center rounded-[10px] bg-cream text-ink">
                <Icon name="home" className="h-5 w-5" />
              </div>
            ))}
            <button type="button" onClick={() => onView("addresses")} className="grid h-16 w-12 place-items-center rounded-[10px] border border-dashed border-line text-lg text-muted transition hover:bg-cream">
              +
            </button>
          </div>
        </AccountSummaryCard>

        <AccountSummaryCard icon="history" title="Order history" subtitle="Past and current orders" count={orders.length} buttonLabel="View history" onButton={() => onView("history")}>
          {orders.length ? (
            <div className="w-full space-y-2">
              {orders.slice(0, 2).map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-2 rounded-[10px] bg-cream px-3 py-2">
                  <p className="truncate text-xs font-semibold text-muted">{o.productTitle || o.items?.[0]?.title || "Order"}</p>
                  <span className="shrink-0 text-[11px] text-muted">{shortDate(o.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <SummaryEmpty text="No order history yet" />
          )}
        </AccountSummaryCard>

        <AccountSummaryCard icon="settings" title="Profile" subtitle="Your name and contact details" buttonLabel="Edit profile" onButton={() => onView("profile")}>
          <div className="flex w-full items-center gap-3">
            <Avatar profile={profile} size="h-11 w-11 text-sm" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-ink">{customerName(profile)}</p>
              <p className="truncate text-xs text-muted">{profile.email}</p>
              {profile.phone && <p className="truncate text-xs text-muted">{profile.phone}</p>}
            </div>
          </div>
        </AccountSummaryCard>
      </div>
    </>
  );
}

function AccountSummaryCard({ icon, title, subtitle, count, children, buttonLabel, onButton }: any) {
  return (
    <div className="flex h-full min-h-[210px] flex-col rounded-[10px] border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cream text-ink">
            <Icon name={icon} className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
            <p className="text-[13px] text-muted">{subtitle}</p>
          </div>
        </div>
        {count !== undefined && (
          <span className="badge shrink-0">{count}</span>
        )}
      </div>

      <div className="mt-4 flex min-h-[80px] items-center">{children}</div>

      <button
        type="button"
        onClick={onButton}
        className="btn btn-secondary btn-sm btn-block mt-auto"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function SummaryEmpty({ text }) {
  return <div className="grid h-16 w-full place-items-center rounded-[10px] bg-cream text-xs text-muted">{text}</div>;
}

/* ------------------------------ Orders ------------------------------ */

function OrdersView({ orders, loading, error, onOpen }) {
  return (
    <Panel title="My Orders">
      {loading ? (
        <LoadingRows />
      ) : error ? (
        <ErrorState text={error} />
      ) : orders.length ? (
        <div className="divide-y divide-line">
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} onOpen={() => onOpen(o)} />
          ))}
        </div>
      ) : (
        <EmptyState text="You have no orders yet." cta />
      )}
    </Panel>
  );
}

function OrderRow({ order, onOpen }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4">
      <img src={orderImage(order)} alt="" className="h-14 w-14 shrink-0 rounded-[10px] object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-ink">{order.productTitle || order.items?.[0]?.title || "Custom order"}</p>
        <p className="mt-0.5 text-xs text-muted">{orderCode(order.id)} &middot; {shortDate(order.createdAt)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={order.paymentStatus || "unpaid"} />
        <StatusBadge status={order.status || "pending"} />
      </div>
      <p className="text-[15px] font-semibold text-ink sm:w-20 sm:text-right">{money(order.total, order.currency)}</p>
      <button type="button" onClick={onOpen} className="btn btn-secondary btn-sm shrink-0">
        View Order
      </button>
    </div>
  );
}

/* ------------------------------ Personalized Designs ------------------------------ */

function RequestsView({ requests, loading, onOpen }) {
  return (
    <Panel title="Personalized Designs">
      {loading ? (
        <LoadingRows />
      ) : requests.length ? (
        <div className="divide-y divide-line">
          {requests.map((r) => (
            <RequestRow key={r.id} request={r} onOpen={() => onOpen(r)} />
          ))}
        </div>
      ) : (
        <EmptyState icon="edit" text="No personalized designs yet. Personalize any design from a product page and it will be saved here." linkLabel="Browse products" linkHref="/products" />
      )}
    </Panel>
  );
}

function designSummary(request) {
  const values = request.values && typeof request.values === "object" ? request.values : {};
  const text = Object.values(values)
    .filter((v) => typeof v === "string" && v.trim())
    .join(" · ");
  return text || "Personalized design saved from the customizer.";
}

function RequestRow({ request, onOpen }) {
  return (
    <div className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:gap-5">
      <div className="flex min-w-0 items-center gap-3 lg:w-56">
        <img src={request.image || orderImage(request)} alt="" className="h-14 w-14 shrink-0 rounded-[10px] object-cover" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">{request.productTitle || "Personalized design"}</p>
          <p className="mt-0.5 text-xs text-muted">{designCode(request.id)} &middot; {shortDate(request.createdAt)}</p>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-muted">Your design</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{designSummary(request)}</p>
      </div>
      <div className="lg:w-36">
        <p className="text-[13px] font-semibold text-muted">Status</p>
        <div className="mt-1"><StatusBadge status={designStatusLabel(request.status)} /></div>
      </div>
      <button type="button" onClick={onOpen} className="btn btn-secondary btn-sm shrink-0">
        View Details
      </button>
    </div>
  );
}

/* ------------------------------ Wishlist ------------------------------ */

function WishlistView({ items, onRemove }) {
  return (
    <Panel title={`Wishlist (${items.length})`}>
      {items.length ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.id || item.productId} className="group overflow-hidden rounded-[10px] border border-line bg-white">
              <Link href={item.slug ? `/products/${item.slug}` : "/products"} className="relative block aspect-[4/5] overflow-hidden">
                <img src={item.image || "/images/weddings/classic.png"} alt={item.title} className="h-full w-full object-cover" />
              </Link>
              <div className="p-3">
                <Link href={item.slug ? `/products/${item.slug}` : "/products"} className="line-clamp-1 text-[15px] font-semibold text-ink hover:text-ink">
                  {item.title || "Product"}
                </Link>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-ink">{item.price ? money(item.price, item.currency) : ""}</span>
                  <button type="button" onClick={() => onRemove(item.productId || item.id)} className="btn btn-secondary btn-sm">
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="Your wishlist is empty. Tap the heart on any product to save it." linkLabel="Browse products" linkHref="/products" />
      )}
    </Panel>
  );
}

/* ------------------------------ Saved Addresses ------------------------------ */

function AddressesView({ addresses }) {
  const [editing, setEditing] = useState(null); // address object or {} for new
  const isOpen = editing !== null;

  return (
    <Panel
      title={`Saved Addresses (${addresses.length})`}
      actionLabel={isOpen ? null : "Add Address"}
      onAction={isOpen ? null : () => setEditing({})}
    >
      {isOpen ? (
        <AddressForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : addresses.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {addresses.map((a) => (
            <div key={a.id} className={`rounded-[10px] border bg-white p-4 ${a.isDefault ? "border-line" : "border-line"}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-[15px] font-semibold text-ink">{a.fullName || a.customerName || "Address"}</p>
                {a.isDefault && <span className="badge">Default</span>}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted">
                {[a.address || a.addressLine1, a.area, a.city, a.district, a.phone || a.customerPhone].filter(Boolean).join(", ")}
              </p>
              {a.note && <p className="mt-1 text-[11px] italic text-muted">Note: {a.note}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {!a.isDefault && (
                  <button type="button" onClick={() => setDefaultAddress(a.id)} className="btn btn-secondary btn-sm">
                    Set as default
                  </button>
                )}
                <button type="button" onClick={() => setEditing(a)} className="btn btn-secondary btn-sm">
                  Edit
                </button>
                <button type="button" onClick={() => removeCustomerAddress(a.id)} className="btn btn-secondary btn-sm">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No saved addresses yet." action={{ label: "Add your first address", onClick: () => setEditing({}) }} />
      )}
    </Panel>
  );
}

function AddressForm({ initial, onCancel, onSaved }) {
  const [form, setForm] = useState({
    fullName: initial.fullName || initial.customerName || "",
    phone: initial.phone || initial.customerPhone || "",
    area: initial.area || "",
    city: initial.city || "",
    district: initial.district || "",
    address: initial.address || initial.addressLine1 || "",
    note: initial.note || initial.deliveryNote || "",
  });
  const [errors, setErrors] = useState<any>({});
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }));

  const submit = (event) => {
    event.preventDefault();
    const next: any = {};
    if (!form.fullName.trim()) next.fullName = "Full name is required.";
    if (!form.phone.trim()) next.phone = "Phone number is required.";
    if (!form.city.trim()) next.city = "City is required.";
    if (!form.address.trim()) next.address = "Full address is required.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const payload = {
      ...form,
      customerName: form.fullName,
      customerPhone: form.phone,
      addressLine1: form.address,
      deliveryNote: form.note,
    };
    if (initial.id) updateCustomerAddress(initial.id, payload);
    else saveCustomerAddress(payload);
    onSaved();
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" value={form.fullName} onChange={(v) => set("fullName", v)} error={errors.fullName} required />
      <Field label="Phone number" value={form.phone} onChange={(v) => set("phone", v)} error={errors.phone} required />
      <Field label="Area" value={form.area} onChange={(v) => set("area", v)} />
      <Field label="City" value={form.city} onChange={(v) => set("city", v)} error={errors.city} required />
      <Field label="District" value={form.district} onChange={(v) => set("district", v)} />
      <Field label="Full address" value={form.address} onChange={(v) => set("address", v)} error={errors.address} required className="sm:col-span-2" />
      <Field label="Note (optional)" value={form.note} onChange={(v) => set("note", v)} className="sm:col-span-2" />
      <div className="flex gap-3 sm:col-span-2">
        <button type="submit" className="btn btn-primary">
          {initial.id ? "Update Address" : "Save Address"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------ History ------------------------------ */

function HistoryView({ orders, loading, error, onOpen }) {
  return (
    <Panel title="Order History">
      {loading ? (
        <LoadingRows />
      ) : error ? (
        <ErrorState text={error} />
      ) : orders.length ? (
        <ol className="relative ml-2 border-l border-line">
          {orders.map((o) => (
            <li key={o.id} className="relative py-4 pl-6">
              <span className="absolute -left-[6px] top-6 h-[11px] w-[11px] rounded-full border border-white bg-ink" />
              <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-white p-3 sm:flex-row sm:items-center sm:gap-4">
                <img src={orderImage(o)} alt="" className="h-12 w-12 shrink-0 rounded-[10px] object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{o.productTitle || o.items?.[0]?.title || "Custom order"}</p>
                  <p className="mt-0.5 text-xs text-muted">{orderCode(o.id)} &middot; {shortDate(o.createdAt)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={o.paymentStatus || "unpaid"} />
                  <StatusBadge status={o.status || "pending"} />
                </div>
                <p className="text-[15px] font-semibold text-ink sm:w-20 sm:text-right">{money(o.total, o.currency)}</p>
                <button type="button" onClick={() => onOpen(o)} className="btn btn-secondary btn-sm shrink-0">
                  View Order
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon="history" title="No history yet" text="Your order history will appear here after your first checkout." cta />
      )}
    </Panel>
  );
}

/* ------------------------------ Profile ------------------------------ */

function ProfileView({ profile, setProfile, addresses }) {
  const [form, setForm] = useState({ name: profile.name, phone: profile.phone, photoURL: profile.photoURL });
  const [status, setStatus] = useState({ saving: false, message: "", error: "" });
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }));

  const onPickPhoto = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    set("photoURL", url); // preview only; persistent photo needs a hosted URL
  };

  const save = async () => {
    setStatus({ saving: true, message: "", error: "" });
    try {
      const photo = form.photoURL && form.photoURL.startsWith("http") ? form.photoURL : profile.photoURL || "";
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Your session expired. Please sign in again.");

      await supabase.auth.updateUser({
        data: {
          full_name: form.name || "",
          avatar_url: photo || null,
        },
      });

      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: form.name || "",
          avatar_url: photo || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (error) throw error;
      saveLocalProfile({ phone: form.phone, photoURL: photo });
      setProfile((p) => ({ ...p, name: form.name, phone: form.phone, photoURL: photo || p.photoURL }));
      setStatus({ saving: false, message: "Profile updated.", error: "" });
    } catch (error) {
      setStatus({ saving: false, message: "", error: error.message || "Could not update profile." });
    }
  };

  const defaultAddress = addresses.find((a) => a.isDefault) || addresses[0];

  return (
    <Panel title="Profile Settings">
      <div className="flex items-center gap-4">
        <Avatar profile={{ ...profile, photoURL: form.photoURL }} size="h-16 w-16 text-xl" />
        <label className="btn btn-secondary btn-sm cursor-pointer">
          Change photo
          <input type="file" accept="image/*" onChange={onPickPhoto} className="hidden" />
        </label>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Full name" value={form.name} onChange={(v) => set("name", v)} />
        <Field label="Phone number" value={form.phone} onChange={(v) => set("phone", v)} />
        <Field label="Email (read only)" value={profile.email} onChange={() => {}} readOnly className="sm:col-span-2" />
        <Field label="Photo URL (for a permanent photo)" value={form.photoURL.startsWith("blob:") ? "" : form.photoURL} onChange={(v) => set("photoURL", v)} placeholder="https://..." className="sm:col-span-2" />
      </div>

      {defaultAddress && (
        <p className="mt-4 rounded-[10px] bg-cream px-4 py-3 text-xs text-muted">
          Default address: {[defaultAddress.fullName || defaultAddress.customerName, defaultAddress.address || defaultAddress.addressLine1, defaultAddress.city].filter(Boolean).join(", ")}
        </p>
      )}

      {status.message && <p className="mt-4 text-[15px] font-semibold text-ink">{status.message}</p>}
      {status.error && <p className="mt-4 text-sm font-semibold text-red-600">{status.error}</p>}

      <button type="button" onClick={save} disabled={status.saving} className="btn btn-primary mt-5">
        {status.saving ? <Spinner small /> : null}
        {status.saving ? "Saving..." : "Save Changes"}
      </button>
    </Panel>
  );
}

/* ------------------------------ Modals ------------------------------ */

function OrderDetailModal({ order, onClose }) {
  const items = Array.isArray(order.items) && order.items.length ? order.items : [{ title: order.productTitle, image: orderImage(order), price: order.total, quantity: 1 }];
  const custom = order.customizationDetails && typeof order.customizationDetails === "object" ? Object.entries(order.customizationDetails) : [];
  const files = filesFromOrder(order);
  const addr = order.address || {};

  return (
    <Modal title={`Order ${orderCode(order.id)}`} onClose={onClose}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={order.paymentStatus || "unpaid"} />
          <StatusBadge status={order.status || "pending"} />
          <span className="text-xs text-muted">Placed {shortDate(order.createdAt)}</span>
        </div>

        <div className="rounded-[10px] bg-cream p-4">
          <p className="text-[13px] font-semibold text-muted">Customer</p>
          <p className="mt-1 font-semibold text-ink">{order.customerName || "Customer"}</p>
          <p className="text-xs text-muted">{order.customerEmail}</p>
          <p className="text-xs text-muted">{order.customerPhone || ""}</p>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-semibold text-muted">Items</p>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={item.id || i} className="flex items-center gap-3">
                <ServerCustomizationImage customizationId={item.customizationId} outputPageId={item.mockupOutputRef?.pageId} fallbackSrc={item.image || orderImage(order)} alt={item.title || item.productTitle || "Personalized product"} containerClassName="relative h-12 w-12 shrink-0 overflow-hidden rounded-[10px] bg-cream" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{item.title || item.productTitle}</p>
                  <p className="text-xs text-muted">Qty {item.quantity || 1}</p>
                </div>
                <p className="font-semibold">{money(item.finalPrice || item.price || 0, item.currency || order.currency)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-1 border-t border-line pt-3">
          <Row label="Subtotal" value={money(order.subtotal ?? order.total ?? 0, order.currency)} />
          <Row label="Fulfillment" value={order.deliveryMethod === "store" ? "Store pickup" : "Delivery"} />
          <Row label="Payment" value={order.paymentMethod || "Cash on Delivery"} />
          <Row label="Delivery charge" value={order.deliveryMethod === "store" ? "No charge" : order.deliveryChargeConfirmed ? money(order.deliveryCharge || 0, order.currency) : "Confirmed after review"} />
          <Row label={order.deliveryMethod === "store" || order.deliveryChargeConfirmed ? "Total" : "Order subtotal"} value={money(order.total ?? 0, order.currency)} strong />
        </div>

        {(addr.addressLine1 || addr.city) && (
          <div className="rounded-[10px] bg-cream p-4">
            <p className="text-[13px] font-semibold text-muted">Delivery address</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              {[addr.addressLine1, addr.addressLine2, addr.area, addr.city, addr.postalCode, addr.country].filter(Boolean).join(", ")}
            </p>
          </div>
        )}

        {!!custom.length && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-muted">Personalization</p>
            <div className="grid gap-1">
              {custom.map(([k, v]) => (
                <Row key={k} label={k} value={String(v || "")} />
              ))}
            </div>
          </div>
        )}

        {!!files.length && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-muted">Uploaded files</p>
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <a key={i} href={f.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                  {f.name || `File ${i + 1}`}
                </a>
              ))}
            </div>
          </div>
        )}

        {order.message && (
          <div>
            <p className="mb-1 text-[13px] font-semibold text-muted">Notes</p>
            <p className="text-xs leading-5 text-muted">{order.message}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function designFiles(request) {
  const uploaded = request.uploadedFiles && typeof request.uploadedFiles === "object" ? request.uploadedFiles : {};
  return Object.entries(uploaded)
    .map(([key, value]) => {
      const val: any = value;
      const url = val && typeof val === "object" ? val.signedUrl || val.url || "" : typeof val === "string" ? val : "";
      return url ? { url, name: (val && val.name) || key } : null;
    })
    .filter(Boolean);
}

function RequestDetailModal({ request, onClose }) {
  const details = request.values && typeof request.values === "object"
    ? Object.entries(request.values).filter(([, v]) => typeof v === "string" && v.trim())
    : [];
  const options = request.selectedOptions && typeof request.selectedOptions === "object"
    ? Object.entries(request.selectedOptions).filter(([, v]) => v !== "" && v !== null && v !== undefined)
    : [];
  const files = designFiles(request);
  const editHref = request.productSlug
    ? `/products/${request.productSlug}/personalize?customizationId=${encodeURIComponent(request.id)}`
    : "";

  return (
    <Modal title={`Personalized Design ${designCode(request.id)}`} onClose={onClose}>
      <div className="space-y-5 text-sm">
        <div className="flex items-center gap-3">
          <img src={request.image || orderImage(request)} alt="" className="h-16 w-16 rounded-[10px] object-cover" />
          <div>
            <p className="font-semibold text-ink">{request.productTitle || "Personalized design"}</p>
            <div className="mt-1"><StatusBadge status={designStatusLabel(request.status)} /></div>
          </div>
        </div>

        {!!details.length && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-muted">Your details</p>
            <div className="grid gap-1">{details.map(([k, v]) => <Row key={k} label={k} value={String(v || "")} />)}</div>
          </div>
        )}

        {!!options.length && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-muted">Options</p>
            <div className="grid gap-1">{options.map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}</div>
          </div>
        )}

        {!!files.length && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-muted">Your files</p>
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <a key={i} href={f.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">{f.name || `File ${i + 1}`}</a>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 border-t border-line pt-4">
          {editHref && (
            <Link href={editHref} className="btn btn-primary btn-sm">Continue editing</Link>
          )}
          <Link href="/contact" className="btn btn-secondary btn-sm">Request help</Link>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------ Shared UI ------------------------------ */

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/45 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-[560px] flex-col rounded-t-[20px] bg-white sm:rounded-[10px]">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 className="font-display text-[1.5rem] font-medium leading-tight text-ink">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-cream">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function Panel({ title, actionLabel, onAction, children }: any) {
  return (
    <section className="rounded-[10px] border border-line bg-white p-5 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-[1.6rem] font-medium leading-tight text-ink">{title}</h2>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="group inline-flex min-h-9 items-center gap-1 px-2 text-[13px] font-semibold text-ink underline-offset-4 hover:underline">
            {actionLabel} <Arrow />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, error, required, readOnly, placeholder, className = "" }: any) {
  return (
    <label className={`block text-xs font-semibold text-muted ${className}`}>
      <span className="mb-1.5 block">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder={placeholder}
        className={`h-11 w-full rounded-[10px] border bg-white px-3.5 text-sm font-medium text-ink outline-none transition placeholder:font-normal placeholder:text-muted focus:border-ink/40 ${
          error ? "border-red-300" : "border-line hover:border-ink/40"
        } ${readOnly ? "cursor-not-allowed bg-cream" : ""}`}
      />
      {error && <span className="mt-1 block text-[11px] font-semibold text-red-500">{error}</span>}
    </label>
  );
}

function Row({ label, value, strong }: any) {
  return (
    <p className={`flex justify-between gap-3 ${strong ? "text-base font-semibold" : "text-xs"}`}>
      <span className="capitalize text-muted">{label}</span>
      <span className={strong ? "text-ink" : "font-semibold text-ink"}>{value}</span>
    </p>
  );
}

function Avatar({ profile, size }) {
  if (profile.photoURL) {
    return <img src={profile.photoURL} alt={profile.name || "User"} referrerPolicy="no-referrer" className={`${size} rounded-full object-cover`} />;
  }
  return <span className={`${size} grid place-items-center rounded-full bg-cream font-semibold text-ink`}>{initials(profile.name || profile.email)}</span>;
}

function LoadingRows() {
  return (
    <div className="space-y-3 py-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-[10px] bg-cream" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/2 animate-pulse rounded bg-cream" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-cream" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon = "folder", title, text, cta, linkLabel, linkHref, action }: any) {
  return (
    <div className="grid place-items-center rounded-[10px] bg-cream px-4 py-9 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-cream text-ink">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      {title && <p className="mt-4 text-[15px] font-semibold text-ink">{title}</p>}
      <p className="mt-1 max-w-[360px] text-sm leading-6 text-muted">{text}</p>
      {cta && (
        <Link href="/products" className="btn btn-primary btn-sm mt-4">
          Shop new designs
        </Link>
      )}
      {linkLabel && linkHref && (
        <Link href={linkHref} className="group mt-3 inline-flex min-h-9 items-center gap-1 text-[14px] font-semibold text-ink underline-offset-4 hover:underline">
          {linkLabel} <Arrow />
        </Link>
      )}
      {action && (
        <button type="button" onClick={action.onClick} className="btn btn-secondary btn-sm mt-4">
          {action.label}
        </button>
      )}
    </div>
  );
}

function ErrorState({ text }) {
  return <p className="rounded-[10px] bg-red-50 px-4 py-4 text-sm font-semibold text-red-600">{text}</p>;
}

function Spinner({ small }: any) {
  return <span className={`inline-block animate-spin rounded-full border border-current border-t-transparent ${small ? "h-4 w-4" : "h-5 w-5"}`} aria-hidden="true" />;
}

function Arrow() {
  return <RightArrowIcon className="group-hover:translate-x-1" />;
}

function BranchIcon({ className = "h-6 w-6" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M5 19c6.5-3.1 10.6-8 12-14" />
      <path d="M12 13c-3.2-.2-5.2-1.5-6-4" />
      <path d="M14 10c3.1.1 5.1-1 6-3.4" />
      <path d="M9 16c-2.7.2-4.6 1.2-5.7 3" />
    </svg>
  );
}

function StatusBadge({ status }) {
  const s = String(status || "").toLowerCase();
  let tone = "bg-cream text-ink";
  if (["paid", "completed", "delivered", "approved", "active", "customer approved"].includes(s)) tone = "bg-ink text-white";
  else if (["cancelled", "refunded"].includes(s)) tone = "border border-line bg-white text-ink";
  else if (["pending", "processing", "unpaid", "printing", "new", "ready for delivery", "in design review"].some((x) => s.includes(x))) tone = "bg-cream text-ink";
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${tone}`}>{String(status || "pending").replaceAll("-", " ")}</span>;
}

function Icon({ name, className = "h-5 w-5" }) {
  const base: any = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
  switch (name) {
    case "home":
      return <svg {...base}><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></svg>;
    case "bag":
      return <svg {...base}><path d="M6 8h12l1 13H5L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>;
    case "edit":
      return <svg {...base}><path d="m4 20 4-1 11-11a2.2 2.2 0 0 0-3.1-3.1L5 16l-1 4Z" /><path d="m14.5 6.5 3 3" /></svg>;
    case "heart":
      return <svg {...base}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z" /></svg>;
    case "pin":
      return <svg {...base}><path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10Z" /><circle cx="12" cy="11" r="2.2" /></svg>;
    case "folder":
      return <svg {...base}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg>;
    case "history":
      return <svg {...base}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></svg>;
    case "settings":
      return <svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a8 8 0 0 0 .1-6l-2.2-.7-1-2.2 1-2A9 9 0 0 0 12 3L11 5.2 8.6 6.1 6.4 5.2A8.6 8.6 0 0 0 3.7 10l1.8 1.6v.8L3.7 14A8.6 8.6 0 0 0 6.4 18.8l2.2-.9 2.4.9L12 21a9 9 0 0 0 5.3-1.1l-1-2 1-2.2Z" /></svg>;
    case "logout":
      return <svg {...base}><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M14 4h5v16h-5" /></svg>;
    case "close":
      return <svg {...base}><path d="m6 6 12 12" /><path d="m18 6-12 12" /></svg>;
    default:
      return <svg {...base}><circle cx="12" cy="12" r="8" /></svg>;
  }
}
