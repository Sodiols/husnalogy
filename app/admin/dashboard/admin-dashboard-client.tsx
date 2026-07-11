"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import ProductUploadForm from "./product-upload-form";
import HeroCollectionSection from "./hero-collection-section";

const sections = [
  "Overview",
  "Products",
  "Product Reviews",
  "Collections",
  "Home Hero",
  "Order Requests",
  "Contact Messages",
  "Newsletter Subscribers",
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
    ],
  },
  {
    title: "Customers",
    items: [
      { section: "Contact Messages", label: "Contact Messages", icon: "mail" },
      { section: "Newsletter Subscribers", label: "Newsletter Subscribers", icon: "document" },
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
    description: "Update store profile, payments, email, shipping, and security.",
    searchPlaceholder: "Search products, orders, messages...",
  },
};

const sectionTips = {
  Overview: [
    "The cards at the top are live totals for your store. Click any card to jump straight to that page.",
    "New orders and messages also appear under the bell icon in the top bar, so you never miss them.",
  ],
  Products: [
    "Click \"Add Product\" in the top-right corner to create a new product. Products saved as Draft stay hidden from customers until you publish them.",
    "On each product card: the pencil edits, the two squares make a copy, the eye opens the product on your website, and the red bin deletes it.",
    "Deleted products are never lost right away — they move to Recently Deleted, where you can restore them.",
  ],
  "Product Reviews": [
    "Click any review in the list to see its full details on the right side.",
    "Use the dropdowns above the list to narrow reviews by rating, status, or product type.",
  ],
  Collections: [
    "Collections group products together on your website — for example, one wedding suite.",
    "Use \"Add sub\" to place child collections (like RSVP cards) inside a main collection.",
    "The Suite and Wedding checkboxes control where a collection is featured on the website.",
  ],
  "Home Hero": [
    "This controls the big collection section at the top of your homepage.",
    "The homepage shows the collection that is both Active and Featured — mark exactly one that way.",
    "Publishing needs a main image and all three thumbnails, plus at least one heading line.",
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

export default function AdminDashboardClient() {
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
        detail: `${order.productTitle || "Custom order"} | ${formatCurrency(order.total || 0)}`,
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
    setTimeout(() => setNotice(""), 3500);
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
        section: "Newsletter Subscribers",
        count: subscribers.filter((subscriber) => includesSearch([subscriber.email, subscriber.source, subscriber.status], query)).length,
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

  const changeSection = (section) => {
    setActiveSection(section);
    setSidebarOpen(false);
    router.replace(`/admin/dashboard?section=${encodeURIComponent(section)}`);
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

  const handleProductSaved = async (_product, message) => {
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
    <main className="min-h-screen bg-white font-body text-[#111111]">
      <div className="min-h-screen">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-black/55 backdrop-blur-sm lg:hidden"
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex h-screen w-[268px] flex-col border-r border-[#111111]/8 bg-white px-4 py-5 text-black shadow-[18px_0_50px_-36px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out lg:w-[260px] lg:translate-x-0 lg:shadow-none ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="mb-4 flex justify-end lg:hidden">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setSidebarOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[7px] text-black/55 transition hover:bg-[#F3F3F3] hover:text-black"
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1 pt-1">
              {navGroups.map((group) => (
                <div key={group.title || "main"}>
                  {group.title && (
                    <p className="px-3 pb-2 text-[9px] font-bold uppercase tracking-[0.24em] text-black/38">{group.title}</p>
                  )}
                  <div className="grid gap-1.5">
                    {group.items.map((item) => {
                      const badge = navBadges[item.section] || 0;
                      const active = activeSection === item.section;
                      return (
                        <button
                          key={item.section}
                          type="button"
                          onClick={() => changeSection(item.section)}
                          className={`group relative flex h-10 cursor-pointer items-center gap-3 rounded-[7px] px-3 text-left text-[12px] font-semibold transition-all duration-200 ease-out ${
                            active
                              ? "bg-[#F5F5F5] text-black"
                              : "text-black/68 hover:bg-[#F5F5F5] hover:text-black"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute left-0 top-1/2 h-5 w-px -translate-y-1/2 rounded-full bg-[#111111] transition-all duration-200 ease-out ${
                              active ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0 group-hover:scale-y-100 group-hover:opacity-100"
                            }`}
                          />
                          <Icon name={item.icon} className="h-[15px] w-[15px] shrink-0 text-black/72 transition-colors duration-200 group-hover:text-black" />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {badge > 0 && (
                            <span
                              title={`${badge} waiting for you`}
                              className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#F3F3F3] px-1.5 text-[10px] font-bold text-black/72 transition-colors duration-200 group-hover:text-black"
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

            <div className="mt-5 grid gap-1.5 border-t border-[#111111]/8 pt-5">
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                title="Open your website in a new tab"
                className="flex h-10 w-full items-center gap-3 rounded-[7px] px-3 text-left text-[12px] font-semibold text-black/68 transition hover:bg-[#F5F5F5] hover:text-black"
              >
                <Icon name="external" className="h-[15px] w-[15px] shrink-0 text-black/72" />
                <span className="min-w-0 flex-1 truncate">View Store</span>
                <Icon name="chevron" className="h-3.5 w-3.5 shrink-0 -rotate-90 text-black/45" />
              </a>
              <button
                type="button"
                onClick={handleLogout}
                className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-[7px] px-3 text-left text-[12px] font-semibold text-[red]/70 transition hover:bg-red-50/50 hover:text-[red]/50"
              >
                <Icon name="logout" className="h-[15px] w-[15px] shrink-0 text-[red]/70" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </aside>

        <section className="min-w-0 lg:pl-[260px]">
          <header className="sticky top-0 z-20 border-b border-[#111111]/10 bg-white/95 px-4 py-4 shadow-[0_1px_0_rgba(0,0,0,0.03)] backdrop-blur-xl sm:px-6 lg:px-9">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex w-full min-w-0 items-center gap-3 xl:max-w-[390px] 2xl:max-w-[560px]">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[#111111]/10 bg-white text-[#111111] transition hover:bg-[#F4F4F4] lg:hidden"
                  aria-label="Open menu"
                >
                  <Icon name="menu" className="h-6 w-6" />
                </button>
                <form onSubmit={submitGlobalSearch} className="relative block w-full max-w-[360px] 2xl:max-w-[520px]">
                  <button
                    type="submit"
                    data-shape="round"
                    className="absolute right-0 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[#111111]/65 transition hover:bg-[#F8F8F8] hover:text-[#111111] 2xl:right-1 2xl:h-9 2xl:w-9"
                    aria-label="Search admin"
                  >
                    <Icon name="search" className="h-4 w-4 2xl:h-5 2xl:w-5" />
                  </button>
                  <input
                    value={activeSearchValue}
                    onChange={(event) => handleGlobalSearch(event.target.value)}
                    placeholder={activeDetail.searchPlaceholder}
                    className="h-12 w-full rounded-none border-0 border-b border-[#111111]/18 bg-transparent pl-1 pr-11 text-sm font-medium text-[#111111] outline-none transition placeholder:text-[#111111]/45 hover:border-[#111111]/30 focus:border-[#111111]/45 focus:ring-0 2xl:h-14 2xl:pl-1 2xl:pr-12"
                  />
                </form>
              </div>

              <div className="flex w-full min-w-0 flex-nowrap items-center justify-end gap-2 overflow-x-auto pb-1 xl:w-auto xl:overflow-visible xl:pb-0 2xl:gap-3">
                <div className="relative shrink-0">
                  <button type="button" onClick={() => setNotificationsOpen((current) => !current)} title="New orders and messages" className="relative grid h-11 w-11 place-items-center rounded-full border border-transparent text-[#111111] transition hover:border-[#111111]/10 hover:bg-[#F8F8F8]" aria-label="View notifications">
                    <Icon name="bell" className="h-6 w-6" />
                    {!!recentNotifications.length && (
                      <span className="absolute right-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#111111] px-1 text-[10px] font-bold text-white">
                        {recentNotifications.length}
                      </span>
                    )}
                  </button>

                  {notificationsOpen && (
                    <button
                      type="button"
                      aria-label="Close notifications"
                      onClick={() => setNotificationsOpen(false)}
                      className="fixed inset-0 z-40 cursor-default sm:hidden"
                    />
                  )}
                  {notificationsOpen && (
                    <div className="fixed left-3 right-3 top-[72px] z-50 w-auto rounded-none border border-[#111111]/10 bg-white p-3 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.65)] sm:absolute sm:left-auto sm:right-0 sm:top-14 sm:w-[320px]">
                      <div className="flex items-center justify-between border-b border-[#111111]/8 px-2 pb-3">
                        <p className="text-sm font-bold">Notifications</p>
                        <div className="flex items-center gap-3">
                          <button type="button" onClick={() => loadData(true)} className="text-xs font-bold text-[#555555]">Refresh</button>
                          <button type="button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)} className="grid h-7 w-7 place-items-center rounded-full text-[#111111]/55 transition hover:bg-[#F4F4F4] hover:text-[#111111]">
                            <Icon name="close" className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-1">
                        {recentNotifications.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setNotificationsOpen(false);
                              changeSection(item.section);
                            }}
                            className="rounded-none px-3 py-3 text-left transition hover:bg-[#E6E6E6]"
                          >
                            <span className="block text-sm font-bold text-[#111111]">{item.title}</span>
                            <span className="mt-1 block text-xs text-[#111111]/58">{item.detail}</span>
                          </button>
                        ))}
                        {!recentNotifications.length && (
                          <p className="px-3 py-4 text-sm text-[#111111]/58">No new orders or messages.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <span className="hidden h-10 w-px shrink-0 bg-[#111111]/16 sm:block" />
                <div className="flex shrink-0 items-center gap-3 border border-transparent py-1 pl-1 pr-3 transition hover:border-[#111111]/8 hover:bg-[#F8F8F8]">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-[#E6E6E6] text-base font-semibold">A</div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-5">Admin User</p>
                    <p className="text-xs text-[#111111]/58">Administrator</p>
                  </div>
                  <Icon name="chevron" className="h-4 w-4 text-[#111111]/58" />
                </div>
                {primaryAction && (
                  <button
                    type="button"
                    onClick={primaryAction.onClick}
                    className="flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[#111111] px-4 text-xs font-bold text-white transition hover:bg-[#000000] 2xl:h-11 2xl:px-5 2xl:text-sm"
                  >
                    <Icon name="plus" className="h-4 w-4" />
                    {primaryAction.label}
                  </button>
                )}
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:px-10">
            {activeSection !== "Overview" && (
              <div className="mb-7 flex flex-col gap-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="min-w-0">
                    <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#111111]/55" aria-label="Breadcrumb">
                      <span>System Dashboard</span>
                      <span className="text-[#111111]/30">&gt;</span>
                      <span className="text-[#111111]/85">{activeLabel}</span>
                    </nav>
                    <h1 className="mt-3 font-body text-[2.25rem] font-semibold leading-none text-[#111111] sm:text-[2.8rem]">
                      {activeLabel}
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-[#111111]/62">
                      {activeDetail.description}
                    </p>
                  </div>

                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearActiveFilters}
                      className="inline-flex h-10 w-fit items-center gap-2 rounded-full border border-[#111111]/12 bg-white px-4 text-xs font-bold text-[#111111] transition hover:bg-[#F1F1F1]"
                    >
                      <Icon name="close" className="h-4 w-4" />
                      Clear search and filters
                    </button>
                  )}
                </div>

                <SectionHelp key={activeSection} section={activeSection} tips={sectionTips[activeSection] || []} />
              </div>
            )}

            {notice && <p className="mb-5 rounded-none border border-green-200 bg-green-50 px-5 py-4 text-sm font-bold text-green-800">{notice}</p>}
            {error && <p className="mb-5 rounded-none border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">{error}</p>}

            {loading ? (
              <div className="space-y-5" aria-busy="true" aria-live="polite">
                <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
                  {[0, 1, 2, 3].map((placeholder) => (
                    <div key={placeholder} className="min-h-[120px] animate-pulse rounded-none border border-[#111111]/8 bg-white p-5">
                      <div className="h-3.5 w-24 bg-[#F1F1F1]" />
                      <div className="mt-4 h-8 w-20 bg-[#F1F1F1]" />
                      <div className="mt-4 h-3 w-32 bg-[#F4F4F4]" />
                    </div>
                  ))}
                </div>
                <div className="h-[300px] animate-pulse rounded-none border border-[#111111]/8 bg-white" />
                <p className="text-center text-sm font-semibold text-[#111111]/55">Loading your store data. This only takes a moment...</p>
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
                    setQuery={setProductQuery}
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

                {activeSection === "Order Requests" && (
                  <OrdersSection
                    orders={orders}
                    query={orderQuery}
                    status={orderStatus}
                    setStatus={setOrderStatus}
                    onStatusChange={updateOrderStatus}
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

                {activeSection === "Newsletter Subscribers" && (
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

function DeleteConfirmDialog({ title, message, confirmLabel = "Delete", working = false, onCancel, onConfirm }: any) {
  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#000000]/60 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-[430px] rounded-none border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_24px_80px_rgba(16,20,18,0.28)]">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-50 text-red-700">
            <Icon name="trash" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-body text-2xl leading-tight text-[#111111]">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#1F1F1F]/65">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="h-11 rounded-none border border-[#1F1F1F]/16 px-5 text-sm font-bold text-[#1F1F1F] transition hover:bg-[#F4F4F4] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={working}
            className="h-11 rounded-none bg-red-700 px-5 text-sm font-bold text-white transition hover:bg-red-800 disabled:opacity-50"
          >
            {working ? "Deleting..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function PermanentDeleteDialog({ product, credentials, setCredentials, working = false, onCancel, onConfirm }: any) {
  const canDelete = credentials.email.trim() && credentials.password.trim();

  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#000000]/60 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-[460px] rounded-none border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_24px_80px_rgba(16,20,18,0.28)]">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-50 text-red-700">
            <Icon name="trash" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-body text-2xl leading-tight text-[#111111]">Permanently delete product?</h2>
            <p className="mt-2 text-sm leading-6 text-[#1F1F1F]/65">
              This cannot be undone. Enter the permission email and password to delete {product?.title || "this product"} forever.
            </p>
          </div>
        </div>
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
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="h-11 rounded-none border border-[#1F1F1F]/16 px-5 text-sm font-bold text-[#1F1F1F] transition hover:bg-[#F4F4F4] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={working || !canDelete}
            className="h-11 rounded-none bg-red-700 px-5 text-sm font-bold text-white transition hover:bg-red-800 disabled:opacity-50"
          >
            {working ? "Deleting..." : "Permanent delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Panel({ title, children, action }: any) {
  return (
    <div className="rounded-none border border-[#111111]/10 bg-white p-5 shadow-[0_18px_60px_-52px_rgba(0,0,0,0.7)] sm:p-6">
      {(title || action) && (
        <div className="mb-5 flex items-center justify-between gap-3 border-b border-[#111111]/8 pb-4">
          {title && <h2 className="font-body text-[1.65rem] font-semibold leading-none text-[#111111]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
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

  const metrics = [
    { label: "Total Orders", value: rangeOrders.length.toLocaleString(), icon: "bag", note: `${overview.newOrders} need attention`, onClick: onOpenOrders },
    { label: "Total Revenue", value: formatCurrency(totalRevenue), icon: "wallet", note: "Recorded order value", onClick: onOpenOrders },
    { label: "Subscribers", value: overview.subscribers.toLocaleString(), icon: "user", note: "Newsletter audience", onClick: onOpenSubscribers },
    { label: "Active Products", value: overview.activeProducts.toLocaleString(), icon: "box", note: `${overview.products} total products`, onClick: onOpenActiveProducts },
  ];

  const glanceRows = [
    { label: "Pending Orders", value: overview.newOrders, icon: "calendar", onClick: onOpenPendingOrders },
    { label: "New Messages", value: overview.newMessages, icon: "bell", onClick: onOpenNewMessages },
    { label: "Draft Products", value: draftProducts.length, icon: "pencil", onClick: onOpenDraftProducts },
    { label: "Deleted Items", value: deletedProducts.length, icon: "trash", onClick: () => onViewSection("Recently Deleted") },
    { label: "Low Stock Items", value: lowStockProducts.length, icon: "wallet", onClick: () => onViewSection("Products") },
  ];

  const quickActions = [
    { title: "Add New Product", note: "Create a new product", icon: "box", onClick: onAddProduct },
    { title: "Manage Collections", note: "Organize your products", icon: "grid", onClick: () => onViewSection("Collections") },
    { title: "View Messages", note: "Check customer messages", icon: "mail", onClick: () => onViewSection("Contact Messages") },
    { title: "Store Settings", note: "Configure your store", icon: "settings", onClick: () => onViewSection("Settings") },
  ];

  const exportReport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      dateRange: dateRangeLabel,
      summary: {
        totalOrders: rangeOrders.length,
        totalRevenue,
        subscribers: overview.subscribers,
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
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-[1.65rem] font-bold leading-tight text-[#111111] sm:text-[2rem]">Good morning, Admin</h1>
          <p className="mt-2 text-sm font-medium text-[#111111]/58">Here is what is happening with your store today.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SelectMenu
            value={dateRange}
            onChange={setDateRange}
            size="sm"
            ariaLabel="Dashboard date range"
            className="min-w-[190px]"
            options={[
              { value: "7d", label: `Last 7 days (${dateRangeLabel})` },
              { value: "30d", label: "Last 30 days" },
              { value: "month", label: "This month" },
              { value: "year", label: "This year" },
            ]}
          />
          <button type="button" onClick={exportReport} className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-[#111111] px-4 text-xs font-bold text-white transition hover:bg-black">
            Export Report
            <Icon name="download" className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)]">
        <DashboardCard>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[#111111]">Overview</h2>
            <div className="flex items-center gap-2">
              <div className="flex rounded-[8px] border border-[#111111]/10 bg-[#F6F6F6] p-1">
                {["orders", "revenue"].map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setChartMode(item)}
                    className={`h-8 rounded-[6px] px-3 text-xs font-bold capitalize transition ${
                      chartMode === item ? "bg-white text-[#111111] shadow-[0_1px_4px_rgba(0,0,0,0.08)]" : "text-[#111111]/55 hover:text-[#111111]"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <SelectMenu
                value={dateRange}
                onChange={setDateRange}
                size="sm"
                ariaLabel="Chart date range"
                className="min-w-[132px]"
                options={[
                  { value: "7d", label: "Last 7 days" },
                  { value: "30d", label: "Last 30 days" },
                  { value: "month", label: "This month" },
                  { value: "year", label: "This year" },
                ]}
              />
            </div>
          </div>
          <OverviewChart data={chartData} mode={chartMode} />
        </DashboardCard>

        <DashboardCard>
          <h2 className="mb-5 text-lg font-bold text-[#111111]">At a Glance</h2>
          <div className="divide-y divide-[#111111]/8">
            {glanceRows.map((row) => (
              <button
                key={row.label}
                type="button"
                onClick={row.onClick}
                className="flex w-full cursor-pointer items-center gap-3 py-3.5 text-left transition hover:bg-[#F7F7F7]"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F2F2F2] text-[#111111]">
                  <Icon name={row.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-bold text-[#111111]">{row.label}</span>
                <span className="text-sm font-bold text-[#111111]">{row.value.toLocaleString()}</span>
                <Icon name="arrowRight" className="h-3.5 w-3.5 text-[#111111]/45" />
              </button>
            ))}
          </div>
        </DashboardCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]">
        <DashboardCard>
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[#111111]">Recent Orders</h2>
            <DashboardTextButton label="View All Orders" onClick={onOpenOrders} />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className="border-b border-[#111111]/8 text-[11px] font-bold text-[#111111]/62">
                <tr>
                  <th className="py-3 pr-4">Order ID</th>
                  <th className="py-3 pr-4">Customer</th>
                  <th className="py-3 pr-4">Product</th>
                  <th className="py-3 pr-4">Payment Status</th>
                  <th className="py-3 pr-4">Order Status</th>
                  <th className="py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#111111]/8">
                {recentOrders.map((order) => (
                  <tr key={order.id} className="text-[#111111]/82">
                    <td className="py-4 pr-4 text-xs font-bold">{formatOrderId(order.id)}</td>
                    <td className="py-4 pr-4">{order.customerName || "Customer"}</td>
                    <td className="py-4 pr-4">{order.productTitle || order.productSlug || "Custom order"}</td>
                    <td className="py-4 pr-4"><StatusBadge status={order.paymentStatus || "unpaid"} /></td>
                    <td className="py-4 pr-4"><StatusBadge status={order.status || "pending"} /></td>
                    <td className="py-4 text-right font-bold">{formatCurrency(order.total || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!recentOrders.length && (
            <div className="grid min-h-[190px] place-items-center text-center">
              <div>
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-[#111111]/10 text-[#111111]/35">
                  <Icon name="bag" className="h-5 w-5" />
                </span>
                <p className="mt-4 text-sm font-bold text-[#111111]/65">No recent orders yet.</p>
                <p className="mt-1 text-xs font-medium text-[#111111]/45">New orders will appear here.</p>
              </div>
            </div>
          )}
        </DashboardCard>

        <DashboardCard>
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[#111111]">Top Selling Products</h2>
            <DashboardTextButton label="View All Products" onClick={onOpenProducts} />
          </div>
          <div className="divide-y divide-[#111111]/8">
            {topProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onEditProduct(product)}
                className="grid w-full grid-cols-[54px_minmax(0,1fr)_auto_auto] items-center gap-3 py-3 text-left transition hover:bg-[#F7F7F7]"
              >
                <img src={getProductImage(product)} alt="" className="h-12 w-12 rounded-[8px] object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-[#111111]">{product.title || "Untitled product"}</span>
                  <span className="mt-0.5 block truncate text-xs font-medium text-[#111111]/48">SKU: {product.sku || product.slug || product.id}</span>
                </span>
                <span className="text-center text-sm font-bold text-[#111111]">
                  {Number(product.soldCount || 0).toLocaleString()}
                  <span className="block text-[11px] font-medium text-[#111111]/45">Sold</span>
                </span>
                <span className="rounded-full bg-[#F2F2F2] px-3 py-1 text-[11px] font-bold text-[#111111]/62">
                  {getProductBadge(product)}
                </span>
              </button>
            ))}
            {!topProducts.length && <EmptyLine>No products to show yet.</EmptyLine>}
          </div>
        </DashboardCard>
      </div>

      <DashboardCard className="p-0">
        <div className="grid divide-y divide-[#111111]/10 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
          {quickActions.map((action) => (
            <button
              key={action.title}
              type="button"
              onClick={action.onClick}
              className="flex cursor-pointer items-center gap-4 px-5 py-5 text-left transition hover:bg-[#F7F7F7]"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F2F2F2] text-[#111111]">
                <Icon name={action.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-[#111111]">{action.title}</span>
                <span className="mt-1 block truncate text-xs font-medium text-[#111111]/52">{action.note}</span>
              </span>
            </button>
          ))}
        </div>
      </DashboardCard>
    </div>
  );
}

function DashboardCard({ children, className = "" }) {
  return (
    <section className={`rounded-[10px] border border-[#111111]/10 bg-white p-5 shadow-[0_12px_36px_-34px_rgba(0,0,0,0.5)] ${className}`}>
      {children}
    </section>
  );
}

function MetricCard({ label, value, icon, note, onClick = null }) {
  const content = (
    <>
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#F2F2F2] text-[#111111]">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[#111111]/70">{label}</span>
          <span className="mt-2 block text-[1.75rem] font-bold leading-none text-[#111111]">{value}</span>
          <span className="mt-3 block text-xs font-medium text-[#111111]/52">{note}</span>
        </span>
      </div>
      <div className="mt-5 flex items-center gap-2 text-[11px] font-bold text-[#111111]/55">
        <span className="rounded-full bg-[#F2F2F2] px-2 py-1">0%</span>
        <span>vs last 7 days</span>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="min-h-[150px] rounded-[10px] border border-[#111111]/10 bg-white p-5 text-left shadow-[0_12px_36px_-34px_rgba(0,0,0,0.5)] transition hover:border-[#111111]/18 hover:bg-[#F8F8F8]"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="min-h-[150px] rounded-[10px] border border-[#111111]/10 bg-white p-5 shadow-[0_12px_36px_-34px_rgba(0,0,0,0.5)] transition hover:border-[#111111]/18">
      {content}
    </div>
  );
}

function DashboardTextButton({ label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs font-bold text-[#111111] transition hover:bg-[#F4F4F4]">
      {label}
      <Icon name="arrowRight" className="h-3.5 w-3.5" />
    </button>
  );
}

function OverviewChart({ data, mode }) {
  const maxValue = Math.max(1, ...data.map((item) => mode === "revenue" ? item.revenue : item.orders));
  const xFor = (index) => data.length === 1 ? 48 : 48 + (index * (552 / (data.length - 1)));
  const yFor = (value) => 190 - (Number(value || 0) / maxValue) * 150;
  const ordersPath = data.map((item, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(item.orders)}`).join(" ");
  const revenuePath = data.map((item, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(item.revenue)}`).join(" ");
  const ticks = [100, 80, 60, 40, 20, 0];

  return (
    <div className="min-h-[270px]">
      <svg viewBox="0 0 640 250" className="h-[250px] w-full overflow-visible" role="img" aria-label="Orders and revenue overview chart">
        {ticks.map((tick) => {
          const y = 40 + ((100 - tick) / 100) * 150;
          return (
            <g key={tick}>
              <line x1="48" x2="600" y1={y} y2={y} stroke="#111111" strokeOpacity="0.08" strokeDasharray={tick === 0 ? "0" : "4 4"} />
              <text x="22" y={y + 4} fill="#111111" opacity="0.5" fontSize="11">{tick}</text>
            </g>
          );
        })}
        <line x1="48" x2="600" y1="190" y2="190" stroke="#111111" strokeOpacity="0.35" />
        <path d={revenuePath} fill="none" stroke="#777777" strokeWidth="2" strokeDasharray="8 7" opacity={mode === "revenue" ? "1" : "0.45"} />
        <path d={ordersPath} fill="none" stroke="#111111" strokeWidth="2.4" opacity={mode === "orders" ? "1" : "0.45"} />
        {data.map((item, index) => (
          <g key={item.key}>
            <circle cx={xFor(index)} cy={yFor(mode === "revenue" ? item.revenue : item.orders)} r="3" fill="#111111" />
            <text x={xFor(index)} y="214" fill="#111111" opacity="0.58" fontSize="11" textAnchor="middle">{item.label}</text>
          </g>
        ))}
      </svg>
      <div className="flex justify-center gap-7 text-xs font-medium text-[#111111]/55">
        <span className="inline-flex items-center gap-2"><span className="h-px w-8 bg-[#111111]" />Orders</span>
        <span className="inline-flex items-center gap-2"><span className="h-px w-8 border-t border-dashed border-[#777777]" />Revenue</span>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status || "pending").toLowerCase();
  const tone = ["paid", "completed", "delivered", "active", "published", "approved", "resolved", "sent", "verified", "replied"].includes(normalized)
    ? "done"
    : ["pending", "unpaid", "new", "draft", "waiting for customer"].includes(normalized)
      ? "pending"
      : ["confirmed", "in design review", "proof sent", "customer approved", "printing", "ready for delivery", "read"].includes(normalized)
        ? "progress"
        : ["cancelled", "deleted", "flagged"].includes(normalized)
          ? "problem"
          : "gray";

  const toneClass = {
    done: "border-[#111111]/10 bg-[#F4F4F4] text-[#111111]/80",
    pending: "border-[#111111]/12 bg-white text-[#111111]/72",
    progress: "border-[#111111]/10 bg-[#F8F8F8] text-[#111111]/75",
    problem: "border-[#111111]/16 bg-[#E6E6E6] text-[#111111]",
    gray: "border-[#111111]/12 bg-white text-[#111111]/72",
  }[tone];
  const dotClass = {
    done: "bg-[#111111]/55",
    pending: "bg-[#111111]/32",
    progress: "bg-[#111111]/45",
    problem: "bg-[#111111]",
    gray: "bg-[#111111]/36",
  }[tone];

  return (
    <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold capitalize ${toneClass}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      {String(status || "pending").replaceAll("-", " ")}
    </span>
  );
}

function EmptyLine({ children }) {
  return <p className="py-6 text-sm text-[#111111]/55">{children}</p>;
}

function EmptyState({ icon = "box", title, hint = "", action = null }: any) {
  return (
    <div className="grid place-items-center rounded-none border border-dashed border-[#1F1F1F]/18 bg-white px-6 py-10 text-center shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)]">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[#F1F1F1] text-[#1F1F1F]">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="mt-4 text-sm font-bold text-[#1F1F1F]">{title}</p>
      {hint && <p className="mt-1.5 max-w-md text-xs leading-5 text-[#1F1F1F]/60">{hint}</p>}
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
        className="inline-flex w-fit items-center gap-2 rounded-full border border-[#111111]/12 bg-white px-4 py-2 text-xs font-bold text-[#111111]/70 transition hover:bg-[#F1F1F1] hover:text-[#111111]"
      >
        <Icon name="info" className="h-4 w-4" />
        How this page works
      </button>
    );
  }

  return (
    <div className="rounded-none border border-[#111111]/10 bg-[#F8F8F8] px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F1F1F1] text-[#555555]">
            <Icon name="info" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#111111]">How this page works</p>
            <ul className="mt-2 space-y-1.5">
              {tips.map((tip) => (
                <li key={tip} className="flex gap-2 text-sm leading-6 text-[#111111]/72">
                  <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-[#555555]" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <button
          type="button"
          onClick={() => persist(false)}
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-[#555555] transition hover:bg-[#F1F1F1]"
        >
          Hide tips
        </button>
      </div>
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

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatProductPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return `$${amount.toFixed(2)}`;
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

// Shared Husnalogy filter-control styles
const FILTER_BAR_CLASS =
  "mb-5 flex max-w-full flex-wrap items-center gap-2 rounded-none border border-[#1F1F1F]/8 bg-[#F8F8F8] p-2";
const FILTER_SELECT_CLASS = "w-auto shrink-0";

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

  const heightClass = size === "sm" ? "h-9 px-3.5 text-xs" : "h-12 px-4 text-sm";
  const colorClass = disabled
    ? "cursor-not-allowed border-[#1F1F1F]/10 bg-[#F3F3F3] text-[#1F1F1F]/40"
    : isActive
      ? "border-[#1F1F1F] bg-[#1F1F1F] text-[#E6E6E6] hover:bg-[#222222]"
      : "border-[#1F1F1F]/12 bg-white text-[#1F1F1F] hover:border-[#1F1F1F]/24 hover:bg-[#F8F8F8]";

  return (
    <div ref={containerRef} className={`relative ${open ? "z-[140]" : "z-20"} ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((current) => !current)}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-[8px] border font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#1F1F1F]/30 ${heightClass} ${colorClass} ${open ? "ring-2 ring-[#1F1F1F]/25" : ""}`}
      >
        <span className={`truncate ${!selected ? "text-[#1F1F1F]/45" : ""}`}>{selected ? selected.label : placeholder}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""} ${isActive ? "text-[#E6E6E6]" : "text-[#1F1F1F]/55"}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-[150] mt-2 max-h-72 overflow-y-auto rounded-[10px] border border-[#1F1F1F]/10 bg-white p-1.5 shadow-[0_18px_55px_-40px_rgba(0,0,0,0.65)]"
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
                className={`flex w-full items-center justify-between gap-2 rounded-none px-3.5 py-2.5 text-left text-sm font-semibold transition ${
                  optionSelected ? "rounded-[6px] bg-[#1F1F1F]/[0.06] text-[#1F1F1F]" : "rounded-[6px] text-[#1F1F1F]/80 hover:bg-[#E6E6E6] hover:text-[#1F1F1F]"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {optionSelected && <Icon name="check" className="h-4 w-4 shrink-0 text-[#1F1F1F]" />}
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

  const heightClass = size === "sm" ? "h-9 px-3.5 text-xs" : "h-12 px-4 text-sm";

  const openMenu = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuHeight = Math.min(items.length * 40 + 12, 288);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight + 16 ? rect.top - menuHeight - 6 : rect.bottom + 6;
    setCoords({ left: rect.left, top, width: rect.width });
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
        className={`inline-flex w-full items-center justify-between gap-2 rounded-[8px] border border-[#1F1F1F]/12 bg-white font-semibold text-[#1F1F1F] outline-none transition hover:border-[#1F1F1F]/24 hover:bg-[#F8F8F8] focus-visible:ring-2 focus-visible:ring-[#1F1F1F]/30 ${heightClass} ${open ? "ring-2 ring-[#1F1F1F]/25" : ""}`}
      >
        <span className="truncate">{selected ? selected.label : "Select"}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-[#1F1F1F]/55 transition-transform ${open ? "rotate-180" : ""}`}
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
            style={{ position: "fixed", left: coords.left, top: coords.top, width: Math.max(coords.width, 160) }}
            className="z-[9999] max-h-72 overflow-y-auto rounded-[10px] border border-[#1F1F1F]/10 bg-white p-1.5 shadow-[0_18px_55px_-40px_rgba(0,0,0,0.65)]"
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
                  className={`flex w-full items-center justify-between gap-2 rounded-none px-3.5 py-2.5 text-left text-xs font-semibold transition ${
                    optionSelected ? "rounded-[6px] bg-[#1F1F1F]/[0.06] text-[#1F1F1F]" : "rounded-[6px] text-[#1F1F1F]/80 hover:bg-[#E6E6E6] hover:text-[#1F1F1F]"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {optionSelected && <Icon name="check" className="h-4 w-4 shrink-0 text-[#1F1F1F]" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

function ProductsSection({ allProducts = [], products, setQuery, statusFilter, setStatusFilter, totalProducts, editingProduct, formOpen, onSaved, onCloseForm, onEdit, onDuplicate, onDelete }) {
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [personalizationFilter, setPersonalizationFilter] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  const filterSource = allProducts.length ? allProducts : products;
  const categories = [...new Set(filterSource.map((product) => product.category).filter(Boolean))];
  const productTypes = [...new Set(filterSource.map((product) => product.productType).filter(Boolean))];
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
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  const productCountText =
    visibleProducts.length === 0
      ? "Showing 0 products"
      : visibleProducts.length === totalProducts
      ? `Showing ${visibleProducts.length} product${visibleProducts.length === 1 ? "" : "s"}`
      : `Showing ${visibleProducts.length} of ${totalProducts} products`;

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

      <section className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_22px_80px_-70px_rgba(0,0,0,0.65)] sm:p-7">
        <div className="flex flex-col gap-4 border-b border-[#1F1F1F]/10 pb-5 xl:flex-row xl:items-center xl:justify-between">
          <p className="text-sm font-bold text-[#1F1F1F]/75">{productCountText}</p>

          <div className="flex max-w-full flex-wrap items-center gap-2 xl:justify-end">
          <SelectMenu
            value={categoryFilter}
            onChange={setCategoryFilter}
            size="sm"
            ariaLabel="Filter by category"
            className={`${FILTER_SELECT_CLASS} min-w-[150px] max-w-[190px]`}
            options={[{ value: "", label: "All Categories" }, ...categories]}
          />
          <SelectMenu
            value={statusFilter}
            onChange={setStatusFilter}
            size="sm"
            ariaLabel="Filter by status"
            className={`${FILTER_SELECT_CLASS} min-w-[136px] max-w-[170px]`}
            options={[{ value: "", label: "All statuses" }, ...productStatuses]}
          />
          <SelectMenu
            value={typeFilter}
            onChange={setTypeFilter}
            size="sm"
            ariaLabel="Filter by product type"
            className={`${FILTER_SELECT_CLASS} min-w-[132px] max-w-[170px]`}
            options={[{ value: "", label: "All Types" }, ...productTypes]}
          />
          <SelectMenu
            value={personalizationFilter}
            onChange={setPersonalizationFilter}
            size="sm"
            ariaLabel="Filter by personalization"
            className={`${FILTER_SELECT_CLASS} min-w-[142px] max-w-[190px]`}
            options={[
              { value: "", label: "All personalization" },
              { value: "yes", label: "Personalized" },
              { value: "no", label: "Not personalized" },
            ]}
          />
          <SelectMenu
            value={sortBy}
            onChange={setSortBy}
            size="sm"
            ariaLabel="Sort products"
            className={`${FILTER_SELECT_CLASS} min-w-[136px] max-w-[170px]`}
            options={[
              { value: "newest", label: "Newest First" },
              { value: "oldest", label: "Oldest First" },
              { value: "price-high", label: "Price High" },
              { value: "price-low", label: "Price Low" },
            ]}
          />
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setCategoryFilter("");
              setStatusFilter("");
              setTypeFilter("");
              setPersonalizationFilter("");
              setSortBy("newest");
            }}
            title="Clear the header search and every filter"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[8px] border border-[#1F1F1F]/10 bg-white px-4 text-xs font-bold text-[#1F1F1F] transition hover:border-[#1F1F1F]/25 hover:bg-[#F8F8F8]"
          >
            <Icon name="close" className="h-3.5 w-3.5" />
            Reset filters
          </button>
          </div>
        </div>

        <div className="grid gap-4 pt-5 md:grid-cols-2 2xl:grid-cols-3">
          {visibleProducts.map((product) => {
            const hasPersonalization = hasProductPersonalization(product);
            const statusLabel = product.status === "active" ? "Published" : product.status || "Draft";
            const priceValue = product.salePrice ?? product.price;
            const hasOldPrice = product.oldPrice !== null && product.oldPrice !== undefined && product.oldPrice !== "";
            return (
              <article key={product.id} className="flex min-h-[210px] flex-col rounded-[10px] border border-[#1F1F1F]/10 bg-white p-4 shadow-[0_16px_50px_-44px_rgba(0,0,0,0.7)] transition hover:border-[#1F1F1F]/22 hover:shadow-[0_20px_60px_-46px_rgba(0,0,0,0.75)]">
                <div className="flex gap-3">
                  <img src={getProductImage(product)} alt="" className="h-20 w-20 shrink-0 rounded-[8px] border border-[#1F1F1F]/8 object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-[#1F1F1F]">{product.title || "Untitled product"}</p>
                    <p className="mt-1 truncate text-xs font-medium text-[#1F1F1F]/55">SKU: {product.sku || product.slug || product.id}</p>
                    <p className="mt-1 truncate text-xs font-medium text-[#1F1F1F]/60">{product.category || "Uncategorized"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-[#1F1F1F]">{priceValue !== null && priceValue !== undefined ? formatProductPrice(priceValue) : "-"}</p>
                    {hasOldPrice ? <p className="mt-1 text-xs font-medium text-[#1F1F1F]/40 line-through">{formatProductPrice(product.oldPrice)}</p> : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="inline-flex min-h-6 items-center gap-1.5 rounded-[6px] border border-[#1F1F1F]/10 bg-[#F4F4F4] px-2.5 py-1 font-bold capitalize text-[#1F1F1F]/72">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#1F1F1F]/45" />
                    {statusLabel}
                  </span>
                  <span className="rounded-[6px] border border-[#1F1F1F]/10 bg-white px-2.5 py-1 font-bold capitalize text-[#1F1F1F]/72">
                    {product.visibility === "direct" ? "Direct only" : product.visibility || "Public"}
                  </span>
                  {product.isStockOut ? (
                    <span className="rounded-[6px] border border-[#1F1F1F]/12 bg-[#F8F8F8] px-2.5 py-1 font-bold text-[#1F1F1F]/72">
                      Stock Out{product.comingInDays ? ` - ${product.comingInDays}d` : ""}
                    </span>
                  ) : (
                    <span className="rounded-[6px] border border-[#1F1F1F]/10 bg-[#F4F4F4] px-2.5 py-1 font-bold text-[#1F1F1F]/72">Available</span>
                  )}
                  <span className="px-1 py-1 font-medium text-[#1F1F1F]/42">{formatDate(product.createdAt)}</span>
                </div>

                {(product.featured || product.isFeatured || product.isNew || product.isBestSeller || hasPersonalization) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold">
                    {(product.featured || product.isFeatured) && <span className="rounded-[6px] border border-[#1F1F1F]/10 bg-white px-2.5 py-1 text-[#1F1F1F]/70">Featured</span>}
                    {product.isNew && <span className="rounded-[6px] border border-[#1F1F1F]/10 bg-[#F4F4F4] px-2.5 py-1 text-[#1F1F1F]/70">New Arrival</span>}
                    {product.isBestSeller && <span className="rounded-[6px] bg-[#1F1F1F] px-2.5 py-1 text-white">Best Seller</span>}
                    {hasPersonalization && <span className="rounded-[6px] border border-[#1F1F1F]/10 bg-[#F4F4F4] px-2.5 py-1 text-[#1F1F1F]/70">Personalized</span>}
                  </div>
                )}

                <div className="mt-auto flex justify-end gap-2 border-t border-[#1F1F1F]/8 pt-3 text-[#1F1F1F]">
                  <button type="button" onClick={() => onEdit(product)} title="Edit this product" className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#1F1F1F]/10 bg-white transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4]" aria-label="Edit product"><Icon name="pencil" className="h-4 w-4" /></button>
                  <button type="button" onClick={() => onDuplicate(product)} title="Make a copy of this product" className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#1F1F1F]/10 bg-white transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4]" aria-label="Duplicate product"><Icon name="copy" className="h-4 w-4" /></button>
                  <a href={`/products/${product.slug}`} title="See this product on your website" className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#1F1F1F]/10 bg-white transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4]" aria-label="View product"><Icon name="eye" className="h-4 w-4" /></a>
                  <button type="button" onClick={() => onDelete(product.id)} title="Move this product to Recently Deleted" className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#1F1F1F]/10 bg-white text-[#1F1F1F]/70 transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4] hover:text-[#1F1F1F]" aria-label="Delete product"><Icon name="trash" className="h-4 w-4" /></button>
                </div>
              </article>
            );
          })}
          {!visibleProducts.length && (
            <div className="col-span-full">
              <EmptyState
                icon="box"
                title={totalProducts ? "No products match your search or filters" : "You have no products yet"}
                hint={
                  totalProducts
                    ? "Try the Reset filters button above to see all of your products again."
                    : "Click the Add Product button in the top-right corner to create your first product."
                }
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ProductReviewsSection({ products, query, setQuery, onDeleteReview }) {
  const [ratingFilter, setRatingFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedReviewKey, setSelectedReviewKey] = useState("");

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
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
            value: flaggedReviews.toLocaleString(),
            icon: "document",
            note: `${verifiedReviews.toLocaleString()} verified purchases`,
            change: changeLabel(
              currentWeekReviews.filter((review) => getReviewStatus(review) === "flagged").length,
              previousWeekReviews.filter((review) => getReviewStatus(review) === "flagged").length
            ),
          },
        ].map((metric) => (
          <div key={metric.label} className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_18px_65px_-56px_rgba(0,0,0,0.65)]">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]">
                <Icon name={metric.icon} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1F1F1F]/68">{metric.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-[#1F1F1F]">{metric.value}</p>
                <p className="mt-2 text-xs font-medium text-[#1F1F1F]/55">{metric.note}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2 text-xs font-bold text-[#1F1F1F]/55">
              <span className="rounded-full bg-[#F3F3F3] px-3 py-1">{metric.change}</span>
              <span>vs last 7 days</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid min-w-0 max-w-full items-start gap-5 2xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <section className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_22px_80px_-70px_rgba(0,0,0,0.65)] sm:p-6">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-bold text-[#1F1F1F]">All Reviews</h2>
            <div className="relative w-full lg:max-w-[260px]">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1F1F1F]/45" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search reviews..."
                className="h-10 w-full rounded-[8px] border border-[#1F1F1F]/10 bg-white pl-9 pr-3 text-sm font-medium text-[#1F1F1F] outline-none transition placeholder:text-[#1F1F1F]/38 hover:border-[#1F1F1F]/20 focus:border-[#1F1F1F]/35 focus:ring-2 focus:ring-[#1F1F1F]/8"
              />
            </div>
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-2">
            <SelectMenu value={ratingFilter} onChange={setRatingFilter} size="sm" ariaLabel="Filter by rating" className="min-w-[136px]" options={[{ value: "", label: "All Ratings" }, ...[5, 4, 3, 2, 1].map((rating) => ({ value: String(rating), label: `${rating} Stars` }))]} />
            <SelectMenu
              value={statusFilter}
              onChange={setStatusFilter}
              size="sm"
              ariaLabel="Filter by status"
              className="min-w-[140px]"
              options={[
                { value: "", label: "All Statuses" },
                { value: "approved", label: "Approved" },
                { value: "flagged", label: "Flagged" },
                { value: "hidden", label: "Hidden" },
                { value: "pending", label: "Pending" },
              ]}
            />
            <SelectMenu value={typeFilter} onChange={setTypeFilter} size="sm" ariaLabel="Filter by product type" className="min-w-[132px]" options={[{ value: "", label: "All Types" }, ...productTypes]} />
            <SelectMenu
              value={sortBy}
              onChange={setSortBy}
              size="sm"
              ariaLabel="Sort reviews"
              className="min-w-[148px]"
              options={[
                { value: "newest", label: "Newest First" },
                { value: "oldest", label: "Oldest First" },
                { value: "rating-high", label: "Highest Rating" },
                { value: "rating-low", label: "Lowest Rating" },
              ]}
            />
          </div>

          {!filteredReviews.length ? (
            <div className="grid min-h-[260px] place-items-center rounded-[10px] border border-dashed border-[#1F1F1F]/14 bg-white px-6 py-10 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]/72">
                  <Icon name="document" className="h-6 w-6" />
                </span>
                <p className="mt-5 text-sm font-bold text-[#1F1F1F]">No reviews match the current filters.</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#1F1F1F]/55">
                  Try adjusting your filters or search to find what you are looking for.
                </p>
                <button
                  type="button"
                  onClick={clearReviewFilters}
                  className="mt-5 inline-flex h-10 items-center justify-center rounded-[8px] border border-[#1F1F1F]/10 bg-white px-4 text-xs font-bold text-[#1F1F1F] transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4]"
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
                      onClick={() => setSelectedReviewKey(review.reviewKey)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedReviewKey(review.reviewKey);
                        }
                      }}
                      className={`min-w-0 cursor-pointer overflow-hidden rounded-[10px] border p-4 text-left transition ${
                        isSelected ? "border-[#1F1F1F]/22 bg-[#F4F4F4]" : "border-[#1F1F1F]/10 bg-white hover:border-[#1F1F1F]/20 hover:bg-[#F8F8F8]"
                      }`}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F1F1F1] text-xs font-bold text-[#1F1F1F]">{getInitials(review.name || "Customer")}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold text-[#1F1F1F]">{review.name || "Customer"}</p>
                          <p className="truncate text-xs text-[#1F1F1F]/55">{getReviewEmail(review)}</p>
                        </div>
                        <ReviewStatusBadge label={getReviewStatusLabel(review)} status={getReviewStatus(review)} />
                      </div>
                      <div className="mt-4 flex min-w-0 items-center gap-3 rounded-[8px] bg-[#F8F8F8] p-2">
                        <img src={review.productImage} alt="" className="h-12 w-12 shrink-0 rounded-[7px] object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-[#1F1F1F]">{review.productTitle || "Product"}</p>
                          <p className="truncate text-xs text-[#1F1F1F]/55">{renderRating(review.rating)} - {formatDate(review.createdAt)}</p>
                        </div>
                      </div>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#1F1F1F]/68">{getReviewText(review)}</p>
                      <div className="mt-4 flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#1F1F1F]/45">Tap to view details</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteReview(review.productId, review.id);
                          }}
                          className="inline-flex h-9 items-center justify-center rounded-[8px] border border-[#1F1F1F]/10 bg-white px-3 text-xs font-bold text-[#1F1F1F]/70 transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4] hover:text-[#1F1F1F]"
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-hidden rounded-[10px] border border-[#1F1F1F]/10 xl:block">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="bg-[#F4F4F4] text-xs font-bold text-[#1F1F1F]/68">
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
                  <tbody className="divide-y divide-[#1F1F1F]/8">
                    {filteredReviews.map((review) => {
                      const isSelected = selectedReview?.reviewKey === review.reviewKey;
                      return (
                        <tr
                          key={review.reviewKey}
                          tabIndex={0}
                          className={`cursor-pointer transition hover:bg-[#F8F8F8] ${isSelected ? "bg-[#F4F4F4]" : "bg-white"}`}
                          onClick={() => setSelectedReviewKey(review.reviewKey)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedReviewKey(review.reviewKey);
                            }
                          }}
                        >
                          <td className="px-4 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F1F1F1] text-xs font-bold text-[#1F1F1F]">{getInitials(review.name || "Customer")}</span>
                              <span className="min-w-0">
                                <span className="block truncate font-bold text-[#1F1F1F]">{review.name || "Customer"}</span>
                                <span className="block truncate text-xs text-[#1F1F1F]/55">{getReviewEmail(review)}</span>
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <img src={review.productImage} alt="" className="h-12 w-12 shrink-0 rounded-[7px] object-cover" />
                              <span className="min-w-0">
                                <span className="block truncate font-bold text-[#1F1F1F]">{review.productTitle || "Product"}</span>
                                <span className="block truncate text-xs text-[#1F1F1F]/55">SKU: {review.productSku || "N/A"}</span>
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 font-bold text-[#1F1F1F]">{renderRating(review.rating)}</td>
                          <td className="px-4 py-4 text-xs leading-5 text-[#1F1F1F]/68"><span className="line-clamp-2">{getReviewText(review)}</span></td>
                          <td className="px-4 py-4 text-xs font-medium text-[#1F1F1F]/62">{formatDate(review.createdAt)}</td>
                          <td className="px-4 py-4"><ReviewStatusBadge label={getReviewStatusLabel(review)} status={getReviewStatus(review)} /></td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDeleteReview(review.productId, review.id);
                                }}
                                className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#1F1F1F]/10 bg-white text-[#1F1F1F]/70 transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4] hover:text-[#1F1F1F]"
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
  );
}

function ReviewStatusBadge({ label, status }) {
  const isApproved = status === "approved";
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-bold capitalize ${
      isApproved ? "border-[#1F1F1F]/10 bg-[#F4F4F4] text-[#1F1F1F]/78" : "border-[#1F1F1F]/12 bg-white text-[#1F1F1F]/68"
    }`}>
      {label}
    </span>
  );
}

function ReviewDetailsPanel({ review, renderRating, getReviewEmail, getReviewText, getReviewStatus, getReviewStatusLabel, onDeleteReview }) {
  return (
    <section className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_22px_80px_-70px_rgba(0,0,0,0.65)] sm:p-6">
      <h2 className="text-lg font-bold text-[#1F1F1F]">Review Details</h2>
      {!review ? (
        <div className="mt-4 overflow-hidden rounded-[10px] border border-[#1F1F1F]/10">
          <div className="grid min-h-[170px] place-items-center px-6 py-8 text-center">
            <div>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]/65">
                <Icon name="document" className="h-6 w-6" />
              </span>
              <p className="mt-5 text-sm font-bold text-[#1F1F1F]">No review selected.</p>
              <p className="mx-auto mt-2 max-w-[280px] text-sm leading-6 text-[#1F1F1F]/55">
                Select a review from the list to view full details and moderation options.
              </p>
            </div>
          </div>
          <div className="space-y-4 border-t border-[#1F1F1F]/8 px-5 py-6">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="grid grid-cols-[70px_minmax(0,1fr)] gap-5">
                <span className="h-2.5 rounded-full bg-[#E6E6E6]" />
                <span className="h-2.5 rounded-full bg-[#F1F1F1]" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 min-w-0 space-y-4">
          <div className="rounded-[10px] border border-[#1F1F1F]/10 bg-white p-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#F1F1F1] text-lg font-bold text-[#1F1F1F]">{getInitials(review.name || "Customer")}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-[#1F1F1F]">{review.name || "Customer"}</p>
                <p className="truncate text-xs text-[#1F1F1F]/55">{getReviewEmail(review)}</p>
                <p className="mt-3 text-xs font-bold text-[#1F1F1F]/55">
                  {review.verifiedPurchase !== false ? "Verified purchase" : "Not verified"}
                </p>
              </div>
              <ReviewStatusBadge label={getReviewStatusLabel(review)} status={getReviewStatus(review)} />
            </div>
          </div>

          <div className="rounded-[10px] border border-[#1F1F1F]/10 bg-[#F8F8F8] p-4">
            <div className="flex min-w-0 gap-4">
              <img src={review.productImage} alt="" className="h-16 w-16 shrink-0 rounded-[8px] object-cover sm:h-20 sm:w-20" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-[#1F1F1F]">{review.productTitle || "Product"}</p>
                <p className="mt-1 truncate text-xs text-[#1F1F1F]/55">SKU: {review.productSku || "N/A"}</p>
                <p className="mt-2 text-xs text-[#1F1F1F]/55">Product Type: {review.productType || "Product"}</p>
                <p className="mt-2 text-sm font-bold text-[#1F1F1F]">{formatProductPrice(review.productPrice)}</p>
                {review.productSlug && (
                  <a href={`/products/${review.productSlug}`} className="mt-3 inline-flex text-xs font-bold text-[#1F1F1F]/70 transition hover:text-[#1F1F1F]">
                    View Product
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[10px] border border-[#1F1F1F]/10 bg-white p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoPair label="Rating" value={renderRating(review.rating)} />
              <InfoPair label="Review Date" value={formatDate(review.createdAt)} />
              <InfoPair label="Review Source" value={review.source || "Website"} />
              <InfoPair label="Verified Purchase" value={review.verifiedPurchase !== false ? "Verified" : "Not verified"} />
            </div>
            <div className="mt-5 border-t border-[#1F1F1F]/8 pt-4">
              <p className="text-xs font-bold text-[#1F1F1F]/55">Review</p>
              <p className="mt-2 break-words text-sm leading-6 text-[#1F1F1F]/72">{getReviewText(review)}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onDeleteReview(review.productId, review.id)}
            className="inline-flex h-11 w-full items-center justify-center rounded-[8px] border border-[#1F1F1F]/10 bg-white text-sm font-bold text-[#1F1F1F]/75 transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4] hover:text-[#1F1F1F]"
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
      <p className="text-xs font-bold text-[#1F1F1F]/55">{label}</p>
      <p className="mt-1 text-sm font-bold text-[#1F1F1F]">{value || "Not set"}</p>
    </div>
  );
}

function RecentlyDeletedSection({ products, onRestore, onPermanentDelete }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-3">
        <MetricCard label="Deleted Products" value={products.length.toLocaleString()} icon="image" note="Hidden from storefront" />
        <MetricCard label="Restorable" value={products.length.toLocaleString()} icon="box" note="Restore returns as draft" />
        <MetricCard label="Permanent Delete" value="Locked" icon="settings" note="Requires permission credentials" />
      </div>

      <Panel title="Recently Deleted Products">
        <div className={FILTER_BAR_CLASS}>
          <span className="shrink-0 rounded-full bg-red-50 px-4 py-2.5 text-xs font-bold leading-5 text-red-800">
            Permanent delete is credential protected.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[840px] w-full text-left text-sm">
            <thead className="bg-[#F5F5F5] text-xs font-bold text-[#1F1F1F]/70">
              <tr>
                <th className="rounded-none px-4 py-4">Product</th>
                <th className="px-4 py-4">Category</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4">Deleted</th>
                <th className="rounded-none px-4 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F1F1F]/8">
              {products.map((product) => (
                <tr key={product.id}>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <img src={getProductImage(product)} alt="" className="h-14 w-14 rounded-none object-cover" />
                      <div>
                        <p className="font-bold">{product.title}</p>
                        <p className="mt-1 text-xs text-[#1F1F1F]/55">/{product.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">{product.category || "Uncategorized"}</td>
                  <td className="px-4 py-4"><StatusBadge status="deleted" /></td>
                  <td className="px-4 py-4">{formatDate(product.deletedAt)}</td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => onRestore(product.id)} title="Bring this product back to your catalog as a draft" className="rounded-none border border-[#1F1F1F]/15 px-4 py-2 text-xs font-bold transition hover:bg-[#E6E6E6]">Restore</button>
                      <button type="button" onClick={() => onPermanentDelete(product.id)} title="Remove forever — this cannot be undone" className="rounded-none border border-red-200 px-4 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50">Permanent delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!products.length && (
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
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
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
                <label className="flex items-start gap-3 rounded-[10px] border border-[#1F1F1F]/10 bg-[#F8F8F8] px-4 py-3">
                  <input
                    type="checkbox"
                    checked={Boolean(form.isSuite)}
                    onChange={(event) => update("isSuite", event.target.checked)}
                    className="mt-1 h-4 w-4 accent-[#1F1F1F]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-[#1F1F1F]">Suite collection</span>
                    <span className="mt-1 block text-xs leading-5 text-[#1F1F1F]/55">Use "Shop the {form.name || "collection"} suite" on product pages.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-[10px] border border-[#1F1F1F]/10 bg-[#F8F8F8] px-4 py-3">
                  <input
                    type="checkbox"
                    checked={Boolean(form.isTrendingWedding)}
                    onChange={(event) => update("isTrendingWedding", event.target.checked)}
                    className="mt-1 h-4 w-4 accent-[#1F1F1F]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-[#1F1F1F]">Trending wedding collection</span>
                    <span className="mt-1 block text-xs leading-5 text-[#1F1F1F]/55">Show this collection in the Wedding page Trending Wedding Collections row.</span>
                  </span>
                </label>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <button type="submit" className="h-12 rounded-[8px] bg-[#111111] px-6 text-sm font-bold text-white transition hover:bg-black">
                {editingId ? "Update Collection" : "Create Collection"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyCollection);
                  setFormOpen(false);
                }}
                className="h-12 rounded-[8px] border border-[#1F1F1F]/14 px-6 text-sm font-bold transition hover:bg-[#F4F4F4]"
              >
                Cancel
              </button>
            </div>
          </form>
        </Panel>
      )}

      <section className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_22px_80px_-70px_rgba(0,0,0,0.65)] sm:p-6">
        <div className="mb-5 flex flex-col gap-4 border-b border-[#1F1F1F]/8 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#1F1F1F]">Collection Manager</h2>
            <p className="mt-1 text-sm font-medium text-[#1F1F1F]/55">Organize collections with a parent and child hierarchy.</p>
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
              <article key={parent.id} className="rounded-[12px] border border-[#1F1F1F]/10 bg-white shadow-[0_16px_55px_-48px_rgba(0,0,0,0.65)]">
                <div className="grid gap-4 p-4 lg:grid-cols-[44px_minmax(0,1fr)_auto] lg:items-start">
                  <button
                    type="button"
                    onClick={() => toggleParentCollapsed(parent.id)}
                    className="grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-[#1F1F1F]/10 bg-white text-[#1F1F1F] shadow-[0_10px_25px_-20px_rgba(0,0,0,0.7)] transition hover:bg-[#F4F4F4]"
                    aria-label={collapsed ? "Expand collection" : "Collapse collection"}
                  >
                    <Icon name="chevron" className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : "rotate-0"}`} />
                  </button>

                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#1F1F1F]/42">Parent Collection</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 truncate text-xl font-bold text-[#1F1F1F]">{parent.name || "Untitled collection"}</h3>
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
                    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[#1F1F1F]/55">
                      <span className="inline-flex items-center gap-1.5"><Icon name="box" className="h-3.5 w-3.5" />{children.length} child collection{children.length === 1 ? "" : "s"}</span>
                      <span className="inline-flex items-center gap-1.5"><Icon name="box" className="h-3.5 w-3.5" />{parentProducts.length} direct product{parentProducts.length === 1 ? "" : "s"}</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
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
                  <div className="relative mx-4 mb-4 border-t border-[#1F1F1F]/8 pt-4 sm:mx-6">
                    <span className="absolute bottom-5 left-[17px] top-4 hidden w-px bg-[#1F1F1F]/12 sm:block" aria-hidden="true" />
                    <div className="space-y-3 sm:pl-12">
                      {children.map((child) => {
                        const childProducts = getCollectionProducts(child);

                        return (
                          <div key={child.id} className="relative rounded-[10px] border border-[#1F1F1F]/8 bg-[#F8F8F8] p-4">
                            <span className="absolute -left-[31px] top-1/2 hidden h-px w-8 bg-[#1F1F1F]/18 sm:block" aria-hidden="true" />
                            <span className="absolute -left-[34px] top-1/2 hidden h-2 w-2 -translate-y-1/2 rounded-full bg-[#1F1F1F]/22 sm:block" aria-hidden="true" />
                            <div className="grid gap-4 xl:grid-cols-[minmax(180px,0.75fr)_minmax(0,1fr)_auto] xl:items-center">
                              <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#1F1F1F]/42">Child Collection</p>
                                <h4 className="mt-1 truncate text-base font-bold text-[#1F1F1F]">{child.name || "Untitled child collection"}</h4>
                                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1F1F1F]/55">
                                  <Icon name="box" className="h-3.5 w-3.5" />
                                  {childProducts.length} product{childProducts.length === 1 ? "" : "s"}
                                </p>
                              </div>

                              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                                {childProducts.slice(0, 4).map((product) => (
                                  <div key={product.id || product.slug} className="flex min-w-0 items-center gap-3 rounded-[8px] bg-white px-3 py-2">
                                    <img src={getProductImage(product)} alt="" className="h-11 w-11 shrink-0 rounded-[6px] border border-[#1F1F1F]/8 object-cover" />
                                    <span className="min-w-0 truncate text-xs font-bold text-[#1F1F1F]">{product.title}</span>
                                  </div>
                                ))}
                                {!childProducts.length && (
                                  <p className="rounded-[8px] bg-white px-3 py-3 text-xs font-semibold text-[#1F1F1F]/55">No products inside this child collection yet.</p>
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
                        <p className="rounded-[10px] border border-dashed border-[#1F1F1F]/12 bg-[#F8F8F8] px-4 py-4 text-sm font-semibold text-[#1F1F1F]/55">
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
            <div className="grid min-h-[260px] place-items-center rounded-[12px] border border-dashed border-[#1F1F1F]/14 bg-white px-6 py-10 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]/72">
                  <Icon name="grid" className="h-6 w-6" />
                </span>
                <p className="mt-5 text-sm font-bold text-[#1F1F1F]">
                  {collectionRows.length ? "No collections match the current search." : "No collections yet."}
                </p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#1F1F1F]/55">
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

function CollectionMetricCard({ label, value, icon, note, comparison }) {
  return (
    <div className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_18px_65px_-56px_rgba(0,0,0,0.65)]">
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-[#1F1F1F]/68">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-[#1F1F1F]">{value}</p>
          <p className="mt-2 text-xs font-medium text-[#1F1F1F]/55">{note}</p>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2 text-xs font-bold text-[#1F1F1F]/55">
        <span className="text-lg leading-none text-[#1F1F1F]/55">-</span>
        <span className="rounded-full bg-[#F3F3F3] px-3 py-1">{comparison}</span>
        <span>vs last 7 days</span>
      </div>
    </div>
  );
}

function CollectionBadgeButton({ active, activeLabel, inactiveLabel, title, onClick, muted = false }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`inline-flex h-7 cursor-pointer items-center rounded-full px-3 text-[10px] font-extrabold uppercase tracking-[0.08em] transition ${
        active
          ? muted
            ? "bg-[#E6E6E6] text-[#1F1F1F]"
            : "bg-[#1F1F1F] text-white"
          : "border border-[#1F1F1F]/10 bg-white text-[#1F1F1F]/48 hover:border-[#1F1F1F]/20 hover:text-[#1F1F1F]"
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
      className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[8px] border bg-white px-3 text-xs font-bold transition ${
        danger
          ? "border-[#1F1F1F]/10 text-[#1F1F1F]/70 hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4] hover:text-[#1F1F1F]"
          : "border-[#1F1F1F]/10 text-[#1F1F1F] hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4]"
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
      className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-[#1F1F1F]/10 bg-white px-3 text-xs font-bold text-[#1F1F1F] transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4]"
    >
      <Icon name={icon} className="h-4 w-4" />
      <span>{label}</span>
    </a>
  );
}

function OrdersSection({ orders, query, status, setStatus, onStatusChange, onDelete }) {
  const [selectedId, setSelectedId] = useState(null);
  const [showPersonalization, setShowPersonalization] = useState(false);
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
  }, [selectedOrder?.id]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
      <Panel title="Orders">
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {statusButtons.map((item) => {
            const active = status === item.value;
            return (
              <button
                key={item.value || "all"}
                type="button"
                onClick={() => setStatus(item.value)}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-xs font-bold transition ${
                  active
                    ? "bg-[#1F1F1F] text-white"
                    : "border border-[#1F1F1F]/12 bg-white text-[#1F1F1F] hover:bg-[#E6E6E6]"
                }`}
              >
                <span>{item.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${active ? "bg-white/14" : "bg-[#E6E6E6]"}`}>
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          {visibleOrders.map((order) => {
            const active = selectedOrder?.id === order.id;
            return (
              <div
                key={order.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(order.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedId(order.id);
                  }
                }}
                className={`cursor-pointer rounded-none border p-4 transition ${
                  active ? "border-[#1F1F1F] bg-[#F2F2F2]" : "border-[#1F1F1F]/10 bg-white hover:bg-[#F6F6F6]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{formatOrderId(order.id)}</p>
                    <p className="mt-0.5 truncate text-xs text-[#1F1F1F]/55">{order.customerName || "Customer"} &middot; {order.customerEmail}</p>
                    <p className="mt-0.5 text-xs text-[#1F1F1F]/45">{formatDate(order.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{formatCurrency(order.total || 0)}</p>
                    <div className="mt-1"><StatusBadge status={order.paymentStatus || "unpaid"} /></div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                  <StatusBadge status={order.status || "pending"} />
                  <button type="button" onClick={() => setSelectedId(order.id)} className="rounded-full border border-[#1F1F1F]/12 px-3 py-2 text-xs font-bold text-[#1F1F1F] transition hover:bg-[#E6E6E6]">Open details</button>
                  <button type="button" onClick={() => onDelete(order.id)} className="rounded-none border border-red-200 px-3 py-2 text-xs font-bold text-red-700">Delete</button>
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

      <Panel title={selectedOrder ? `Order ${formatOrderId(selectedOrder.id)}` : "Order Details"}>
        {selectedOrder ? (
          <div className="space-y-5 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold">{selectedOrder.customerName || "Customer"}</p>
                <p className="mt-1 text-[#1F1F1F]/60">{selectedOrder.customerEmail}</p>
                <p className="mt-1 text-[#1F1F1F]/60">{selectedOrder.customerPhone || "No phone"}</p>
              </div>
              <StatusBadge status={selectedOrder.status || "pending"} />
            </div>

            <div className="rounded-none border border-[#1F1F1F]/10 bg-white p-4">
              <p className="font-bold">Move order to</p>
              <p className="mt-1 text-xs leading-5 text-[#1F1F1F]/55">
                The steps run in order. Click the next step when the order moves forward — the dark button shows where it is now.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {orderStatuses.map((item, index) => {
                  const active = String(selectedOrder.status || "pending").toLowerCase() === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      disabled={active}
                      onClick={() => onStatusChange(selectedOrder.id, item)}
                      title={active ? "This is the current step" : `Move this order to ${formatStatusLabel(item)}`}
                      className={`rounded-full px-3 py-2 text-xs font-bold transition ${
                        active
                          ? "cursor-default bg-[#1F1F1F] text-white"
                          : "border border-[#1F1F1F]/12 bg-[#E6E6E6] text-[#1F1F1F] hover:bg-[#1F1F1F] hover:text-white"
                      }`}
                    >
                      {item === "cancelled" ? formatStatusLabel(item) : `${index + 1}. ${formatStatusLabel(item)}`}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-none bg-[#F5F5F5] p-4">
              <p className="font-bold">Checkout form</p>
              <div className="mt-3 grid gap-2">
                {checkoutEntries.map((entry) => (
                  <p key={entry.label} className="flex gap-3">
                    <span className="w-28 shrink-0 text-[#1F1F1F]/55">{entry.label}</span>
                    <span className="min-w-0 font-semibold text-[#1F1F1F]">{entry.value}</span>
                  </p>
                ))}
                {!checkoutEntries.length && <p className="text-[#1F1F1F]/58">No checkout form details were saved.</p>}
              </div>
            </div>

            <div className="rounded-none border border-[#1F1F1F]/10 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold">Personalization</p>
                  <p className="mt-1 text-xs text-[#1F1F1F]/55">
                    {hasPersonalization ? "Customer submitted personalized details for this order." : "Customer did not submit personalization details."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!hasPersonalization}
                  onClick={() => setShowPersonalization((current) => !current)}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                    hasPersonalization
                      ? "bg-[#1F1F1F] text-white hover:bg-black"
                      : "cursor-default bg-[#E6E6E6] text-[#1F1F1F]/55"
                  }`}
                >
                  {hasPersonalization ? (showPersonalization ? "Hide personalization" : "View personalization") : "No personalization"}
                </button>
              </div>

              {showPersonalization && hasPersonalization && (
                <div className="mt-4 space-y-4">
                  {personalizationGroups.map((group) => (
                    <div key={group.title} className="rounded-none bg-[#F5F5F5] p-3">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#1F1F1F]/55">{group.title}</p>
                      <div className="mt-2 grid gap-2">
                        {group.entries.map((entry) => (
                          <p key={`${group.title}-${entry.label}`} className="grid gap-1 sm:grid-cols-[130px_minmax(0,1fr)]">
                            <span className="text-[#1F1F1F]/55">{entry.label}</span>
                            <span className="font-semibold text-[#1F1F1F]">{entry.value}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-none bg-[#F5F5F5] p-4">
              <p className="font-bold">Order Items</p>
              <div className="mt-3 space-y-3">
                {(selectedOrder.items || []).map((item) => (
                  <div key={item.id || item.productId} className="rounded-none bg-white/70 p-3">
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold">{item.productTitle || item.title}</span>
                      <span className="font-bold">{formatCurrency(item.finalPrice || item.price || 0)}</span>
                    </div>
                    {!!Object.keys(item.selectedOptions || {}).length && (
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-[#1F1F1F]/65">
                        {Object.entries(item.selectedOptions || {}).map(([key, value]) => (
                          <span key={key} className="rounded-full bg-[#E6E6E6] px-2 py-1">
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
                              <img src={item.previewImages[key]} alt={`${key} design preview`} className="w-full border border-[#1F1F1F]/10 bg-white" />
                              <p className="mt-1 text-center text-[10px] font-bold uppercase tracking-wide text-[#1F1F1F]/50">{key}</p>
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
                            <a key={key} href={url} target="_blank" rel="noreferrer" className="rounded-full bg-[#E6E6E6] px-2 py-1 font-semibold text-blue-700 underline">
                              {formatDetailLabel(key)} file
                            </a>
                          ) : null;
                        })}
                      </div>
                    )}

                    {(item.customizationId || item.templateVersion) && (
                      <p className="mt-2 text-[10px] font-semibold text-[#1F1F1F]/45">
                        {item.customizationId ? `Customization ${String(item.customizationId).slice(0, 8)}` : ""}
                        {item.templateVersion ? `${item.customizationId ? " · " : ""}Template v${item.templateVersion}` : ""}
                      </p>
                    )}
                  </div>
                ))}
                {!selectedOrder.items?.length && <p>{selectedOrder.productTitle || "Custom order"}</p>}
              </div>
            </div>
            <div className="grid gap-2 border-t border-[#1F1F1F]/10 pt-4">
              <p className="flex justify-between"><span>Subtotal</span><strong>{formatCurrency(selectedOrder.subtotal || selectedOrder.total || 0)}</strong></p>
              <p className="flex justify-between"><span>Delivery</span><strong>{formatCurrency(selectedOrder.deliveryCharge || 0)}</strong></p>
              <p className="flex justify-between text-base"><span>Total</span><strong>{formatCurrency(selectedOrder.total || 0)}</strong></p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#1F1F1F]/60">Select an order to review details.</p>
        )}
      </Panel>
    </div>
  );
}

function MessagesSection({ messages, allMessages = messages, query, setQuery, status, setStatus, onStatusChange, onDelete }) {
  const [selectedId, setSelectedId] = useState(null);
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
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
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
        <section className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_22px_80px_-70px_rgba(0,0,0,0.65)] sm:p-6">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-[#1F1F1F]">All Messages</h2>
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
              <Icon name="search" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1F1F1F]/45" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search messages..."
                className="h-10 w-full rounded-[8px] border border-[#1F1F1F]/10 bg-white pl-3 pr-10 text-sm font-medium text-[#1F1F1F] outline-none transition placeholder:text-[#1F1F1F]/38 hover:border-[#1F1F1F]/20 focus:border-[#1F1F1F]/35 focus:ring-2 focus:ring-[#1F1F1F]/8"
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
                  onClick={() => setSelectedId(message.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(message.id);
                    }
                  }}
                  className={`cursor-pointer rounded-[10px] border p-4 transition ${
                    active ? "border-[#1F1F1F]/22 bg-[#F4F4F4]" : "border-[#1F1F1F]/10 bg-white hover:border-[#1F1F1F]/20 hover:bg-[#F8F8F8]"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F1F1F1] text-xs font-bold text-[#1F1F1F]">
                      {getInitials(message.name || "Customer")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-bold text-[#1F1F1F]">{message.name || "Customer"}</p>
                          <p className="truncate text-xs text-[#1F1F1F]/55">{messageEmail(message)}</p>
                        </div>
                        <span className="shrink-0 text-xs font-medium text-[#1F1F1F]/45">{formatDate(message.createdAt)}</span>
                      </div>
                      <p className="mt-3 truncate text-sm font-bold text-[#1F1F1F]">{message.subject || "Contact message"}</p>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#1F1F1F]/62">{message.message || "No message provided."}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 pl-0 sm:pl-[52px]" onClick={(event) => event.stopPropagation()}>
                    <MessageStatusBadge status={normalizedStatus} label={statusLabel(normalizedStatus)} />
                    <StyledNativeSelect
                      size="sm"
                      value={normalizedStatus}
                      onChange={(next) => onStatusChange(message.id, next)}
                      ariaLabel="Update message status"
                      options={messageStatuses.map((item) => ({ value: item, label: statusLabel(item) }))}
                      className="w-36"
                    />
                    <button
                      type="button"
                      onClick={() => onDelete(message.id)}
                      className="inline-flex h-9 items-center justify-center rounded-[8px] border border-[#1F1F1F]/10 bg-white px-3 text-xs font-bold text-[#1F1F1F]/70 transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4] hover:text-[#1F1F1F]"
                    >
                      Delete
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

        <MessageDetailsPanel
          message={selectedMessage}
          normalizeStatus={normalizeMessageStatus}
          statusLabel={statusLabel}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

function MessageMetricCard({ label, value, icon, note, change }) {
  return (
    <div className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_18px_65px_-56px_rgba(0,0,0,0.65)]">
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-[#1F1F1F]/68">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-[#1F1F1F]">{value}</p>
          <p className="mt-2 text-xs font-medium text-[#1F1F1F]/55">{note}</p>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2 text-xs font-bold text-[#1F1F1F]/55">
        <span className="rounded-full bg-[#F3F3F3] px-3 py-1">{change}</span>
        <span>vs last 7 days</span>
      </div>
    </div>
  );
}

function MessageStatusBadge({ label, status }) {
  const emphasized = status === "new" || status === "archived";
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-bold capitalize ${
      emphasized ? "border-[#1F1F1F]/12 bg-[#F4F4F4] text-[#1F1F1F]/78" : "border-[#1F1F1F]/10 bg-white text-[#1F1F1F]/68"
    }`}>
      {label}
    </span>
  );
}

function MessageEmptyState({ title, hint, onReset = null }) {
  return (
    <div className="grid min-h-[260px] place-items-center rounded-[10px] border border-[#1F1F1F]/10 bg-white px-6 py-10 text-center">
      <div>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]/72">
          <Icon name="mail" className="h-6 w-6" />
        </span>
        <p className="mt-5 text-sm font-bold text-[#1F1F1F]">{title}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#1F1F1F]/55">{hint}</p>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-[8px] border border-[#1F1F1F]/10 bg-white px-4 text-xs font-bold text-[#1F1F1F] transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4]"
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
    <section className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_22px_80px_-70px_rgba(0,0,0,0.65)] sm:p-6">
      <h2 className="text-lg font-bold text-[#1F1F1F]">Message Details</h2>
      {!message ? (
        <div className="mt-4 overflow-hidden rounded-[10px] border border-[#1F1F1F]/10">
          <div className="grid min-h-[190px] place-items-center px-6 py-8 text-center">
            <div>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]/65">
                <Icon name="mail" className="h-6 w-6" />
              </span>
              <p className="mt-5 text-sm font-bold text-[#1F1F1F]">No message selected.</p>
              <p className="mx-auto mt-2 max-w-[280px] text-sm leading-6 text-[#1F1F1F]/55">
                Select a message from the list to view full details and reply options.
              </p>
            </div>
          </div>
          <div className="space-y-4 border-t border-[#1F1F1F]/8 px-5 py-6">
            <span className="block h-2.5 w-24 rounded-full bg-[#E6E6E6]" />
            <span className="block h-2.5 w-40 rounded-full bg-[#F1F1F1]" />
            <span className="block h-2.5 w-full rounded-full bg-[#F1F1F1]" />
            <span className="block h-2.5 w-3/4 rounded-full bg-[#F1F1F1]" />
            <span className="block h-12 w-full rounded-[8px] border border-[#1F1F1F]/8 bg-white" />
          </div>
        </div>
      ) : (
        <div className="mt-4 min-w-0 space-y-4">
          <div className="rounded-[10px] border border-[#1F1F1F]/10 bg-white p-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#F1F1F1] text-lg font-bold text-[#1F1F1F]">
                {getInitials(message.name || "Customer")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-[#1F1F1F]">{message.name || "Customer"}</p>
                <p className="truncate text-xs text-[#1F1F1F]/55">{message.email || "No email"}</p>
                {message.phone && <p className="mt-1 truncate text-xs text-[#1F1F1F]/55">{message.phone}</p>}
              </div>
              <MessageStatusBadge label={statusLabel(normalizedStatus)} status={normalizedStatus} />
            </div>
          </div>

          <div className="rounded-[10px] border border-[#1F1F1F]/10 bg-[#F8F8F8] p-4">
            <p className="text-xs font-bold text-[#1F1F1F]/55">Subject</p>
            <p className="mt-1 text-base font-bold text-[#1F1F1F]">{message.subject || "Contact message"}</p>
            <p className="mt-4 text-xs font-bold text-[#1F1F1F]/55">Message</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#1F1F1F]/72">{message.message || "No message provided."}</p>
          </div>

          <div className="rounded-[10px] border border-[#1F1F1F]/10 bg-white p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoPair label="Date Received" value={formatDate(message.createdAt)} />
              <InfoPair label="Current Status" value={statusLabel(normalizedStatus)} />
            </div>
            <div className="mt-4" onClick={(event) => event.stopPropagation()}>
              <p className="mb-2 text-xs font-bold text-[#1F1F1F]/55">Update Status</p>
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
                className="inline-flex h-11 flex-1 items-center justify-center rounded-[8px] bg-[#1F1F1F] px-4 text-sm font-bold text-white transition hover:bg-black sm:flex-none"
              >
                Reply by Email
              </a>
            )}
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-[8px] border border-[#1F1F1F]/10 bg-white px-4 text-sm font-bold text-[#1F1F1F]/75 transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4] hover:text-[#1F1F1F] sm:flex-none"
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
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <NewsletterMetricCard label="Total Subscribers" value={allSubscribers.length.toLocaleString()} icon="user" note="All newsletter signups" />
        <NewsletterMetricCard label="Active Subscribers" value={activeSubscribers.length.toLocaleString()} icon="mail" note="Receiving updates" />
        <NewsletterMetricCard label="Emails Sent" value={emailsSent.toLocaleString()} icon="send" note={emailsSent ? "Campaign delivery count" : "Campaigns not configured"} />
        <NewsletterMetricCard label="Avg. Open Rate" value={avgOpenRate} icon="chart" note={avgOpenRate === "-" ? "Connect campaigns later" : "Campaign average"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_22px_80px_-70px_rgba(0,0,0,0.65)] sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-4 border-b border-[#1F1F1F]/8 pb-5">
            <h2 className="text-lg font-bold text-[#1F1F1F]">Subscribers</h2>
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
              <span className="text-xs font-bold text-[#1F1F1F]/65">
                {visibleSubscribers.length} subscriber{visibleSubscribers.length === 1 ? "" : "s"}
              </span>
            </div>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!visibleSubscribers.length}
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-[#1F1F1F]/10 bg-white px-4 text-xs font-bold text-[#1F1F1F] transition hover:border-[#1F1F1F]/24 hover:bg-[#F4F4F4] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="download" className="h-4 w-4" />
              Export CSV
            </button>
          </div>

          {visibleSubscribers.length ? (
            <>
              <div className="hidden overflow-hidden rounded-[10px] border border-[#1F1F1F]/10 lg:block">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="bg-[#F4F4F4] text-xs font-bold text-[#1F1F1F]/68">
                    <tr>
                      <th className="w-[6%] px-4 py-4"><span className="block h-4 w-4 rounded border border-[#1F1F1F]/20" /></th>
                      <th className="w-[32%] px-4 py-4">Subscriber</th>
                      <th className="w-[16%] px-4 py-4">Status</th>
                      <th className="w-[22%] px-4 py-4">Subscribed On</th>
                      <th className="w-[16%] px-4 py-4">Source</th>
                      <th className="w-[8%] px-4 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F1F1F]/8">
                    {pagedSubscribers.map((subscriber) => (
                      <tr key={subscriber.id} className="bg-white transition hover:bg-[#F8F8F8]">
                        <td className="px-4 py-4"><span className="block h-4 w-4 rounded border border-[#1F1F1F]/18" /></td>
                        <td className="px-4 py-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F1F1F1] text-xs font-bold uppercase text-[#1F1F1F]">{getInitials(subscriber.email || "S")}</span>
                            <span className="min-w-0 truncate font-bold text-[#1F1F1F]">{subscriber.email}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4"><SubscriberStatusBadge status={getSubscriberStatus(subscriber)} /></td>
                        <td className="px-4 py-4 text-sm font-semibold text-[#1F1F1F]">{formatSubscriberDate(subscriber.createdAt)}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-[#1F1F1F]/62">{subscriber.source || "website"}</td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-2">
                            <a href={`mailto:${subscriber.email}`} className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#1F1F1F]/10 bg-white text-[#1F1F1F]/72 transition hover:bg-[#F4F4F4]" aria-label="Email subscriber"><Icon name="mail" className="h-4 w-4" /></a>
                            <button type="button" onClick={() => onDelete(subscriber.id)} className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#1F1F1F]/10 bg-white text-[#1F1F1F]/72 transition hover:bg-[#F4F4F4]" aria-label="Delete subscriber"><Icon name="trash" className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 lg:hidden">
                {pagedSubscribers.map((subscriber) => (
                  <article key={subscriber.id} className="rounded-[10px] border border-[#1F1F1F]/10 bg-white p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F1F1F1] text-xs font-bold uppercase text-[#1F1F1F]">{getInitials(subscriber.email || "S")}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-[#1F1F1F]">{subscriber.email}</p>
                        <p className="mt-1 text-xs font-semibold text-[#1F1F1F]/55">{subscriber.source || "website"} - {formatSubscriberDate(subscriber.createdAt)}</p>
                      </div>
                      <SubscriberStatusBadge status={getSubscriberStatus(subscriber)} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <a href={`mailto:${subscriber.email}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[#1F1F1F]/10 bg-white px-3 text-xs font-bold text-[#1F1F1F] transition hover:bg-[#F4F4F4]"><Icon name="mail" className="h-4 w-4" />Email</a>
                      <button type="button" onClick={() => onDelete(subscriber.id)} className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[#1F1F1F]/10 bg-white px-3 text-xs font-bold text-[#1F1F1F]/75 transition hover:bg-[#F4F4F4]"><Icon name="trash" className="h-4 w-4" />Delete</button>
                    </div>
                  </article>
                ))}
              </div>

              {visibleSubscribers.length > pageSize && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} className="grid h-10 w-10 place-items-center rounded-[8px] border border-[#1F1F1F]/10 bg-white text-[#1F1F1F] disabled:opacity-40"><Icon name="chevron" className="h-4 w-4 rotate-90" /></button>
                  <span className="grid h-10 min-w-10 place-items-center rounded-[8px] bg-[#1F1F1F] px-3 text-xs font-bold text-white">{currentPage}</span>
                  <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} className="grid h-10 w-10 place-items-center rounded-[8px] border border-[#1F1F1F]/10 bg-white text-[#1F1F1F] disabled:opacity-40"><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>
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

      <section className="flex flex-col gap-4 rounded-[12px] border border-[#1F1F1F]/10 bg-white p-4 shadow-[0_18px_65px_-56px_rgba(0,0,0,0.65)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]">
            <Icon name="check" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-[#1F1F1F]">Your subscribers are protected.</p>
            <p className="mt-1 text-xs font-medium text-[#1F1F1F]/55">We store subscriber data securely and never share it with third parties.</p>
          </div>
        </div>
        <a href="/privacy" className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-[#1F1F1F]/10 bg-white px-4 text-xs font-bold text-[#1F1F1F] transition hover:bg-[#F4F4F4]">
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
  return (
    <div className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_18px_65px_-56px_rgba(0,0,0,0.65)]">
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-[#1F1F1F]/68">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-[#1F1F1F]">{value}</p>
          <p className="mt-2 text-xs font-medium text-[#1F1F1F]/55">{note}</p>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2 text-xs font-bold text-[#1F1F1F]/55">
        <span className="rounded-full bg-[#F3F3F3] px-3 py-1">0%</span>
        <span>vs last 7 days</span>
      </div>
    </div>
  );
}

function SubscriberStatusBadge({ status }) {
  const label = String(status || "active").replaceAll("-", " ");
  return (
    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-[#1F1F1F]/10 bg-[#F4F4F4] px-3 py-1 text-xs font-bold capitalize text-[#1F1F1F]/78">
      <span className="h-1.5 w-1.5 rounded-full bg-[#1F1F1F]/45" />
      {label}
    </span>
  );
}

function SubscriberEmptyState({ title, hint }) {
  return (
    <div className="grid min-h-[260px] place-items-center rounded-[10px] border border-[#1F1F1F]/10 bg-white px-6 py-10 text-center">
      <div>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F3F3F3] text-[#1F1F1F]/72">
          <Icon name="mail" className="h-6 w-6" />
        </span>
        <p className="mt-5 text-sm font-bold text-[#1F1F1F]">{title}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#1F1F1F]/55">{hint}</p>
      </div>
    </div>
  );
}

function CreateNewsletterCard({ onOpen }) {
  return (
    <section className="rounded-[12px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_22px_80px_-70px_rgba(0,0,0,0.65)] sm:p-6">
      <h2 className="text-lg font-bold text-[#1F1F1F]">Create Newsletter</h2>
      <div className="mt-5 grid min-h-[320px] place-items-center rounded-[10px] border-t border-[#1F1F1F]/8 pt-6 text-center">
        <div>
          <div className="mx-auto grid h-24 w-24 place-items-center rounded-[18px] border border-[#1F1F1F]/10 bg-[#F3F3F3] text-[#1F1F1F]">
            <Icon name="mail" className="h-10 w-10" />
          </div>
          <p className="mx-auto mt-6 max-w-[220px] text-xl font-bold leading-tight text-[#1F1F1F]">Design and send beautiful emails</p>
          <p className="mx-auto mt-4 max-w-[250px] text-sm leading-6 text-[#1F1F1F]/62">Create engaging newsletter campaigns and send updates to your subscribers.</p>
          <button type="button" onClick={onOpen} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[#111111] px-5 text-sm font-bold text-white transition hover:bg-black">
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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[14px] border border-[#1F1F1F]/10 bg-white p-5 shadow-[0_30px_90px_-45px_rgba(0,0,0,0.85)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#1F1F1F]">Create newsletter draft</h2>
            <p className="mt-1 text-sm text-[#1F1F1F]/58">Drafts are saved only. No emails are sent from this modal.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-[8px] text-[#1F1F1F]/60 transition hover:bg-[#F4F4F4]" aria-label="Close newsletter modal">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="mt-6 grid gap-4">
          <AdminInput label="Campaign Title" value={draft.title} onChange={(value) => update("title", value)} required />
          <AdminInput label="Subject Line" value={draft.subject} onChange={(value) => update("subject", value)} required />
          <AdminInput label="Preview Text" value={draft.previewText} onChange={(value) => update("previewText", value)} />
          <AdminTextarea label="Email Body" value={draft.body} onChange={(value) => update("body", value)} required />
          <label className="block text-sm font-bold">
            <span>Audience</span>
            <select
              value={draft.audience}
              onChange={(event) => update("audience", event.target.value)}
              className="mt-2 h-12 w-full rounded-none border border-[#1F1F1F]/12 bg-white px-4 text-sm font-semibold text-[#1F1F1F] outline-none transition hover:border-[#1F1F1F]/20 hover:bg-[#F8F8F8] focus:border-[#1F1F1F]/40 focus:bg-white focus:ring-2 focus:ring-[#1F1F1F]/10"
            >
              <option value="all_active">All active subscribers ({activeSubscriberCount})</option>
            </select>
          </label>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="h-11 rounded-[8px] border border-[#1F1F1F]/12 px-5 text-sm font-bold text-[#1F1F1F] transition hover:bg-[#F4F4F4]">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="h-11 rounded-[8px] bg-[#111111] px-5 text-sm font-bold text-white transition hover:bg-black disabled:opacity-60">
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
    { id: "email", title: "Email Settings", subtitle: "Sender identity and email provider" },
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
        <p className="text-sm text-[#1F1F1F]/65">Loading settings...</p>
      </Panel>
    );
  }

  if (!draft) {
    return (
      <Panel title="Settings">
        <p className="text-sm font-bold text-red-700">{status.error || "Settings could not be loaded."}</p>
      </Panel>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <Panel>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          {settingGroups.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveGroup(item.id)}
              className={`rounded-none px-4 py-3 text-left transition ${activeGroup === item.id ? "bg-[#F1F1F1]" : "hover:bg-[#E6E6E6]"}`}
            >
              <span className="block text-sm font-bold">{item.title}</span>
              <span className="mt-1 block text-xs text-[#1F1F1F]/60">{item.subtitle}</span>
            </button>
          ))}
        </div>
      </Panel>

      <div className="min-w-0 space-y-5">
        {status.error && <p className="rounded-none border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">{status.error}</p>}
        {status.notice && <p className="rounded-none border border-green-200 bg-green-50 px-5 py-4 text-sm font-bold text-green-800">{status.notice}</p>}

        {activeGroup === "general" && (
          <>
            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
              <Panel title="Store Information">
                <div className="grid gap-4 md:grid-cols-2">
                  <AdminInput label="Store Name" value={draft.store.name} onChange={(value) => setDraftValue("store", "name", value)} required />
                  <AdminInput label="Store Tagline" value={draft.store.tagline} onChange={(value) => setDraftValue("store", "tagline", value)} required />
                  <AdminInput label="Store Email" type="email" value={draft.store.email} onChange={(value) => setDraftValue("store", "email", value)} required />
                  <AdminInput label="Phone Number" value={draft.store.phone} onChange={(value) => setDraftValue("store", "phone", value)} required />
                  <AdminTextarea label="Store Address" value={draft.store.address} onChange={(value) => setDraftValue("store", "address", value)} required />
                </div>
                <SaveButton saving={status.saving} onClick={() => saveSettings({ store: draft.store }, "Store information saved.")}>
                  Update Store Information
                </SaveButton>
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
                  <div className="rounded-none border border-[#1F1F1F]/10 bg-[#F6F6F6] px-4 py-3 text-sm">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#1F1F1F]/55">Role</p>
                    <p className="mt-1 font-bold text-[#1F1F1F]">{draft.adminProfile.role}</p>
                    <p className="mt-1 text-xs text-[#1F1F1F]/55">Only a super admin can change roles.</p>
                  </div>
                </div>
                <SaveButton saving={status.saving} onClick={() => saveSettings({ adminProfile: draft.adminProfile }, "Admin profile saved.")}>
                  Update Profile
                </SaveButton>
              </Panel>

              <Panel title="Other Preferences">
                <div className="space-y-3">
                  <ToggleRow label="Allow Product Reviews" checked={draft.preferences.allowProductReviews} onChange={(value) => setDraftValue("preferences", "allowProductReviews", value)} />
                  <ToggleRow label="Enable Newsletter Subscription" checked={draft.preferences.newsletterEnabled} onChange={(value) => setDraftValue("preferences", "newsletterEnabled", value)} />
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
            <div className="grid gap-4 lg:grid-cols-2">
              <ToggleRow label="Cash on Delivery" checked={draft.payment.cashOnDeliveryEnabled} onChange={(value) => setDraftValue("payment", "cashOnDeliveryEnabled", value)} />
              <ToggleRow label="SSLCommerz" checked={draft.payment.sslCommerzEnabled} onChange={(value) => setDraftValue("payment", "sslCommerzEnabled", value)} />
              <AdminSelect label="Gateway Mode" value={draft.payment.sslCommerzMode} onChange={(value) => setDraftValue("payment", "sslCommerzMode", value)} options={["test", "live"]} />
              <AdminInput label="SSLCommerz Store ID" value={draft.payment.sslCommerzStoreId} onChange={(value) => setDraftValue("payment", "sslCommerzStoreId", value)} />
              <AdminInput label="Store Password" type="password" value={draft.payment.sslCommerzStorePassword || ""} onChange={(value) => setDraftValue("payment", "sslCommerzStorePassword", value)} />
              <AdminInput label="API Key" type="password" value={draft.payment.sslCommerzApiKey || ""} onChange={(value) => setDraftValue("payment", "sslCommerzApiKey", value)} />
            </div>
            <p className="mt-4 rounded-none bg-[#F6F6F6] px-4 py-3 text-xs font-semibold text-[#1F1F1F]/65">
              Saved keys are masked in the dashboard and are only handled by protected admin APIs.
            </p>
            <SaveButton saving={status.saving} onClick={savePayment}>Save Payment Settings</SaveButton>
          </Panel>
        )}

        {activeGroup === "shipping" && (
          <Panel title="Shipping Settings">
            <ToggleRow
              label="Digital products do not require shipping"
              checked={draft.shipping.digitalProductsNoShipping}
              onChange={(value) => setDraftValue("shipping", "digitalProductsNoShipping", value)}
            />
            <div className="mt-5 space-y-3">
              {draft.shipping.methods.map((method, index) => (
                <ShippingMethodEditor
                  key={method.id || index}
                  method={method}
                  onChange={(nextMethod) => {
                    const methods = [...draft.shipping.methods];
                    methods[index] = nextMethod;
                    setShippingMethods(methods);
                  }}
                  onDelete={() => setShippingMethods(draft.shipping.methods.filter((_, itemIndex) => itemIndex !== index))}
                />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setShippingMethods([...draft.shipping.methods, { id: `method-${Date.now()}`, name: "New Shipping Method", area: "", fee: 0, eta: "", enabled: true }])}
                className="inline-flex h-11 min-w-[180px] items-center justify-center rounded-full border border-[#1F1F1F]/15 px-5 text-sm font-bold text-[#1F1F1F] transition hover:bg-[#E6E6E6]"
              >
                Add Shipping Method
              </button>
              <SaveButton saving={status.saving} spaced={false} className="h-11 min-w-[180px]" onClick={() => saveSettings({ shipping: draft.shipping }, "Shipping settings saved.")}>
                Save Shipping Settings
              </SaveButton>
            </div>
          </Panel>
        )}

        {activeGroup === "email" && (
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
              <button type="button" onClick={sendTestEmail} disabled={status.saving} className="self-end rounded-full border border-[#1F1F1F]/15 px-5 py-3 text-sm font-bold text-[#1F1F1F] transition hover:bg-[#E6E6E6] disabled:opacity-60">
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
                ["newsletterSubscribers", "Newsletter subscribers"],
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
              <BackupButton label="Export Full Backup" onClick={() => exportEndpoint("full-store-backup", "/api/admin/products", (data) => ({ settings: settings || draft, products: data.products || [] }))} />
            </div>
            <p className="mt-4 text-xs font-semibold text-[#1F1F1F]/55">
              Backup actions require the active admin session and download JSON files directly to this device.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function SaveButton({ children, saving, onClick, spaced = true, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className={`${spaced ? "mt-5" : ""} inline-flex items-center justify-center rounded-full bg-[#111111] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#000000] disabled:opacity-60 ${className}`}
    >
      {saving ? "Saving..." : children}
    </button>
  );
}

function ToggleRow({ label, checked, onChange, disabled = false, note }: any) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-none border border-[#1F1F1F]/10 bg-[#F8F8F8] px-4 py-3 text-sm">
      <span className="min-w-0">
        <span className="block font-bold text-[#1F1F1F]">{label}</span>
        {note && <span className="mt-1 block text-xs text-[#1F1F1F]/55">{note}</span>}
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`h-7 w-12 shrink-0 rounded-none p-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-[#1F1F1F]" : "bg-[#1F1F1F]/14"}`}
      >
        <span className={`block h-5 w-5 rounded-none bg-white transition ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

function UploadPreview({ label, value, folder, onUpload, onRemove, onFile, compact = false, round = false }) {
  return (
    <div className="rounded-none border border-[#1F1F1F]/10 bg-[#F8F8F8] p-4">
      <p className="text-sm font-bold text-[#1F1F1F]">{label}</p>
      <div className={`mt-3 grid place-items-center overflow-hidden border border-dashed border-[#1F1F1F]/20 bg-white ${round ? "h-24 w-24 rounded-full" : compact ? "h-24 rounded-none" : "h-32 rounded-none"}`}>
        {value ? (
          <img src={value} alt={label} className="h-full w-full object-contain p-3" />
        ) : (
          <span className="px-4 text-center text-xs font-semibold text-[#1F1F1F]/45">No {label.toLowerCase()} selected</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="cursor-pointer rounded-none border border-[#1F1F1F]/15 px-4 py-2 text-xs font-bold text-[#1F1F1F] transition hover:bg-[#E6E6E6]">
          Upload
          <input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => onFile(event.target.files?.[0], folder, onUpload)} />
        </label>
        <button type="button" onClick={onRemove} className="rounded-full border border-red-200 px-4 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50">
          Remove
        </button>
      </div>
    </div>
  );
}

function ShippingMethodEditor({ method, onChange, onDelete }) {
  return (
    <div className="rounded-none border border-[#1F1F1F]/10 bg-[#F8F8F8] p-4">
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_minmax(100px,0.7fr)_minmax(120px,0.85fr)_minmax(180px,0.75fr)]">
        <AdminInput label="Method Name" value={method.name} onChange={(value) => onChange({ ...method, name: value })} />
        <AdminInput label="Delivery Area" value={method.area} onChange={(value) => onChange({ ...method, area: value })} />
        <AdminInput label="Shipping Fee" type="number" value={method.fee} onChange={(value) => onChange({ ...method, fee: value })} />
        <AdminInput label="Estimated Time" value={method.eta} onChange={(value) => onChange({ ...method, eta: value })} />
        <div className="flex min-w-0 items-end gap-2 md:col-span-2 2xl:col-span-1">
          <button
            type="button"
            onClick={() => onChange({ ...method, enabled: !method.enabled })}
            className={`h-11 min-w-0 flex-1 rounded-full px-3 text-xs font-bold ${method.enabled ? "bg-[#1F1F1F] text-white" : "bg-white text-[#1F1F1F]"}`}
          >
            {method.enabled ? "Enabled" : "Disabled"}
          </button>
          <button type="button" onClick={onDelete} className="h-11 shrink-0 rounded-full border border-red-200 px-3 text-xs font-bold text-red-700 transition hover:bg-red-50">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoBox({ label, value }) {
  return (
    <div className="rounded-none border border-[#1F1F1F]/10 bg-[#F8F8F8] px-4 py-3 text-sm">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#1F1F1F]/55">{label}</p>
      <p className="mt-1 break-words font-bold text-[#1F1F1F]">{value || "Not set"}</p>
    </div>
  );
}

function BackupButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-none border border-[#1F1F1F]/10 bg-[#F8F8F8] px-4 py-5 text-left text-sm font-bold text-[#1F1F1F] transition hover:border-[#1F1F1F]/25 hover:bg-[#E6E6E6]"
    >
      {label}
    </button>
  );
}

function AdminInput({ label, value, onChange, onBlur, type = "text", required = false, placeholder = "", helper = "" }: any) {
  return (
    <label className="block text-sm font-bold">
      <span>{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        required={required}
        placeholder={placeholder}
        step={type === "number" ? "0.01" : undefined}
        className="mt-2 h-12 w-full rounded-none border border-[#1F1F1F]/12 bg-white px-4 text-sm font-semibold text-[#1F1F1F] outline-none transition placeholder:text-[#1F1F1F]/35 hover:border-[#1F1F1F]/20 hover:bg-[#F8F8F8] focus:border-[#1F1F1F]/40 focus:bg-white focus:ring-2 focus:ring-[#1F1F1F]/10"
      />
      {helper && <span className="mt-1.5 block text-xs font-normal leading-5 text-[#1F1F1F]/55">{helper}</span>}
    </label>
  );
}

function AdminTextarea({ label, value, onChange, helper, required = false, placeholder = "" }: any) {
  return (
    <label className="block text-sm font-bold">
      <span>{label}</span>
      <textarea
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        className="mt-2 min-h-32 w-full rounded-none border border-[#1F1F1F]/12 bg-white p-4 text-sm font-medium leading-6 text-[#1F1F1F] outline-none transition placeholder:text-[#1F1F1F]/35 hover:border-[#1F1F1F]/20 hover:bg-[#F8F8F8] focus:border-[#1F1F1F]/40 focus:bg-white focus:ring-2 focus:ring-[#1F1F1F]/10"
      />
      {helper && <span className="mt-1 block text-xs font-normal text-[#1F1F1F]/55">{helper}</span>}
    </label>
  );
}

function AdminSelect({ label, value, onChange, options }) {
  return (
    <div className="block text-sm font-bold">
      <span>{label}</span>
      <div className="mt-2">
        <SelectMenu value={value} onChange={onChange} options={options} variant="field" ariaLabel={label} />
      </div>
    </div>
  );
}
