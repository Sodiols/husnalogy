/**
 * Order notification emails, built ONLY from the stored order (trusted server
 * data). No production data, snapshots, file paths, internal ids beyond the
 * order number, or request data is ever included.
 */

import { formatCurrency } from "@/lib/currency";
import { BUSINESS_INFO, ORDER_POLICY } from "@/lib/launch-config";
import type { OrderView } from "@/lib/orders/order-view";

export type EmailMessage = { to: string; subject: string; html: string; text: string };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Every customer-derived string is escaped before it enters HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function lines(order: OrderView) {
  return order.items.map((item) => ({
    title: item.productTitle,
    quantity: item.quantity,
    unit: formatCurrency(item.price, item.currency),
    total: formatCurrency(item.finalPrice, item.currency),
    options: Object.entries(item.selectedOptions || {})
      .filter(([key, value]) => key !== "logo" && typeof value === "string" && value)
      .map(([, value]) => String(value)),
  }));
}

function addressLines(order: OrderView): string[] {
  if (order.deliveryMethod === "store") return ["Store pickup — we will tell you when your order is ready to collect."];
  const address = order.address || {};
  return [address.addressLine1, address.area, address.city, address.postalCode, address.country].map((part) => String(part || "").trim()).filter(Boolean);
}

function statusLabel(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function render(order: OrderView, heading: string, intro: string, audience: "customer" | "admin"): { html: string; text: string } {
  const items = lines(order);
  const money = (value: number) => formatCurrency(value, order.currency);
  const placedAt = new Date(order.createdAt || Date.now()).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" });
  const delivery = order.deliveryMethod === "store" ? "Store pickup" : "Home delivery";
  const deliveryCharge = order.deliveryMethod === "store" ? "No charge" : order.deliveryChargeConfirmed ? money(order.deliveryCharge) : "Confirmed after review";
  const address = addressLines(order);

  const text = [
    heading,
    "",
    intro,
    "",
    `Order number: ${order.id}`,
    `Placed: ${placedAt}`,
    `Name: ${order.customerName}`,
    ...(audience === "admin" ? [`Email: ${order.customerEmail}`, `Phone: ${order.customerPhone}`] : []),
    "",
    ...items.map((item) => `${item.quantity} x ${item.title}${item.options.length ? ` (${item.options.join(", ")})` : ""} — ${item.total}`),
    "",
    `Subtotal: ${money(order.subtotal)}`,
    `Delivery: ${deliveryCharge}`,
    `Total: ${money(order.total)}`,
    "",
    `Delivery method: ${delivery}`,
    ...(address.length ? [`Address: ${address.join(", ")}`] : []),
    `Payment: ${order.paymentMethod} (${statusLabel(order.paymentStatus)})`,
    `Order status: ${statusLabel(order.status)}`,
    "",
    `${BUSINESS_INFO.name} · ${BUSINESS_INFO.email} · ${BUSINESS_INFO.phone}`,
  ].join("\n");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${escapeHtml(label)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8f6f1;font-family:Arial,Helvetica,sans-serif;color:#303839">
<div style="max-width:600px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 8px">${escapeHtml(heading)}</h1>
<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(intro)}</p>
<table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
${row("Order number", order.id)}${row("Placed", placedAt)}${row("Name", order.customerName)}${audience === "admin" ? row("Email", order.customerEmail) + row("Phone", order.customerPhone) : ""}
</table>
<table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:16px">
<tr><th align="left" style="border-bottom:1px solid #ddd;padding:6px 0">Item</th><th align="right" style="border-bottom:1px solid #ddd;padding:6px 0">Qty</th><th align="right" style="border-bottom:1px solid #ddd;padding:6px 0">Total</th></tr>
${items
  .map(
    (item) =>
      `<tr><td style="padding:6px 0">${escapeHtml(item.title)}${item.options.length ? `<br><span style="color:#6b7280;font-size:12px">${escapeHtml(item.options.join(" · "))}</span>` : ""}</td><td align="right">${escapeHtml(item.quantity)}</td><td align="right">${escapeHtml(item.total)}</td></tr>`,
  )
  .join("\n")}
</table>
<table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
${row("Subtotal", money(order.subtotal))}${row("Delivery", deliveryCharge)}${row("Total", money(order.total))}${row("Delivery method", delivery)}${address.length ? row("Address", address.join(", ")) : ""}${row("Payment", `${order.paymentMethod} (${statusLabel(order.paymentStatus)})`)}${row("Order status", statusLabel(order.status))}
</table>
<p style="font-size:12px;color:#6b7280;line-height:1.5">${escapeHtml(ORDER_POLICY.deliveryCharge)}</p>
<p style="font-size:12px;color:#6b7280">${escapeHtml(BUSINESS_INFO.name)} · ${escapeHtml(BUSINESS_INFO.email)} · ${escapeHtml(BUSINESS_INFO.phone)}</p>
</div></body></html>`;
  return { html, text };
}

export function customerConfirmationEmail(order: OrderView, to: string): EmailMessage {
  const { html, text } = render(
    order,
    `Thank you — order ${order.id} received`,
    `Hi ${order.customerName}, we have received your order. We will review it and contact you to confirm the details. You pay on delivery or at pickup.`,
    "customer",
  );
  return { to, subject: `Your Husnalogy order ${order.id}`, html, text };
}

export function adminNewOrderEmail(order: OrderView, to: string): EmailMessage {
  const { html, text } = render(order, `New order ${order.id}`, "A new Cash on Delivery order was placed. Review it in Admin → Orders.", "admin");
  return { to, subject: `New order ${order.id} — ${formatCurrency(order.total, order.currency)}`, html, text };
}
