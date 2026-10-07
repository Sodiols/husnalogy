"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import ProductUploadForm from "./product-upload-form";
import HeroCollectionSection from "./hero-collection-section";
import ElementsLibrarySection from "./elements-library-section";
import { formatCurrency as formatMoneyValue } from "@/lib/currency";
import { BUSINESS_INFO, LAUNCH_FEATURES, ORDER_POLICY } from "@/lib/launch-config";

const sections = [
  "Overview",
  "Products",
  "Product Reviews",
  "Collections",
  "Home Hero",
  "Elements Library",
  "Order Requests",
  "Contact Messages",
  "Recently Deleted",
  "Settings",
];

const navGroups = [
  {
    title: "overview",
    items: [{ section: "Overview", label: "Dashboard", icon: "home" }],
  },
  {
    title: "Sales",
    items: [{ section: "Order Requests", label: "Order Requests", icon: "calendar" }],
  },
  {
    title: "Catalog",
    items: [
      { section: "Products", label: "Products", icon: "box" },
      { section: "Product Reviews", label: "Product Reviews", icon: "star" },
      { section: "Collections", label: "Collections", icon: "grid" },
      { section: "Home Hero", label: "Home Hero", icon: "image" },
      { section: "Elements Library", label: "Elements Library", icon: "star" },
    ],
  },
  {
    title: "Customers",
    items: [
      { section: "Contact Messages", label: "Contact Messages", icon: "mail" },
    ],
  },
  {
    title: "System",
    items: [
      { section: "Recently Deleted", label: "Recently Deleted", icon: "trash" },
      { section: "Settings", label: "Settings", icon: "settings" },
    ],
  },
];

const sectionDetails = {
  Overview: {
    description: "Review orders, messages, stock, and content that needs attention.",
    searchPlaceholder: "Search products, orders, messages...",
  },
  Products: {
    description: "Create, edit, duplicate, and publish storefront products.",
    searchPlaceholder: "Search products by name, slug, or SKU...",
  },
  "Product Reviews": {
    description: "Moderate customer reviews across all products.",
    searchPlaceholder: "Search reviews by text, product, reviewer, or email...",
  },
  Collections: {
    description: "Create, edit, and curate storefront product collections.",
    searchPlaceholder: "Search collections...",
  },
  "Home Hero": {
    description: "Manage the featured collection shown in the homepage hero section.",
    searchPlaceholder: "",
  },
  "Elements Library": {
    description: "Upload and manage decorative elements customers can add to their designs.",
    searchPlaceholder: "",
  },
  "Order Requests": {
    description: "Track customer order requests from submission to delivery.",
    searchPlaceholder: "Search by order ID, customer, email...",
  },
  "Contact Messages": {
    description: "Read, reply to, and archive customer inquiries.",
    searchPlaceholder: "Search messages...",
  },
  "Newsletter Subscribers": {
    description: "Manage newsletter signups and exportable subscriber records.",
    searchPlaceholder: "Search subscribers by email...",
  },
  "Recently Deleted": {
    description: "Restore deleted products or remove them permanently.",
    searchPlaceholder: "Search recently deleted products...",
  },
  Settings: {
    description: "Update store profile, launch payment, delivery, and security settings.",
    searchPlaceholder: "Search products, orders, messages...",
  },
};

const sectionTips = {
  Overview: [
    "The cards at the top are live totals for your store. Click any card to jump straight to that page.",
    "New orders and messages also appear under the bell icon in the top bar, so you never miss them.",
  ],
  Products: [
    "Click \"Add product\" to create a new product. The form shows what is still needed before you can publish, and drafts stay hidden from customers.",
    "Use the tabs to see published products, drafts or hidden ones. On each card, Edit opens the form; the other buttons copy the product, open it on your website, or delete it.",
    "Deleted products are never lost right away — they move to Recently Deleted, where you can restore them.",
  ],
  "Product Reviews": [
    "Click any review in the list to see its full details on the right side.",
    "Use the dropdowns above the list to narrow reviews by rating, status, or product type.",
  ],
  Collections: [
    "Collections group products together on your website — for example, one wedding suite.",
    "Use \"Add Child\" to place child collections (like RSVP cards) inside a main collection.",
    "The Trending Wedding and Suite toggles next to each name control where a collection is featured on the website.",
  ],
  "Home Hero": [
    "This controls the big collection section at the top of your homepage.",
    "The homepage shows the collection that is both Active and Featured. Featuring a new one automatically unfeatures the previous one.",
    "Images, product links and the item count come from the selected source collection automatically.",
  ],
  "Order Requests": [
    "Click an order in the list to open its full details on the right.",
    "Move an order forward with the \"Move order to\" buttons — the steps run in order, from Pending all the way to Delivered.",
    "The pills above the list show how many orders sit in each step. Click one to see only those orders.",
  ],
  "Contact Messages": [
    "Click a message to read it in full on the right side.",
    "Use the small status dropdown on each message to mark it as read, replied, or archived — that is how you keep your inbox tidy.",
  ],
  "Newsletter Subscribers": [
    "Everyone who signs up for your newsletter on the website appears here automatically.",
    "Use the search box to check whether a specific email address is subscribed.",
  ],
  "Recently Deleted": [
    "Deleted products are kept here as a safety net instead of disappearing right away.",
    "Restore returns a product to your catalog as a draft. Permanent delete asks for the permission email and password, and cannot be undone.",
  ],
  Settings: [
    "Pick a settings group on the left, make your changes, then press the Save button inside that panel.",
    "Nothing is applied until you press Save — feel free to look around.",
  ],
};

const productStatuses = ["draft", "active", "hidden"];
const orderStatuses = ["pending", "confirmed", "in design review", "proof sent", "customer approved", "printing", "ready for delivery", "delivered", "cancelled"];
const messageStatuses = ["new", "read", "replied", "archived"];

const emptyCollection = {
  name: "",
  parentCollectionId: "",
  isTrendingWedding: false,
  isSuite: false,
};

async function fetchAdminJson(label, url) {
  const response = await fetch(url, { cache: "no-store" });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(`${label} load failed.`);
  return { label, data };
}

export default function AdminDashboardClient({ basePath = "/admin/dashboard" }: { basePath?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get("section") || "Overview";
  const initialSection = requestedSection === "Categories" ? "Collections" : requestedSection;
  const [activeSection, setActiveSection] = useState(sections.includes(initialSection) ? initialSection : "Overview");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [products, setProducts] = useState([]);
  const [deletedProducts, setDeletedProducts] = useState([]);
  const [productCollections, setProductCollections] = useState([]);
  const [orders, setOrders] = useState([]);
  const [messages, setMessages] = useState([]);
  const [subscribers, setSubscribers] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [collectionForm, setCollectionForm] = useState(emptyCollection);
  const [editingCollectionId, setEditingCollectionId] = useState(null);
  const [collectionFormOpen, setCollectionFormOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [productStatusFilter, setProductStatusFilter] = useState("");
  const [reviewQuery, setReviewQuery] = useState("");
  const [collectionQuery, setCollectionQuery] = useState("");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [messageQuery, setMessageQuery] = useState("");
  const [messageStatus, setMessageStatus] = useState("");
  const [subscriberQuery, setSubscriberQuery] = useState("");
  const [deletedQuery, setDeletedQuery] = useState("");
  const [globalQuery, setGlobalQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const noticeTimerRef = useRef(0);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmWorking, setConfirmWorking] = useState(false);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);
  const [permanentDeleteCredentials, setPermanentDeleteCredentials] = useState({ email: "", password: "" });
  const [permanentDeleteWorking, setPermanentDeleteWorking] = useState(false);

  const overview = useMemo(
    () => ({
      products: products.filter((item) => item.status !== "deleted").length,
      activeProducts: products.filter((item) => item.status === "active").length,
      collections: productCollections.length,
      newOrders: orders.filter((item) => ["pending", "new"].includes(item.status)).length,
      newMessages: messages.filter((item) => item.status === "new").length,
      subscribers: subscribers.length,
    }),
    [products, productCollections, orders, messages, subscribers]
  );

  const recentNotifications = useMemo(() => {
    const orderItems = orders
      .filter((order) => !["delivered", "cancelled"].includes(String(order.status || "").toLowerCase()))
      .slice(0, 5)
      .map((order) => ({
        id: `order-${order.id}`,
        title: `New order from ${order.customerName || "Customer"}`,
        detail: `${order.productTitle || "Custom order"} | ${formatCurrency(order.total || 0, order.currency)}`,
        section: "Order Requests",
      }));

    const messageItems = messages
      .filter((message) => message.status === "new")
      .slice(0, 3)
      .map((message) => ({
        id: `message-${message.id}`,
        title: `New message from ${message.name || "Customer"}`,
        detail: message.subject || message.email || "Contact message",
        section: "Contact Messages",
      }));

    return [...orderItems, ...messageItems];
  }, [orders, messages]);

  const navBadges = {
    "Order Requests": overview.newOrders,
    "Product Reviews": products.reduce((count, product) => count + (Array.isArray(product.reviews) ? product.reviews.length : 0), 0),
    "Contact Messages": overview.newMessages,
  };


  const filteredProducts = products.filter((product) => {
    const haystack = [
      product.title,
      product.slug,
      product.sku,
      product.id,
      product.category,
      ...(Array.isArray(product.tags) ? product.tags : []),
    ]
      .join(" ")
      .toLowerCase();

    if (productQuery && !haystack.includes(productQuery.toLowerCase())) return false;
    if (productStatusFilter && product.status !== productStatusFilter) return false;
    return true;
  });

  const filteredDeletedProducts = deletedProducts.filter((product) => {
    const haystack = [
      product.title,
      product.slug,
      product.sku,
      product.id,
    ]
      .join(" ")
      .toLowerCase();

    return !deletedQuery || haystack.includes(deletedQuery.toLowerCase());
  });

  const filteredMessages = messages.filter((message) => {
    const haystack = [message.name, message.email, message.phone, message.subject, message.message, message.status]
      .join(" ")
      .toLowerCase();
    if (messageQuery && !haystack.includes(messageQuery.toLowerCase())) return false;
    if (messageStatus && message.status !== messageStatus) return false;
    return true;
  });

  const filteredSubscribers = subscribers.filter((subscriber) => {
    const haystack = [subscriber.email, subscriber.source, subscriber.status, subscriber.createdAt]
      .join(" ")
      .toLowerCase();
    return !subscriberQuery || haystack.includes(subscriberQuery.toLowerCase());
  });

  const showNotice = (message) => {
    setNotice(message);
    setError("");
    // Restart the timer so a new notice is never cut short by an older one.
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 3500);
  };

  const showError = (message) => {
    setError(message);
    setNotice("");
  };

  const setSearchForSection = (section, value) => {
    if (section === "Products") setProductQuery(value);
    if (section === "Product Reviews") setReviewQuery(value);
    if (section === "Collections") setCollectionQuery(value);
    if (section === "Order Requests") setOrderQuery(value);
    if (section === "Contact Messages") setMessageQuery(value);
    if (section === "Newsletter Subscribers") setSubscriberQuery(value);
    if (section === "Recently Deleted") setDeletedQuery(value);
  };

  const findGlobalSearchTarget = (value) => {
    const query = String(value || "").trim().toLowerCase();
    if (!query) return null;

    const reviewMatches = products.reduce((count, product) => {
      if (!Array.isArray(product.reviews)) return count;
      return count + product.reviews.filter((review) =>
        includesSearch([review.text, review.comment, review.name, review.customerEmail, review.email, product.title, product.slug], query)
      ).length;
    }, 0);

    const targets = [
      {
        section: "Products",
        count: products.filter((product) => includesSearch([product.title, product.slug, product.sku, product.category, product.theme], query)).length,
      },
      { section: "Product Reviews", count: reviewMatches },
      {
        section: "Order Requests",
        count: orders.filter((order) =>
          includesSearch([order.id, order.productTitle, order.customerName, order.customerEmail, order.customerPhone, order.message], query)
        ).length,
      },
      {
        section: "Contact Messages",
        count: messages.filter((message) => includesSearch([message.name, message.email, message.phone, message.subject, message.message], query)).length,
      },
      {
        section: "Collections",
        count: productCollections.filter((collection) => includesSearch([collection.name, collection.slug, collection.description], query)).length,
      },
      {
        section: "Recently Deleted",
        count: deletedProducts.filter((product) => includesSearch([product.title, product.slug, product.sku, product.id], query)).length,
      },
    ];

    return targets.sort((a, b) => b.count - a.count)[0];
  };

  const loadData = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }

    try {
      const results = await Promise.allSettled([
        fetchAdminJson("Products", "/api/admin/products"),
        fetchAdminJson("Deleted products", "/api/admin/products/deleted"),
        fetchAdminJson("Collections", "/api/admin/collections"),
        fetchAdminJson("Orders", "/api/admin/order-requests"),
        fetchAdminJson("Messages", "/api/admin/contact-messages"),
        fetchAdminJson("Subscribers", "/api/admin/newsletter"),
      ]);
      const [productsData, deletedProductsData, collectionsData, ordersData, messagesData, subscribersData] = results.map((result) =>
        result.status === "fulfilled" ? result.value.data : null
      );
      const failedSections = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message)
        .filter(Boolean);

      if (productsData) setProducts((productsData.products || []).filter((product) => product.status !== "deleted"));
      if (deletedProductsData) setDeletedProducts(deletedProductsData.products || []);
      if (collectionsData) setProductCollections(collectionsData.collections || []);
      if (ordersData) setOrders(ordersData.orders || []);
      if (messagesData) setMessages(messagesData.messages || []);
      if (subscribersData) setSubscribers(subscribersData.subscribers || []);

      if (!silent && failedSections.length) {
        showError(`${failedSections.join(" ")} Other dashboard data loaded where available.`);
      }
    } catch (loadError) {
      if (!silent) showError(loadError.message || "Could not load dashboard data.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const refresh = window.setInterval(() => loadData(true), 30000);
    return () => window.clearInterval(refresh);
  }, []);

  // The off-canvas sidebar is modal on small screens: lock the page behind it,
  // and let Escape close it (and the notifications popover) from anywhere.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen && !notificationsOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setSidebarOpen(false);
      setNotificationsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen, notificationsOpen]);

  const changeSection = (section) => {
    if (section !== activeSection) window.scrollTo({ top: 0 });
    setActiveSection(section);
    setSidebarOpen(false);
    setNotificationsOpen(false);
    router.replace(`${basePath}?section=${encodeURIComponent(section)}`);
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const handleGlobalSearch = (value) => {
    setGlobalQuery(value);
    setSearchForSection(activeSection, value);
  };

  const submitGlobalSearch = (event) => {
    event.preventDefault();
    const query = String(activeSearchValue || "").trim();
    if (!query || !["Overview", "Settings"].includes(activeSection)) return;

    const target = findGlobalSearchTarget(query);
    if (!target || target.count === 0) {
      showNotice(`No admin records found for "${query}".`);
      return;
    }

    setSearchForSection(target.section, query);
    changeSection(target.section);
    showNotice(`Showing ${target.count.toLocaleString()} result${target.count === 1 ? "" : "s"} in ${target.section}.`);
  };

  const clearActiveFilters = () => {
    setGlobalQuery("");
    setSearchForSection(activeSection, "");
    if (activeSection === "Products") setProductStatusFilter("");
    if (activeSection === "Order Requests") setOrderStatus("");
    if (activeSection === "Contact Messages") setMessageStatus("");
    showNotice(`${activeLabel} filters cleared.`);
  };

  const handleProductSaved = async (_product, message, meta: { source?: string } = {}) => {
    // A Design Studio save (draft save, or the save before a template
    // publication) must keep the product form — and the studio inside it —
    // mounted until its own sequence finishes. Only footer saves close it.
    if (meta?.source === "studio") {
      // Silent: a non-silent refresh swaps the section for a spinner, which
      // would unmount the studio just as surely as closing the form.
      await loadData(true);
      return;
    }
    setEditingProduct(null);
    setProductFormOpen(false);
    await loadData();
    showNotice(message || "Product saved.");
  };

  const closeProductForm = () => {
    setEditingProduct(null);
    setProductFormOpen(false);
  };

  const editProduct = (product) => {
    setEditingProduct(product);
    setProductFormOpen(true);
    changeSection("Products");
  };

  const duplicateProduct = (product) => {
    setEditingProduct({
      ...product,
      id: null,
      slug: "",
      title: `${product.title || "Product"} Copy`,
      status: "draft",
    });
    setProductFormOpen(true);
    changeSection("Products");
  };

  const requestDeleteConfirm = ({ title, message, confirmLabel = "Delete", onConfirm }) => {
    setConfirmDialog({ title, message, confirmLabel, onConfirm });
  };

  const closeConfirmDialog = () => {
    if (confirmWorking) return;
    setConfirmDialog(null);
  };

  const runConfirmedAction = async () => {
    if (!confirmDialog?.onConfirm) return;
    setConfirmWorking(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirmWorking(false);
    }
  };

  const removeProduct = (id) => {
    requestDeleteConfirm({
      title: "Delete product?",
      message: "This moves the product out of the live catalog. You can restore it later from Recently Deleted.",
      confirmLabel: "Delete product",
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/admin/products/${id}`, { method: "DELETE" });
          if (!response.ok) throw new Error("Product could not be deleted.");
          await loadData();
          showNotice("Product deleted.");
        } catch (deleteError) {
          showError(deleteError.message || "Product could not be deleted.");
        }
      },
    });
  };

  const removeProductReview = (productId, reviewId) => {
    requestDeleteConfirm({
      title: "Delete review?",
      message: "This removes the customer review from the product permanently.",
      confirmLabel: "Delete review",
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/admin/products/${productId}/reviews/${reviewId}`, { method: "DELETE" });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
            throw new Error(firstError || "Review could not be deleted.");
          }
          await loadData();
          showNotice("Review deleted.");
        } catch (deleteError) {
          showError(deleteError.message || "Review could not be deleted.");
        }
      },
    });
  };

  const restoreProductItem = async (id) => {
    try {
      const response = await fetch(`/api/admin/products/${id}/restore`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Product could not be restored.");
      await loadData();
      showNotice("Product restored as draft.");
    } catch (restoreError) {
      showError(restoreError.message || "Product could not be restored.");
    }
  };

  const permanentlyDeleteProductItem = (id) => {
    const product = deletedProducts.find((item) => item.id === id) || { id };
    setPermanentDeleteCredentials({ email: "", password: "" });
    setPermanentDeleteTarget(product);
  };

  const closePermanentDeleteDialog = () => {
    if (permanentDeleteWorking) return;
    setPermanentDeleteTarget(null);
    setPermanentDeleteCredentials({ email: "", password: "" });
  };

  const runPermanentDelete = async () => {
    if (!permanentDeleteTarget?.id || !permanentDeleteCredentials.email || !permanentDeleteCredentials.password) return;
    setPermanentDeleteWorking(true);
    try {
      const response = await fetch(`/api/admin/products/${permanentDeleteTarget.id}/permanent-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(permanentDeleteCredentials),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Product could not be permanently deleted.");
      }
      await loadData();
      setPermanentDeleteTarget(null);
      setPermanentDeleteCredentials({ email: "", password: "" });
      showNotice("Product permanently deleted.");
    } catch (deleteError) {
      showError(deleteError.message || "Product could not be permanently deleted.");
    } finally {
      setPermanentDeleteWorking(false);
    }
  };

  const saveCollection = async (event) => {
    event.preventDefault();
    const method = editingCollectionId ? "PATCH" : "POST";
    const payload = collectionForm.parentCollectionId
      ? { ...collectionForm, isTrendingWedding: false, isSuite: false }
      : collectionForm;

    try {
      const response = await fetch("/api/admin/collections", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingCollectionId ? { ...payload, id: editingCollectionId } : payload),
      });
      const data = await response.json();

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Collection could not be saved.");
      }

      setCollectionForm(emptyCollection);
      setEditingCollectionId(null);
      setCollectionFormOpen(false);
      await loadData();
      showNotice(editingCollectionId ? "Collection updated." : "Collection created.");
    } catch (saveError) {
      showError(saveError.message || "Collection could not be saved.");
    }
  };

  const editCollection = (collection) => {
    setEditingCollectionId(collection.id);
    setCollectionForm({
      name: collection.name || "",
      parentCollectionId: collection.parentCollectionId || "",
      isTrendingWedding: Boolean(collection.isTrendingWedding),
      isSuite: Boolean(collection.isSuite),
    });
    setCollectionFormOpen(true);
    changeSection("Collections");
  };

  const removeCollection = (id) => {
    requestDeleteConfirm({
      title: "Delete collection?",
      message: "Products inside this collection will stay in the store, but this collection and its link will be removed.",
      confirmLabel: "Delete collection",
      onConfirm: async () => {
        try {
          const response = await fetch("/api/admin/collections", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
          if (!response.ok) throw new Error("Collection could not be deleted.");
          await loadData();
          showNotice("Collection deleted.");
        } catch (deleteError) {
          showError(deleteError.message || "Collection could not be deleted.");
        }
      },
    });
  };

  const updateCollectionTrending = async (id, isTrendingWedding) => {
    const previousCollections = productCollections;
    setProductCollections((current) =>
      current.map((collection) =>
        collection.id === id ? { ...collection, isTrendingWedding } : collection
      )
    );

    try {
      const response = await fetch("/api/admin/collections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isTrendingWedding }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(String(firstError || "Collection could not be updated."));
      }

      if (data.collection) {
        setProductCollections((current) =>
          current
            .map((collection) => (collection.id === id ? data.collection : collection))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      }

      showNotice(isTrendingWedding ? "Collection marked as trending." : "Collection removed from trending.");
    } catch (updateError) {
      setProductCollections(previousCollections);
      showError(updateError.message || "Collection could not be updated.");
    }
  };

  const updateCollectionSuite = async (id, isSuite) => {
    const previousCollections = productCollections;
    setProductCollections((current) =>
      current.map((collection) =>
        collection.id === id ? { ...collection, isSuite } : collection
      )
    );

    try {
      const response = await fetch("/api/admin/collections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isSuite }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(String(firstError || "Collection could not be updated."));
      }

      if (data.collection) {
        setProductCollections((current) =>
          current
            .map((collection) => (collection.id === id ? data.collection : collection))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      }

      showNotice(isSuite ? "Collection marked as a suite." : "Collection marked as a collection.");
    } catch (updateError) {
      setProductCollections(previousCollections);
      showError(updateError.message || "Collection could not be updated.");
    }
  };

  const updateOrderStatus = async (id, status) => {
    try {
      const response = await fetch(`/api/admin/order-requests/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Order status could not be updated.");
      await loadData();
      showNotice("Order status updated.");
    } catch (updateError) {
      showError(updateError.message || "Order status could not be updated.");
    }
  };

  const updateOrderDeliveryCharge = async (id, deliveryCharge) => {
    try {
      const response = await fetch(`/api/admin/order-requests/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryCharge }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Object.values(data?.errors || {})[0] || data?.error || "Delivery charge could not be updated.");
      await loadData();
      showNotice("Delivery charge confirmed.");
    } catch (updateError) {
      showError(updateError.message || "Delivery charge could not be updated.");
    }
  };

  const removeOrder = (id) => {
    requestDeleteConfirm({
      title: "Delete order request?",
      message: "This removes the order request from the admin panel.",
      confirmLabel: "Delete order",
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/admin/order-requests/${id}`, { method: "DELETE" });
          if (!response.ok) throw new Error("Order request could not be deleted.");
          await loadData();
          showNotice("Order request deleted.");
        } catch (deleteError) {
          showError(deleteError.message || "Order request could not be deleted.");
        }
      },
    });
  };

  const updateMessageStatus = async (id, status) => {
    try {
      const response = await fetch(`/api/admin/contact-messages/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Message status could not be updated.");
      await loadData();
      showNotice("Message status updated.");
    } catch (updateError) {
      showError(updateError.message || "Message status could not be updated.");
    }
  };

  const removeMessage = (id) => {
    requestDeleteConfirm({
      title: "Delete message?",
      message: "This removes the customer message from the inbox.",
      confirmLabel: "Delete message",
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/admin/contact-messages/${id}`, { method: "DELETE" });
          if (!response.ok) throw new Error("Message could not be deleted.");
          await loadData();
          showNotice("Message deleted.");
        } catch (deleteError) {
          showError(deleteError.message || "Message could not be deleted.");
        }
      },
    });
  };

  const removeSubscriber = (id) => {
    requestDeleteConfirm({
      title: "Delete subscriber?",
      message: "This removes the email address from the newsletter list.",
      confirmLabel: "Delete subscriber",
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/admin/newsletter/${id}`, { method: "DELETE" });
          if (!response.ok) throw new Error("Subscriber could not be deleted.");
          await loadData();
          showNotice("Subscriber deleted.");
        } catch (deleteError) {
          showError(deleteError.message || "Subscriber could not be deleted.");
        }
      },
    });
  };

  const activeLabel =
    navGroups.flatMap((group) => group.items).find((item) => item.section === activeSection)?.label || activeSection;
  const activeDetail = sectionDetails[activeSection] || sectionDetails.Overview;
  const activeSearchValue =
    activeSection === "Products" ? productQuery :
    activeSection === "Product Reviews" ? reviewQuery :
    activeSection === "Collections" ? collectionQuery :
    activeSection === "Order Requests" ? orderQuery :
    activeSection === "Contact Messages" ? messageQuery :
    activeSection === "Newsletter Subscribers" ? subscriberQuery :
    activeSection === "Recently Deleted" ? deletedQuery :
    globalQuery;
  const hasActiveFilters = Boolean(
    activeSearchValue ||
    (activeSection === "Products" && productStatusFilter) ||
    (activeSection === "Order Requests" && orderStatus) ||
    (activeSection === "Contact Messages" && messageStatus)
  );
  const primaryAction =
    activeSection === "Products"
      ? {
          label: "Add Product",
          onClick: () => {
            setEditingProduct(null);
            setProductFormOpen(true);
            changeSection("Products");
          },
        }
      : activeSection === "Collections"
        ? {
            label: "Add Collection",
            onClick: () => {
              setEditingCollectionId(null);
              setCollectionForm(emptyCollection);
              setCollectionFormOpen(true);
              changeSection("Collections");
            },
          }
        : null;
  return (
    <main data-admin-shell className="min-h-screen bg-[#FAF9F6] font-body text-[#303839]">
      <div className="min-h-screen">
        <div
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
          className={`fixed inset-0 z-40 bg-[#303839]/40 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
            sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />
        <aside
          id="admin-sidebar"
          aria-label="Admin navigation"
          className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-[272px] max-w-[86vw] flex-col border-r border-[#303839]/10 bg-white transition-[transform,visibility,box-shadow] duration-300 ease-out lg:visible lg:z-30 lg:w-[248px] lg:translate-x-0 lg:shadow-none ${
            sidebarOpen ? "visible translate-x-0 shadow-[0_24px_60px_-12px_rgba(48,56,57,0.35)]" : "invisible -translate-x-full"
          }`}
        >
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[#303839]/8 px-5">
            <Image
              src="/Brand Kit/Logo-1.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-[8px]"
            />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="font-display text-[1.25rem] font-semibold text-[#303839]">Husnalogy</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#303839]/70">Admin</p>
            </div>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setSidebarOpen(false)}
              className="grid h-10 w-10 shrink-0 place-items-center text-[#303839]/75 transition-colors hover:bg-[#F3F1EC] hover:text-[#303839] lg:hidden"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>

          <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-4">
            {navGroups.map((group) => (
              <div key={group.title || "main"}>
                {group.title && (
                  <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#303839]/70">{group.title}</p>
                )}
                <div className="grid gap-0.5">
                  {group.items.map((item) => {
                    const badge = navBadges[item.section] || 0;
                    const active = activeSection === item.section;
                    return (
                      <button
                        key={item.section}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => changeSection(item.section)}
                        className={`group relative flex h-10 cursor-pointer items-center gap-3 px-3 text-left text-[13px] transition-colors duration-200 [@media(pointer:coarse)]:h-11 ${
                          active
                            ? "bg-[#F3F1EC] font-semibold text-[#303839]"
                            : "font-medium text-[#303839]/80 hover:bg-[#F8F6F1] hover:text-[#303839]"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#303839] transition-opacity duration-200 ${
                            active ? "opacity-100" : "opacity-0"
                          }`}
                        />
                        <Icon name={item.icon} className={`h-4 w-4 shrink-0 ${active ? "text-[#303839]" : "text-[#303839]/70 group-hover:text-[#303839]"}`} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {badge > 0 && (
                          <span
                            title={`${badge} waiting for you`}
                            className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                              active ? "bg-white text-[#303839]" : "bg-[#ECE9E1] text-[#303839]"
                            }`}
                          >
                            {badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="grid shrink-0 gap-0.5 border-t border-[#303839]/8 p-3">
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              title="Open your website in a new tab"
              className="flex h-10 w-full items-center gap-3 rounded-[8px] px-3 text-left text-[13px] font-medium text-[#303839]/80 transition-colors hover:bg-[#F8F6F1] hover:text-[#303839] [@media(pointer:coarse)]:h-11"
            >
              <Icon name="external" className="h-4 w-4 shrink-0 text-[#303839]/70" />
              <span className="min-w-0 flex-1 truncate">View Store</span>
            </a>
            <button
              type="button"
              onClick={handleLogout}
              className="flex h-10 w-full cursor-pointer items-center gap-3 px-3 text-left text-[13px] font-medium text-red-700 transition-colors hover:bg-red-50 [@media(pointer:coarse)]:h-11"
            >
              <Icon name="logout" className="h-4 w-4 shrink-0" />
              <span>Log out</span>
            </button>
          </div>
        </aside>

        <section className="min-w-0 lg:pl-[248px]">
          <header className="sticky top-0 z-20 border-b border-[#303839]/10 bg-white/90 backdrop-blur-xl supports-[backdrop-filter]:bg-white/80">
            <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
                aria-controls="admin-sidebar"
                aria-expanded={sidebarOpen}
                className="-ml-1 grid h-10 w-10 shrink-0 place-items-center text-[#303839] transition-colors hover:bg-[#F3F1EC] lg:hidden"
              >
                <Icon name="menu" className="h-5 w-5" />
              </button>

              <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#303839] md:hidden">{activeLabel}</p>

              {activeDetail.searchPlaceholder && (
                <form onSubmit={submitGlobalSearch} role="search" className="relative hidden min-w-0 flex-1 md:block md:max-w-[420px]">
                  <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#303839]/70" />
                  <input
                    type="search"
                    value={activeSearchValue}
                    onChange={(event) => handleGlobalSearch(event.target.value)}
                    placeholder={activeDetail.searchPlaceholder}
                    aria-label="Search admin"
                    className="h-10 w-full border border-[#303839]/10 bg-[#F8F6F1] pl-9 pr-3 text-sm font-medium text-[#303839] outline-none transition-colors placeholder:text-[#303839]/50 hover:border-[#303839]/20 focus:bg-white"
                  />
                </form>
              )}

              <div className="hidden flex-1 md:block" />

              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                {activeDetail.searchPlaceholder && (
                  <button
                    type="button"
                    onClick={() => setMobileSearchOpen((current) => !current)}
                    aria-label={mobileSearchOpen ? "Hide search" : "Show search"}
                    aria-expanded={mobileSearchOpen || Boolean(activeSearchValue)}
                    className={`grid h-10 w-10 place-items-center text-[#303839] transition-colors hover:bg-[#F3F1EC] md:hidden ${
                      mobileSearchOpen || activeSearchValue ? "bg-[#F3F1EC]" : ""
                    }`}
                  >
                    <Icon name="search" className="h-5 w-5" />
                  </button>
                )}

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setNotificationsOpen((current) => !current)}
                    title="New orders and messages"
                    aria-label={`Notifications${recentNotifications.length ? ` (${recentNotifications.length})` : ""}`}
                    aria-expanded={notificationsOpen}
                    aria-haspopup="dialog"
                    className={`relative grid h-10 w-10 place-items-center text-[#303839] transition-colors hover:bg-[#F3F1EC] ${notificationsOpen ? "bg-[#F3F1EC]" : ""}`}
                  >
                    <Icon name="bell" className="h-5 w-5" />
                    {!!recentNotifications.length && (
                      <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#303839] px-1 text-[10px] font-semibold tabular-nums leading-none text-white ring-2 ring-white">
                        {recentNotifications.length}
                      </span>
                    )}
                  </button>

                  {notificationsOpen && (
                    <>
                      <div aria-hidden="true" onClick={() => setNotificationsOpen(false)} className="fixed inset-0 z-40" />
                      <div
                        role="dialog"
                        aria-label="Notifications"
                        className="fixed inset-x-3 top-[68px] z-50 overflow-hidden rounded-[12px] border border-[#303839]/10 bg-white shadow-[0_24px_60px_-24px_rgba(48,56,57,0.4)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[340px]"
                      >
                        <div className="flex items-center justify-between gap-3 border-b border-[#303839]/8 py-2 pl-4 pr-2">
                          <p className="text-sm font-semibold">Notifications</p>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => loadData(true)} className="h-9 px-3 text-xs font-semibold text-[#303839]/80 transition-colors hover:bg-[#F3F1EC] hover:text-[#303839]">
                              Refresh
                            </button>
                            <button type="button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)} className="grid h-9 w-9 place-items-center text-[#303839]/75 transition-colors hover:bg-[#F3F1EC] hover:text-[#303839]">
                              <Icon name="close" className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div className="max-h-[min(420px,calc(100dvh-140px))] overflow-y-auto overscroll-contain p-1.5">
                          {recentNotifications.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => changeSection(item.section)}
                              className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#F8F6F1]"
                            >
                              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]">
                                <Icon name={item.section === "Contact Messages" ? "mail" : "bag"} className="h-4 w-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-[#303839]">{item.title}</span>
                                <span className="mt-0.5 block truncate text-xs text-[#303839]/70">{item.detail}</span>
                              </span>
                            </button>
                          ))}
                          {!recentNotifications.length && (
                            <p className="px-3 py-6 text-center text-sm text-[#303839]/70">You are all caught up.</p>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-[#303839]/12 sm:block" />

                <div className="flex items-center gap-2.5" title="Signed in as administrator">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#303839] text-sm font-semibold text-white">A</span>
                  <span className="hidden min-w-0 leading-tight xl:block">
                    <span className="block text-[13px] font-semibold">Admin</span>
                    <span className="block text-xs text-[#303839]/70">Administrator</span>
                  </span>
                </div>

                {primaryAction && (
                  <button
                    type="button"
                    onClick={primaryAction.onClick}
                    aria-label={primaryAction.label}
                    className="ml-1 inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap bg-[#303839] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#434C4D] sm:px-4"
                  >
                    <Icon name="plus" className="h-4 w-4" />
                    <span className="hidden sm:inline">{primaryAction.label}</span>
                  </button>
                )}
              </div>
            </div>

            {activeDetail.searchPlaceholder && (mobileSearchOpen || activeSearchValue) && (
              <form onSubmit={submitGlobalSearch} role="search" className="relative border-t border-[#303839]/8 px-4 py-2.5 sm:px-6 md:hidden">
                <Icon name="search" className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-[#303839]/70 sm:left-9" />
                <input
                  type="search"
                  autoFocus={mobileSearchOpen && !activeSearchValue}
                  value={activeSearchValue}
                  onChange={(event) => handleGlobalSearch(event.target.value)}
                  placeholder={activeDetail.searchPlaceholder}
                  aria-label="Search admin"
                  className="h-11 w-full border border-[#303839]/10 bg-[#F8F6F1] pl-9 pr-3 text-base font-medium text-[#303839] outline-none placeholder:text-[#303839]/50 focus:bg-white"
                />
              </form>
            )}
          </header>

          <div className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pb-12">
            {activeSection !== "Overview" && (
              <div className="mb-6 flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-xs font-medium text-[#303839]/70 md:flex">
                      <button type="button" onClick={() => changeSection("Overview")} className="transition-colors hover:text-[#303839]">
                        Dashboard
                      </button>
                      <Icon name="chevron" className="h-3 w-3 -rotate-90" />
                      <span aria-current="page" className="text-[#303839]">{activeLabel}</span>
                    </nav>
                    <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.01em] text-[#303839] sm:text-[1.75rem] md:mt-2">
                      {activeLabel}
                    </h1>
                    <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#303839]/75">
                      {activeDetail.description}
                    </p>
                  </div>

                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearActiveFilters}
                      className="inline-flex h-10 w-fit shrink-0 items-center gap-2 border border-[#303839]/12 bg-white px-4 text-xs font-semibold text-[#303839] transition-colors hover:bg-[#F3F1EC]"
                    >
                      <Icon name="close" className="h-4 w-4" />
                      Clear filters
                    </button>
                  )}
                </div>

                <SectionHelp key={activeSection} section={activeSection} tips={sectionTips[activeSection] || []} />
              </div>
            )}

            {(notice || error) && (
              <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[90] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end">
                {notice && (
                  <div role="status" className="pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-[12px] border border-[#303839]/10 bg-[#303839] px-4 py-3 text-sm font-medium text-white shadow-[0_18px_40px_-16px_rgba(48,56,57,0.55)]">
                    <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">{notice}</span>
                  </div>
                )}
                {error && (
                  <div role="alert" className="pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-[12px] border border-red-200 bg-white py-3 pl-4 pr-2 text-sm font-medium text-red-800 shadow-[0_18px_40px_-16px_rgba(48,56,57,0.4)]">
                    <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">{error}</span>
                    <button type="button" aria-label="Dismiss error" onClick={() => setError("")} className="-my-1 grid h-8 w-8 shrink-0 place-items-center text-red-800/80 transition-colors hover:bg-red-50">
                      <Icon name="close" className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {loading ? (
              <div className="space-y-4" aria-busy="true" aria-live="polite">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {[0, 1, 2, 3].map((placeholder) => (
                    <div key={placeholder} className="min-h-[112px] animate-pulse rounded-[12px] border border-[#303839]/8 bg-white p-5">
                      <div className="h-3 w-24 rounded-full bg-[#F3F1EC]" />
                      <div className="mt-4 h-7 w-20 rounded-full bg-[#F3F1EC]" />
                      <div className="mt-4 h-3 w-32 rounded-full bg-[#F3F1EC]" />
                    </div>
                  ))}
                </div>
                <div className="h-[300px] animate-pulse rounded-[12px] border border-[#303839]/8 bg-white" />
                <p className="text-center text-sm text-[#303839]/70">Loading your store data…</p>
              </div>
            ) : (
              <>
                {activeSection === "Overview" && (
                  <Overview
                    overview={overview}
                    orders={orders}
                    products={products}
                    deletedProducts={deletedProducts}
                    onViewSection={changeSection}
                    onEditProduct={editProduct}
                    onAddProduct={() => {
                      setEditingProduct(null);
                      setProductFormOpen(true);
                      changeSection("Products");
                    }}
                    onOpenOrders={() => {
                      setOrderStatus("");
                      changeSection("Order Requests");
                    }}
                    onOpenProducts={() => {
                      setProductStatusFilter("");
                      changeSection("Products");
                    }}
                    onOpenPendingOrders={() => {
                      setOrderStatus("pending");
                      changeSection("Order Requests");
                    }}
                    onOpenNewMessages={() => {
                      setMessageStatus("new");
                      changeSection("Contact Messages");
                    }}
                    onOpenDraftProducts={() => {
                      setProductStatusFilter("draft");
                      changeSection("Products");
                    }}
                    onOpenActiveProducts={() => {
                      setProductStatusFilter("active");
                      changeSection("Products");
                    }}
                    onOpenSubscribers={() => changeSection("Newsletter Subscribers")}
                  />
                )}

                {activeSection === "Products" && (
                  <ProductsSection
                    allProducts={products}
                    products={filteredProducts}
                    query={productQuery}
                    setQuery={setProductQuery}
                    onAdd={() => {
                      setEditingProduct(null);
                      setProductFormOpen(true);
                    }}
                    statusFilter={productStatusFilter}
                    setStatusFilter={setProductStatusFilter}
                    totalProducts={products.length}
                    editingProduct={editingProduct}
                    formOpen={productFormOpen}
                    onSaved={handleProductSaved}
                    onCloseForm={closeProductForm}
                    onEdit={editProduct}
                    onDuplicate={duplicateProduct}
                    onDelete={removeProduct}
                  />
                )}

                {activeSection === "Product Reviews" && (
                  <ProductReviewsSection
                    products={products}
                    query={reviewQuery}
                    setQuery={setReviewQuery}
                    onDeleteReview={removeProductReview}
                  />
                )}

                {activeSection === "Collections" && (
                  <CollectionsSection
                    collections={productCollections}
                    products={products}
                    query={collectionQuery}
                    form={collectionForm}
                    setForm={setCollectionForm}
                    editingId={editingCollectionId}
                    setEditingId={setEditingCollectionId}
                    formOpen={collectionFormOpen}
                    setFormOpen={setCollectionFormOpen}
                    onSubmit={saveCollection}
                    onEdit={editCollection}
                    onDelete={removeCollection}
                    onToggleTrendingCollection={updateCollectionTrending}
                    onToggleSuiteCollection={updateCollectionSuite}
                  />
                )}

                {activeSection === "Home Hero" && <HeroCollectionSection onAction={showNotice} />}
                {activeSection === "Elements Library" && <ElementsLibrarySection onAction={showNotice} />}

                {activeSection === "Order Requests" && (
                  <OrdersSection
                    orders={orders}
                    query={orderQuery}
                    status={orderStatus}
                    setStatus={setOrderStatus}
                    onStatusChange={updateOrderStatus}
                    onDeliveryChargeChange={updateOrderDeliveryCharge}
                    onDelete={removeOrder}
                  />
                )}

                {activeSection === "Contact Messages" && (
                  <MessagesSection
                    messages={filteredMessages}
                    allMessages={messages}
                    query={messageQuery}
                    setQuery={setMessageQuery}
                    status={messageStatus}
                    setStatus={setMessageStatus}
                    onStatusChange={updateMessageStatus}
                    onDelete={removeMessage}
                  />
                )}

                {LAUNCH_FEATURES.marketingEmail && activeSection === "Newsletter Subscribers" && (
                  <SubscribersSection
                    subscribers={filteredSubscribers}
                    allSubscribers={subscribers}
                    query={subscriberQuery}
                    onDelete={removeSubscriber}
                    onAction={showNotice}
                    onError={showError}
                  />
                )}

                {activeSection === "Recently Deleted" && (
                  <RecentlyDeletedSection
                    products={filteredDeletedProducts}
                    onRestore={restoreProductItem}
                    onPermanentDelete={permanentlyDeleteProductItem}
                  />
                )}

                {activeSection === "Settings" && <SettingsSection onAction={showNotice} />}
              </>
            )}
          </div>
        </section>
      </div>
      {confirmDialog && (
        <DeleteConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          working={confirmWorking}
          onCancel={closeConfirmDialog}
          onConfirm={runConfirmedAction}
        />
      )}
      {permanentDeleteTarget && (
        <PermanentDeleteDialog
          product={permanentDeleteTarget}
          credentials={permanentDeleteCredentials}
          setCredentials={setPermanentDeleteCredentials}
          working={permanentDeleteWorking}
          onCancel={closePermanentDeleteDialog}
          onConfirm={runPermanentDelete}
        />
      )}
    </main>
  );
}

// Shared modal frame: portal, scroll lock, Escape to close, and a bottom sheet
// on phones so the actions stay within thumb reach.
function AdminModal({ labelledBy, onClose, children, maxWidth = "max-w-[440px]", busy = false }: any) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !busy) onClose?.();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, busy]);

  return createPortal(
    <div data-admin-shell className="fixed inset-0 z-[100] flex items-end justify-center bg-[#303839]/45 backdrop-blur-[2px] sm:items-center sm:p-6" onClick={() => !busy && onClose?.()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(event) => event.stopPropagation()}
        className={`max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-[16px] border border-[#303839]/10 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] font-body text-[#303839] shadow-[0_24px_80px_-24px_rgba(48,56,57,0.45)] sm:rounded-[14px] sm:p-6 ${maxWidth}`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

function DialogActions({ children }) {
  return <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

const BUTTON_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 bg-[#303839] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#434C4D] disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_SECONDARY =
  "inline-flex h-11 items-center justify-center gap-2 border border-[#303839]/15 bg-white px-5 text-sm font-semibold text-[#303839] transition-colors hover:bg-[#F3F1EC] disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_DANGER =
  "inline-flex h-11 items-center justify-center gap-2 bg-red-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_SM_SECONDARY =
  "inline-flex h-9 items-center justify-center gap-1.5 border border-[#303839]/12 bg-white px-3 text-xs font-semibold text-[#303839] transition-colors hover:border-[#303839]/25 hover:bg-[#F8F6F1] disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-10";
const BUTTON_SM_DANGER =
  "inline-flex h-9 items-center justify-center gap-1.5 border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 [@media(pointer:coarse)]:h-10";
const ICON_BUTTON =
  "grid h-9 w-9 shrink-0 place-items-center border border-[#303839]/12 bg-white text-[#303839] transition-colors hover:border-[#303839]/25 hover:bg-[#F8F6F1] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10";
const CARD = "min-w-0 rounded-[12px] border border-[#303839]/10 bg-white shadow-[0_1px_2px_rgba(48,56,57,0.04)]";

function DeleteConfirmDialog({ title, message, confirmLabel = "Delete", working = false, onCancel, onConfirm }: any) {
  return (
    <AdminModal labelledBy="admin-confirm-title" onClose={onCancel} busy={working}>
      <div className="flex items-start gap-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-700">
          <Icon name="trash" className="h-5 w-5" />
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 id="admin-confirm-title" className="text-lg font-semibold leading-snug">{title}</h2>
          <p className="mt-1.5 text-sm leading-6 text-[#303839]/75">{message}</p>
        </div>
      </div>
      <DialogActions>
        <button type="button" onClick={onCancel} disabled={working} className={BUTTON_SECONDARY}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={working} className={BUTTON_DANGER}>
          {working ? "Deleting…" : confirmLabel}
        </button>
      </DialogActions>
    </AdminModal>
  );
}

function PermanentDeleteDialog({ product, credentials, setCredentials, working = false, onCancel, onConfirm }: any) {
  const canDelete = credentials.email.trim() && credentials.password.trim();

  return (
    <AdminModal labelledBy="admin-permanent-delete-title" onClose={onCancel} busy={working} maxWidth="max-w-[460px]">
      <div className="flex items-start gap-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-700">
          <Icon name="trash" className="h-5 w-5" />
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 id="admin-permanent-delete-title" className="text-lg font-semibold leading-snug">Permanently delete product?</h2>
          <p className="mt-1.5 text-sm leading-6 text-[#303839]/75">
            This cannot be undone. Enter the permission email and password to delete {product?.title || "this product"} forever.
          </p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canDelete && !working) onConfirm();
        }}
      >
        <div className="mt-5 grid gap-3">
          <AdminInput
            label="Permission email"
            type="email"
            value={credentials.email}
            onChange={(value) => setCredentials((current) => ({ ...current, email: value }))}
          />
          <AdminInput
            label="Password"
            type="password"
            value={credentials.password}
            onChange={(value) => setCredentials((current) => ({ ...current, password: value }))}
          />
        </div>
        <DialogActions>
          <button type="button" onClick={onCancel} disabled={working} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={working || !canDelete} className={BUTTON_DANGER}>
            {working ? "Deleting…" : "Permanently delete"}
          </button>
        </DialogActions>
      </form>
    </AdminModal>
  );
}

function Panel({ title, children, action, className = "" }: any) {
  return (
    <div className={`${CARD} p-4 sm:p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-[#303839]/8 pb-4 sm:mb-5">
          {title && <h2 className="min-w-0 truncate text-base font-semibold text-[#303839] sm:text-lg">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Overview({
  overview,
  orders,
  products,
  deletedProducts,
  onViewSection,
  onEditProduct,
  onAddProduct,
  onOpenOrders,
  onOpenProducts,
  onOpenPendingOrders,
  onOpenNewMessages,
  onOpenDraftProducts,
  onOpenActiveProducts,
  onOpenSubscribers,
}) {
  const [chartMode, setChartMode] = useState("orders");
  const [dateRange, setDateRange] = useState("7d");
  const range = getDashboardDateRange(dateRange);
  const rangeOrders = orders.filter((order) => isDateInRange(order.createdAt || order.created_at || order.date, range.start, range.end));
  const revenueSource = rangeOrders.filter((order) => isRevenueOrder(order));
  const totalRevenue = revenueSource.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const recentOrders = [...rangeOrders]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 5);
  const draftProducts = products.filter((product) => product.status === "draft");
  const lowStockProducts = products.filter((product) => {
    const stock = getProductStock(product);
    return stock !== null && stock <= 3;
  });
  const chartDays = getChartDays(range.start, range.end);
  const chartData = buildOverviewChartData(chartDays, rangeOrders, revenueSource);
  const topProducts = getTopSellingProducts(products, orders);
  const dateRangeLabel = formatDashboardDateRange(range.start, range.end);
  const rangeOptions = [
    { value: "7d", label: "Last 7 days" },
    { value: "30d", label: "Last 30 days" },
    { value: "month", label: "This month" },
    { value: "year", label: "This year" },
  ];

  const metrics = [
    { label: "Orders", value: rangeOrders.length.toLocaleString(), icon: "bag", note: `${overview.newOrders} need attention`, onClick: onOpenOrders },
    { label: "Revenue", value: formatCurrency(totalRevenue), icon: "wallet", note: "Recorded order value", onClick: onOpenOrders },
    ...(LAUNCH_FEATURES.marketingEmail ? [{ label: "Subscribers", value: overview.subscribers.toLocaleString(), icon: "user", note: "Newsletter audience", onClick: onOpenSubscribers }] : []),
    { label: "Active products", value: overview.activeProducts.toLocaleString(), icon: "box", note: `${overview.products} total products`, onClick: onOpenActiveProducts },
  ];

  const glanceRows = [
    { label: "Pending orders", value: overview.newOrders, icon: "calendar", onClick: onOpenPendingOrders },
    { label: "New messages", value: overview.newMessages, icon: "bell", onClick: onOpenNewMessages },
    { label: "Draft products", value: draftProducts.length, icon: "pencil", onClick: onOpenDraftProducts },
    { label: "Deleted items", value: deletedProducts.length, icon: "trash", onClick: () => onViewSection("Recently Deleted") },
    { label: "Low stock items", value: lowStockProducts.length, icon: "wallet", onClick: () => onViewSection("Products") },
  ];

  const quickActions = [
    { title: "Add new product", note: "Create a new product", icon: "plus", onClick: onAddProduct },
    { title: "Manage collections", note: "Organize your products", icon: "grid", onClick: () => onViewSection("Collections") },
    { title: "View messages", note: "Check customer messages", icon: "mail", onClick: () => onViewSection("Contact Messages") },
    { title: "Store settings", note: "Configure your store", icon: "settings", onClick: () => onViewSection("Settings") },
  ];

  const exportReport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      dateRange: dateRangeLabel,
      summary: {
        totalOrders: rangeOrders.length,
        totalRevenue,
        ...(LAUNCH_FEATURES.marketingEmail ? { subscribers: overview.subscribers } : {}),
        activeProducts: overview.activeProducts,
        pendingOrders: overview.newOrders,
        newMessages: overview.newMessages,
        draftProducts: draftProducts.length,
        deletedItems: deletedProducts.length,
        lowStockItems: lowStockProducts.length,
      },
      chart: chartData,
      recentOrders,
      topProducts,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `husnalogy-admin-report-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.01em] text-[#303839] sm:text-[1.75rem]">{getGreeting()}, Admin</h1>
          <p className="mt-1.5 text-sm text-[#303839]/75">
            Here is what is happening with your store <span className="whitespace-nowrap">({dateRangeLabel}).</span>
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:items-center">
          <SelectMenu value={dateRange} onChange={setDateRange} size="sm" ariaLabel="Dashboard date range" className="sm:w-[168px]" options={rangeOptions} />
          <button type="button" onClick={exportReport} className={`${BUTTON_SM_SECONDARY} h-10 px-4 [@media(pointer:coarse)]:h-11`}>
            <Icon name="download" className="h-4 w-4" />
            <span>Export<span className="hidden sm:inline"> report</span></span>
          </button>
        </div>
      </div>

      <div
        className={`grid grid-cols-2 gap-3 sm:gap-4 [&>*:last-child:nth-child(odd)]:col-span-2 ${
          metrics.length === 3 ? "lg:grid-cols-3 lg:[&>*:last-child:nth-child(odd)]:col-span-1" : "xl:grid-cols-4 xl:[&>*:last-child:nth-child(odd)]:col-span-1"
        }`}
      >
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <DashboardCard>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#303839]">Performance</h2>
              <p className="mt-0.5 text-xs text-[#303839]/70">{chartMode === "orders" ? "Orders per day" : "Revenue per day"}</p>
            </div>
            <div role="tablist" aria-label="Chart metric" className="inline-flex rounded-[10px] border border-[#303839]/10 bg-[#F8F6F1] p-1">
              {["orders", "revenue"].map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={chartMode === item}
                  onClick={() => setChartMode(item)}
                  className={`h-8 px-3.5 text-xs font-semibold capitalize transition-colors ${
                    chartMode === item ? "bg-white text-[#303839] shadow-[0_1px_3px_rgba(48,56,57,0.12)]" : "text-[#303839]/70 hover:text-[#303839]"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <OverviewChart data={chartData} mode={chartMode} />
        </DashboardCard>

        <DashboardCard className="p-0 sm:p-0">
          <h2 className="px-4 pb-2 pt-4 text-base font-semibold text-[#303839] sm:px-5 sm:pt-5">At a glance</h2>
          <div className="divide-y divide-[#303839]/8 pb-1.5">
            {glanceRows.map((row) => (
              <button
                key={row.label}
                type="button"
                onClick={row.onClick}
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#F8F6F1] sm:px-5"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]">
                  <Icon name={row.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#303839]">{row.label}</span>
                <span className="text-sm font-semibold tabular-nums text-[#303839]">{row.value.toLocaleString()}</span>
                <Icon name="chevron" className="h-4 w-4 -rotate-90 text-[#303839]/60" />
              </button>
            ))}
          </div>
        </DashboardCard>
      </div>

      <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
        <DashboardCard>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[#303839]">Recent orders</h2>
            <DashboardTextButton label="View all" onClick={onOpenOrders} />
          </div>

          {recentOrders.length ? (
            <>
              <div className="-mx-1 divide-y divide-[#303839]/8 md:hidden">
                {recentOrders.map((order) => (
                  <button key={order.id} type="button" onClick={onOpenOrders} className="flex w-full items-start gap-3 px-1 py-3 text-left transition-colors hover:bg-[#F8F6F1]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#303839]">{order.customerName || "Customer"}</span>
                      <span className="mt-0.5 block truncate text-xs text-[#303839]/70">
                        {formatOrderId(order.id)} · {order.productTitle || order.productSlug || "Custom order"}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        <StatusBadge status={order.status || "pending"} />
                        <StatusBadge status={order.paymentStatus || "unpaid"} />
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-[#303839]">{formatCurrency(order.total || 0, order.currency)}</span>
                  </button>
                ))}
              </div>

              <div className="-mx-4 hidden overflow-x-auto sm:-mx-5 md:block">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead className="border-y border-[#303839]/8 bg-[#F8F6F1] text-xs font-semibold text-[#303839]/75">
                    <tr>
                      <th scope="col" className="py-2.5 pl-4 pr-3 font-semibold sm:pl-5">Order</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Customer</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Payment</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                      <th scope="col" className="py-2.5 pl-3 pr-4 text-right font-semibold sm:pr-5">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#303839]/8">
                    {recentOrders.map((order) => (
                      <tr key={order.id} className="text-[#303839]">
                        <td className="py-3 pl-4 pr-3 sm:pl-5">
                          <span className="block text-xs font-semibold tabular-nums">{formatOrderId(order.id)}</span>
                          <span className="mt-0.5 block max-w-[180px] truncate text-xs text-[#303839]/70">{order.productTitle || order.productSlug || "Custom order"}</span>
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-3">{order.customerName || "Customer"}</td>
                        <td className="px-3 py-3"><StatusBadge status={order.paymentStatus || "unpaid"} /></td>
                        <td className="px-3 py-3"><StatusBadge status={order.status || "pending"} /></td>
                        <td className="whitespace-nowrap py-3 pl-3 pr-4 text-right font-semibold tabular-nums sm:pr-5">{formatCurrency(order.total || 0, order.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="grid min-h-[180px] place-items-center text-center">
              <div>
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]/75">
                  <Icon name="bag" className="h-5 w-5" />
                </span>
                <p className="mt-3 text-sm font-semibold text-[#303839]">No orders in this period</p>
                <p className="mt-1 text-xs text-[#303839]/70">New orders will appear here.</p>
              </div>
            </div>
          )}
        </DashboardCard>

        <DashboardCard>
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[#303839]">Top selling products</h2>
            <DashboardTextButton label="View all" onClick={onOpenProducts} />
          </div>
          <div className="-mx-1 divide-y divide-[#303839]/8">
            {topProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onEditProduct(product)}
                className="grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-[#F8F6F1] sm:grid-cols-[48px_minmax(0,1fr)_auto_auto]"
              >
                <img src={getProductImage(product)} alt="" loading="lazy" className="h-11 w-11 rounded-[8px] border border-[#303839]/8 bg-[#F8F6F1] object-cover sm:h-12 sm:w-12" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[#303839]">{product.title || "Untitled product"}</span>
                  <span className="mt-0.5 block truncate text-xs text-[#303839]/70">SKU {product.sku || product.slug || product.id}</span>
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-[#303839]">
                  {Number(product.soldCount || 0).toLocaleString()}
                  <span className="block text-[11px] font-medium text-[#303839]/70">sold</span>
                </span>
                <span className="hidden rounded-full bg-[#F3F1EC] px-2.5 py-1 text-[11px] font-semibold text-[#303839]/80 sm:inline-block">
                  {getProductBadge(product)}
                </span>
              </button>
            ))}
            {!topProducts.length && <EmptyLine>No products to show yet.</EmptyLine>}
          </div>
        </DashboardCard>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {quickActions.map((action) => (
          <button
            key={action.title}
            type="button"
            onClick={action.onClick}
            className={`${CARD} group flex cursor-pointer flex-col items-start gap-3 p-4 text-left transition-colors hover:border-[#303839]/20 hover:bg-[#F8F6F1] sm:flex-row sm:items-center sm:p-5`}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-[#303839] transition-colors group-hover:bg-[#303839] group-hover:text-white">
              <Icon name={action.icon} className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[#303839]">{action.title}</span>
              <span className="mt-0.5 block text-xs text-[#303839]/70">{action.note}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DashboardCard({ children, className = "" }) {
  return <section className={`${CARD} p-4 sm:p-5 ${className}`}>{children}</section>;
}

function MetricCard({ label, value, icon, note, onClick = null, change = "", invertChange = false }: any) {
  const direction = String(change).startsWith("+") && change !== "+0%" ? "up" : String(change).startsWith("-") ? "down" : "flat";
  // For counts where fewer is better (e.g. flagged reviews) a drop reads as good news.
  const changeTone = direction === "flat" ? "flat" : (direction === "up") !== invertChange ? "up" : "down";
  const content = (
    <>
      <span className="flex items-start justify-between gap-2 sm:items-center sm:gap-3">
        <span className="line-clamp-2 min-w-0 text-xs font-semibold leading-4 text-[#303839]/75 sm:text-[13px] sm:leading-5">{label}</span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-[#303839] sm:h-9 sm:w-9">
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </span>
      <span className="mt-2 block truncate text-[1.375rem] font-semibold leading-tight tabular-nums tracking-[-0.01em] text-[#303839] sm:mt-3 sm:text-[1.75rem]">{value}</span>
      {note && <span className="mt-1 line-clamp-2 text-xs leading-4 text-[#303839]/70 sm:truncate sm:leading-5">{note}</span>}
      {change && (
        <span className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-[#303839]/70">
          <span
            className={`rounded-full px-2 py-0.5 font-semibold tabular-nums ${
              changeTone === "up" ? "bg-[#E6F4EA] text-[#1B5E20]" : changeTone === "down" ? "bg-[#FDE8E8] text-[#8C1F1F]" : "bg-[#F3F1EC] text-[#303839]/80"
            }`}
          >
            {change}
          </span>
          <span className="truncate">vs previous 7 days</span>
        </span>
      )}
    </>
  );
  const className = `${CARD} block p-4 text-left sm:p-5`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${className} cursor-pointer transition-colors hover:border-[#303839]/20 hover:bg-[#FCFBF9]`}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function DashboardTextButton({ label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="-mr-2 inline-flex h-9 items-center gap-1.5 px-2 text-xs font-semibold text-[#303839] transition-colors hover:bg-[#F3F1EC]">
      {label}
      <Icon name="arrowRight" className="h-3.5 w-3.5" />
    </button>
  );
}

// Rounds the chart ceiling up to a readable step (1, 2, 2.5, 5 x 10^n) so the
// axis shows real values instead of a fixed 0-100 scale.
function getNiceChartMax(value) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) || 10;
  return step * magnitude;
}

function formatChartTick(value, mode) {
  if (mode !== "revenue") return value.toLocaleString();
  if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 ? 1 : 0)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k`;
  return value.toLocaleString();
}

function OverviewChart({ data, mode }) {
  // Draw in real pixels (viewBox tracks the rendered width) so axis text stays
  // 11px on every screen instead of scaling down with the SVG.
  const containerRef = useRef(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = 232;
  const left = 44;
  const right = 12;
  const top = 12;
  const bottom = 196;
  const values = data.map((item) => Number(mode === "revenue" ? item.revenue : item.orders) || 0);
  const maxValue = getNiceChartMax(Math.max(0, ...values));
  const xFor = (index) => (data.length <= 1 ? (left + width - right) / 2 : left + index * ((width - right - left) / (data.length - 1)));
  const yFor = (value) => bottom - (Number(value || 0) / maxValue) * (bottom - top);
  const linePath = values.map((value, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(1)} ${yFor(value).toFixed(1)}`).join(" ");
  const areaPath = values.length ? `${linePath} L ${xFor(values.length - 1).toFixed(1)} ${bottom} L ${xFor(0).toFixed(1)} ${bottom} Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(maxValue * ratio));
  // Keep at most ~7 x-axis labels so dates never collide on narrow screens.
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(width / 76))));
  const showPoints = data.length <= 31;
  const total = values.reduce((sum, value) => sum + value, 0);

  return (
    <figure ref={containerRef}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className="block overflow-visible" role="img" aria-label={`${mode === "revenue" ? "Revenue" : "Orders"} per day, ${mode === "revenue" ? formatCurrency(total) : total} total`}>
        <defs>
          <linearGradient id="admin-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#303839" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#303839" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={yFor(tick)} y2={yFor(tick)} stroke="#303839" strokeOpacity={tick === 0 ? 0.25 : 0.08} strokeDasharray={tick === 0 ? undefined : "3 4"} vectorEffect="non-scaling-stroke" />
            <text x={left - 8} y={yFor(tick) + 4} fill="#303839" fillOpacity="0.7" fontSize="11" textAnchor="end">{formatChartTick(tick, mode)}</text>
          </g>
        ))}
        {areaPath && <path d={areaPath} fill="url(#admin-chart-fill)" />}
        <path d={linePath} fill="none" stroke="#303839" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {data.map((item, index) => (
          <g key={item.key}>
            {showPoints && (
              <circle cx={xFor(index)} cy={yFor(values[index])} r="3" fill="#fff" stroke="#303839" strokeWidth="1.5" vectorEffect="non-scaling-stroke">
                <title>{`${item.label}: ${mode === "revenue" ? formatCurrency(values[index]) : `${values[index]} order${values[index] === 1 ? "" : "s"}`}`}</title>
              </circle>
            )}
            {(index % labelEvery === 0 || index === data.length - 1) && (index === data.length - 1 || data.length - 1 - index >= labelEvery / 2) && (
              <text x={xFor(index)} y={bottom + 24} fill="#303839" fillOpacity="0.7" fontSize="11" textAnchor={index === 0 && data.length > 1 ? "start" : index === data.length - 1 && data.length > 1 ? "end" : "middle"}>
                {item.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">
        {data.map((item, index) => `${item.label}: ${values[index]}`).join(", ")}
      </figcaption>
    </figure>
  );
}

const STATUS_TONES = {
  done: { chip: "border-[#1B5E20]/15 bg-[#E6F4EA] text-[#1B5E20]", dot: "bg-[#1B5E20]" },
  pending: { chip: "border-[#8A5A00]/15 bg-[#FBF3E2] text-[#7A4F00]", dot: "bg-[#B7791F]" },
  progress: { chip: "border-[#34526B]/15 bg-[#EAF0F5] text-[#2F4A60]", dot: "bg-[#4A6B86]" },
  problem: { chip: "border-[#8C1F1F]/15 bg-[#FDE8E8] text-[#8C1F1F]", dot: "bg-[#8C1F1F]" },
  gray: { chip: "border-[#303839]/12 bg-[#F3F1EC] text-[#303839]/80", dot: "bg-[#303839]/50" },
};

function getStatusTone(status) {
  const normalized = String(status || "pending").toLowerCase();
  if (["paid", "completed", "delivered", "active", "published", "approved", "resolved", "sent", "verified", "replied"].includes(normalized)) return "done";
  if (["pending", "unpaid", "new", "draft", "waiting for customer"].includes(normalized)) return "pending";
  if (["confirmed", "in design review", "proof sent", "customer approved", "printing", "ready for delivery", "read"].includes(normalized)) return "progress";
  if (["cancelled", "deleted", "flagged", "bounced"].includes(normalized)) return "problem";
  return "gray";
}

function StatusBadge({ status, label = "" }: any) {
  const tone = STATUS_TONES[getStatusTone(status)];
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-semibold capitalize ${tone.chip}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
      {label || String(status || "pending").replaceAll("-", " ")}
    </span>
  );
}

function EmptyLine({ children }) {
  return <p className="px-1 py-6 text-sm text-[#303839]/70">{children}</p>;
}

function EmptyState({ icon = "box", title, hint = "", action = null }: any) {
  return (
    <div className="grid place-items-center rounded-[12px] border border-dashed border-[#303839]/15 bg-white px-6 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="mt-4 text-sm font-semibold text-[#303839]">{title}</p>
      {hint && <p className="mt-1.5 max-w-md text-[13px] leading-5 text-[#303839]/70">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Dismissible plain-language tips shown under each page title. Hidden state is
// remembered per page in localStorage so returning users are not nagged.
function SectionHelp({ section, tips }) {
  const storageKey = `husnalogy-admin-help-${section}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(storageKey) !== "hidden");
    } catch {
      setOpen(true);
    }
  }, [storageKey]);

  if (!tips.length) return null;

  const persist = (next) => {
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "shown" : "hidden");
    } catch {}
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => persist(true)}
        title="Show tips for this page"
        className="inline-flex h-9 w-fit items-center gap-2 border border-[#303839]/12 bg-white px-3.5 text-xs font-semibold text-[#303839]/80 transition-colors hover:bg-[#F3F1EC] hover:text-[#303839]"
      >
        <Icon name="info" className="h-4 w-4" />
        How this page works
      </button>
    );
  }

  return (
    <div className="rounded-[12px] border border-[#303839]/10 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-[#303839]">
          <Icon name="info" className="h-4 w-4 shrink-0 text-[#303839]/75" />
          How this page works
        </p>
        <button
          type="button"
          onClick={() => persist(false)}
          className="-my-1 -mr-1 h-8 shrink-0 px-2.5 text-xs font-semibold text-[#303839]/75 transition-colors hover:bg-[#F3F1EC] hover:text-[#303839]"
        >
          Hide tips
        </button>
      </div>
      <ul className="mt-2.5 grid gap-1.5 lg:grid-cols-2 lg:gap-x-8">
        {tips.map((tip) => (
          <li key={tip} className="flex gap-2.5 text-[13px] leading-5 text-[#303839]/80">
            <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#303839]/60" />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function getProductImage(product) {
  const imageCandidates = [
    ...(Array.isArray(product?.images) ? product.images : []),
    product?.thumbnail,
    product?.image,
    ...(Array.isArray(product?.mockups) ? product.mockups : []),
  ];
  for (const item of imageCandidates) {
    if (!item) continue;
    if (typeof item === "string") return item;
    if (typeof item === "object") {
      const url = item.url || item.src || item.publicUrl || item.imageUrl || item.thumbnail || item.previewUrl;
      if (typeof url === "string" && url.trim()) return url;
    }
  }
  return "/images/weddings.png";
}

function formatCurrency(value, currency = "BDT") {
  return formatMoneyValue(value, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatProductPrice(value, currency = "BDT") {
  return formatMoneyValue(value, currency);
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatOrderId(value) {
  const raw = String(value || "order").replace(/^order-/, "ORD-");
  return raw.length > 18 ? raw.slice(0, 18).toUpperCase() : raw.toUpperCase();
}

function isRevenueOrder(order) {
  const payment = String(order.paymentStatus || "").toLowerCase();
  const status = String(order.status || "").toLowerCase();
  return ["paid", "completed", "succeeded"].includes(payment) || ["completed", "delivered"].includes(status);
}

function getDashboardDateRange(range) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  if (range === "30d") {
    start.setDate(end.getDate() - 29);
  } else if (range === "month") {
    start.setDate(1);
  } else if (range === "year") {
    start.setMonth(0, 1);
  } else {
    start.setDate(end.getDate() - 6);
  }
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function getChartDays(start, end) {
  const days = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const final = new Date(end);
  final.setHours(0, 0, 0, 0);
  while (cursor <= final) {
    days.push({
      date: new Date(cursor),
      key: getDateKey(cursor),
      label: cursor.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function getLastDays(count) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (count - 1 - index));
    return {
      date,
      key: getDateKey(date),
      label: date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    };
  });
}

function isDateInRange(value, start, end) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date >= start && date <= end;
}

function getDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildOverviewChartData(days, orders, revenueOrders) {
  const rows = days.map((day) => ({ ...day, orders: 0, revenue: 0 }));
  const byKey: Map<string, any> = new Map(rows.map((row) => [row.key, row]));

  orders.forEach((order) => {
    const row = byKey.get(getDateKey(order.createdAt || order.created_at || order.date));
    if (row) row.orders += 1;
  });

  revenueOrders.forEach((order) => {
    const row = byKey.get(getDateKey(order.createdAt || order.created_at || order.date));
    if (row) row.revenue += Number(order.total || 0);
  });

  return rows;
}

function formatDashboardDateRange(start, end) {
  const year = end.getFullYear();
  const startLabel = start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const endLabel = end.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${startLabel} - ${endLabel} ${year}`;
}

function getProductStock(product) {
  const fields = [product.stock, product.stockQuantity, product.inventory, product.quantityAvailable, product.availableQuantity];
  const value = fields.find((item) => item !== undefined && item !== null && item !== "");
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasProductPersonalization(product) {
  const template = product?.customizerTemplate || product?.data?.customizerTemplate;
  if (template?.enabled) return true;
  if (product?.customizeEnabled && template) return true;
  if (product?.customizeEnabled && Array.isArray(product?.customizationFields) && product.customizationFields.length > 0) return true;
  if (Array.isArray(product?.customizationFields) && product.customizationFields.length > 0) return true;
  if (Array.isArray(template?.fields) && template.fields.length > 0) return true;
  if (Array.isArray(template?.layers) && template.layers.length > 0) return true;
  if (Array.isArray(template?.pages) && template.pages.some((page) => Array.isArray(page.fields) && page.fields.length > 0)) return true;
  if (Array.isArray(template?.pages) && template.pages.some((page) => Array.isArray(page.layers) && page.layers.length > 0)) return true;
  if (Array.isArray(product?.customizerFields) && product.customizerFields.length > 0) return true;
  return false;
}

function getProductBadge(product) {
  if (product.isBestSeller) return "Best seller";
  if (product.featured || product.isFeatured) return "Featured";
  if (product.isNew) return "New";
  return "Active";
}

function getTopSellingProducts(products, orders) {
  return [...products]
    .filter((product) => product.status !== "deleted")
    .map((product) => ({
      ...product,
      soldCount: getProductSoldCount(product, orders),
    }))
    .sort((a, b) =>
      Number(b.soldCount || 0) - Number(a.soldCount || 0) ||
      Number(Boolean(b.isBestSeller)) - Number(Boolean(a.isBestSeller)) ||
      Number(Boolean(b.featured || b.isFeatured)) - Number(Boolean(a.featured || a.isFeatured)) ||
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    )
    .slice(0, 3);
}

function getProductSoldCount(product, orders) {
  return orders.reduce((count, order) => count + getOrderProductQuantity(order, product), 0);
}

function getOrderProductQuantity(order, product) {
  const productKeys = [product.id, product.slug, product.sku, product.title].map(normalizeLookupKey).filter(Boolean);
  const items = Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.products)
      ? order.products
      : Array.isArray(order.cartItems)
        ? order.cartItems
        : [];

  if (items.length) {
    return items.reduce((total, item) => {
      const itemKeys = [item.productId, item.id, item.slug, item.sku, item.title, item.productTitle].map(normalizeLookupKey).filter(Boolean);
      const matched = itemKeys.some((key) => productKeys.includes(key));
      return matched ? total + Number(item.quantity || item.qty || 1) : total;
    }, 0);
  }

  const orderKeys = [order.productId, order.productSlug, order.productSku, order.productTitle].map(normalizeLookupKey).filter(Boolean);
  return orderKeys.some((key) => productKeys.includes(key)) ? Number(order.quantity || 1) : 0;
}

function formatStatusLabel(value) {
  return String(value || "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function orderMatchesQuery(order, query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return true;
  return includesSearch(
    [
      order?.id,
      order?.productTitle,
      order?.productSlug,
      order?.customerName,
      order?.customerEmail,
      order?.customerPhone,
      order?.message,
      order?.address?.addressLine1,
      order?.address?.city,
      order?.address?.area,
      ...(Array.isArray(order?.items) ? order.items.map((item) => `${item.productTitle || item.title || ""} ${item.productSlug || ""}`) : []),
    ],
    term,
  );
}

function hasAdminDetailValue(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasAdminDetailValue);
  if (typeof value === "object") return Object.values(value).some(hasAdminDetailValue);
  return Boolean(value);
}

function formatDetailLabel(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const known = {
    bridename: "Bride name",
    groomname: "Groom name",
    eventdate: "Event date",
    eventtime: "Event time",
    venueaddress: "Venue address",
    photoupload: "Photo upload",
    wordingnote: "Wording note",
    customqty: "Custom quantity",
  };

  if (known[normalized]) return known[normalized];

  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDetailValue(value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    if (value.name) return value.name;
    if (value.signedUrl) return value.signedUrl;
    if (value.path) return value.path;
    return JSON.stringify(value);
  }
  return String(value);
}

function detailEntriesFromObject(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];

  return Object.entries(source)
    .filter(([, value]) => hasAdminDetailValue(value))
    .map(([key, value]) => ({
      label: formatDetailLabel(key),
      value: formatDetailValue(value),
    }));
}

function getOrderPersonalizationGroups(order) {
  if (!order) return [];

  const groups = [];
  const orderEntries = detailEntriesFromObject(order.customizationDetails);

  if (orderEntries.length) {
    groups.push({ title: "Order personalization", entries: orderEntries });
  }

  (order.items || []).forEach((item, index) => {
    const title = item.productTitle || item.title || `Item ${index + 1}`;
    const customizationEntries =
      detailEntriesFromObject(item.customizationValues).length
        ? detailEntriesFromObject(item.customizationValues)
        : detailEntriesFromObject(item.customization).length
          ? detailEntriesFromObject(item.customization)
          : detailEntriesFromObject(item.previewData);
    const uploadEntries = detailEntriesFromObject(item.uploadedFiles);
    const entries = [...customizationEntries, ...uploadEntries.filter((entry) => !customizationEntries.some((itemEntry) => itemEntry.label === entry.label))];

    if (entries.length) groups.push({ title, entries });
  });

  return groups;
}

function getCheckoutDetailEntries(order) {
  if (!order) return [];
  const address = order.address || {};

  return [
    { label: "Name", value: order.customerName },
    { label: "Email", value: order.customerEmail },
    { label: "Phone", value: order.customerPhone },
    { label: "Fulfillment", value: order.deliveryMethod === "store" ? "Store pickup" : "Delivery" },
    { label: "Payment method", value: order.paymentMethod || ORDER_POLICY.paymentMethod },
    { label: "Address 1", value: address.addressLine1 },
    { label: "Address 2", value: address.addressLine2 },
    { label: "City", value: address.city },
    { label: "Area", value: address.area },
    { label: "Postal code", value: address.postalCode },
    { label: "Country", value: address.country },
    { label: "Delivery note", value: address.deliveryNote || order.message },
  ].filter((entry) => hasAdminDetailValue(entry.value)).map((entry) => ({
    ...entry,
    value: formatDetailValue(entry.value),
  }));
}

function getInitials(value) {
  const parts = String(value || "Customer").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";
}

function includesSearch(fields, query) {
  const term = String(query || "").toLowerCase();
  return fields
    .filter((field) => field !== undefined && field !== null)
    .join(" ")
    .toLowerCase()
    .includes(term);
}

function normalizeLookupKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function productMatchesCollection(product, collection) {
  const collectionIds = [collection.id, collection.collectionId].filter(Boolean).map(String);
  const collectionKeys = [collection.id, collection.collectionId, collection.name, collection.slug].map(normalizeLookupKey).filter(Boolean);
  const hasDirectId = (value) => collectionIds.includes(String(value));
  const hasKey = (value) => collectionKeys.includes(normalizeLookupKey(value));

  if (Array.isArray(product.collectionIds) && product.collectionIds.some(hasDirectId)) return true;
  if (product.collectionId && hasDirectId(product.collectionId)) return true;
  if (product.collection && hasKey(product.collection)) return true;

  const collectionArrays = [
    product.collections,
    product.productCollections,
    product.collectionProducts,
    product.product_collection_products,
  ].filter(Array.isArray);

  return collectionArrays.some((items) =>
    items.some((item) => {
      if (typeof item === "string" || typeof item === "number") return hasDirectId(item) || hasKey(item);
      return [
        item.id,
        item.collectionId,
        item.collection_id,
        item.slug,
        item.name,
        item.collection?.id,
        item.collection?.slug,
        item.collection?.name,
      ].some((value) => value !== undefined && value !== null && (hasDirectId(value) || hasKey(value)));
    })
  );
}

function Icon({ name, className = "h-5 w-5" }) {
  const common: any = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  switch (name) {
    case "home":
      return <svg {...common}><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></svg>;
    case "calendar":
      return <svg {...common}><path d="M7 3v4" /><path d="M17 3v4" /><path d="M4 8h16" /><rect x="4" y="5" width="16" height="16" rx="2" /></svg>;
    case "box":
      return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M4.5 8 12 12.2 19.5 8" /><path d="M12 12.2V21" /></svg>;
    case "grid":
      return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>;
    case "star":
      return <svg {...common}><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg>;
    case "tag":
      return <svg {...common}><path d="M20 12v7a1 1 0 0 1-1 1h-7L4 12V5a1 1 0 0 1 1-1h7Z" /><path d="M8 8h.01" /></svg>;
    case "user":
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
    case "mail":
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>;
    case "document":
      return <svg {...common}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h6" /></svg>;
    case "image":
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 16 5-5 4 4 2-2 5 5" /><circle cx="16" cy="9" r="1.5" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a8 8 0 0 0 .1-6l-2.2-.7-1-2.2 1-2A9 9 0 0 0 12 3L11 5.2 8.6 6.1 6.4 5.2A8.6 8.6 0 0 0 3.7 10l1.8 1.6v.8L3.7 14A8.6 8.6 0 0 0 6.4 18.8l2.2-.9 2.4.9L12 21a9 9 0 0 0 5.3-1.1l-1-2 1-2.2Z" /></svg>;
    case "logout":
      return <svg {...common}><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M14 4h5v16h-5" /></svg>;
    case "search":
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>;
    case "bell":
      return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>;
    case "chevron":
      return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
    case "bag":
      return <svg {...common}><path d="M6 8h12l1 13H5L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>;
    case "wallet":
      return <svg {...common}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M16 10h5v6h-5a3 3 0 0 1 0-6Z" /><path d="M3 9h15" /></svg>;
    case "pencil":
      return <svg {...common}><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m14 7 3 3" /></svg>;
    case "eye":
      return <svg {...common}><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case "copy":
      return <svg {...common}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></svg>;
    case "download":
      return <svg {...common}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>;
    case "send":
      return <svg {...common}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>;
    case "chart":
      return <svg {...common}><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-4 3 3 5-7" /><path d="M17 7h2v2" /></svg>;
    case "more":
      return <svg {...common}><path d="M12 5v.01" /><path d="M12 12v.01" /><path d="M12 19v.01" /></svg>;
    case "trash":
      return <svg {...common}><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></svg>;
    case "arrowRight":
      return <svg {...common}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 4 4 10-10" /></svg>;
    case "menu":
      return <svg {...common}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg>;
    case "filter":
      return <svg {...common}><path d="M4 6h16" /><path d="M7 12h10" /><path d="M10 18h4" /></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12" /><path d="m18 6-12 12" /></svg>;
    case "info":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01" /><path d="M11 12h1v4h1" /></svg>;
    case "external":
      return <svg {...common}><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M9 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
  }
}

function normalizeOptions(options) {
  return options.map((option) =>
    typeof option === "string" || typeof option === "number"
      ? { value: String(option), label: String(option) }
      : { value: String(option.value), label: option.label ?? String(option.value) }
  );
}

// Custom Husnalogy dropdown with a fully styled menu (use outside scrollable tables)
function SelectMenu({ value, onChange, options, placeholder = "Select", size = "md", variant = "filter", disabled = false, ariaLabel, className = "" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const items = normalizeOptions(options);
  const selected = items.find((option) => option.value === String(value ?? ""));
  const defaultValue = items[0]?.value;
  const isActive =
    variant === "filter" &&
    value !== undefined &&
    value !== null &&
    String(value) !== "" &&
    String(value) !== String(defaultValue);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const heightClass = size === "sm" ? "h-10 px-3 text-[13px] [@media(pointer:coarse)]:h-11" : "h-11 px-3.5 text-sm";
  const colorClass = disabled
    ? "cursor-not-allowed border-[#303839]/10 bg-[#F3F1EC] text-[#303839]/70"
    : isActive
      ? "border-[#303839] bg-[#303839] text-[#ECE9E1] hover:bg-[#434C4D]"
      : "border-[#303839]/12 bg-white text-[#303839] hover:border-[#303839]/24 hover:bg-[#F8F6F1]";

  return (
    <div ref={containerRef} className={`relative ${open ? "z-30" : ""} ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((current) => !current)}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-[8px] border font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#303839]/30 ${heightClass} ${colorClass} ${open ? "ring-2 ring-[#303839]/25" : ""}`}
      >
        <span className={`truncate ${!selected ? "text-[#303839]/70" : ""}`}>{selected ? selected.label : placeholder}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""} ${isActive ? "text-[#ECE9E1]" : "text-[#303839]/70"}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-[150] mt-1.5 max-h-72 overflow-y-auto overscroll-contain rounded-[10px] border border-[#303839]/10 bg-white p-1.5 shadow-[0_18px_40px_-16px_rgba(48,56,57,0.3)]"
        >
          {items.map((option) => {
            const optionSelected = option.value === String(value ?? "");
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={optionSelected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold transition ${
                  optionSelected ? "rounded-[6px] bg-[#303839]/[0.06] text-[#303839]" : "rounded-[6px] text-[#303839]/80 hover:bg-[#ECE9E1] hover:text-[#303839]"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {optionSelected && <Icon name="check" className="h-4 w-4 shrink-0 text-[#303839]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Custom dropdown styled like SelectMenu, but the menu is rendered in a portal with fixed
// positioning so it escapes scrollable table overflow (no clipping, no extra scroll area).
function StyledNativeSelect({ value, onChange, options, size = "md", ariaLabel, className = "" }) {
  const items = normalizeOptions(options);
  const selected = items.find((option) => option.value === String(value ?? ""));
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const heightClass = size === "sm" ? "h-10 px-3 text-[13px] [@media(pointer:coarse)]:h-11" : "h-11 px-3.5 text-sm";

  const openMenu = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuHeight = Math.min(items.length * 40 + 12, 288);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight + 16 ? rect.top - menuHeight - 6 : rect.bottom + 6;
    const width = Math.max(rect.width, 160);
    setCoords({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top, width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (event) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(event.target) &&
        menuRef.current &&
        !menuRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-[8px] border border-[#303839]/12 bg-white font-semibold text-[#303839] outline-none transition hover:border-[#303839]/24 hover:bg-[#F8F6F1] focus-visible:ring-2 focus-visible:ring-[#303839]/30 ${heightClass} ${open ? "ring-2 ring-[#303839]/25" : ""}`}
      >
        <span className="truncate">{selected ? selected.label : "Select"}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-[#303839]/70 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{ position: "fixed", left: coords.left, top: coords.top, width: coords.width }}
            className="z-[9999] max-h-72 overflow-y-auto overscroll-contain rounded-[10px] border border-[#303839]/10 bg-white p-1.5 font-body shadow-[0_18px_40px_-16px_rgba(48,56,57,0.3)]"
          >
            {items.map((option) => {
              const optionSelected = option.value === String(value ?? "");
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={optionSelected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-semibold transition ${
                    optionSelected ? "rounded-[6px] bg-[#303839]/[0.06] text-[#303839]" : "rounded-[6px] text-[#303839]/80 hover:bg-[#ECE9E1] hover:text-[#303839]"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {optionSelected && <Icon name="check" className="h-4 w-4 shrink-0 text-[#303839]" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

function ProductsSection({ allProducts = [], products, query = "", setQuery, onAdd, statusFilter, setStatusFilter, totalProducts, editingProduct, formOpen, onSaved, onCloseForm, onEdit, onDuplicate, onDelete }: any) {
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [personalizationFilter, setPersonalizationFilter] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  const filterSource = allProducts.length ? allProducts : products;
  const categories = [...new Set(filterSource.map((product) => product.category).filter(Boolean))];
  const productTypes = [...new Set(filterSource.map((product) => product.productType).filter(Boolean))];
  const statusCounts = filterSource.reduce(
    (counts, product) => {
      const key = product.status || "draft";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    },
    {} as Record<string, number>
  );
  const statusTabs = [
    { value: "", label: "All", count: filterSource.length },
    { value: "active", label: "Published", count: statusCounts.active || 0 },
    { value: "draft", label: "Drafts", count: statusCounts.draft || 0 },
    { value: "hidden", label: "Hidden", count: statusCounts.hidden || 0 },
  ];
  const visibleProducts = products
    .filter((product) => !categoryFilter || product.category === categoryFilter)
    .filter((product) => !typeFilter || product.productType === typeFilter)
    .filter((product) => {
      if (!personalizationFilter) return true;
      const hasPersonalization = hasProductPersonalization(product);
      return personalizationFilter === "yes" ? hasPersonalization : !hasPersonalization;
    })
    .sort((a, b) => {
      if (sortBy === "oldest") return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      if (sortBy === "price-high") return Number(b.salePrice ?? b.price ?? 0) - Number(a.salePrice ?? a.price ?? 0);
      if (sortBy === "price-low") return Number(a.salePrice ?? a.price ?? 0) - Number(b.salePrice ?? b.price ?? 0);
      if (sortBy === "name") return String(a.title || "").localeCompare(String(b.title || ""));
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  const filtersActive = Boolean(query || categoryFilter || statusFilter || typeFilter || personalizationFilter || sortBy !== "newest");
  const productCountText =
    visibleProducts.length === totalProducts
      ? `${visibleProducts.length} product${visibleProducts.length === 1 ? "" : "s"}`
      : `${visibleProducts.length} of ${totalProducts} products`;
  const resetFilters = () => {
    setQuery("");
    setCategoryFilter("");
    setStatusFilter("");
    setTypeFilter("");
    setPersonalizationFilter("");
    setSortBy("newest");
  };

  return (
    <div className="space-y-6">
      {formOpen && (
        <ProductUploadForm
          key={editingProduct?.id || "new-product"}
          product={editingProduct}
          onSaved={onSaved}
          onClose={onCloseForm}
        />
      )}

      <section className={`${CARD} overflow-hidden`} aria-label="Product list">
        {/* Search + add */}
        <div className="flex flex-col gap-3 border-b border-[#303839]/8 p-4 sm:flex-row sm:items-center sm:p-5">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search products</span>
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#303839]/60">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, category, tag or SKU"
              className="h-11 w-full border border-[#303839]/15 bg-white pl-10 pr-3 text-sm text-[#303839] outline-none transition-colors placeholder:text-[#303839]/55 focus:border-[#303839]/50 focus:ring-2 focus:ring-[#303839]/10"
            />
          </label>
          <button type="button" onClick={onAdd} className={`${BUTTON_PRIMARY} shrink-0`}>
            <Icon name="plus" className="h-4 w-4" />
            Add product
          </button>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-[#303839]/8 px-4 sm:px-5" role="tablist" aria-label="Filter by status">
          {statusTabs.map((tab) => {
            const selected = (statusFilter || "") === tab.value;
            return (
              <button
                key={tab.value || "all"}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setStatusFilter(tab.value)}
                className={`relative -mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors ${
                  selected ? "border-[#303839] text-[#303839]" : "border-transparent text-[#303839]/65 hover:text-[#303839]"
                }`}
              >
                {tab.label}
                <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums ${selected ? "bg-[#303839] text-white" : "bg-[#F3F1EC] text-[#303839]/80"}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Secondary filters */}
        <div className="flex flex-col gap-3 p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
          <p className="text-sm text-[#303839]/75" aria-live="polite">
            <span className="font-semibold text-[#303839]">{productCountText}</span>
            {filtersActive && (
              <button type="button" onClick={resetFilters} className="ml-3 text-sm font-semibold text-[#303839] underline underline-offset-4">
                Clear filters
              </button>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center xl:justify-end">
            <SelectMenu
              value={categoryFilter}
              onChange={setCategoryFilter}
              size="sm"
              ariaLabel="Filter by category"
              className="min-w-0 sm:w-[168px]"
              options={[{ value: "", label: "All categories" }, ...categories]}
            />
            <SelectMenu
              value={typeFilter}
              onChange={setTypeFilter}
              size="sm"
              ariaLabel="Filter by product type"
              className="min-w-0 sm:w-[148px]"
              options={[{ value: "", label: "All types" }, ...productTypes]}
            />
            <SelectMenu
              value={personalizationFilter}
              onChange={setPersonalizationFilter}
              size="sm"
              ariaLabel="Filter by personalization"
              className="min-w-0 sm:w-[176px]"
              options={[
                { value: "", label: "Any personalization" },
                { value: "yes", label: "Personalized" },
                { value: "no", label: "Not personalized" },
              ]}
            />
            <SelectMenu
              value={sortBy}
              onChange={setSortBy}
              size="sm"
              ariaLabel="Sort products"
              className="min-w-0 sm:w-[160px]"
              options={[
                { value: "newest", label: "Newest first" },
                { value: "oldest", label: "Oldest first" },
                { value: "name", label: "Name A–Z" },
                { value: "price-high", label: "Price: high to low" },
                { value: "price-low", label: "Price: low to high" },
              ]}
            />
          </div>
        </div>

        <div className="grid gap-3 px-4 pb-4 sm:gap-4 sm:px-5 sm:pb-5 md:grid-cols-2 2xl:grid-cols-3">
          {visibleProducts.map((product) => {
            const hasPersonalization = hasProductPersonalization(product);
            const statusLabel = product.status === "active" ? "Published" : product.status === "hidden" ? "Hidden" : "Draft";
            const priceValue = product.salePrice ?? product.price;
            const hasPrice = priceValue !== null && priceValue !== undefined && priceValue !== "";
            const hasOldPrice = product.oldPrice !== null && product.oldPrice !== undefined && product.oldPrice !== "";
            const flags = [
              (product.featured || product.isFeatured) && "Featured",
              product.isNew && "New arrival",
              product.isBestSeller && "Best seller",
              hasPersonalization && "Personalized",
            ].filter(Boolean);
            return (
              <article key={product.id} className="flex min-w-0 flex-col rounded-[12px] border border-[#303839]/10 bg-white transition-colors hover:border-[#303839]/25">
                <div className="flex gap-3 p-3.5 sm:p-4">
                  <button type="button" onClick={() => onEdit(product)} className="shrink-0" aria-label={`Edit ${product.title || "product"}`} tabIndex={-1}>
                    <img src={getProductImage(product)} alt="" loading="lazy" className="h-[76px] w-[76px] rounded-[8px] border border-[#303839]/8 bg-[#F8F6F1] object-cover sm:h-20 sm:w-20" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-[#303839]">{product.title || "Untitled product"}</h3>
                      <div className="shrink-0 text-right">
                        {hasPrice ? (
                          <p className="text-sm font-semibold tabular-nums text-[#303839]">{formatProductPrice(priceValue, product.currency)}</p>
                        ) : (
                          <p className="text-xs font-semibold text-amber-800">No price set</p>
                        )}
                        {hasOldPrice ? <p className="text-xs tabular-nums text-[#303839]/70 line-through">{formatProductPrice(product.oldPrice, product.currency)}</p> : null}
                      </div>
                    </div>
                    <p className="mt-1 truncate text-xs text-[#303839]/70">
                      {product.category || "No department"} · SKU {product.sku || product.slug || product.id}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={product.status || "draft"} label={statusLabel} />
                      {product.isStockOut ? (
                        <StatusBadge status="flagged" label={`Out of stock${product.comingInDays ? ` · back in ${product.comingInDays}d` : ""}`} />
                      ) : null}
                      {product.visibility === "direct" && (
                        <span className="inline-flex h-6 items-center rounded-full border border-[#303839]/12 bg-white px-2.5 text-[11px] font-semibold text-[#303839]/80">Direct link only</span>
                      )}
                    </div>
                  </div>
                </div>

                {flags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-3.5 pb-3 sm:px-4">
                    {flags.map((flag) => (
                      <span key={flag} className="inline-flex h-6 items-center rounded-full bg-[#F3F1EC] px-2.5 text-[11px] font-semibold text-[#303839]/80">
                        {flag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 border-t border-[#303839]/8 px-3.5 py-2.5 sm:px-4">
                  <span className="truncate text-xs text-[#303839]/70">Added {formatDate(product.createdAt)}</span>
                  <div className="flex shrink-0 gap-1.5">
                    <button type="button" onClick={() => onEdit(product)} className={`${BUTTON_SM_SECONDARY}`} aria-label={`Edit ${product.title || "product"}`}>
                      <Icon name="pencil" className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button type="button" onClick={() => onDuplicate(product)} title="Duplicate" className={ICON_BUTTON} aria-label={`Duplicate ${product.title || "product"}`}><Icon name="copy" className="h-4 w-4" /></button>
                    <a href={`/products/${product.slug}`} target="_blank" rel="noreferrer" title="View on the website" className={ICON_BUTTON} aria-label={`View ${product.title || "product"} on the website`}><Icon name="eye" className="h-4 w-4" /></a>
                    <button type="button" onClick={() => onDelete(product.id)} title="Move to Recently Deleted" className={`${ICON_BUTTON} hover:border-red-200 hover:bg-red-50 hover:text-red-700`} aria-label={`Delete ${product.title || "product"}`}><Icon name="trash" className="h-4 w-4" /></button>
                  </div>
                </div>
              </article>
            );
          })}
          {!visibleProducts.length && (
            <div className="col-span-full">
              <EmptyState
                icon="box"
                title={totalProducts ? "No products match your search or filters" : "You have no products yet"}
                hint={totalProducts ? "Clear the filters to see all of your products again." : "Add your first product to start selling."}
                action={
                  totalProducts ? (
                    <button type="button" onClick={resetFilters} className={BUTTON_SM_SECONDARY}>Clear filters</button>
                  ) : (
                    <button type="button" onClick={onAdd} className={BUTTON_PRIMARY}>Add product</button>
                  )
                }
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// Below the two-column breakpoint the detail panel sits under the list, so a
// selection would otherwise change something the admin cannot see.
function revealOnSmallScreens(ref, query = "(max-width: 1279px)") {
  if (typeof window === "undefined" || !window.matchMedia(query).matches) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }));
}

function ProductReviewsSection({ products, query, setQuery, onDeleteReview }) {
  const [ratingFilter, setRatingFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedReviewKey, setSelectedReviewKey] = useState("");
  const detailsRef = useRef(null);
  const selectReview = (key) => {
    setSelectedReviewKey(key);
    revealOnSmallScreens(detailsRef, "(max-width: 1535px)");
  };

  const reviews = products.flatMap((product) =>
    Array.isArray(product.reviews)
      ? product.reviews.map((review, reviewIndex) => ({
          ...review,
          productId: product.id,
          productTitle: product.title,
          productSku: product.sku || product.slug,
          productSlug: product.slug,
          productType: product.productType || product.category || "Product",
          productImage: getProductImage(product),
          productPrice: product.salePrice ?? product.price,
          reviewKey: `${product.id}-${review.id || review.createdAt || reviewIndex}`,
        }))
      : []
  );

  const getReviewStatus = (review) => {
    const rawStatus = String(review.status || "published").toLowerCase();
    if (rawStatus === "published" || rawStatus === "active" || rawStatus === "approved") return "approved";
    if (rawStatus === "flagged") return "flagged";
    if (rawStatus === "hidden") return "hidden";
    if (rawStatus === "pending") return "pending";
    return rawStatus;
  };
  const getReviewStatusLabel = (review) => {
    const status = getReviewStatus(review);
    if (status === "approved") return "Approved";
    if (status === "flagged") return "Flagged";
    if (status === "hidden") return "Hidden";
    if (status === "pending") return "Pending";
    return status.replaceAll("-", " ");
  };
  const getReviewEmail = (review) => review.customerEmail || review.email || "No email";
  const getReviewText = (review) => review.text || review.comment || "No review text.";
  const renderRating = (rating) => {
    const value = Number(rating);
    if (!Number.isFinite(value)) return "0 / 5";
    return `${value.toFixed(1).replace(".0", "")} / 5`;
  };
  const clearReviewFilters = () => {
    setQuery("");
    setRatingFilter("");
    setStatusFilter("");
    setTypeFilter("");
    setSortBy("newest");
  };

  const productTypes = [...new Set(reviews.map((review) => review.productType).filter(Boolean))];
  const ratedReviews = reviews
    .map((review) => Number(review.rating))
    .filter((rating) => Number.isFinite(rating));
  const averageRating = ratedReviews.length
    ? (ratedReviews.reduce((total, rating) => total + rating, 0) / ratedReviews.length).toFixed(1)
    : "0.0";
  const approvedReviews = reviews.filter((review) => getReviewStatus(review) === "approved").length;
  const verifiedReviews = reviews.filter((review) => review.verifiedPurchase !== false).length;
  const flaggedReviews = reviews.filter((review) => getReviewStatus(review) === "flagged").length;
  const now = new Date();
  const currentRangeStart = new Date(now);
  currentRangeStart.setDate(now.getDate() - 6);
  currentRangeStart.setHours(0, 0, 0, 0);
  const previousRangeStart = new Date(currentRangeStart);
  previousRangeStart.setDate(currentRangeStart.getDate() - 7);
  const previousRangeEnd = new Date(currentRangeStart);
  previousRangeEnd.setMilliseconds(-1);
  const reviewsInRange = (start, end) =>
    reviews.filter((review) => {
      const date = new Date(review.createdAt || 0);
      return !Number.isNaN(date.getTime()) && date >= start && date <= end;
    });
  const currentWeekReviews = reviewsInRange(currentRangeStart, now);
  const previousWeekReviews = reviewsInRange(previousRangeStart, previousRangeEnd);
  const averageFor = (items) => {
    const values = items.map((review) => Number(review.rating)).filter((rating) => Number.isFinite(rating));
    return values.length ? values.reduce((total, rating) => total + rating, 0) / values.length : 0;
  };
  const changeLabel = (current, previous) => {
    if (!previous) return current ? "+100%" : "0%";
    const change = Math.round(((current - previous) / previous) * 100);
    return `${change > 0 ? "+" : ""}${change}%`;
  };

  const normalizedQuery = String(query || "").trim().toLowerCase();
  const filteredReviews = reviews
    .filter((review) => {
      const searchable = [
        review.text,
        review.comment,
        review.name,
        review.customerEmail,
        review.email,
        review.productTitle,
        review.productSlug,
        review.productSku,
      ].join(" ").toLowerCase();
      return !normalizedQuery || searchable.includes(normalizedQuery);
    })
    .filter((review) => !ratingFilter || Number(review.rating || 0) === Number(ratingFilter))
    .filter((review) => !statusFilter || getReviewStatus(review) === statusFilter)
    .filter((review) => !typeFilter || review.productType === typeFilter)
    .sort((a, b) => {
      if (sortBy === "rating-high") return Number(b.rating || 0) - Number(a.rating || 0);
      if (sortBy === "rating-low") return Number(a.rating || 0) - Number(b.rating || 0);
      if (sortBy === "oldest") return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

  const selectedReview =
    filteredReviews.find((review) => review.reviewKey === selectedReviewKey) ||
    filteredReviews[0] ||
    null;

  useEffect(() => {
    if (!filteredReviews.length && selectedReviewKey) {
      setSelectedReviewKey("");
      return;
    }
    if (selectedReview?.reviewKey && selectedReview.reviewKey !== selectedReviewKey) {
      setSelectedReviewKey(selectedReview.reviewKey);
    }
  }, [filteredReviews, selectedReview, selectedReviewKey]);

  return (
    <div className="max-w-full space-y-5 overflow-hidden">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[
          { label: "Total Reviews", value: reviews.length.toLocaleString(), icon: "star", note: "all customer reviews", change: changeLabel(currentWeekReviews.length, previousWeekReviews.length) },
          {
            label: "Approved Reviews",
            value: approvedReviews.toLocaleString(),
            icon: "check",
            note: "published automatically",
            change: changeLabel(
              currentWeekReviews.filter((review) => getReviewStatus(review) === "approved").length,
              previousWeekReviews.filter((review) => getReviewStatus(review) === "approved").length
            ),
          },
          { label: "Average Rating", value: `${averageRating} / 5`, icon: "star", note: "across all products", change: changeLabel(averageFor(currentWeekReviews), averageFor(previousWeekReviews)) },
          {
            label: "Flagged Reviews",
            invertChange: true,
            value: flaggedReviews.toLocaleString(),
            icon: "document",
            note: `${verifiedReviews.toLocaleString()} verified purchases`,
            change: changeLabel(
              currentWeekReviews.filter((review) => getReviewStatus(review) === "flagged").length,
              previousWeekReviews.filter((review) => getReviewStatus(review) === "flagged").length
            ),
          },
        ].map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid min-w-0 max-w-full items-start gap-5 2xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <section className={`${CARD} p-4 sm:p-6`}>
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-base font-semibold text-[#303839] sm:text-lg">All Reviews</h2>
            <div className="relative w-full lg:max-w-[260px]">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#303839]/70" />
              <input
                type="search"
                aria-label="Search reviews"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search reviews…"
                className="h-10 w-full rounded-[8px] border border-[#303839]/10 bg-white pl-9 pr-3 text-sm font-medium text-[#303839] outline-none transition placeholder:text-[#303839]/50 hover:border-[#303839]/20 "
              />
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <SelectMenu value={ratingFilter} onChange={setRatingFilter} size="sm" ariaLabel="Filter by rating" className="min-w-0 sm:w-[150px]" options={[{ value: "", label: "All Ratings" }, ...[5, 4, 3, 2, 1].map((rating) => ({ value: String(rating), label: `${rating} Stars` }))]} />
            <SelectMenu
              value={statusFilter}
              onChange={setStatusFilter}
              size="sm"
              ariaLabel="Filter by status"
              className="min-w-0 sm:w-[150px]"
              options={[
                { value: "", label: "All Statuses" },
                { value: "approved", label: "Approved" },
                { value: "flagged", label: "Flagged" },
                { value: "hidden", label: "Hidden" },
                { value: "pending", label: "Pending" },
              ]}
            />
            <SelectMenu value={typeFilter} onChange={setTypeFilter} size="sm" ariaLabel="Filter by product type" className="min-w-0 sm:w-[150px]" options={[{ value: "", label: "All Types" }, ...productTypes]} />
            <SelectMenu
              value={sortBy}
              onChange={setSortBy}
              size="sm"
              ariaLabel="Sort reviews"
              className="min-w-0 sm:w-[150px]"
              options={[
                { value: "newest", label: "Newest First" },
                { value: "oldest", label: "Oldest First" },
                { value: "rating-high", label: "Highest Rating" },
                { value: "rating-low", label: "Lowest Rating" },
              ]}
            />
          </div>

          {!filteredReviews.length ? (
            <div className="grid min-h-[260px] place-items-center rounded-[10px] border border-dashed border-[#303839]/14 bg-white px-6 py-10 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]/72">
                  <Icon name="document" className="h-6 w-6" />
                </span>
                <p className="mt-5 text-sm font-semibold text-[#303839]">No reviews match the current filters.</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#303839]/70">
                  Try adjusting your filters or search to find what you are looking for.
                </p>
                <button
                  type="button"
                  onClick={clearReviewFilters}
                  className="mt-5 inline-flex h-10 items-center justify-center rounded-[8px] border border-[#303839]/10 bg-white px-4 text-xs font-semibold text-[#303839] transition hover:border-[#303839]/24 hover:bg-[#F3F1EC]"
                >
                  Reset filters
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid min-w-0 gap-3 xl:hidden">
                {filteredReviews.map((review) => {
                  const isSelected = selectedReview?.reviewKey === review.reviewKey;
                  return (
                    <article
                      key={review.reviewKey}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectReview(review.reviewKey)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectReview(review.reviewKey);
                        }
                      }}
                      className={`min-w-0 cursor-pointer overflow-hidden rounded-[10px] border p-4 text-left transition ${
                        isSelected ? "border-[#303839]/22 bg-[#F3F1EC]" : "border-[#303839]/10 bg-white hover:border-[#303839]/20 hover:bg-[#F8F6F1]"
                      }`}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-xs font-semibold text-[#303839]">{getInitials(review.name || "Customer")}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-[#303839]">{review.name || "Customer"}</p>
                          <p className="truncate text-xs text-[#303839]/70">{getReviewEmail(review)}</p>
                        </div>
                        <ReviewStatusBadge label={getReviewStatusLabel(review)} status={getReviewStatus(review)} />
                      </div>
                      <div className="mt-4 flex min-w-0 items-center gap-3 rounded-[8px] bg-[#F8F6F1] p-2">
                        <img src={review.productImage} alt="" className="h-12 w-12 shrink-0 rounded-[7px] object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[#303839]">{review.productTitle || "Product"}</p>
                          <p className="truncate text-xs text-[#303839]/70">{renderRating(review.rating)} - {formatDate(review.createdAt)}</p>
                        </div>
                      </div>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#303839]/75">{getReviewText(review)}</p>
                      <div className="mt-4 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#303839]/70">Tap to view details</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteReview(review.productId, review.id);
                          }}
                          className="inline-flex h-9 items-center justify-center rounded-[8px] border border-[#303839]/10 bg-white px-3 text-xs font-semibold text-[#303839]/70 transition hover:border-[#303839]/24 hover:bg-[#F3F1EC] hover:text-[#303839]"
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-hidden rounded-[10px] border border-[#303839]/10 xl:block">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="bg-[#F3F1EC] text-xs font-semibold text-[#303839]/75">
                    <tr>
                      <th className="w-[18%] px-4 py-4">Reviewer</th>
                      <th className="w-[20%] px-4 py-4">Product</th>
                      <th className="w-[10%] px-4 py-4">Rating</th>
                      <th className="w-[22%] px-4 py-4">Review</th>
                      <th className="w-[11%] px-4 py-4">Date</th>
                      <th className="w-[11%] px-4 py-4">Status</th>
                      <th className="w-[8%] px-4 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#303839]/8">
                    {filteredReviews.map((review) => {
                      const isSelected = selectedReview?.reviewKey === review.reviewKey;
                      return (
                        <tr
                          key={review.reviewKey}
                          tabIndex={0}
                          className={`cursor-pointer transition hover:bg-[#F8F6F1] ${isSelected ? "bg-[#F3F1EC]" : "bg-white"}`}
                          onClick={() => selectReview(review.reviewKey)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              selectReview(review.reviewKey);
                            }
                          }}
                        >
                          <td className="px-4 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-xs font-semibold text-[#303839]">{getInitials(review.name || "Customer")}</span>
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-[#303839]">{review.name || "Customer"}</span>
                                <span className="block truncate text-xs text-[#303839]/70">{getReviewEmail(review)}</span>
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <img src={review.productImage} alt="" className="h-12 w-12 shrink-0 rounded-[7px] object-cover" />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-[#303839]">{review.productTitle || "Product"}</span>
                                <span className="block truncate text-xs text-[#303839]/70">SKU: {review.productSku || "N/A"}</span>
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 font-semibold text-[#303839]">{renderRating(review.rating)}</td>
                          <td className="px-4 py-4 text-xs leading-5 text-[#303839]/75"><span className="line-clamp-2">{getReviewText(review)}</span></td>
                          <td className="px-4 py-4 text-xs font-medium text-[#303839]/75">{formatDate(review.createdAt)}</td>
                          <td className="px-4 py-4"><ReviewStatusBadge label={getReviewStatusLabel(review)} status={getReviewStatus(review)} /></td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDeleteReview(review.productId, review.id);
                                }}
                                className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#303839]/10 bg-white text-[#303839]/70 transition hover:border-[#303839]/24 hover:bg-[#F3F1EC] hover:text-[#303839]"
                                aria-label="Delete review"
                              >
                                <Icon name="trash" className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <div ref={detailsRef} className="min-w-0 scroll-mt-20">
        <ReviewDetailsPanel
          review={selectedReview}
          renderRating={renderRating}
          getReviewEmail={getReviewEmail}
          getReviewText={getReviewText}
          getReviewStatus={getReviewStatus}
          getReviewStatusLabel={getReviewStatusLabel}
          onDeleteReview={onDeleteReview}
        />
        </div>
      </div>
    </div>
  );
}

function ReviewStatusBadge({ label, status }) {
  return <StatusBadge status={status} label={label} />;
}

function ReviewDetailsPanel({ review, renderRating, getReviewEmail, getReviewText, getReviewStatus, getReviewStatusLabel, onDeleteReview }) {
  return (
    <section className={`${CARD} p-4 sm:p-6`}>
      <h2 className="text-base font-semibold text-[#303839] sm:text-lg">Review Details</h2>
      {!review ? (
        <div className="mt-4 overflow-hidden rounded-[10px] border border-[#303839]/10">
          <div className="grid min-h-[170px] place-items-center px-6 py-8 text-center">
            <div>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]/75">
                <Icon name="document" className="h-6 w-6" />
              </span>
              <p className="mt-5 text-sm font-semibold text-[#303839]">No review selected.</p>
              <p className="mx-auto mt-2 max-w-[280px] text-sm leading-6 text-[#303839]/70">
                Select a review from the list to view full details and moderation options.
              </p>
            </div>
          </div>
          <div className="space-y-4 border-t border-[#303839]/8 px-5 py-6">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="grid grid-cols-[70px_minmax(0,1fr)] gap-5">
                <span className="h-2.5 rounded-full bg-[#ECE9E1]" />
                <span className="h-2.5 rounded-full bg-[#F3F1EC]" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 min-w-0 space-y-4">
          <div className="rounded-[10px] border border-[#303839]/10 bg-white p-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-lg font-semibold text-[#303839]">{getInitials(review.name || "Customer")}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-[#303839]">{review.name || "Customer"}</p>
                <p className="truncate text-xs text-[#303839]/70">{getReviewEmail(review)}</p>
                <p className="mt-3 text-xs font-semibold text-[#303839]/70">
                  {review.verifiedPurchase !== false ? "Verified purchase" : "Not verified"}
                </p>
              </div>
              <ReviewStatusBadge label={getReviewStatusLabel(review)} status={getReviewStatus(review)} />
            </div>
          </div>

          <div className="rounded-[10px] border border-[#303839]/10 bg-[#F8F6F1] p-4">
            <div className="flex min-w-0 gap-4">
              <img src={review.productImage} alt="" className="h-16 w-16 shrink-0 rounded-[8px] object-cover sm:h-20 sm:w-20" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-[#303839]">{review.productTitle || "Product"}</p>
                <p className="mt-1 truncate text-xs text-[#303839]/70">SKU: {review.productSku || "N/A"}</p>
                <p className="mt-2 text-xs text-[#303839]/70">Product Type: {review.productType || "Product"}</p>
                <p className="mt-2 text-sm font-semibold text-[#303839]">{formatProductPrice(review.productPrice)}</p>
                {review.productSlug && (
                  <a href={`/products/${review.productSlug}`} target="_blank" rel="noreferrer" className="-my-1 mt-2 inline-flex min-h-8 items-center gap-1 py-1 text-xs font-semibold text-[#303839]/80 underline-offset-2 transition-colors hover:text-[#303839] hover:underline">
                    View Product
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[10px] border border-[#303839]/10 bg-white p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoPair label="Rating" value={renderRating(review.rating)} />
              <InfoPair label="Review Date" value={formatDate(review.createdAt)} />
              <InfoPair label="Review Source" value={review.source || "Website"} />
              <InfoPair label="Verified Purchase" value={review.verifiedPurchase !== false ? "Verified" : "Not verified"} />
            </div>
            <div className="mt-5 border-t border-[#303839]/8 pt-4">
              <p className="text-xs font-semibold text-[#303839]/70">Review</p>
              <p className="mt-2 break-words text-sm leading-6 text-[#303839]/72">{getReviewText(review)}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onDeleteReview(review.productId, review.id)}
            className="inline-flex h-11 w-full items-center justify-center rounded-[8px] border border-[#303839]/10 bg-white text-sm font-semibold text-[#303839]/75 transition hover:border-[#303839]/24 hover:bg-[#F3F1EC] hover:text-[#303839]"
          >
            Delete Review
          </button>
        </div>
      )}
    </section>
  );
}

function InfoPair({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[#303839]/70">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[#303839]">{value || "Not set"}</p>
    </div>
  );
}

function RecentlyDeletedSection({ products, onRestore, onPermanentDelete }) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
        <MetricCard label="Deleted products" value={products.length.toLocaleString()} icon="image" note="Hidden from storefront" />
        <MetricCard label="Restorable" value={products.length.toLocaleString()} icon="box" note="Restore returns as draft" />
        <MetricCard label="Permanent delete" value="Locked" icon="settings" note="Requires permission credentials" />
      </div>

      <Panel
        title="Recently deleted products"
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-800">
            <Icon name="info" className="h-3.5 w-3.5" />
            Permanent delete is credential protected
          </span>
        }
      >
        {products.length ? (
          <>
            <ul className="divide-y divide-[#303839]/8 md:hidden">
              {products.map((product) => (
                <li key={product.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <img src={getProductImage(product)} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-[8px] border border-[#303839]/8 bg-[#F8F6F1] object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{product.title}</p>
                      <p className="mt-0.5 truncate text-xs text-[#303839]/70">
                        {product.category || "Uncategorized"} · Deleted {formatDate(product.deletedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => onRestore(product.id)} className={`${BUTTON_SM_SECONDARY} h-10`}>
                      Restore
                    </button>
                    <button type="button" onClick={() => onPermanentDelete(product.id)} className={`${BUTTON_SM_DANGER} h-10`}>
                      Delete forever
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="-mx-4 hidden overflow-x-auto sm:-mx-6 md:block">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-y border-[#303839]/8 bg-[#F8F6F1] text-xs font-semibold text-[#303839]/75">
                  <tr>
                    <th scope="col" className="py-3 pl-4 pr-3 font-semibold sm:pl-6">Product</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Category</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Deleted</th>
                    <th scope="col" className="py-3 pl-3 pr-4 text-right font-semibold sm:pr-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#303839]/8">
                  {products.map((product) => (
                    <tr key={product.id} className="transition-colors hover:bg-[#FCFBF9]">
                      <td className="py-3 pl-4 pr-3 sm:pl-6">
                        <div className="flex min-w-0 items-center gap-3">
                          <img src={getProductImage(product)} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-[8px] border border-[#303839]/8 bg-[#F8F6F1] object-cover" />
                          <div className="min-w-0">
                            <p className="max-w-[280px] truncate font-semibold">{product.title}</p>
                            <p className="mt-0.5 max-w-[280px] truncate text-xs text-[#303839]/70">/{product.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[#303839]/80">{product.category || "Uncategorized"}</td>
                      <td className="px-3 py-3"><StatusBadge status="deleted" /></td>
                      <td className="whitespace-nowrap px-3 py-3 text-[#303839]/80">{formatDate(product.deletedAt)}</td>
                      <td className="py-3 pl-3 pr-4 sm:pr-6">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => onRestore(product.id)} title="Bring this product back to your catalog as a draft" className={BUTTON_SM_SECONDARY}>Restore</button>
                          <button type="button" onClick={() => onPermanentDelete(product.id)} title="Remove forever — this cannot be undone" className={BUTTON_SM_DANGER}>Delete forever</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState
            icon="trash"
            title="Nothing has been deleted"
            hint="When you delete a product, it is kept here as a safety net so you can restore it later."
          />
        )}
      </Panel>
    </div>
  );
}

function CollectionsSection({ collections = [], products, query, form, setForm, editingId, setEditingId, formOpen, setFormOpen, onSubmit, onEdit, onDelete, onToggleTrendingCollection, onToggleSuiteCollection }) {
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const [sortBy, setSortBy] = useState("name");
  const [collapsedParents, setCollapsedParents] = useState({});
  const activeProducts = products.filter((product) => product.status !== "deleted");

  const getCollectionCount = (collection) => {
    return activeProducts.filter((product) => productMatchesCollection(product, collection)).length;
  };
  const getCollectionProducts = (collection) => {
    return activeProducts.filter((product) => productMatchesCollection(product, collection));
  };

  const collectionRows = collections.map((collection) => ({
    ...collection,
    productCount: getCollectionCount(collection),
  }));
  const parentOptions = [
    { value: "", label: "None (top level)" },
    ...collectionRows
      .filter((collection) => collection.id !== editingId && !collection.parentCollectionId)
      .map((collection) => ({ value: collection.id, label: collection.name })),
  ];
  const isParentCollectionForm = !form.parentCollectionId;
  const collectionIds = new Set(collectionRows.map((collection) => collection.id));
  const productsInCollections = activeProducts.filter((product) => {
    if (Array.isArray(product.collectionIds) && product.collectionIds.some((id) => collectionIds.has(id))) return true;
    return collectionRows.some((collection) => productMatchesCollection(product, collection));
  });
  const trendingCollections = collectionRows.filter((collection) => collection.isTrendingWedding);
  const unassignedProductCount = Math.max(activeProducts.length - productsInCollections.length, 0);
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const collectionMatchesQuery = (collection) => {
    const searchable = [collection.name, collection.slug, collection.description].join(" ").toLowerCase();
    return !normalizedQuery || searchable.includes(normalizedQuery);
  };
  const sortedCollections = [...collectionRows].sort((a, b) => {
    if (sortBy === "products") return b.productCount - a.productCount;
    if (sortBy === "trending") return Number(b.isTrendingWedding) - Number(a.isTrendingWedding) || String(a.name || "").localeCompare(String(b.name || ""));
    if (sortBy === "newest") return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  const allParents = sortedCollections.filter((collection) => !collection.parentCollectionId);
  const parentRows = allParents.filter((parent) => {
    const children = sortedCollections.filter((collection) => collection.parentCollectionId === parent.id);
    return collectionMatchesQuery(parent) || children.some(collectionMatchesQuery);
  });
  const getChildCollections = (parent) => {
    const parentMatches = collectionMatchesQuery(parent);
    return sortedCollections.filter((collection) => {
      if (collection.parentCollectionId !== parent.id) return false;
      return parentMatches || collectionMatchesQuery(collection);
    });
  };
  const toggleParentCollapsed = (id) => {
    setCollapsedParents((current) => ({ ...current, [id]: !current[id] }));
  };
  const comparisonText = (count) => (count ? "+100%" : "0%");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <CollectionMetricCard label="Total Collections" value={collectionRows.length.toLocaleString()} icon="grid" note="Product collection records" comparison={comparisonText(collectionRows.length)} />
        <CollectionMetricCard label="Wedding Trending" value={trendingCollections.length.toLocaleString()} icon="star" note="Shown on Wedding page" comparison={comparisonText(trendingCollections.length)} />
        <CollectionMetricCard label="Products in Collections" value={productsInCollections.length.toLocaleString()} icon="box" note="Linked to any collection" comparison={comparisonText(productsInCollections.length)} />
        <CollectionMetricCard label="Unassigned Products" value={unassignedProductCount.toLocaleString()} icon="document" note="No collection link" comparison="0%" />
      </div>

      {formOpen && (
        <Panel title={editingId ? "Edit Collection" : "Add Collection"}>
          <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-2">
            <AdminInput label="Name" value={form.name} onChange={(value) => update("name", value)} required />
            <AdminSelect
              label="Parent collection"
              value={form.parentCollectionId || ""}
              onChange={(value) => {
                update("parentCollectionId", value);
                if (value) {
                  update("isTrendingWedding", false);
                  update("isSuite", false);
                }
              }}
              options={parentOptions}
            />
            {isParentCollectionForm && (
              <div className="grid gap-3 lg:col-span-2 lg:grid-cols-2">
                <label className="flex items-start gap-3 rounded-[10px] border border-[#303839]/10 bg-[#F8F6F1] px-4 py-3">
                  <input
                    type="checkbox"
                    checked={Boolean(form.isSuite)}
                    onChange={(event) => update("isSuite", event.target.checked)}
                    className="mt-1 h-4 w-4 accent-[#303839]"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-[#303839]">Suite collection</span>
                    <span className="mt-1 block text-xs leading-5 text-[#303839]/70">Use &ldquo;Shop the {form.name || "collection"} suite&rdquo; on product pages.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-[10px] border border-[#303839]/10 bg-[#F8F6F1] px-4 py-3">
                  <input
                    type="checkbox"
                    checked={Boolean(form.isTrendingWedding)}
                    onChange={(event) => update("isTrendingWedding", event.target.checked)}
                    className="mt-1 h-4 w-4 accent-[#303839]"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-[#303839]">Trending wedding collection</span>
                    <span className="mt-1 block text-xs leading-5 text-[#303839]/70">Show this collection in the Wedding page Trending Wedding Collections row.</span>
                  </span>
                </label>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <button type="submit" className="h-12 rounded-[8px] bg-[#303839] px-6 text-sm font-semibold text-white transition hover:bg-[#434C4D]">
                {editingId ? "Update Collection" : "Create Collection"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyCollection);
                  setFormOpen(false);
                }}
                className="h-12 rounded-[8px] border border-[#303839]/14 px-6 text-sm font-semibold transition hover:bg-[#F3F1EC]"
              >
                Cancel
              </button>
            </div>
          </form>
        </Panel>
      )}

      <section className={`${CARD} p-4 sm:p-6`}>
        <div className="mb-5 flex flex-col gap-4 border-b border-[#303839]/8 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#303839] sm:text-lg">Collection Manager</h2>
            <p className="mt-1 text-sm font-medium text-[#303839]/70">Organize collections with a parent and child hierarchy.</p>
          </div>
          <SelectMenu
            value={sortBy}
            onChange={setSortBy}
            size="sm"
            ariaLabel="Sort collections"
            className="w-full min-w-[190px] max-w-[230px]"
            options={[
              { value: "name", label: "Sort by: Name A-Z" },
              { value: "products", label: "Sort by: Product Count" },
              { value: "trending", label: "Sort by: Trending First" },
              { value: "newest", label: "Sort by: Newest" },
            ]}
          />
        </div>

        <div className="space-y-4">
          {parentRows.map((parent) => {
            const children = getChildCollections(parent);
            const parentProducts = getCollectionProducts(parent);
            const collapsed = Boolean(collapsedParents[parent.id]);

            return (
              <article key={parent.id} className="rounded-[12px] border border-[#303839]/10 bg-white shadow-[0_1px_2px_rgba(48,56,57,0.04)]">
                <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-3 p-4 lg:grid-cols-[40px_minmax(0,1fr)_auto] lg:items-start">
                  <button
                    type="button"
                    onClick={() => toggleParentCollapsed(parent.id)}
                    aria-expanded={!collapsed}
                    className={`${ICON_BUTTON} h-10 w-10`}
                    aria-label={`${collapsed ? "Expand" : "Collapse"} ${parent.name || "collection"}`}
                  >
                    <Icon name="chevron" className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : "rotate-0"}`} />
                  </button>

                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#303839]/70">Parent Collection</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 break-words text-lg font-semibold leading-snug text-[#303839] sm:text-xl">{parent.name || "Untitled collection"}</h3>
                      <CollectionBadgeButton
                        active={Boolean(parent.isTrendingWedding)}
                        activeLabel="Trending Wedding"
                        inactiveLabel="Mark Trending"
                        title="Toggle Trending Wedding collection"
                        onClick={() => onToggleTrendingCollection(parent.id, !parent.isTrendingWedding)}
                      />
                      <CollectionBadgeButton
                        active={Boolean(parent.isSuite)}
                        activeLabel="Suite"
                        inactiveLabel="Suite"
                        title="Toggle Suite collection"
                        muted
                        onClick={() => onToggleSuiteCollection(parent.id, !parent.isSuite)}
                      />
                    </div>
                    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[#303839]/70">
                      <span className="inline-flex items-center gap-1.5"><Icon name="box" className="h-3.5 w-3.5" />{children.length} child collection{children.length === 1 ? "" : "s"}</span>
                      <span className="inline-flex items-center gap-1.5"><Icon name="box" className="h-3.5 w-3.5" />{parentProducts.length} direct product{parentProducts.length === 1 ? "" : "s"}</span>
                    </p>
                  </div>

                  <div className="col-span-full flex flex-wrap items-center gap-2 lg:col-span-1 lg:justify-end">
                    <CollectionActionButton icon="pencil" label="Edit" onClick={() => onEdit(parent)} />
                    <CollectionActionLink icon="eye" label="View" href={`/collections/${parent.slug}`} />
                    <CollectionActionButton
                      icon="plus"
                      label="Add Child"
                      onClick={() => {
                        setEditingId(null);
                        setForm({ ...emptyCollection, parentCollectionId: parent.id });
                        setFormOpen(true);
                      }}
                    />
                    <CollectionActionButton icon="trash" label="" danger onClick={() => onDelete(parent.id)} ariaLabel="Delete collection" />
                  </div>
                </div>

                {!collapsed && (
                  <div className="relative mx-4 mb-4 border-t border-[#303839]/8 pt-4 sm:mx-6">
                    <span className="absolute bottom-5 left-[17px] top-4 hidden w-px bg-[#303839]/12 sm:block" aria-hidden="true" />
                    <div className="space-y-3 sm:pl-12">
                      {children.map((child) => {
                        const childProducts = getCollectionProducts(child);

                        return (
                          <div key={child.id} className="relative rounded-[10px] border border-[#303839]/8 bg-[#F8F6F1] p-4">
                            <span className="absolute -left-[31px] top-1/2 hidden h-px w-8 bg-[#303839]/18 sm:block" aria-hidden="true" />
                            <span className="absolute -left-[34px] top-1/2 hidden h-2 w-2 -translate-y-1/2 rounded-full bg-[#303839]/22 sm:block" aria-hidden="true" />
                            <div className="grid gap-4 xl:grid-cols-[minmax(180px,0.75fr)_minmax(0,1fr)_auto] xl:items-center">
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#303839]/70">Child Collection</p>
                                <h4 className="mt-1 truncate text-base font-semibold text-[#303839]">{child.name || "Untitled child collection"}</h4>
                                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#303839]/70">
                                  <Icon name="box" className="h-3.5 w-3.5" />
                                  {childProducts.length} product{childProducts.length === 1 ? "" : "s"}
                                </p>
                              </div>

                              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                                {childProducts.slice(0, 4).map((product) => (
                                  <div key={product.id || product.slug} className="flex min-w-0 items-center gap-3 rounded-[8px] bg-white px-3 py-2">
                                    <img src={getProductImage(product)} alt="" className="h-11 w-11 shrink-0 rounded-[6px] border border-[#303839]/8 object-cover" />
                                    <span className="min-w-0 truncate text-xs font-semibold text-[#303839]">{product.title}</span>
                                  </div>
                                ))}
                                {!childProducts.length && (
                                  <p className="rounded-[8px] bg-white px-3 py-3 text-xs font-semibold text-[#303839]/70">No products inside this child collection yet.</p>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                                <CollectionActionButton icon="pencil" label="Edit" onClick={() => onEdit(child)} />
                                <CollectionActionLink icon="eye" label="View" href={`/collections/${child.slug}`} />
                                <CollectionActionButton icon="trash" label="" danger onClick={() => onDelete(child.id)} ariaLabel="Delete child collection" />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {!children.length && (
                        <p className="rounded-[10px] border border-dashed border-[#303839]/12 bg-[#F8F6F1] px-4 py-4 text-sm font-semibold text-[#303839]/70">
                          No child collections yet. Use Add Child to create one.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}

          {!parentRows.length && (
            <div className="grid min-h-[260px] place-items-center rounded-[12px] border border-dashed border-[#303839]/14 bg-white px-6 py-10 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]/72">
                  <Icon name="grid" className="h-6 w-6" />
                </span>
                <p className="mt-5 text-sm font-semibold text-[#303839]">
                  {collectionRows.length ? "No collections match the current search." : "No collections yet."}
                </p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#303839]/70">
                  {collectionRows.length
                    ? "Adjust the main header search to show more collections."
                    : "Create your first collection from the Add Collection button in the main header."}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CollectionMetricCard({ label, value, icon, note }: any) {
  return <MetricCard label={label} value={value} icon={icon} note={note} />;
}

function CollectionBadgeButton({ active, activeLabel, inactiveLabel, title, onClick, muted = false }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      data-shape="round"
      onClick={onClick}
      className={`inline-flex h-7 cursor-pointer items-center rounded-full px-3 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors [@media(pointer:coarse)]:h-8 ${
        active
          ? muted
            ? "bg-[#ECE9E1] text-[#303839]"
            : "bg-[#303839] text-white"
          : "border border-[#303839]/10 bg-white text-[#303839]/70 hover:border-[#303839]/20 hover:text-[#303839]"
      }`}
    >
      {active ? activeLabel : inactiveLabel}
    </button>
  );
}

function CollectionActionButton({ icon, label, onClick, danger = false, ariaLabel = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel || label}
      className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[8px] border bg-white px-3 text-xs font-semibold transition ${
        danger
          ? "w-10 border-[#303839]/12 text-[#303839]/75 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
          : "border-[#303839]/12 text-[#303839] hover:border-[#303839]/25 hover:bg-[#F8F6F1]"
      }`}
    >
      <Icon name={icon} className="h-4 w-4" />
      {label && <span>{label}</span>}
    </button>
  );
}

function CollectionActionLink({ icon, label, href }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-[#303839]/12 bg-white px-3 text-xs font-semibold text-[#303839] transition-colors hover:border-[#303839]/25 hover:bg-[#F8F6F1]"
    >
      <Icon name={icon} className="h-4 w-4" />
      <span>{label}</span>
    </a>
  );
}

function OrdersSection({ orders, query, status, setStatus, onStatusChange, onDeliveryChargeChange, onDelete }) {
  const [selectedId, setSelectedId] = useState(null);
  const detailsRef = useRef(null);
  const selectOrder = (id) => {
    setSelectedId(id);
    revealOnSmallScreens(detailsRef);
  };
  const [showPersonalization, setShowPersonalization] = useState(false);
  const [deliveryChargeDraft, setDeliveryChargeDraft] = useState("");
  const queryMatchedOrders = orders.filter((order) => orderMatchesQuery(order, query));
  const visibleOrders = status
    ? queryMatchedOrders.filter((order) => String(order.status || "pending").toLowerCase() === status)
    : queryMatchedOrders;
  const selectedOrder = visibleOrders.find((order) => String(order.id) === String(selectedId)) || visibleOrders[0];
  const personalizationGroups = getOrderPersonalizationGroups(selectedOrder);
  const hasPersonalization = personalizationGroups.some((group) => group.entries.length);
  const checkoutEntries = getCheckoutDetailEntries(selectedOrder);
  const statusButtons = [
    { value: "", label: "All orders", count: queryMatchedOrders.length },
    ...orderStatuses.map((item) => ({
      value: item,
      label: formatStatusLabel(item),
      count: queryMatchedOrders.filter((order) => String(order.status || "pending").toLowerCase() === item).length,
    })),
  ];

  useEffect(() => {
    setShowPersonalization(false);
    setDeliveryChargeDraft(selectedOrder?.deliveryChargeConfirmed ? String(selectedOrder.deliveryCharge ?? 0) : "");
  }, [selectedOrder?.id, selectedOrder?.deliveryCharge, selectedOrder?.deliveryChargeConfirmed]);

  return (
    <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]">
      <Panel title="Orders">
        <div role="tablist" aria-label="Filter orders by status" className="no-scrollbar -mx-4 mb-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 sm:-mx-6 sm:scroll-px-6 sm:px-6">
          {statusButtons.map((item) => {
            const active = status === item.value;
            return (
              <button
                key={item.value || "all"}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatus(item.value)}
                className={`inline-flex h-9 shrink-0 snap-start items-center gap-2 px-3.5 text-xs font-semibold transition-colors [@media(pointer:coarse)]:h-10 ${
                  active
                    ? "bg-[#303839] text-white"
                    : "border border-[#303839]/12 bg-white text-[#303839] hover:bg-[#F3F1EC]"
                }`}
              >
                <span className="whitespace-nowrap">{item.label}</span>
                <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] tabular-nums ${active ? "bg-white/15" : "bg-[#F3F1EC]"}`}>
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-2.5">
          {visibleOrders.map((order) => {
            const active = selectedOrder?.id === order.id;
            return (
              <div
                key={order.id}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                onClick={() => selectOrder(order.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectOrder(order.id);
                  }
                }}
                className={`min-w-0 cursor-pointer rounded-[10px] border p-3.5 transition-colors sm:p-4 ${
                  active ? "border-[#303839]/40 bg-[#F8F6F1] shadow-[inset_3px_0_0_#303839]" : "border-[#303839]/10 bg-white hover:border-[#303839]/20 hover:bg-[#FCFBF9]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#303839]">{order.customerName || "Customer"}</p>
                    <p className="mt-0.5 truncate text-xs tabular-nums text-[#303839]/70">{formatOrderId(order.id)}</p>
                    <p className="mt-0.5 truncate text-xs text-[#303839]/70">
                      {formatDate(order.createdAt)}
                      {order.customerEmail ? ` · ${order.customerEmail}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-[#303839]">{formatCurrency(order.total || 0, order.currency)}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={order.status || "pending"} />
                  <StatusBadge status={order.paymentStatus || "unpaid"} />
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(order.id);
                    }}
                    aria-label={`Delete order ${formatOrderId(order.id)}`}
                    title="Delete order"
                    className={`${ICON_BUTTON} h-8 w-8 border-transparent text-[#303839]/70 hover:border-red-200 hover:bg-red-50 hover:text-red-700`}
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          {!visibleOrders.length && (
            <EmptyState
              icon="calendar"
              title="No orders in this view"
              hint="New orders appear here automatically when customers place a request on your website. If you used the search box or a status pill above, clear it to see all orders."
            />
          )}
        </div>
      </Panel>

      <div ref={detailsRef} className="min-w-0 scroll-mt-20">
      <Panel title={selectedOrder ? `Order ${formatOrderId(selectedOrder.id)}` : "Order Details"}>
        {selectedOrder ? (
          <div className="space-y-5 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-xs font-semibold text-[#303839]">{getInitials(selectedOrder.customerName || "Customer")}</span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{selectedOrder.customerName || "Customer"}</p>
                  {selectedOrder.customerEmail && (
                    <a href={`mailto:${selectedOrder.customerEmail}`} className="block truncate text-[13px] text-[#303839]/75 underline-offset-2 hover:underline">{selectedOrder.customerEmail}</a>
                  )}
                  {selectedOrder.customerPhone ? (
                    <a href={`tel:${String(selectedOrder.customerPhone).replace(/\s+/g, "")}`} className="block truncate text-[13px] text-[#303839]/75 underline-offset-2 hover:underline">{selectedOrder.customerPhone}</a>
                  ) : (
                    <p className="text-[13px] text-[#303839]/70">No phone</p>
                  )}
                </div>
              </div>
              <StatusBadge status={selectedOrder.status || "pending"} />
            </div>

            <div className="rounded-[10px] border border-[#303839]/10 bg-white p-4">
              <p className="font-semibold">Move order to</p>
              <p className="mt-1 text-xs leading-5 text-[#303839]/70">
                The steps run in order. Pick the next step when the order moves forward — the dark step shows where it is now.
              </p>
              <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
                {orderStatuses.map((item, index) => {
                  const currentStatus = String(selectedOrder.status || "pending").toLowerCase();
                  const active = currentStatus === item;
                  const currentIndex = orderStatuses.indexOf(currentStatus);
                  const done = item !== "cancelled" && currentStatus !== "cancelled" && currentIndex > index;
                  const isCancel = item === "cancelled";
                  return (
                    <li key={item} className={isCancel ? "col-span-full" : ""}>
                      <button
                        type="button"
                        disabled={active}
                        aria-current={active ? "step" : undefined}
                        onClick={() => onStatusChange(selectedOrder.id, item)}
                        title={active ? "This is the current step" : `Move this order to ${formatStatusLabel(item)}`}
                        className={`flex h-10 w-full items-center gap-2 px-3 text-left text-xs font-semibold transition-colors [@media(pointer:coarse)]:h-11 ${
                          active
                            ? isCancel
                              ? "cursor-default bg-red-700 text-white"
                              : "cursor-default bg-[#303839] text-white"
                            : isCancel
                              ? "border border-red-200 bg-white text-red-700 hover:bg-red-50"
                              : done
                                ? "border border-[#303839]/10 bg-[#F8F6F1] text-[#303839]/75 hover:border-[#303839]/25 hover:text-[#303839]"
                                : "border border-[#303839]/12 bg-white text-[#303839] hover:border-[#303839]/30 hover:bg-[#F3F1EC]"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] tabular-nums ${
                            active ? "bg-white/20" : isCancel ? "bg-red-50" : done ? "bg-[#303839] text-white" : "bg-[#F3F1EC]"
                          }`}
                        >
                          {isCancel ? <Icon name="close" className="h-3 w-3" /> : done ? <Icon name="check" className="h-3 w-3" /> : index + 1}
                        </span>
                        <span className="min-w-0 truncate">{formatStatusLabel(item)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="rounded-[10px] bg-[#F8F6F1] p-4">
              <p className="font-semibold">Checkout form</p>
              {checkoutEntries.length ? (
                <dl className="mt-3 grid gap-x-3 gap-y-1 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-y-2">
                  {checkoutEntries.map((entry) => (
                    <div key={entry.label} className="contents">
                      <dt className="text-[13px] text-[#303839]/70">{entry.label}</dt>
                      <dd className="mb-2 min-w-0 break-words text-[13px] font-semibold text-[#303839] sm:mb-0">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-[13px] text-[#303839]/70">No checkout form details were saved.</p>
              )}
            </div>

            {selectedOrder.deliveryMethod !== "store" && (
              <div className="rounded-[10px] border border-[#303839]/10 bg-white p-4">
                <p className="font-semibold">Confirm delivery charge</p>
                <p className="mt-1 text-xs leading-5 text-[#303839]/70">Enter the charge agreed for this destination. The order total updates from the trusted subtotal.</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="number" inputMode="decimal" min="0" max="100000" step="0.01" value={deliveryChargeDraft} onChange={(event) => setDeliveryChargeDraft(event.target.value)} placeholder="Delivery charge" aria-label="Delivery charge" className="h-11 min-w-0 flex-1 border border-[#303839]/15 bg-white px-3 text-sm tabular-nums outline-none" />
                  <button type="button" disabled={deliveryChargeDraft === ""} onClick={() => onDeliveryChargeChange(selectedOrder.id, Number(deliveryChargeDraft))} className={BUTTON_PRIMARY}>Confirm charge</button>
                </div>
              </div>
            )}

            <div className="rounded-[10px] border border-[#303839]/10 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Personalization</p>
                  <p className="mt-1 text-xs text-[#303839]/70">
                    {hasPersonalization ? "Customer submitted personalized details for this order." : "Customer did not submit personalization details."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!hasPersonalization}
                  onClick={() => setShowPersonalization((current) => !current)}
                  className={`h-9 px-4 text-xs font-semibold transition-colors ${
                    hasPersonalization
                      ? "bg-[#303839] text-white hover:bg-[#434C4D]"
                      : "cursor-default bg-[#ECE9E1] text-[#303839]/70"
                  }`}
                >
                  {hasPersonalization ? (showPersonalization ? "Hide personalization" : "View personalization") : "No personalization"}
                </button>
              </div>

              {showPersonalization && hasPersonalization && (
                <div className="mt-4 space-y-4">
                  {personalizationGroups.map((group) => (
                    <div key={group.title} className="rounded-[10px] bg-[#F8F6F1] p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#303839]/70">{group.title}</p>
                      <div className="mt-2 grid gap-2">
                        {group.entries.map((entry) => (
                          <p key={`${group.title}-${entry.label}`} className="grid gap-1 sm:grid-cols-[130px_minmax(0,1fr)]">
                            <span className="text-[#303839]/70">{entry.label}</span>
                            <span className="font-semibold text-[#303839]">{entry.value}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[10px] bg-[#F8F6F1] p-4">
              <p className="font-semibold">Order Items</p>
              <div className="mt-3 space-y-3">
                {(selectedOrder.items || []).map((item) => (
                  <div key={item.id || item.productId} className="rounded-[10px] bg-white/70 p-3">
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold">{item.productTitle || item.title}</span>
                      <span className="font-semibold">{formatCurrency(item.finalPrice || item.price || 0, item.currency || selectedOrder.currency)}</span>
                    </div>
                    {!!Object.keys(item.selectedOptions || {}).length && (
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-[#303839]/75">
                        {Object.entries(item.selectedOptions || {}).map(([key, value]) => (
                          <span key={key} className="rounded-full bg-[#ECE9E1] px-2 py-1">
                            {formatDetailLabel(key)}: {formatDetailValue(value)}
                          </span>
                        ))}
                      </div>
                    )}

                    {(item.previewImages?.front || item.previewImages?.back) && (
                      <div className="mt-3 flex flex-wrap gap-3">
                        {["front", "back"].map((key) =>
                          item.previewImages?.[key] ? (
                            <div key={key} className="w-24">
                              <img src={item.previewImages[key]} alt={`${key} design preview`} className="w-full border border-[#303839]/10 bg-white" />
                              <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[#303839]/70">{key}</p>
                            </div>
                          ) : null,
                        )}
                      </div>
                    )}

                    {!!Object.keys(item.uploadedFiles || {}).length && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        {Object.entries(item.uploadedFiles || {}).map(([key, file]: any) => {
                          const url = file?.signedUrl || file?.url || (typeof file === "string" ? file : "");
                          return url ? (
                            <a key={key} href={url} target="_blank" rel="noreferrer" className="rounded-full bg-[#ECE9E1] px-2 py-1 font-semibold text-blue-700 underline">
                              {formatDetailLabel(key)} file
                            </a>
                          ) : null;
                        })}
                      </div>
                    )}

                    {(item.customizationId || item.templateVersion) && (
                      <p className="mt-2 text-[10px] font-semibold text-[#303839]/70">
                        {item.customizationId ? `Customization ${String(item.customizationId).slice(0, 8)}` : ""}
                        {item.templateVersion ? `${item.customizationId ? " · " : ""}Template v${item.templateVersion}` : ""}
                      </p>
                    )}
                  </div>
                ))}
                {!selectedOrder.items?.length && <p>{selectedOrder.productTitle || "Custom order"}</p>}
              </div>
            </div>
            <div className="grid gap-2 border-t border-[#303839]/10 pt-4">
              <p className="flex justify-between"><span>Subtotal</span><strong>{formatCurrency(selectedOrder.subtotal || selectedOrder.total || 0, selectedOrder.currency)}</strong></p>
              <p className="flex justify-between"><span>Delivery charge</span><strong>{selectedOrder.deliveryMethod === "store" ? "No charge" : selectedOrder.deliveryChargeConfirmed ? formatCurrency(selectedOrder.deliveryCharge || 0, selectedOrder.currency) : "Awaiting confirmation"}</strong></p>
              <p className="flex justify-between text-base"><span>{selectedOrder.deliveryMethod === "store" || selectedOrder.deliveryChargeConfirmed ? "Total" : "Order subtotal"}</span><strong>{formatCurrency(selectedOrder.total || 0, selectedOrder.currency)}</strong></p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#303839]/75">Select an order to review details.</p>
        )}
      </Panel>
      </div>
    </div>
  );
}

function MessagesSection({ messages, allMessages = messages, query, setQuery, status, setStatus, onStatusChange, onDelete }) {
  const [selectedId, setSelectedId] = useState(null);
  const detailsRef = useRef(null);
  const selectMessage = (id) => {
    setSelectedId(id);
    revealOnSmallScreens(detailsRef);
  };
  const normalizeMessageStatus = (value) => {
    const normalized = String(value || "new").toLowerCase();
    return messageStatuses.includes(normalized) ? normalized : "new";
  };
  const statusLabel = (value) => {
    const normalized = normalizeMessageStatus(value);
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };
  const messageEmail = (message) => message.email || "No email";
  const selectedMessage = messages.find((message) => String(message.id) === String(selectedId)) || messages[0] || null;
  const counts = {
    total: allMessages.length,
    new: allMessages.filter((message) => normalizeMessageStatus(message.status) === "new").length,
    read: allMessages.filter((message) => normalizeMessageStatus(message.status) === "read").length,
    resolved: allMessages.filter((message) => ["replied", "archived"].includes(normalizeMessageStatus(message.status))).length,
  };
  const now = new Date();
  const currentRangeStart = new Date(now);
  currentRangeStart.setDate(now.getDate() - 6);
  currentRangeStart.setHours(0, 0, 0, 0);
  const previousRangeStart = new Date(currentRangeStart);
  previousRangeStart.setDate(currentRangeStart.getDate() - 7);
  const previousRangeEnd = new Date(currentRangeStart);
  previousRangeEnd.setMilliseconds(-1);
  const messagesInRange = (items, start, end) =>
    items.filter((message) => {
      const date = new Date(message.createdAt || 0);
      return !Number.isNaN(date.getTime()) && date >= start && date <= end;
    });
  const currentWeekMessages = messagesInRange(allMessages, currentRangeStart, now);
  const previousWeekMessages = messagesInRange(allMessages, previousRangeStart, previousRangeEnd);
  const changeLabel = (current, previous) => {
    if (!previous) return current ? "+100%" : "0%";
    const change = Math.round(((current - previous) / previous) * 100);
    return `${change > 0 ? "+" : ""}${change}%`;
  };
  const clearMessageFilters = () => {
    setQuery("");
    setStatus("");
  };

  useEffect(() => {
    if (!messages.length && selectedId) {
      setSelectedId(null);
      return;
    }
    if (selectedMessage?.id && String(selectedMessage.id) !== String(selectedId)) {
      setSelectedId(selectedMessage.id);
    }
  }, [messages, selectedId, selectedMessage]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[
          { label: "Total Messages", value: counts.total.toLocaleString(), icon: "document", note: "All inquiries", change: changeLabel(currentWeekMessages.length, previousWeekMessages.length) },
          {
            label: "New Messages",
            value: counts.new.toLocaleString(),
            icon: "bell",
            note: "Unread inbox",
            change: changeLabel(
              currentWeekMessages.filter((message) => normalizeMessageStatus(message.status) === "new").length,
              previousWeekMessages.filter((message) => normalizeMessageStatus(message.status) === "new").length
            ),
          },
          {
            label: "In Progress",
            value: counts.read.toLocaleString(),
            icon: "calendar",
            note: "Marked read",
            change: changeLabel(
              currentWeekMessages.filter((message) => normalizeMessageStatus(message.status) === "read").length,
              previousWeekMessages.filter((message) => normalizeMessageStatus(message.status) === "read").length
            ),
          },
          {
            label: "Resolved",
            value: counts.resolved.toLocaleString(),
            icon: "check",
            note: "Replied or archived",
            change: changeLabel(
              currentWeekMessages.filter((message) => ["replied", "archived"].includes(normalizeMessageStatus(message.status))).length,
              previousWeekMessages.filter((message) => ["replied", "archived"].includes(normalizeMessageStatus(message.status))).length
            ),
          },
        ].map((metric) => (
          <MessageMetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.22fr)_minmax(360px,0.78fr)]">
        <section className={`${CARD} p-4 sm:p-6`}>
          <div className="mb-5">
            <h2 className="text-base font-semibold text-[#303839] sm:text-lg">All Messages</h2>
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <SelectMenu
              value={status}
              onChange={setStatus}
              size="sm"
              ariaLabel="Filter by message status"
              className="w-full min-w-[132px] sm:w-[150px]"
              options={[
                { value: "", label: "All statuses" },
                { value: "new", label: "New" },
                { value: "read", label: "Read" },
                { value: "replied", label: "Replied" },
                { value: "archived", label: "Archived" },
              ]}
            />
            <div className="relative min-w-0 flex-1">
              <Icon name="search" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#303839]/70" />
              <input
                type="search"
                aria-label="Search messages"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search messages…"
                className="h-10 w-full rounded-[8px] border border-[#303839]/10 bg-white pl-3 pr-10 text-sm font-medium text-[#303839] outline-none transition placeholder:text-[#303839]/50 hover:border-[#303839]/20 "
              />
            </div>
          </div>

          <div className="space-y-3">
            {messages.map((message) => {
              const active = selectedMessage?.id === message.id;
              const normalizedStatus = normalizeMessageStatus(message.status);
              return (
                <article
                  key={message.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectMessage(message.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectMessage(message.id);
                    }
                  }}
                  className={`cursor-pointer rounded-[10px] border p-4 transition ${
                    active ? "border-[#303839]/22 bg-[#F3F1EC]" : "border-[#303839]/10 bg-white hover:border-[#303839]/20 hover:bg-[#F8F6F1]"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-xs font-semibold text-[#303839]">
                      {getInitials(message.name || "Customer")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[#303839]">{message.name || "Customer"}</p>
                          <p className="truncate text-xs text-[#303839]/70">{messageEmail(message)}</p>
                        </div>
                        <span className="shrink-0 text-xs font-medium text-[#303839]/70">{formatDate(message.createdAt)}</span>
                      </div>
                      <p className="mt-3 truncate text-sm font-semibold text-[#303839]">{message.subject || "Contact message"}</p>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#303839]/75">{message.message || "No message provided."}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 sm:pl-[52px]" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <MessageStatusBadge status={normalizedStatus} label={statusLabel(normalizedStatus)} />
                    <span className="flex-1" />
                    <StyledNativeSelect
                      size="sm"
                      value={normalizedStatus}
                      onChange={(next) => onStatusChange(message.id, next)}
                      ariaLabel={`Update status for message from ${message.name || "customer"}`}
                      options={messageStatuses.map((item) => ({ value: item, label: statusLabel(item) }))}
                      className="w-[124px]"
                    />
                    <button
                      type="button"
                      onClick={() => onDelete(message.id)}
                      aria-label={`Delete message from ${message.name || "customer"}`}
                      title="Delete message"
                      className={`${ICON_BUTTON} h-10 w-10 hover:border-red-200 hover:bg-red-50 hover:text-red-700`}
                    >
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              );
            })}
            {!messages.length && (
              <MessageEmptyState
                title="No messages here"
                hint="Messages sent through the contact form on your website will appear here automatically."
                onReset={allMessages.length ? clearMessageFilters : null}
              />
            )}
          </div>
        </section>

        <div ref={detailsRef} className="min-w-0 scroll-mt-20">
        <MessageDetailsPanel
          message={selectedMessage}
          normalizeStatus={normalizeMessageStatus}
          statusLabel={statusLabel}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
        />
        </div>
      </div>
    </div>
  );
}

function MessageMetricCard({ label, value, icon, note, change }) {
  return <MetricCard label={label} value={value} icon={icon} note={note} change={change} />;
}

function MessageStatusBadge({ label, status }) {
  return <StatusBadge status={status} label={label} />;
}

function MessageEmptyState({ title, hint, onReset = null }) {
  return (
    <div className="grid min-h-[260px] place-items-center rounded-[10px] border border-[#303839]/10 bg-white px-6 py-10 text-center">
      <div>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]/72">
          <Icon name="mail" className="h-6 w-6" />
        </span>
        <p className="mt-5 text-sm font-semibold text-[#303839]">{title}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#303839]/70">{hint}</p>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-[8px] border border-[#303839]/10 bg-white px-4 text-xs font-semibold text-[#303839] transition hover:border-[#303839]/24 hover:bg-[#F3F1EC]"
          >
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
}

function MessageDetailsPanel({ message, normalizeStatus, statusLabel, onStatusChange, onDelete }) {
  const normalizedStatus = message ? normalizeStatus(message.status) : "";
  const replyHref = message?.email
    ? `mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject || "Contact message"}`)}`
    : "";

  return (
    <section className={`${CARD} p-4 sm:p-6`}>
      <h2 className="text-base font-semibold text-[#303839] sm:text-lg">Message Details</h2>
      {!message ? (
        <div className="mt-4 overflow-hidden rounded-[10px] border border-[#303839]/10">
          <div className="grid min-h-[190px] place-items-center px-6 py-8 text-center">
            <div>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]/75">
                <Icon name="mail" className="h-6 w-6" />
              </span>
              <p className="mt-5 text-sm font-semibold text-[#303839]">No message selected.</p>
              <p className="mx-auto mt-2 max-w-[280px] text-sm leading-6 text-[#303839]/70">
                Select a message from the list to view full details and reply options.
              </p>
            </div>
          </div>
          <div className="space-y-4 border-t border-[#303839]/8 px-5 py-6">
            <span className="block h-2.5 w-24 rounded-full bg-[#ECE9E1]" />
            <span className="block h-2.5 w-40 rounded-full bg-[#F3F1EC]" />
            <span className="block h-2.5 w-full rounded-full bg-[#F3F1EC]" />
            <span className="block h-2.5 w-3/4 rounded-full bg-[#F3F1EC]" />
            <span className="block h-12 w-full rounded-[8px] border border-[#303839]/8 bg-white" />
          </div>
        </div>
      ) : (
        <div className="mt-4 min-w-0 space-y-4">
          <div className="rounded-[10px] border border-[#303839]/10 bg-white p-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-lg font-semibold text-[#303839]">
                {getInitials(message.name || "Customer")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-[#303839]">{message.name || "Customer"}</p>
                <p className="truncate text-xs text-[#303839]/70">{message.email || "No email"}</p>
                {message.phone && <p className="mt-1 truncate text-xs text-[#303839]/70">{message.phone}</p>}
              </div>
              <MessageStatusBadge label={statusLabel(normalizedStatus)} status={normalizedStatus} />
            </div>
          </div>

          <div className="rounded-[10px] border border-[#303839]/10 bg-[#F8F6F1] p-4">
            <p className="text-xs font-semibold text-[#303839]/70">Subject</p>
            <p className="mt-1 text-base font-semibold text-[#303839]">{message.subject || "Contact message"}</p>
            <p className="mt-4 text-xs font-semibold text-[#303839]/70">Message</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#303839]/72">{message.message || "No message provided."}</p>
          </div>

          <div className="rounded-[10px] border border-[#303839]/10 bg-white p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoPair label="Date Received" value={formatDate(message.createdAt)} />
              <InfoPair label="Current Status" value={statusLabel(normalizedStatus)} />
            </div>
            <div className="mt-4" onClick={(event) => event.stopPropagation()}>
              <p className="mb-2 text-xs font-semibold text-[#303839]/70">Update Status</p>
              <StyledNativeSelect
                size="sm"
                value={normalizedStatus}
                onChange={(next) => onStatusChange(message.id, next)}
                ariaLabel="Update selected message status"
                options={messageStatuses.map((item) => ({ value: item, label: statusLabel(item) }))}
                className="w-full sm:w-40"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {replyHref && (
              <a
                href={replyHref}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-[8px] bg-[#303839] px-4 text-sm font-semibold text-white transition hover:bg-[#434C4D] sm:flex-none"
              >
                Reply by Email
              </a>
            )}
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-[8px] border border-[#303839]/10 bg-white px-4 text-sm font-semibold text-[#303839]/75 transition hover:border-[#303839]/24 hover:bg-[#F3F1EC] hover:text-[#303839] sm:flex-none"
            >
              Delete Message
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SubscribersSection({ subscribers, allSubscribers = subscribers, query, onDelete, onAction, onError }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [campaigns, setCampaigns] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState({ title: "", subject: "", previewText: "", body: "", audience: "all_active" });
  const [savingDraft, setSavingDraft] = useState(false);
  const pageSize = 10;

  const getSubscriberStatus = (subscriber) => String(subscriber.status || "active").toLowerCase();
  const activeSubscribers = allSubscribers.filter((subscriber) => getSubscriberStatus(subscriber) === "active" || !subscriber.status);
  const visibleSubscribers = subscribers.filter((subscriber) => !statusFilter || getSubscriberStatus(subscriber) === statusFilter);
  const totalPages = Math.max(1, Math.ceil(visibleSubscribers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedSubscribers = visibleSubscribers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const emailsSent = campaigns.reduce((total, campaign) => total + Number(campaign.emailsSent || 0), 0);
  const openRateValues = campaigns.map((campaign) => Number(campaign.openRate)).filter((value) => Number.isFinite(value));
  const avgOpenRate = openRateValues.length
    ? `${Math.round(openRateValues.reduce((total, value) => total + value, 0) / openRateValues.length)}%`
    : "-";

  useEffect(() => {
    setPage(1);
  }, [statusFilter, query, subscribers.length]);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/newsletter/campaigns", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data?.campaigns) setCampaigns(data.campaigns);
      })
      .catch(() => {
        if (active) setCampaigns([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const exportCsv = () => {
    const rows = visibleSubscribers.map((subscriber) => ({
      Email: subscriber.email || "",
      Status: getSubscriberStatus(subscriber) || "active",
      Source: subscriber.source || "website",
      "Subscribed On": subscriber.createdAt || "",
      ID: subscriber.id || "",
    }));
    const headers = ["Email", "Status", "Source", "Subscribed On", "ID"];
    const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))].join("\r\n");
    const date = new Date();
    const filename = `husnalogy newsletter subscribers ${date.getFullYear()} ${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getDate()).padStart(2, "0")}.csv`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const saveCampaignDraft = async (event) => {
    event.preventDefault();
    setSavingDraft(true);
    try {
      const response = await fetch("/api/admin/newsletter/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : "";
        throw new Error(String(firstError || data?.error || "Newsletter draft could not be created."));
      }
      setCampaigns((current) => [data.campaign, ...current]);
      setDraft({ title: "", subject: "", previewText: "", body: "", audience: "all_active" });
      setModalOpen(false);
      onAction?.("Newsletter draft created.");
    } catch (error) {
      onError?.(error.message || "Newsletter draft could not be created.");
    } finally {
      setSavingDraft(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <NewsletterMetricCard label="Total Subscribers" value={allSubscribers.length.toLocaleString()} icon="user" note="All newsletter signups" />
        <NewsletterMetricCard label="Active Subscribers" value={activeSubscribers.length.toLocaleString()} icon="mail" note="Receiving updates" />
        <NewsletterMetricCard label="Emails Sent" value={emailsSent.toLocaleString()} icon="send" note={emailsSent ? "Campaign delivery count" : "Campaigns not configured"} />
        <NewsletterMetricCard label="Avg. Open Rate" value={avgOpenRate} icon="chart" note={avgOpenRate === "-" ? "Connect campaigns later" : "Campaign average"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className={`${CARD} p-4 sm:p-6`}>
          <div className="mb-5 flex items-center justify-between gap-4 border-b border-[#303839]/8 pb-5">
            <h2 className="text-base font-semibold text-[#303839] sm:text-lg">Subscribers</h2>
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <SelectMenu
                value={statusFilter}
                onChange={setStatusFilter}
                size="sm"
                ariaLabel="Filter subscriber status"
                className="w-[150px]"
                options={[
                  { value: "", label: "All Statuses" },
                  { value: "active", label: "Active" },
                  { value: "unsubscribed", label: "Unsubscribed" },
                  { value: "bounced", label: "Bounced" },
                ]}
              />
              <span className="text-xs font-semibold text-[#303839]/75">
                {visibleSubscribers.length} subscriber{visibleSubscribers.length === 1 ? "" : "s"}
              </span>
            </div>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!visibleSubscribers.length}
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-[#303839]/10 bg-white px-4 text-xs font-semibold text-[#303839] transition hover:border-[#303839]/24 hover:bg-[#F3F1EC] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="download" className="h-4 w-4" />
              Export CSV
            </button>
          </div>

          {visibleSubscribers.length ? (
            <>
              <div className="hidden overflow-hidden rounded-[10px] border border-[#303839]/10 lg:block">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="bg-[#F3F1EC] text-xs font-semibold text-[#303839]/75">
                    <tr>
                      <th className="w-[6%] px-4 py-4"><span className="block h-4 w-4 rounded border border-[#303839]/20" /></th>
                      <th className="w-[32%] px-4 py-4">Subscriber</th>
                      <th className="w-[16%] px-4 py-4">Status</th>
                      <th className="w-[22%] px-4 py-4">Subscribed On</th>
                      <th className="w-[16%] px-4 py-4">Source</th>
                      <th className="w-[8%] px-4 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#303839]/8">
                    {pagedSubscribers.map((subscriber) => (
                      <tr key={subscriber.id} className="bg-white transition hover:bg-[#F8F6F1]">
                        <td className="px-4 py-4"><span className="block h-4 w-4 rounded border border-[#303839]/18" /></td>
                        <td className="px-4 py-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-xs font-semibold uppercase text-[#303839]">{getInitials(subscriber.email || "S")}</span>
                            <span className="min-w-0 truncate font-semibold text-[#303839]">{subscriber.email}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4"><SubscriberStatusBadge status={getSubscriberStatus(subscriber)} /></td>
                        <td className="px-4 py-4 text-sm font-semibold text-[#303839]">{formatSubscriberDate(subscriber.createdAt)}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-[#303839]/75">{subscriber.source || "website"}</td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-2">
                            <a href={`mailto:${subscriber.email}`} className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#303839]/10 bg-white text-[#303839]/72 transition hover:bg-[#F3F1EC]" aria-label="Email subscriber"><Icon name="mail" className="h-4 w-4" /></a>
                            <button type="button" onClick={() => onDelete(subscriber.id)} className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#303839]/10 bg-white text-[#303839]/72 transition hover:bg-[#F3F1EC]" aria-label="Delete subscriber"><Icon name="trash" className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 lg:hidden">
                {pagedSubscribers.map((subscriber) => (
                  <article key={subscriber.id} className="rounded-[10px] border border-[#303839]/10 bg-white p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-xs font-semibold uppercase text-[#303839]">{getInitials(subscriber.email || "S")}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-[#303839]">{subscriber.email}</p>
                        <p className="mt-1 text-xs font-semibold text-[#303839]/70">{subscriber.source || "website"} - {formatSubscriberDate(subscriber.createdAt)}</p>
                      </div>
                      <SubscriberStatusBadge status={getSubscriberStatus(subscriber)} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <a href={`mailto:${subscriber.email}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[#303839]/10 bg-white px-3 text-xs font-semibold text-[#303839] transition hover:bg-[#F3F1EC]"><Icon name="mail" className="h-4 w-4" />Email</a>
                      <button type="button" onClick={() => onDelete(subscriber.id)} className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[#303839]/10 bg-white px-3 text-xs font-semibold text-[#303839]/75 transition hover:bg-[#F3F1EC]"><Icon name="trash" className="h-4 w-4" />Delete</button>
                    </div>
                  </article>
                ))}
              </div>

              {visibleSubscribers.length > pageSize && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} className="grid h-10 w-10 place-items-center rounded-[8px] border border-[#303839]/10 bg-white text-[#303839] disabled:opacity-40"><Icon name="chevron" className="h-4 w-4 rotate-90" /></button>
                  <span className="grid h-10 min-w-10 place-items-center rounded-[8px] bg-[#303839] px-3 text-xs font-semibold text-white">{currentPage}</span>
                  <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} className="grid h-10 w-10 place-items-center rounded-[8px] border border-[#303839]/10 bg-white text-[#303839] disabled:opacity-40"><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>
                </div>
              )}
            </>
          ) : (
            <SubscriberEmptyState
              title="No subscribers yet."
              hint={allSubscribers.length ? "Adjust the main header search or status filter to show subscribers." : "Newsletter signups from your website will appear here automatically."}
            />
          )}
        </section>

        <CreateNewsletterCard onOpen={() => setModalOpen(true)} />
      </div>

      <section className="flex flex-col gap-4 rounded-[12px] border border-[#303839]/10 bg-white p-4 shadow-[0_1px_2px_rgba(48,56,57,0.04)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]">
            <Icon name="check" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-[#303839]">Your subscribers are protected.</p>
            <p className="mt-1 text-xs font-medium text-[#303839]/70">We store subscriber data securely and never share it with third parties.</p>
          </div>
        </div>
        <a href="/privacy" className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-[#303839]/10 bg-white px-4 text-xs font-semibold text-[#303839] transition hover:bg-[#F3F1EC]">
          Learn more
          <Icon name="external" className="h-3.5 w-3.5" />
        </a>
      </section>

      {modalOpen && (
        <CreateNewsletterModal
          draft={draft}
          setDraft={setDraft}
          saving={savingDraft}
          activeSubscriberCount={activeSubscribers.length}
          onSubmit={saveCampaignDraft}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

function NewsletterMetricCard({ label, value, icon, note }) {
  return <MetricCard label={label} value={value} icon={icon} note={note} />;
}

function SubscriberStatusBadge({ status }) {
  return <StatusBadge status={status} />;
}

function SubscriberEmptyState({ title, hint }) {
  return (
    <div className="grid min-h-[260px] place-items-center rounded-[10px] border border-[#303839]/10 bg-white px-6 py-10 text-center">
      <div>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F1EC] text-[#303839]/72">
          <Icon name="mail" className="h-6 w-6" />
        </span>
        <p className="mt-5 text-sm font-semibold text-[#303839]">{title}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#303839]/70">{hint}</p>
      </div>
    </div>
  );
}

function CreateNewsletterCard({ onOpen }) {
  return (
    <section className={`${CARD} p-4 sm:p-6`}>
      <h2 className="text-base font-semibold text-[#303839] sm:text-lg">Create Newsletter</h2>
      <div className="mt-5 grid min-h-[320px] place-items-center rounded-[10px] border-t border-[#303839]/8 pt-6 text-center">
        <div>
          <div className="mx-auto grid h-24 w-24 place-items-center rounded-[18px] border border-[#303839]/10 bg-[#F3F1EC] text-[#303839]">
            <Icon name="mail" className="h-10 w-10" />
          </div>
          <p className="mx-auto mt-6 max-w-[220px] text-xl font-semibold leading-tight text-[#303839]">Design and send beautiful emails</p>
          <p className="mx-auto mt-4 max-w-[250px] text-sm leading-6 text-[#303839]/75">Create engaging newsletter campaigns and send updates to your subscribers.</p>
          <button type="button" onClick={onOpen} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[#303839] px-5 text-sm font-semibold text-white transition hover:bg-[#434C4D]">
            <Icon name="plus" className="h-4 w-4" />
            Create New Newsletter
          </button>
        </div>
      </div>
    </section>
  );
}

function CreateNewsletterModal({ draft, setDraft, saving, activeSubscriberCount, onSubmit, onClose }) {
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/55 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[14px] border border-[#303839]/10 bg-white p-5 shadow-[0_1px_2px_rgba(48,56,57,0.04)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-[#303839]">Create newsletter draft</h2>
            <p className="mt-1 text-sm text-[#303839]/70">Drafts are saved only. No emails are sent from this modal.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-[8px] text-[#303839]/75 transition hover:bg-[#F3F1EC]" aria-label="Close newsletter modal">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="mt-6 grid gap-4">
          <AdminInput label="Campaign Title" value={draft.title} onChange={(value) => update("title", value)} required />
          <AdminInput label="Subject Line" value={draft.subject} onChange={(value) => update("subject", value)} required />
          <AdminInput label="Preview Text" value={draft.previewText} onChange={(value) => update("previewText", value)} />
          <AdminTextarea label="Email Body" value={draft.body} onChange={(value) => update("body", value)} required />
          <label className="block text-sm font-semibold">
            <span>Audience</span>
            <select
              value={draft.audience}
              onChange={(event) => update("audience", event.target.value)}
              className="mt-2 h-12 w-full rounded-[10px] border border-[#303839]/12 bg-white px-4 text-sm font-semibold text-[#303839] outline-none transition hover:border-[#303839]/20 hover:bg-[#F8F6F1] focus:border-[#303839]/40 focus:bg-white focus:ring-2 focus:ring-[#303839]/10"
            >
              <option value="all_active">All active subscribers ({activeSubscriberCount})</option>
            </select>
          </label>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="h-11 rounded-[8px] border border-[#303839]/12 px-5 text-sm font-semibold text-[#303839] transition hover:bg-[#F3F1EC]">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="h-11 rounded-[8px] bg-[#303839] px-5 text-sm font-semibold text-white transition hover:bg-[#434C4D] disabled:opacity-60">
              {saving ? "Saving..." : "Save Draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatSubscriberDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const DEFAULT_ADMIN_SETTINGS = {
  store: { name: "", tagline: "", email: "", phone: "", address: "" },
  branding: { logoUrl: "", faviconUrl: "" },
  hero: { collectionId: "" },
  adminProfile: { fullName: "", email: "", role: "Administrator", photoUrl: "" },
  preferences: { allowProductReviews: true, newsletterEnabled: true, maintenanceMode: false },
  payment: {
    cashOnDeliveryEnabled: true,
    sslCommerzEnabled: false,
    sslCommerzMode: "test",
    sslCommerzStoreId: "",
    sslCommerzStorePassword: "",
    sslCommerzApiKey: "",
  },
  shipping: { digitalProductsNoShipping: true, methods: [] },
  email: {
    senderName: "",
    senderEmail: "",
    provider: "",
    smtpHost: "",
    smtpPort: "",
    smtpUser: "",
    smtpPassword: "",
    orderConfirmationEmails: true,
    designRequestUpdateEmails: true,
    newsletterEmails: true,
  },
  security: {
    sessionTimeoutMinutes: 60,
    twoStepVerificationEnabled: false,
    twoStepVerificationSupported: false,
    allowedRoles: ["Administrator"],
  },
  notifications: {
    newOrders: true,
    newMessages: true,
    lowStockProducts: true,
    newsletterSubscribers: true,
  },
};

function mergeAdminSettings(settings) {
  return deepMerge(DEFAULT_ADMIN_SETTINGS, settings || {});
}

function deepMerge(base, override) {
  const result = { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && base?.[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      result[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  });
  return result;
}

function SettingsSection({ onAction }) {
  const settingGroups = [
    { id: "general", title: "General Settings", subtitle: "Store, branding, profile and preferences" },
    { id: "payment", title: "Payment Settings", subtitle: "Payment methods and gateway mode" },
    { id: "shipping", title: "Shipping Settings", subtitle: "Delivery methods, areas and fees" },
    ...(LAUNCH_FEATURES.emailSettings ? [{ id: "email", title: "Email Settings", subtitle: "Sender identity and email provider" }] : []),
    { id: "security", title: "Security", subtitle: "Access rules and active session" },
    { id: "notifications", title: "Notifications", subtitle: "Admin alert preferences" },
    { id: "backup", title: "Backup", subtitle: "Export settings and store data" },
  ];
  const [activeGroup, setActiveGroup] = useState("general");
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adminSession, setAdminSession] = useState(null);
  const [status, setStatus] = useState({ loading: true, saving: false, error: "", notice: "" });
  const [testRecipient, setTestRecipient] = useState("");

  useEffect(() => {
    let active = true;

    async function loadSettings() {
      try {
        const response = await fetch("/api/admin/settings", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Settings could not be loaded.");
        if (!active) return;
        const mergedSettings = mergeAdminSettings(data.settings);
        setSettings(mergedSettings);
        setDraft(mergedSettings);
        setAdminSession(data.admin);
        setTestRecipient(mergedSettings.store.email || "");
        setStatus({ loading: false, saving: false, error: "", notice: "" });
      } catch (error) {
        if (!active) return;
        setStatus({ loading: false, saving: false, error: error.message || "Settings could not be loaded.", notice: "" });
      }
    }

    loadSettings();
    return () => {
      active = false;
    };
  }, []);

  const setDraftValue = (section, key, value) => {
    setDraft((current) => ({
      ...current,
      [section]: {
        ...(current?.[section] || {}),
        [key]: value,
      },
    }));
  };

  const setShippingMethods = (methods) => {
    setDraft((current) => ({
      ...current,
      shipping: {
        ...(current?.shipping || {}),
        methods,
      },
    }));
  };

  const saveSettings = async (payload, successMessage) => {
    setStatus((current) => ({ ...current, saving: true, error: "", notice: "" }));

    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Settings could not be saved.");
      }

      const mergedSettings = mergeAdminSettings(data.settings);
      setSettings(mergedSettings);
      setDraft(mergedSettings);
      setStatus({ loading: false, saving: false, error: "", notice: successMessage });
      onAction?.(successMessage);
    } catch (error) {
      setStatus((current) => ({ ...current, saving: false, error: error.message || "Settings could not be saved.", notice: "" }));
    }
  };

  const uploadSettingsAsset = async (file, folder, onUploaded) => {
    if (!file) return;
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
    const safeExtension = /\.(png|jpe?g|webp)$/i.test(file.name || "");

    if ((!allowedTypes.has(file.type) && !safeExtension) || Number(file.size || 0) > 5 * 1024 * 1024) {
      setStatus((current) => ({ ...current, error: "Use PNG, JPG, JPEG, or WEBP under 5MB.", notice: "" }));
      return;
    }

    setStatus((current) => ({ ...current, saving: true, error: "", notice: "" }));
    try {
      const formData = new FormData();
      formData.append("folder", folder);
      formData.append("files", file);

      const response = await fetch("/api/admin/uploads", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Upload failed.");
      onUploaded(data.urls?.[0] || "");
      setStatus((current) => ({ ...current, saving: false, error: "", notice: "Preview updated. Save changes to publish it." }));
    } catch (error) {
      setStatus((current) => ({ ...current, saving: false, error: error.message || "Upload failed.", notice: "" }));
    }
  };

  const savePayment = () => {
    saveSettings(
      {
        payment: {
          ...draft.payment,
          sslCommerzStorePassword: draft.payment.sslCommerzStorePassword === "Saved securely" ? "__KEEP__" : draft.payment.sslCommerzStorePassword,
          sslCommerzApiKey: draft.payment.sslCommerzApiKey === "Saved securely" ? "__KEEP__" : draft.payment.sslCommerzApiKey,
        },
      },
      "Payment settings saved."
    );
  };

  const saveEmail = () => {
    saveSettings(
      {
        email: {
          ...draft.email,
          smtpPassword: draft.email.smtpPassword === "Saved securely" ? "__KEEP__" : draft.email.smtpPassword,
        },
      },
      "Email settings saved."
    );
  };

  const sendTestEmail = async () => {
    setStatus((current) => ({ ...current, saving: true, error: "", notice: "" }));
    try {
      const response = await fetch("/api/admin/settings/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: testRecipient }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Test email could not be sent.");
      setStatus({ loading: false, saving: false, error: "", notice: data.message || "Test email request accepted." });
    } catch (error) {
      setStatus((current) => ({ ...current, saving: false, error: error.message || "Test email could not be sent.", notice: "" }));
    }
  };

  const downloadJson = (name, data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportEndpoint = async (name, endpoint, projector = (data) => data) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `${name} export failed.`);
      downloadJson(name, projector(data));
      setStatus((current) => ({ ...current, error: "", notice: `${name} export downloaded.` }));
    } catch (error) {
      setStatus((current) => ({ ...current, error: error.message || `${name} export failed.`, notice: "" }));
    }
  };

  if (status.loading) {
    return (
      <Panel title="Settings">
        <p className="text-sm text-[#303839]/75">Loading settings...</p>
      </Panel>
    );
  }

  if (!draft) {
    return (
      <Panel title="Settings">
        <p className="text-sm font-semibold text-red-700">{status.error || "Settings could not be loaded."}</p>
      </Panel>
    );
  }

  return (
    <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[264px_minmax(0,1fr)]">
      <nav aria-label="Settings groups" className={`${CARD} p-1.5 xl:sticky xl:top-20`}>
        <div role="tablist" aria-orientation="vertical" className="no-scrollbar flex gap-1 overflow-x-auto xl:flex-col xl:overflow-visible">
          {settingGroups.map((item) => {
            const active = activeGroup === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveGroup(item.id)}
                className={`shrink-0 px-3.5 py-2.5 text-left transition-colors xl:w-full ${active ? "bg-[#F3F1EC] text-[#303839]" : "text-[#303839]/80 hover:bg-[#F8F6F1] hover:text-[#303839]"}`}
              >
                <span className={`block whitespace-nowrap text-[13px] ${active ? "font-semibold" : "font-medium"}`}>{item.title}</span>
                <span className="mt-0.5 hidden text-xs text-[#303839]/70 xl:block">{item.subtitle}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0 space-y-5">
        {status.error && <p role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{status.error}</p>}
        {status.notice && <p role="status" className="rounded-[10px] border border-[#1B5E20]/15 bg-[#E6F4EA] px-4 py-3 text-sm font-medium text-[#1B5E20]">{status.notice}</p>}

        {activeGroup === "general" && (
          <>
            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
              <Panel title="Store Information">
                <p className="mb-4 rounded-[10px] bg-[#F8F6F1] px-4 py-3 text-xs font-semibold leading-5 text-[#303839]/75">
                  Store contact information is fixed at launch as a single source of truth for the storefront, checkout, metadata and Ask Logy. It is read-only here so Admin can never drift from what customers see. Contact engineering to update it in <code className="font-mono">lib/launch-config.ts</code>.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <AdminInput label="Store Name" value={BUSINESS_INFO.name} onChange={() => {}} disabled />
                  <AdminInput label="Store Tagline" value={BUSINESS_INFO.tagline} onChange={() => {}} disabled />
                  <AdminInput label="Store Email" type="email" value={BUSINESS_INFO.email} onChange={() => {}} disabled />
                  <AdminInput label="Phone Number" value={BUSINESS_INFO.phone} onChange={() => {}} disabled />
                  <AdminTextarea label="Store Address" value={BUSINESS_INFO.address} onChange={() => {}} disabled />
                </div>
              </Panel>

              <Panel title="Logo & Favicon">
                <div className="grid gap-4">
                  <UploadPreview
                    label="Store Logo"
                    value={draft.branding.logoUrl}
                    folder="logo"
                    onUpload={(url) => setDraftValue("branding", "logoUrl", url)}
                    onRemove={() => setDraftValue("branding", "logoUrl", "")}
                    onFile={uploadSettingsAsset}
                  />
                  <UploadPreview
                    label="Favicon"
                    value={draft.branding.faviconUrl}
                    folder="favicon"
                    compact
                    onUpload={(url) => setDraftValue("branding", "faviconUrl", url)}
                    onRemove={() => setDraftValue("branding", "faviconUrl", "")}
                    onFile={uploadSettingsAsset}
                  />
                </div>
                <SaveButton saving={status.saving} onClick={() => saveSettings({ branding: draft.branding }, "Branding saved.")}>
                  Save Branding
                </SaveButton>
              </Panel>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Admin Profile">
                <UploadPreview
                  label="Profile Photo"
                  value={draft.adminProfile.photoUrl}
                  folder="profile"
                  compact
                  round
                  onUpload={(url) => setDraftValue("adminProfile", "photoUrl", url)}
                  onRemove={() => setDraftValue("adminProfile", "photoUrl", "")}
                  onFile={uploadSettingsAsset}
                />
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <AdminInput label="Full Name" value={draft.adminProfile.fullName} onChange={(value) => setDraftValue("adminProfile", "fullName", value)} />
                  <AdminInput label="Email Address" type="email" value={draft.adminProfile.email} onChange={(value) => setDraftValue("adminProfile", "email", value)} />
                  <div className="rounded-[10px] border border-[#303839]/10 bg-[#F8F6F1] px-4 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#303839]/70">Role</p>
                    <p className="mt-1 font-semibold text-[#303839]">{draft.adminProfile.role}</p>
                    <p className="mt-1 text-xs text-[#303839]/70">Only a super admin can change roles.</p>
                  </div>
                </div>
                <SaveButton saving={status.saving} onClick={() => saveSettings({ adminProfile: draft.adminProfile }, "Admin profile saved.")}>
                  Update Profile
                </SaveButton>
              </Panel>

              <Panel title="Other Preferences">
                <div className="space-y-3">
                  <ToggleRow label="Allow Product Reviews" checked={draft.preferences.allowProductReviews} onChange={(value) => setDraftValue("preferences", "allowProductReviews", value)} />
                  {LAUNCH_FEATURES.marketingEmail && <ToggleRow label="Enable Newsletter Subscription" checked={draft.preferences.newsletterEnabled} onChange={(value) => setDraftValue("preferences", "newsletterEnabled", value)} />}
                  <ToggleRow label="Enable Maintenance Mode" checked={draft.preferences.maintenanceMode} onChange={(value) => setDraftValue("preferences", "maintenanceMode", value)} />
                </div>
                <SaveButton saving={status.saving} onClick={() => saveSettings({ preferences: draft.preferences }, "Preferences saved.")}>
                  Save Preferences
                </SaveButton>
              </Panel>
            </div>
          </>
        )}

        {activeGroup === "payment" && (
          <Panel title="Payment Settings">
            <InfoBox label="Launch payment method" value={ORDER_POLICY.paymentMethod} />
            <p className="mt-4 rounded-[10px] bg-[#F8F6F1] px-4 py-3 text-xs font-semibold leading-5 text-[#303839]/75">Online gateway settings are hidden for launch. Checkout is server-enforced as Cash on Delivery.</p>
          </Panel>
        )}

        {activeGroup === "shipping" && (
          <Panel title="Shipping Settings">
            <p className="rounded-[10px] bg-[#F8F6F1] px-4 py-4 text-sm font-semibold leading-6 text-[#303839]/70">{ORDER_POLICY.deliveryCharge}</p>
            <p className="mt-3 text-xs leading-5 text-[#303839]/75">Fixed delivery-rate controls are hidden because launch orders are reviewed before the delivery charge is confirmed.</p>
          </Panel>
        )}

        {LAUNCH_FEATURES.emailSettings && activeGroup === "email" && (
          <Panel title="Email Settings">
            <div className="grid gap-4 lg:grid-cols-2">
              <AdminInput label="Sender Name" value={draft.email.senderName} onChange={(value) => setDraftValue("email", "senderName", value)} />
              <AdminInput label="Sender Email" type="email" value={draft.email.senderEmail} onChange={(value) => setDraftValue("email", "senderEmail", value)} />
              <AdminInput label="Email Provider" value={draft.email.provider} onChange={(value) => setDraftValue("email", "provider", value)} />
              <AdminInput label="SMTP Host" value={draft.email.smtpHost} onChange={(value) => setDraftValue("email", "smtpHost", value)} />
              <AdminInput label="SMTP Port" value={draft.email.smtpPort} onChange={(value) => setDraftValue("email", "smtpPort", value)} />
              <AdminInput label="SMTP User" value={draft.email.smtpUser} onChange={(value) => setDraftValue("email", "smtpUser", value)} />
              <AdminInput label="SMTP Password" type="password" value={draft.email.smtpPassword || ""} onChange={(value) => setDraftValue("email", "smtpPassword", value)} />
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              <ToggleRow label="Order Confirmation Emails" checked={draft.email.orderConfirmationEmails} onChange={(value) => setDraftValue("email", "orderConfirmationEmails", value)} />
              <ToggleRow label="Design Request Update Emails" checked={draft.email.designRequestUpdateEmails} onChange={(value) => setDraftValue("email", "designRequestUpdateEmails", value)} />
              <ToggleRow label="Newsletter Emails" checked={draft.email.newsletterEmails} onChange={(value) => setDraftValue("email", "newsletterEmails", value)} />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <AdminInput label="Test Recipient" type="email" value={testRecipient} onChange={setTestRecipient} />
              <SaveButton saving={status.saving} onClick={saveEmail}>Save Email Settings</SaveButton>
              <button type="button" onClick={sendTestEmail} disabled={status.saving} className={`${BUTTON_SECONDARY} self-end`}>
                Send Test Email
              </button>
            </div>
          </Panel>
        )}

        {activeGroup === "security" && (
          <Panel title="Security">
            <div className="grid gap-4 lg:grid-cols-3">
              <InfoBox label="Current Admin" value={adminSession?.email || draft.adminProfile.email} />
              <InfoBox label="Role" value={draft.adminProfile.role} />
              <AdminInput label="Session Timeout Minutes" type="number" value={draft.security.sessionTimeoutMinutes} onChange={(value) => setDraftValue("security", "sessionTimeoutMinutes", value)} />
            </div>
            <div className="mt-5 space-y-3">
              <ToggleRow
                label="Two Step Verification"
                checked={draft.security.twoStepVerificationEnabled}
                disabled={!draft.security.twoStepVerificationSupported}
                onChange={(value) => setDraftValue("security", "twoStepVerificationEnabled", value)}
                note={draft.security.twoStepVerificationSupported ? "Supported by the current auth system." : "Not supported by the current auth system."}
              />
              <InfoBox label="Access Rules" value={(draft.security.allowedRoles || ["Administrator"]).join(", ")} />
            </div>
            <SaveButton saving={status.saving} onClick={() => saveSettings({ security: draft.security }, "Security settings saved.")}>
              Save Security Settings
            </SaveButton>
          </Panel>
        )}

        {activeGroup === "notifications" && (
          <Panel title="Notifications">
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["newOrders", "New orders"],
                ["newDesignRequests", "New design requests"],
                ["newContactMessages", "New contact messages"],
                ["newReviews", "New reviews"],
                ["paymentUpdates", "Payment updates"],
                ["lowStockProducts", "Low stock products"],
                ...(LAUNCH_FEATURES.marketingEmail ? [["newsletterSubscribers", "Newsletter subscribers"]] : []),
              ].map(([key, label]) => (
                <ToggleRow key={key} label={label} checked={draft.notifications[key]} onChange={(value) => setDraftValue("notifications", key, value)} />
              ))}
            </div>
            <SaveButton saving={status.saving} onClick={() => saveSettings({ notifications: draft.notifications }, "Notification settings saved.")}>
              Save Notification Settings
            </SaveButton>
          </Panel>
        )}

        {activeGroup === "backup" && (
          <Panel title="Backup">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <BackupButton label="Export Store Settings" onClick={() => downloadJson("store-settings", settings || draft)} />
              <BackupButton label="Export Products" onClick={() => exportEndpoint("products", "/api/admin/products", (data) => data.products || [])} />
              <BackupButton label="Export Orders" onClick={() => exportEndpoint("orders", "/api/admin/order-requests", (data) => data.orders || [])} />
              <BackupButton label="Export Reviews" onClick={() => exportEndpoint("reviews", "/api/admin/products", (data) => (data.products || []).flatMap((product) => (product.reviews || []).map((review) => ({ ...review, productId: product.id, productTitle: product.title })) ))} />
              <BackupButton label="Export Customers" onClick={() => setStatus((current) => ({ ...current, notice: "", error: "Customer export is not available until a customer database is connected." }))} />
              {/* Settings + products only: a catalogue export, NOT a full backup. */}
              <BackupButton label="Export Catalogue Backup" onClick={() => exportEndpoint("catalogue-backup", "/api/admin/products", (data) => ({ settings: settings || draft, products: data.products || [] }))} />
            </div>
            <p className="mt-4 text-xs font-semibold text-[#303839]/70">
              Backup actions require the active admin session and download JSON files directly to this device.
            </p>
            <p className="mt-2 text-xs text-[#303839]/70" data-backup-scope-note>
              These exports are data copies, not a disaster-recovery backup: they do not include customer accounts, customer designs, uploaded files, production files or Storage.
              Full recovery relies on the Supabase database and Storage backups described in HOSTINGER_DEPLOYMENT.md.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function SaveButton({ children, saving, onClick, spaced = true, className = "" }) {
  return (
    <button type="button" onClick={onClick} disabled={saving} className={`${spaced ? "mt-5" : ""} ${BUTTON_PRIMARY} w-full sm:w-auto ${className}`}>
      {saving ? "Saving…" : children}
    </button>
  );
}

function ToggleRow({ label, checked, onChange, disabled = false, note }: any) {
  return (
    <label className={`flex min-h-14 items-center justify-between gap-4 rounded-[10px] border border-[#303839]/10 bg-[#F8F6F1] px-4 py-3 text-sm ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
      <span className="min-w-0">
        <span className="block font-semibold text-[#303839]">{label}</span>
        {note && <span className="mt-0.5 block text-xs text-[#303839]/70">{note}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        aria-label={label}
        disabled={disabled}
        data-shape="round"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-[#303839]" : "bg-[#303839]/20"}`}
      >
        <span aria-hidden="true" className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(48,56,57,0.3)] transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </label>
  );
}

function UploadPreview({ label, value, folder, onUpload, onRemove, onFile, compact = false, round = false }) {
  return (
    <div className="rounded-[10px] border border-[#303839]/10 bg-[#F8F6F1] p-4">
      <p className="text-sm font-semibold text-[#303839]">{label}</p>
      <div className={`mt-3 grid place-items-center overflow-hidden border border-dashed border-[#303839]/20 bg-white ${round ? "h-24 w-24 rounded-full" : compact ? "h-24 rounded-[10px]" : "h-32 rounded-[10px]"}`}>
        {value ? (
          <img src={value} alt={label} className="h-full w-full object-contain p-3" />
        ) : (
          <span className="px-4 text-center text-xs text-[#303839]/70">No {label.toLowerCase()} selected</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className={`${BUTTON_SM_SECONDARY} cursor-pointer rounded-[8px] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#303839]/60`}>
          <Icon name="download" className="h-3.5 w-3.5 rotate-180" />
          Upload
          <input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => onFile(event.target.files?.[0], folder, onUpload)} />
        </label>
        {value && (
          <button type="button" onClick={onRemove} className={BUTTON_SM_DANGER}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function ShippingMethodEditor({ method, onChange, onDelete }) {
  return (
    <div className="rounded-[10px] border border-[#303839]/10 bg-[#F8F6F1] p-4">
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_minmax(100px,0.7fr)_minmax(120px,0.85fr)_minmax(180px,0.75fr)]">
        <AdminInput label="Method Name" value={method.name} onChange={(value) => onChange({ ...method, name: value })} />
        <AdminInput label="Delivery Area" value={method.area} onChange={(value) => onChange({ ...method, area: value })} />
        <AdminInput label="Shipping Fee" type="number" value={method.fee} onChange={(value) => onChange({ ...method, fee: value })} />
        <AdminInput label="Estimated Time" value={method.eta} onChange={(value) => onChange({ ...method, eta: value })} />
        <div className="flex min-w-0 items-end gap-2 md:col-span-2 2xl:col-span-1">
          <button
            type="button"
            onClick={() => onChange({ ...method, enabled: !method.enabled })}
            className={`h-11 min-w-0 flex-1 rounded-full px-3 text-xs font-semibold ${method.enabled ? "bg-[#303839] text-white" : "bg-white text-[#303839]"}`}
          >
            {method.enabled ? "Enabled" : "Disabled"}
          </button>
          <button type="button" onClick={onDelete} className={`${BUTTON_SM_DANGER} h-11 shrink-0`}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoBox({ label, value }) {
  return (
    <div className="rounded-[10px] border border-[#303839]/10 bg-[#F8F6F1] px-4 py-3 text-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#303839]/70">{label}</p>
      <p className="mt-1 break-words font-semibold text-[#303839]">{value || "Not set"}</p>
    </div>
  );
}

function BackupButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-14 items-center justify-between gap-3 border border-[#303839]/10 bg-white px-4 py-3 text-left text-sm font-semibold text-[#303839] transition-colors hover:border-[#303839]/25 hover:bg-[#F8F6F1]"
    >
      <span>{label}</span>
      <Icon name="download" className="h-4 w-4 shrink-0 text-[#303839]/70 transition-colors group-hover:text-[#303839]" />
    </button>
  );
}

function AdminInput({ label, value, onChange, onBlur, type = "text", required = false, placeholder = "", helper = "", disabled = false }: any) {
  return (
    <label className="block min-w-0 text-[13px] font-semibold text-[#303839]">
      <span>
        {label}
        {required && <span aria-hidden="true" className="text-red-700"> *</span>}
      </span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        required={required}
        placeholder={placeholder}
        step={type === "number" ? "0.01" : undefined}
        inputMode={type === "number" ? "decimal" : undefined}
        disabled={disabled}
        readOnly={disabled}
        className={`mt-1.5 h-11 w-full border border-[#303839]/15 px-3.5 text-base font-medium text-[#303839] outline-none transition-colors placeholder:text-[#303839]/50 sm:text-sm ${disabled ? "cursor-not-allowed bg-[#F3F1EC] text-[#303839]/75" : "bg-white hover:border-[#303839]/25"}`}
      />
      {helper && <span className="mt-1.5 block text-xs font-normal leading-5 text-[#303839]/70">{helper}</span>}
    </label>
  );
}

function AdminTextarea({ label, value, onChange, helper, required = false, placeholder = "", disabled = false }: any) {
  return (
    <label className="block min-w-0 text-[13px] font-semibold text-[#303839]">
      <span>
        {label}
        {required && <span aria-hidden="true" className="text-red-700"> *</span>}
      </span>
      <textarea
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={disabled}
        className={`mt-1.5 min-h-32 w-full border border-[#303839]/15 px-3.5 py-3 text-base font-medium leading-6 text-[#303839] outline-none transition-colors placeholder:text-[#303839]/50 sm:text-sm ${disabled ? "cursor-not-allowed bg-[#F3F1EC] text-[#303839]/75" : "bg-white hover:border-[#303839]/25"}`}
      />
      {helper && <span className="mt-1 block text-xs font-normal text-[#303839]/70">{helper}</span>}
    </label>
  );
}

function AdminSelect({ label, value, onChange, options }) {
  return (
    <div className="block min-w-0 text-[13px] font-semibold text-[#303839]">
      <span>{label}</span>
      <div className="mt-1.5">
        <SelectMenu value={value} onChange={onChange} options={options} variant="field" ariaLabel={label} />
      </div>
    </div>
  );
}
