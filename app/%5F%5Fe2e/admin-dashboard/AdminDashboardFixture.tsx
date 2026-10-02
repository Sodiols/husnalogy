"use client";

/**
 * Mounts the REAL admin dashboard on deterministic data.
 *
 * `window.fetch` is wrapped before the dashboard mounts so every `/api/admin/*`
 * request is answered from the in-memory store below. Writes succeed and update
 * the store, so flows such as status changes and deletes can be exercised end
 * to end without touching any database. Every other request passes through.
 */

import { useEffect, useState } from "react";

import AdminDashboardClient from "@/app/admin/dashboard/admin-dashboard-client";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();
const IMAGES = [
  "/images/invitations.png",
  "/images/weddings.png",
  "/images/birthdays.png",
  "/images/gifts.png",
  "/images/giftsForHer.png",
  "/images/personalizedGifts.png",
];

function buildStore() {
  const collections = [
    { id: "col-ivory", name: "Ivory Bloom Suite", slug: "ivory-bloom", parentCollectionId: null, isTrendingWedding: true, isSuite: true, createdAt: daysAgo(40) },
    { id: "col-ivory-rsvp", name: "Ivory Bloom RSVP Cards", slug: "ivory-bloom-rsvp", parentCollectionId: "col-ivory", isTrendingWedding: false, isSuite: false, createdAt: daysAgo(38) },
    { id: "col-ivory-menu", name: "Ivory Bloom Menus", slug: "ivory-bloom-menus", parentCollectionId: "col-ivory", isTrendingWedding: false, isSuite: false, createdAt: daysAgo(30) },
    { id: "col-nikah", name: "Nikah Classics", slug: "nikah-classics", parentCollectionId: null, isTrendingWedding: false, isSuite: false, createdAt: daysAgo(20) },
  ];

  const titles = [
    ["Ivory Bloom Wedding Invitation", "Invitations", "invitation", "col-ivory"],
    ["Ivory Bloom RSVP Card", "Invitations", "rsvp", "col-ivory-rsvp"],
    ["Golden Crescent Nikah Card", "Nikah", "invitation", "col-nikah"],
    ["Botanical Save the Date", "Save the Dates", "save-the-date", ""],
    ["Personalized Keepsake Box", "Gifts", "gift", ""],
    ["Birthday Celebration Card with an Unusually Long Product Title", "Birthdays", "card", ""],
    ["Minimal Thank You Card", "Cards", "card", "col-ivory-menu"],
  ];

  const products = titles.map(([title, category, productType, collectionId], index) => ({
    id: `prod-${index + 1}`,
    slug: String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title,
    sku: `HSN-${1000 + index}`,
    category,
    productType,
    status: index === 3 ? "draft" : index === 5 ? "hidden" : "active",
    visibility: index === 5 ? "direct" : "public",
    price: 450 + index * 175,
    salePrice: index % 3 === 0 ? 400 + index * 150 : null,
    oldPrice: index % 3 === 0 ? 450 + index * 175 : null,
    currency: "BDT",
    images: [IMAGES[index % IMAGES.length]],
    collectionIds: collectionId ? [collectionId] : [],
    stock: index === 4 ? 2 : 50,
    isStockOut: index === 6,
    comingInDays: index === 6 ? 5 : null,
    isFeatured: index === 0,
    isNew: index === 1,
    isBestSeller: index === 2,
    customization: index < 3 ? { enabled: true } : null,
    createdAt: daysAgo(index * 4 + 1),
    reviews:
      index < 3
        ? [
            { id: `rev-${index}-a`, name: "Nusrat Jahan", email: "nusrat@example.com", rating: 5, text: "The paper quality is beautiful and the gold foil looked even better in person. Guests kept asking where we ordered from.", status: "published", verifiedPurchase: true, createdAt: daysAgo(index + 1) },
            { id: `rev-${index}-b`, name: "Arif Hossain", email: "arif@example.com", rating: 4, text: "Lovely design, delivery took a day longer than expected.", status: index === 1 ? "flagged" : "published", verifiedPurchase: index !== 2, createdAt: daysAgo(index + 9) },
          ]
        : [],
  }));

  const statuses = ["pending", "confirmed", "in design review", "proof sent", "printing", "delivered", "pending", "cancelled"];
  const names = ["Tahsin Rahman", "Mehjabin Chowdhury", "Sadia Islam", "Rafiq Ahmed", "Farhana Akter", "Imran Kabir", "Lamia Haque", "Zubair Hasan"];
  const orders = statuses.map((status, index) => {
    const product = products[index % products.length];
    const subtotal = Number(product.salePrice ?? product.price) * (index + 1) * 10;
    const confirmed = index % 2 === 0;
    return {
      id: `7f3c${index}a12-4b5d-4e6f-9a0b-1c2d3e4f5a6${index}`,
      customerName: names[index],
      customerEmail: `${names[index].split(" ")[0].toLowerCase()}@example.com`,
      customerPhone: `+880 1711 00${index}${index}${index}`,
      productTitle: product.title,
      productSlug: product.slug,
      status,
      paymentStatus: status === "delivered" ? "paid" : "unpaid",
      paymentMethod: "Cash on Delivery",
      deliveryMethod: index === 3 ? "store" : "delivery",
      deliveryCharge: confirmed ? 120 : 0,
      deliveryChargeConfirmed: confirmed,
      subtotal,
      total: subtotal + (confirmed ? 120 : 0),
      currency: "BDT",
      createdAt: daysAgo(index * 0.8),
      address: { addressLine1: "House 12, Road 5", city: "Dhaka", area: "Dhanmondi", postalCode: "1205", country: "Bangladesh", deliveryNote: index === 0 ? "Please call before delivery." : "" },
      items: [
        {
          id: `item-${index}`,
          productId: product.id,
          productTitle: product.title,
          finalPrice: subtotal,
          currency: "BDT",
          selectedOptions: { paperStyle: "Cotton 600gsm", quantity: (index + 1) * 10 },
          customizationValues: index < 4 ? { brideName: "Ayesha", groomName: "Karim", eventDate: "12 December 2026", venue: "Radisson Blu, Dhaka" } : {},
        },
      ],
    };
  });

  const messages = [
    { id: "msg-1", name: "Ayesha Siddiqua", email: "ayesha@example.com", phone: "+880 1811 223344", subject: "Bulk order for a corporate event", message: "Hello! We would like to order 300 personalized cards for our company anniversary. Could you share pricing and lead time?\n\nThank you.", status: "new", createdAt: daysAgo(0.2) },
    { id: "msg-2", name: "Kamal Uddin", email: "kamal@example.com", subject: "Delivery outside Dhaka", message: "Do you deliver to Chattogram? I need invitations by next month.", status: "read", createdAt: daysAgo(2) },
    { id: "msg-3", name: "Rumana Afroz", email: "rumana@example.com", subject: "Proof revision", message: "Thanks for the proof — could we change the font for the names to something more classic?", status: "replied", createdAt: daysAgo(6) },
  ];

  const deletedProducts = [
    { id: "del-1", title: "Vintage Lace Invitation", slug: "vintage-lace-invitation", category: "Invitations", images: [IMAGES[1]], status: "deleted", deletedAt: daysAgo(3) },
  ];

  const settings = {
    branding: { logoUrl: "/Brand Kit/Logo-5.png", faviconUrl: "" },
    adminProfile: { fullName: "Husnalogy Admin", email: "admin@example.com", role: "Administrator", photoUrl: "" },
    preferences: { allowProductReviews: true, newsletterEnabled: true, maintenanceMode: false },
    security: { sessionTimeoutMinutes: 60, twoStepVerificationEnabled: false, twoStepVerificationSupported: false, allowedRoles: ["Administrator"] },
    notifications: { newOrders: true, newMessages: true, lowStockProducts: true, newsletterSubscribers: false },
  };

  return { products, deletedProducts, collections, orders, messages, subscribers: [] as any[], settings };
}

type Store = ReturnType<typeof buildStore>;

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

async function readBody(init?: RequestInit) {
  try {
    return typeof init?.body === "string" ? JSON.parse(init.body) : {};
  } catch {
    return {};
  }
}

function installMock(store: Store) {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    const path = url.pathname;
    const method = (init?.method || "GET").toUpperCase();
    if (!path.startsWith("/api/admin")) return realFetch(input, init);

    await new Promise((resolve) => setTimeout(resolve, 150));
    const body = await readBody(init);
    const parts = path.split("/").filter(Boolean); // api, admin, resource, id, action

    if (path === "/api/admin/products" && method === "GET") return json({ products: store.products });
    if (path === "/api/admin/products/deleted") return json({ products: store.deletedProducts });
    if (parts[2] === "products" && parts[4] === "restore") {
      const item = store.deletedProducts.find((product) => product.id === parts[3]);
      store.deletedProducts = store.deletedProducts.filter((product) => product.id !== parts[3]);
      if (item) store.products.unshift({ ...(store.products[0] as any), ...item, status: "draft", reviews: [] });
      return json({ ok: true });
    }
    if (parts[2] === "products" && parts[4] === "permanent-delete") {
      store.deletedProducts = store.deletedProducts.filter((product) => product.id !== parts[3]);
      return json({ ok: true });
    }
    if (parts[2] === "products" && parts[4] === "reviews") {
      store.products = store.products.map((product) => ({ ...product, reviews: product.reviews.filter((review) => review.id !== parts[5]) }));
      return json({ ok: true });
    }
    if (parts[2] === "products" && parts[3] && method === "DELETE") {
      const item = store.products.find((product) => product.id === parts[3]);
      store.products = store.products.filter((product) => product.id !== parts[3]);
      if (item) store.deletedProducts.unshift({ ...item, status: "deleted", deletedAt: new Date().toISOString() } as any);
      return json({ ok: true });
    }

    if (path === "/api/admin/collections") {
      if (method === "GET") return json({ collections: store.collections });
      if (method === "DELETE") {
        store.collections = store.collections.filter((collection) => collection.id !== body.id);
        return json({ ok: true });
      }
      if (method === "PATCH" && body.id) {
        store.collections = store.collections.map((collection) => (collection.id === body.id ? { ...collection, ...body } : collection));
        return json({ collection: store.collections.find((collection) => collection.id === body.id) });
      }
      const created = { id: `col-${Date.now()}`, slug: String(body.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"), createdAt: new Date().toISOString(), ...body, parentCollectionId: body.parentCollectionId || null };
      store.collections.push(created);
      return json({ collection: created });
    }

    if (path === "/api/admin/order-requests") return json({ orders: store.orders });
    if (parts[2] === "order-requests" && parts[3]) {
      if (method === "DELETE") store.orders = store.orders.filter((order) => order.id !== parts[3]);
      else
        store.orders = store.orders.map((order) =>
          order.id === parts[3]
            ? {
                ...order,
                ...(body.status ? { status: body.status } : {}),
                ...(body.deliveryCharge !== undefined
                  ? { deliveryCharge: body.deliveryCharge, deliveryChargeConfirmed: true, total: order.subtotal + Number(body.deliveryCharge) }
                  : {}),
              }
            : order
        );
      return json({ ok: true });
    }

    if (path === "/api/admin/contact-messages") return json({ messages: store.messages });
    if (parts[2] === "contact-messages" && parts[3]) {
      if (method === "DELETE") store.messages = store.messages.filter((message) => message.id !== parts[3]);
      else store.messages = store.messages.map((message) => (message.id === parts[3] ? { ...message, ...body } : message));
      return json({ ok: true });
    }

    if (path === "/api/admin/newsletter") return json({ subscribers: store.subscribers });
    if (path === "/api/admin/newsletter/campaigns") return json({ campaigns: [] });

    if (path === "/api/admin/settings") {
      if (method === "PUT") store.settings = { ...store.settings, ...body };
      return json({ settings: store.settings, admin: { email: "admin@example.com" } });
    }

    if (path === "/api/admin/hero-collections") return json({ collections: [] });
    if (path === "/api/admin/hero-collections/resolve") return json({ resolved: null });
    if (path === "/api/admin/customizer/assets") return json({ ok: true, assets: [], categories: [], folders: [] });
    if (path === "/api/admin/logout") return json({ ok: true });

    return json({ ok: true });
  };

  return () => {
    window.fetch = realFetch;
  };
}

export default function AdminDashboardFixture() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const restore = installMock(buildStore());
    setReady(true);
    return restore;
  }, []);

  if (!ready) return null;
  return <AdminDashboardClient basePath="/__e2e/admin-dashboard" />;
}
