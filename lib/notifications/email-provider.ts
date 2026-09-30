/**
 * Transactional email transport (server only).
 *
 * Resend's HTTP API (one of the providers HOSTINGER_DEPLOYMENT.md names), used
 * through `fetch` so no SDK dependency is added. Every send carries an
 * `Idempotency-Key` (the notification task id), so a retry after a timeout —
 * where the provider may already have accepted the message — does not deliver
 * a second copy.
 *
 * When RESEND_API_KEY / EMAIL_FROM are not configured, `getEmailTransport()`
 * returns null and notification tasks are deferred (kept, not dropped) until
 * email is configured.
 */

import type { EmailMessage } from "@/lib/notifications/order-email";

export type EmailTransport = {
  send(message: EmailMessage, idempotencyKey: string): Promise<{ id: string }>;
};

export class EmailSendError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "EmailSendError";
  }
}

export function getEmailTransport(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): EmailTransport | null {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.EMAIL_FROM || "").trim();
  if (!apiKey || !from) return null;
  const replyTo = String(env.EMAIL_REPLY_TO || "").trim();

  return {
    async send(message, idempotencyKey) {
      let response: Response;
      try {
        response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(replyTo ? { reply_to: replyTo } : {}),
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        throw new EmailSendError(`Email provider unreachable: ${error instanceof Error ? error.message : String(error)}`, true);
      }
      const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok) {
        // 4xx other than 429 is a configuration/content problem; still retried
        // (bounded) so a fixed configuration eventually delivers.
        throw new EmailSendError(`Email provider responded ${response.status}: ${String(payload?.message || "").slice(0, 200)}`, response.status === 429 || response.status >= 500);
      }
      return { id: String(payload?.id || "") };
    },
  };
}

/** Where new-order alerts go: ORDER_NOTIFICATION_EMAIL, else the store email. */
export function adminNotificationRecipient(storeEmail: string, env: Record<string, string | undefined> = process.env): string {
  return String(env.ORDER_NOTIFICATION_EMAIL || storeEmail || "").trim().toLowerCase();
}
