import { describe, expect, it } from "vitest";
import { adminNewOrderEmail, customerConfirmationEmail, escapeHtml } from "@/lib/notifications/order-email";
import { adminNotificationRecipient, getEmailTransport } from "@/lib/notifications/email-provider";
import { makeNotificationRunner } from "@/lib/notifications/notification-runner";
import { orderFromRow } from "@/lib/orders/order-view";

const order = orderFromRow({
  id: "order-123",
  customer_id: "c1",
  customer_name: "<img src=x onerror=alert(1)> Ayesha",
  customer_email: "ayesha@example.com",
  customer_phone: "+8801712345678",
  subtotal: 400,
  delivery_charge: 0,
  total: 400,
  currency: "BDT",
  payment_status: "unpaid",
  status: "pending",
  checkout_state: "finalized",
  delivery_method: "delivery",
  address: { addressLine1: "House 12 <b>", city: "Sylhet", country: "Bangladesh" },
  metadata: { paymentMethod: "Cash on Delivery", internalNote: "SECRET-PRODUCTION" },
  created_at: "2026-10-01T10:00:00Z",
  order_items: [
    { id: "i1", line_number: 1, product_title: "Pearl <script>", quantity: 2, unit_price: 200, line_total: 400, currency: "BDT", selected_options: { paper: "Premium", logo: true }, metadata: { templateId: "tpl-internal" } },
  ],
});

describe("order emails contain trusted data only, safely escaped", () => {
  it("customer confirmation includes the required order facts", () => {
    const mail = customerConfirmationEmail(order, "ayesha@example.com");
    for (const expected of ["order-123", "Pearl", "2 x", "Premium", "Home delivery", "House 12", "Sylhet", "Cash on Delivery", "Unpaid", "Pending", "hello@husnalogy.com"]) {
      expect(mail.text).toContain(expected);
    }
    expect(mail.to).toBe("ayesha@example.com");
    expect(mail.subject).toContain("order-123");
  });

  it("escapes every customer-supplied value in HTML", () => {
    const html = customerConfirmationEmail(order, "ayesha@example.com").html;
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("House 12 <b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });

  it("never includes internal production data", () => {
    const mail = customerConfirmationEmail(order, "ayesha@example.com");
    expect(mail.text + mail.html).not.toContain("SECRET-PRODUCTION");
    expect(mail.text + mail.html).not.toContain("tpl-internal");
    // The customer email does not repeat contact details; the admin email does.
    const admin = adminNewOrderEmail(order, "orders@husnalogy.com");
    expect(admin.text).toContain("+8801712345678");
    expect(admin.text).toContain("ayesha@example.com");
  });
});

describe("email transport", () => {
  it("is absent until RESEND_API_KEY and EMAIL_FROM are configured", () => {
    expect(getEmailTransport({})).toBeNull();
    expect(getEmailTransport({ RESEND_API_KEY: "re_x" })).toBeNull();
  });

  it("sends with the task id as provider idempotency key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const transport = getEmailTransport({ RESEND_API_KEY: "re_x", EMAIL_FROM: "Husnalogy <orders@husnalogy.com>" }, fakeFetch);
    const result = await transport?.send({ to: "a@b.co", subject: "s", html: "<p>h</p>", text: "t" }, "husnalogy-notification-task-1");
    expect(result).toEqual({ id: "msg_1" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("husnalogy-notification-task-1");
  });

  it("reports provider failures as retryable errors", async () => {
    const failing = (async () => new Response(JSON.stringify({ message: "busy" }), { status: 503 })) as unknown as typeof fetch;
    const transport = getEmailTransport({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.co" }, failing);
    await expect(transport?.send({ to: "a@b.co", subject: "s", html: "h", text: "t" }, "k")).rejects.toThrow(/503/);
  });

  it("routes admin alerts to ORDER_NOTIFICATION_EMAIL, else the store email", () => {
    expect(adminNotificationRecipient("store@husnalogy.com", { ORDER_NOTIFICATION_EMAIL: "Orders@Husnalogy.com" })).toBe("orders@husnalogy.com");
    expect(adminNotificationRecipient("store@husnalogy.com", {})).toBe("store@husnalogy.com");
  });
});

describe("notification runner", () => {
  const task = { id: "t1", lock_token: "l", attempt_count: 1, order_id: "order-123", kind: "order_confirmation_customer" as const, recipient: "ayesha@example.com" };

  it("defers (keeps) the task when no provider is configured", async () => {
    const run = makeNotificationRunner({ transport: null, adminRecipient: "", loadOrder: async () => order });
    expect((await run(task)).kind).toBe("defer");
  });

  it("refuses to email about an order that is not finalized", async () => {
    const run = makeNotificationRunner({
      transport: { send: async () => ({ id: "x" }) },
      adminRecipient: "",
      loadOrder: async () => ({ ...order, checkoutState: "creating" }),
    });
    await expect(run(task)).rejects.toThrow(/not-finalized/);
  });
});
