import { createId, nowIso } from "@/lib/core/id";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { clampString, cleanString, isValidEmail } from "@/lib/validation";

const MESSAGE_STATUSES = new Set(["new", "read", "replied", "archived"]);

function messageFromRow(row: any = {}) {
  return {
    id: row.id,
    name: row.name || "",
    email: row.email || "",
    phone: row.phone || "",
    subject: row.subject || "",
    message: row.message || "",
    status: row.status || "new",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function normalizeContactMessage(input: any, existing: any = {}) {
  return {
    id: existing.id || createId("message"),
    name: clampString(input.name ?? existing.name, 160),
    email: clampString(input.email ?? existing.email, 254).toLowerCase(),
    phone: clampString(input.phone ?? existing.phone, 40),
    subject: clampString(input.subject ?? existing.subject, 200),
    message: clampString(input.message ?? existing.message, 5000),
    status: MESSAGE_STATUSES.has(input.status) ? input.status : existing.status || "new",
    createdAt: existing.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function validateContactMessage(message: any) {
  const errors: any = {};
  if (!message.name) errors.name = "Name is required.";
  if (!message.email) errors.email = "Email is required.";
  if (message.email && !isValidEmail(message.email)) errors.email = "Enter a valid email address.";
  if (!message.message) errors.message = "Message is required.";
  return errors;
}

function toMessageRow(message) {
  return {
    id: message.id,
    name: message.name,
    email: message.email,
    phone: message.phone || null,
    subject: message.subject || null,
    message: message.message,
    status: message.status,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
  };
}

export async function createContactMessage(input) {
  const message = normalizeContactMessage({ ...input, status: "new" });
  const errors = validateContactMessage(message);

  if (Object.keys(errors).length) return { ok: false, errors };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("contact_messages")
    .insert(toMessageRow(message))
    .select("*")
    .single();

  if (error) throw error;
  return { ok: true, message: messageFromRow(data) };
}

export async function getContactMessages(filters: any = {}) {
  const supabase = createServiceRoleClient();
  let query = supabase.from("contact_messages").select("*").order("created_at", { ascending: false });
  const status = cleanString(filters.status).toLowerCase();

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  const queryText = cleanString(filters.query).toLowerCase();
  const messages = (data || []).map(messageFromRow);

  if (!queryText) return messages;

  return messages.filter((message) => {
    const haystack = [message.name, message.email, message.phone, message.subject, message.message]
      .join(" ")
      .toLowerCase();
    return haystack.includes(queryText);
  });
}

export async function updateContactMessageStatus(id, status) {
  if (!MESSAGE_STATUSES.has(status)) return { ok: false, errors: { status: "Invalid message status." } };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("contact_messages")
    .update({ status, updated_at: nowIso() })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, errors: { message: "Message not found." } };

  return { ok: true, message: messageFromRow(data) };
}

export async function deleteContactMessage(id) {
  const supabase = createServiceRoleClient();
  const { error, count } = await supabase.from("contact_messages").delete({ count: "exact" }).eq("id", id);

  if (error) throw error;
  if (!count) return { ok: false, errors: { message: "Message not found." } };

  return { ok: true };
}
