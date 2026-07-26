import { createId, nowIso } from "@/lib/core/id";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { cleanOptionalString, cleanString, isValidEmail } from "@/lib/validation";

function subscriberFromRow(row: any = {}) {
  return {
    id: row.id,
    email: row.email || "",
    source: row.source || "website",
    status: row.status || "active",
    createdAt: row.created_at || "",
  };
}

function campaignFromRow(row: any = {}) {
  return {
    id: row.id,
    title: row.title || "",
    subject: row.subject || "",
    previewText: row.preview_text || "",
    body: row.body || "",
    status: row.status || "draft",
    audience: row.audience || "all_active",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    sentAt: row.sent_at || null,
    emailsSent: Number(row.emails_sent || 0),
    openRate: row.open_rate === null || row.open_rate === undefined ? null : Number(row.open_rate),
  };
}

function normalizeSubscriber(input) {
  return {
    id: createId("subscriber"),
    email: cleanString(input.email).toLowerCase(),
    source: cleanOptionalString(input.source).slice(0, 60) || "website",
    status: "active",
    createdAt: nowIso(),
  };
}

export async function createSubscriber(input) {
  const subscriber = normalizeSubscriber(input);
  const errors: any = {};

  if (!subscriber.email) errors.email = "Email is required.";
  if (subscriber.email && !isValidEmail(subscriber.email)) errors.email = "Enter a valid email address.";

  if (Object.keys(errors).length) return { ok: false, errors };

  const supabase = createServiceRoleClient();
  const { data: existing, error: readError } = await supabase
    .from("newsletter_subscribers")
    .select("id")
    .eq("email", subscriber.email)
    .maybeSingle();

  if (readError) throw readError;

  if (existing) {
    return { ok: false, errors: { email: "This email is already subscribed." } };
  }

  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .insert({
      id: subscriber.id,
      email: subscriber.email,
      source: subscriber.source,
      status: subscriber.status,
      created_at: subscriber.createdAt,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, errors: { email: "This email is already subscribed." } };
    }
    throw error;
  }

  return { ok: true, subscriber: subscriberFromRow(data) };
}

export async function getSubscribers() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(subscriberFromRow);
}

export async function deleteSubscriber(id) {
  const supabase = createServiceRoleClient();
  const { error, count } = await supabase.from("newsletter_subscribers").delete({ count: "exact" }).eq("id", id);

  if (error) throw error;
  if (!count) return { ok: false, errors: { subscriber: "Subscriber not found." } };

  return { ok: true };
}

function normalizeCampaign(input: any = {}) {
  return {
    id: createId("campaign"),
    title: cleanString(input.title).slice(0, 160),
    subject: cleanString(input.subject).slice(0, 180),
    previewText: cleanOptionalString(input.previewText || input.preview_text).slice(0, 240),
    body: cleanString(input.body).slice(0, 12000),
    status: ["draft", "scheduled", "sent"].includes(String(input.status || "").toLowerCase()) ? String(input.status).toLowerCase() : "draft",
    audience: cleanOptionalString(input.audience).slice(0, 80) || "all_active",
  };
}

export async function getNewsletterCampaigns() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("newsletter_campaigns")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(campaignFromRow);
}

export async function createNewsletterCampaignDraft(input) {
  const campaign = normalizeCampaign({ ...input, status: "draft" });
  const errors: any = {};

  if (!campaign.title) errors.title = "Campaign title is required.";
  if (!campaign.subject) errors.subject = "Subject line is required.";
  if (!campaign.body) errors.body = "Email body is required.";
  if (Object.keys(errors).length) return { ok: false, errors };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("newsletter_campaigns")
    .insert({
      id: campaign.id,
      title: campaign.title,
      subject: campaign.subject,
      preview_text: campaign.previewText,
      body: campaign.body,
      status: "draft",
      audience: campaign.audience,
      emails_sent: 0,
      open_rate: null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return { ok: true, campaign: campaignFromRow(data) };
}

export async function updateNewsletterCampaign(id, input) {
  const campaign = normalizeCampaign(input);
  const payload: any = {
    updated_at: nowIso(),
  };
  if (campaign.title) payload.title = campaign.title;
  if (campaign.subject) payload.subject = campaign.subject;
  if (campaign.previewText !== undefined) payload.preview_text = campaign.previewText;
  if (campaign.body) payload.body = campaign.body;
  if (campaign.status) payload.status = campaign.status;
  if (campaign.audience) payload.audience = campaign.audience;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("newsletter_campaigns")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return { ok: true, campaign: campaignFromRow(data) };
}
