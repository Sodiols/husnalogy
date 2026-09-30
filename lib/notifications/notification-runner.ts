/**
 * Turns one durable notification task into one email. Pure apart from its
 * injected dependencies, so the retry/idempotency behaviour is tested without
 * a mail provider.
 */

import type { EmailTransport } from "@/lib/notifications/email-provider";
import { adminNewOrderEmail, customerConfirmationEmail } from "@/lib/notifications/order-email";
import type { OrderView } from "@/lib/orders/order-view";
import type { LeasedTask, TaskOutcome } from "@/lib/outbox/processor";
import type { EmailMessage } from "@/lib/notifications/order-email";

export type NotificationTask = LeasedTask & {
  kind: "order_confirmation_customer" | "order_notification_admin";
  recipient: string | null;
  provider_message_id?: string | null;
  first_delivery_attempt_at?: string | null;
  delivery_payload?: EmailMessage | null;
  delivery_generation?: number;
};

export function makeNotificationRunner(deps: {
  transport: EmailTransport | null;
  loadOrder(orderId: string): Promise<OrderView | null>;
  adminRecipient: string;
  prepareDelivery?(task: NotificationTask, message: EmailMessage): Promise<{ message: EmailMessage; firstAttemptAt: string }>;
  recordDelivery?(task: NotificationTask, providerId: string): Promise<void>;
}) {
  return async (task: NotificationTask): Promise<TaskOutcome> => {
    if (task.provider_message_id) return { kind: "done", reference: task.provider_message_id };
    // Keep the task (do not burn attempts) until email is configured.
    if (!deps.transport) return { kind: "defer", reason: "Email provider is not configured (RESEND_API_KEY / EMAIL_FROM)." };

    const order = await deps.loadOrder(task.order_id);
    if (!order) throw new Error("order-not-found");
    if (order.checkoutState !== "finalized") throw new Error(`order-not-finalized:${order.checkoutState}`);

    let message = task.delivery_payload || (
      task.kind === "order_confirmation_customer"
        ? customerConfirmationEmail(order, String(task.recipient || order.customerEmail || ""))
        : adminNewOrderEmail(order, deps.adminRecipient));
    if (!message.to) return { kind: "defer", reason: "No recipient configured (ORDER_NOTIFICATION_EMAIL)." };
    message = deps.transport.prepare?.(message) || message;
    let firstAttemptAt = task.first_delivery_attempt_at;
    if (deps.prepareDelivery) {
      const prepared = await deps.prepareDelivery(task, message);
      message = prepared.message;
      firstAttemptAt = prepared.firstAttemptAt;
    }
    // Resend retains idempotency keys for 24h. Leave one hour of margin;
    // an uncertain older delivery requires a provider check, never a blind send.
    if (firstAttemptAt && Date.now() - Date.parse(firstAttemptAt) >= 23 * 60 * 60 * 1000) throw new Error("DELIVERY_UNCERTAIN: provider deduplication window elapsed; verify delivery before recovery.");

    // The task id is the provider idempotency key: a retried send after a
    // lost response is deduplicated by the provider.
    const generation = task.delivery_generation || 0;
    const sent = await deps.transport.send(message, `husnalogy-notification-${task.id}${generation ? `-review-${generation}` : ""}`);
    await deps.recordDelivery?.(task, sent.id);
    return { kind: "done", reference: sent.id };
  };
}
