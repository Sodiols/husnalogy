/**
 * Turns one durable notification task into one email. Pure apart from its
 * injected dependencies, so the retry/idempotency behaviour is tested without
 * a mail provider.
 */

import type { EmailTransport } from "@/lib/notifications/email-provider";
import { adminNewOrderEmail, customerConfirmationEmail } from "@/lib/notifications/order-email";
import type { OrderView } from "@/lib/orders/order-view";
import type { LeasedTask, TaskOutcome } from "@/lib/outbox/processor";

export type NotificationTask = LeasedTask & {
  kind: "order_confirmation_customer" | "order_notification_admin";
  recipient: string | null;
};

export function makeNotificationRunner(deps: {
  transport: EmailTransport | null;
  loadOrder(orderId: string): Promise<OrderView | null>;
  adminRecipient: string;
}) {
  return async (task: NotificationTask): Promise<TaskOutcome> => {
    // Keep the task (do not burn attempts) until email is configured.
    if (!deps.transport) return { kind: "defer", reason: "Email provider is not configured (RESEND_API_KEY / EMAIL_FROM)." };

    const order = await deps.loadOrder(task.order_id);
    if (!order) throw new Error("order-not-found");
    if (order.checkoutState !== "finalized") throw new Error(`order-not-finalized:${order.checkoutState}`);

    const message =
      task.kind === "order_confirmation_customer"
        ? customerConfirmationEmail(order, String(task.recipient || order.customerEmail || ""))
        : adminNewOrderEmail(order, deps.adminRecipient);
    if (!message.to) return { kind: "defer", reason: "No recipient configured (ORDER_NOTIFICATION_EMAIL)." };

    // The task id is the provider idempotency key: a retried send after a
    // lost response is deduplicated by the provider.
    const sent = await deps.transport.send(message, `husnalogy-notification-${task.id}`);
    return { kind: "done", reference: sent.id };
  };
}
