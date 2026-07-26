// Render job queue (spec §23). Server-only.
//
// Jobs are stored in customizer_render_jobs and processed by a protected
// worker endpoint (or inline for small preview jobs). Jobs are idempotent:
// an identical completed job (same input_hash + job_type) is reused instead
// of re-rendering. Failed jobs keep their error and can be retried.

import { createHash, randomUUID } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { customizationFromRow } from "@/lib/customizer/customizations";
import { getTrustedTemplateForCustomization } from "@/lib/customizer/versions";
import {
  renderCustomizationPages,
  buildPrintPdf,
  RenderError,
  loadTrustedImageBuffer,
  type PageRenderResult,
} from "@/lib/customizer/v2/server/render";
import { renderFlatMockup } from "@/lib/customizer/v2/server/mockup-render";
import { MOCKUP_RENDERER_VERSION } from "@/lib/customizer/v2/mockups";
import { FONT_REGISTRY_VERSION } from "@/lib/customizer/v2/fonts";
import { getDisabledRenderFeature } from "@/lib/customizer/v2/feature-flags";
import { assetReferenceHashMaterial, collectCustomerAssetReferences } from "@/lib/customizer/v2/asset-references";
import { resolvePrivateAssetsForDelivery } from "@/lib/customizer/server/private-assets";
import type { RenderJobType } from "@/lib/customizer/v2/types";
import { loadNormalizedMockupTemplate } from "@/lib/customizer/mockup-store";
import { resolveFlagsIntoTemplate } from "@/lib/customizer/v2/feature-flags.server";

export const RENDER_MAX_ATTEMPTS = 3;
const RENDER_BUCKET = "customizer-renders";

export type RenderJobRow = {
  id: string;
  customizationId: string | null;
  orderId: string | null;
  jobType: RenderJobType;
  status: string;
  attemptCount: number;
  priority: number;
  inputHash: string;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  lockedBy: string | null;
  lockExpiresAt: string | null;
  heartbeatAt: string | null;
  nextAttemptAt: string | null;
  cancelRequestedAt: string | null;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

export function renderRetryStatus(attemptCountAfterFailure: number): "retrying" | "failed" {
  return attemptCountAfterFailure >= RENDER_MAX_ATTEMPTS ? "failed" : "retrying";
}

const CANONICAL_RENDER_CODES = new Set([
  "FONT_FILE_MISSING", "ASSET_NOT_FOUND", "ASSET_ACCESS_DENIED", "INVALID_DOCUMENT", "TEXT_OVERFLOW",
  "IMAGE_DECODE_FAILED", "PDF_RENDER_FAILED", "MOCKUP_RENDER_FAILED", "UNSUPPORTED_LAYER",
  "FEATURE_DISABLED",
  "MOCKUP_PERSPECTIVE_INVALID", "ASSET_REFERENCE_INVALID", "ASSET_SIGNING_FAILED",
  "RENDER_CANCELLED", "WORKER_LEASE_EXPIRED", "OUTPUT_VERIFICATION_FAILED",
]);

export function getRenderErrorCode(error: unknown): string {
  const direct = error instanceof RenderError ? error.code : "";
  if (CANONICAL_RENDER_CODES.has(direct)) return direct;
  const message = String((error as any)?.message || error || "");
  const prefix = message.split(":", 1)[0];
  if (CANONICAL_RENDER_CODES.has(prefix)) return prefix;
  if (["customization-not-found", "template-not-found", "no-pages", "job-not-found"].includes(direct)) return "INVALID_DOCUMENT";
  if (["asset-too-large"].includes(direct)) return "IMAGE_DECODE_FAILED";
  if (["upload-failed", "output-record-failed"].includes(direct)) return "ASSET_ACCESS_DENIED";
  return "INVALID_DOCUMENT";
}

function jobFromRow(row: any): RenderJobRow {
  return {
    id: row.id,
    customizationId: row.customization_id,
    orderId: row.order_id,
    jobType: row.job_type,
    status: row.status,
    attemptCount: Number(row.attempt_count) || 0,
    priority: Number(row.priority) || 0,
    inputHash: row.input_hash || "",
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    lockedBy: row.locked_by || null,
    lockExpiresAt: row.lock_expires_at || null,
    heartbeatAt: row.heartbeat_at || null,
    nextAttemptAt: row.next_attempt_at || null,
    cancelRequestedAt: row.cancel_requested_at || null,
  };
}

async function effectiveMockupTemplate(productId: string, template: any, supabase: ReturnType<typeof createServiceRoleClient>) {
  if (productId) {
    try {
      const normalized = await loadNormalizedMockupTemplate(productId, { client: supabase });
      if (normalized) return normalized;
    } catch (error) {
      // Compatibility during a staged migration: published normalized rows are
      // authoritative when available; legacy template JSON remains readable.
      console.warn(`[customizer] Normalized mockup lookup failed for product ${productId}; using legacy config.`, error);
    }
  }
  return template?.mockupTemplates?.[0] || template?.settings?.mockupTemplates?.[0] || null;
}

export function computeRenderInputHash(
  jobType: string,
  customization: { id: string; templateId?: string; templateVersion?: number; values?: unknown; renderData?: any; updatedAt?: string },
  trustedTemplate?: any,
): string {
  const material = JSON.stringify(stable({
    jobType,
    customizationId: customization.id,
    templateId: customization.templateId || "",
    templateVersion: customization.templateVersion || 0,
    values: assetReferenceHashMaterial(customization.values || {}),
    editorState: assetReferenceHashMaterial(customization.renderData?.editorState || {}),
    selectedOptions: (customization as any).selectedOptions || {},
    fontRegistryVersion: FONT_REGISTRY_VERSION,
    renderEngineVersion: "husnalogy-2.2.0",
    mockupRendererVersion: jobType === "mockup" ? MOCKUP_RENDERER_VERSION : undefined,
    mockupTemplate: jobType === "mockup"
      ? assetReferenceHashMaterial(trustedTemplate?.mockupTemplates?.[0] || trustedTemplate?.settings?.mockupTemplates?.[0] || null)
      : undefined,
  }));
  return createHash("sha256").update(material).digest("hex");
}

// Enqueue a render job. Idempotent: returns an existing completed job with
// the same input instead of creating a duplicate (spec §23).
export async function enqueueRenderJob(options: {
  customizationId: string;
  orderId?: string | null;
  jobType: RenderJobType;
  priority?: number;
  force?: boolean;
}): Promise<{ job: RenderJobRow; reused: boolean }> {
  const supabase = createServiceRoleClient();

  const { data: row, error } = await supabase
    .from("product_customizations")
    .select("*")
    .eq("id", options.customizationId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new RenderError("customization-not-found", "Customization not found.");
  const customization = customizationFromRow(row);
  const trusted = await getTrustedTemplateForCustomization(customization);
  if (!trusted) throw new RenderError("template-not-found", "No template available for this customization.");
  const normalizedMockup = options.jobType === "mockup"
    ? await effectiveMockupTemplate(customization.productId, trusted.template, supabase)
    : null;
  const templateWithMockup = normalizedMockup ? { ...trusted.template, mockupTemplates: [normalizedMockup] } : trusted.template;
  const authoritativeTemplate = await resolveFlagsIntoTemplate(templateWithMockup, {
    productId: customization.productId,
    productType: normalizedMockup?.productType || templateWithMockup?.productType || templateWithMockup?.settings?.productType,
    actorId: customization.userId,
  });
  const disabledFeature = getDisabledRenderFeature(authoritativeTemplate, options.jobType);
  if (disabledFeature) throw new RenderError("FEATURE_DISABLED", `${disabledFeature} is disabled for this product.`);
  const inputHash = computeRenderInputHash(options.jobType, customization, authoritativeTemplate);

  const { data: existing } = options.force ? { data: null } : await supabase
    .from("customizer_render_jobs")
    .select("*")
    .eq("input_hash", inputHash)
    .eq("job_type", options.jobType)
    .in("status", ["completed", "queued", "retrying", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return { job: jobFromRow(existing), reused: true };

  const { data: versionRow } = customization.templateId
    ? await supabase
        .from("customizer_template_versions")
        .select("id")
        .eq("template_id", customization.templateId)
        .eq("version", customization.templateVersion || 0)
        .maybeSingle()
    : { data: null };

  const { data: created, error: insertError } = await supabase
    .from("customizer_render_jobs")
    .insert({
      customization_id: options.customizationId,
      order_id: options.orderId || null,
      template_version_id: versionRow?.id || null,
      job_type: options.jobType,
      status: "queued",
      priority: options.priority || 0,
      input_hash: inputHash,
      input_snapshot: {
        templateId: customization.templateId,
        templateVersion: customization.templateVersion,
        values: customization.values,
        editorState: customization.renderData?.editorState || {},
        assetReferences: collectCustomerAssetReferences({ values: customization.values, editorState: customization.renderData?.editorState || {} }, customization.userId),
      },
    })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return { job: jobFromRow(created), reused: false };
}

async function uploadOutput(
  supabase: ReturnType<typeof createServiceRoleClient>,
  path: string,
  data: Buffer,
  contentType: string,
) {
  const { error } = await supabase.storage.from(RENDER_BUCKET).upload(path, data, {
    contentType,
    upsert: true,
  });
  if (error) throw new RenderError("upload-failed", `Could not store render output: ${error.message}`);
}

async function verifyStoredOutput(
  supabase: ReturnType<typeof createServiceRoleClient>,
  path: string,
  expected: Buffer,
): Promise<string> {
  const { data, error } = await supabase.storage.from(RENDER_BUCKET).download(path);
  if (error || !data) throw new RenderError("OUTPUT_VERIFICATION_FAILED", `Stored output ${path} could not be read back.`);
  const stored = Buffer.from(await data.arrayBuffer());
  const expectedChecksum = createHash("sha256").update(expected).digest("hex");
  const storedChecksum = createHash("sha256").update(stored).digest("hex");
  if (stored.byteLength !== expected.byteLength || storedChecksum !== expectedChecksum) {
    await supabase.storage.from(RENDER_BUCKET).remove([path]);
    throw new RenderError("OUTPUT_VERIFICATION_FAILED", `Stored output ${path} failed checksum verification.`);
  }
  return storedChecksum;
}

// Process one job to completion (or failure). Returns the final job row.
export async function processRenderJob(jobId: string): Promise<RenderJobRow> {
  const supabase = createServiceRoleClient();

  // Claim the job: queued → processing. A concurrent worker loses the race.
  const workerId = `${process.env.VERCEL_REGION || "local"}:${process.pid}:${randomUUID()}`;
  const { data: claimResult, error: claimError } = await supabase.rpc("claim_customizer_render_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: 180,
  });
  if (claimError) throw claimError;
  const claimed = Array.isArray(claimResult) ? claimResult[0] : claimResult;
  if (!claimed) {
    const { data: current } = await supabase.from("customizer_render_jobs").select("*").eq("id", jobId).maybeSingle();
    if (!current) throw new RenderError("job-not-found", "Render job not found.");
    return jobFromRow(current);
  }

  let leaseLost = false;
  let cancelRequested = false;
  const heartbeat = async () => {
    const now = new Date();
    const { data } = await supabase.from("customizer_render_jobs")
      .update({ heartbeat_at: now.toISOString(), lock_expires_at: new Date(now.getTime() + 180_000).toISOString() })
      .eq("id", jobId)
      .eq("lock_token", claimed.lock_token)
      .eq("status", "processing")
      .select("id,cancel_requested_at")
      .maybeSingle();
    if (!data) leaseLost = true;
    if (data?.cancel_requested_at) cancelRequested = true;
  };
  const heartbeatTimer = setInterval(() => { heartbeat().catch(() => { leaseLost = true; }); }, 25_000);
  const assertActiveLease = async () => {
    if (leaseLost) throw new RenderError("WORKER_LEASE_EXPIRED", "This worker no longer owns the render job lease.");
    if (cancelRequested) throw new RenderError("RENDER_CANCELLED", "The render job was cancelled.");
    const { data } = await supabase.from("customizer_render_jobs").select("status,cancel_requested_at,lock_token").eq("id", jobId).maybeSingle();
    if (!data || data.lock_token !== claimed.lock_token || data.status !== "processing") throw new RenderError("WORKER_LEASE_EXPIRED", "This worker no longer owns the render job lease.");
    if (data.cancel_requested_at) throw new RenderError("RENDER_CANCELLED", "The render job was cancelled.");
  };

  const finish = async (patch: Record<string, unknown>) => {
    clearInterval(heartbeatTimer);
    const { data, error } = await supabase
      .from("customizer_render_jobs")
      .update({ ...patch, attempt_count: (Number(claimed.attempt_count) || 0) + 1, locked_by: null, lock_token: null, lock_expires_at: null, heartbeat_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("lock_token", claimed.lock_token)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: current } = await supabase.from("customizer_render_jobs").select("*").eq("id", jobId).single();
      return jobFromRow(current);
    }
    return jobFromRow(data);
  };

  const uploadedPaths: string[] = [];
  try {
    const { data: row } = await supabase
      .from("product_customizations")
      .select("*")
      .eq("id", claimed.customization_id)
      .maybeSingle();
    if (!row) throw new RenderError("customization-not-found", "Customization no longer exists.");
    const customization = customizationFromRow(row);

    const trusted = await getTrustedTemplateForCustomization(customization);
    if (!trusted) throw new RenderError("template-not-found", "No template available for this customization.");
    let template = trusted.template;

    const jobType = claimed.job_type as RenderJobType;
    const normalizedMockup = jobType === "mockup" ? await effectiveMockupTemplate(customization.productId, template, supabase) : null;
    if (normalizedMockup) template = { ...template, mockupTemplates: [normalizedMockup] };
    template = await resolveFlagsIntoTemplate(template, {
      productId: customization.productId,
      productType: normalizedMockup?.productType || template?.productType || template?.settings?.productType,
      actorId: customization.userId,
    });
    const disabledFeature = getDisabledRenderFeature(template, jobType);
    if (disabledFeature) {
      throw new RenderError("FEATURE_DISABLED", `${disabledFeature} is disabled for this product.`);
    }
    const isPrint = jobType === "print_png" || jobType === "print_pdf";
    const assetVariant = isPrint ? "original" : "editor";
    const [values, editorState] = await Promise.all([
      resolvePrivateAssetsForDelivery(customization.values || {}, { productionWorker: true }, assetVariant, supabase),
      resolvePrivateAssetsForDelivery(customization.renderData?.editorState || null, { productionWorker: true }, assetVariant, supabase),
    ]);

    const pages: PageRenderResult[] = await renderCustomizationPages({
      template,
      values,
      editorState,
      mode: isPrint ? "print" : "preview",
      previewWidth: jobType === "thumbnail" || jobType === "cart_thumbnail" ? 480 : 1000,
      watermark: isPrint || jobType === "admin_preview" ? "" : "HUSNALOGY PREVIEW",
      includeBleed: isPrint,
    });
    await assertActiveLease();

    const outputs: Array<Record<string, unknown>> = [];
    const basePath = `renders/${customization.id}/${jobId}`;

    if (jobType === "mockup") {
      const config = normalizedMockup || await effectiveMockupTemplate(customization.productId, template, supabase);
      if (!config?.views?.length) throw new RenderError("MOCKUP_RENDER_FAILED", "No mockup template is configured for this product.");
      const pageImages = Object.fromEntries(pages.map((page) => [page.pageId, page.png]));
      for (const view of config.views) {
        await assertActiveLease();
        if (!view.baseImageUrl) throw new RenderError("MOCKUP_RENDER_FAILED", `Mockup view ${view.name || view.id} has no base image.`);
        const baseImage = await loadTrustedImageBuffer(view.baseImageUrl);
        const overlayImages: Record<string, Buffer> = {};
        for (const overlay of view.overlays || []) {
          if (!overlay.src) continue;
          overlayImages[overlay.id] = await loadTrustedImageBuffer(overlay.src);
          if (overlay.assetId) overlayImages[overlay.assetId] = overlayImages[overlay.id];
        }
        const transparent = view.requiresTransparency === true;
        const rendered = await renderFlatMockup({
          view,
          baseImage,
          pageImages,
          overlayImages,
          width: Number(view.width || config.width) || 1600,
          height: Number(view.height || config.height) || 1200,
          format: transparent ? "png" : "webp",
        });
        const format = transparent ? "png" : "webp";
        const contentType = transparent ? "image/png" : "image/webp";
        const path = `${basePath}/mockup-${view.id}.${format}`;
        await uploadOutput(supabase, path, rendered.image, contentType);
        uploadedPaths.push(path);
        const verifiedChecksum = await verifyStoredOutput(supabase, path, rendered.image);
        outputs.push({
          job_id: jobId,
          customization_id: customization.id,
          page_id: `mockup:${view.id}`,
          format,
          mime_type: contentType,
          bucket: RENDER_BUCKET,
          path,
          width_px: rendered.width,
          height_px: rendered.height,
          dpi: 72,
          file_size_bytes: rendered.image.byteLength,
          checksum: verifiedChecksum,
          watermarked: true,
          render_engine_version: `husnalogy-2.2.0/${MOCKUP_RENDERER_VERSION}`,
          template_version: customization.templateVersion || template.version || 1,
          mockup_version: Number(config.version) || 1,
          output_type: "customer_mockup",
          input_hash: claimed.input_hash,
          status: "ready",
          order_id: claimed.order_id || null,
          verified_at: new Date().toISOString(),
        });
      }
    }

    if (jobType === "print_pdf") {
      const bleedPx = {
        top: Number(template.bleed?.top) || 0,
        right: Number(template.bleed?.right) || 0,
        bottom: Number(template.bleed?.bottom) || 0,
        left: Number(template.bleed?.left) || 0,
      };
      const { pdf, checksum } = await buildPrintPdf(pages, {
        widthIn: Number(template.cardWidthIn) || 5,
        heightIn: Number(template.cardHeightIn) || 7,
        dpi: Number(template.dpi) || 300,
        bleedPx,
      });
      const path = `${basePath}/print.pdf`;
      await uploadOutput(supabase, path, pdf, "application/pdf");
      uploadedPaths.push(path);
      const verifiedChecksum = await verifyStoredOutput(supabase, path, pdf);
      outputs.push({
        job_id: jobId,
        customization_id: customization.id,
        page_id: "all",
        format: "pdf",
        bucket: RENDER_BUCKET,
        path,
        width_px: pages[0]?.widthPx || 0,
        height_px: pages[0]?.heightPx || 0,
        dpi: Number(template.dpi) || 300,
        file_size_bytes: pdf.byteLength,
        checksum: verifiedChecksum || checksum,
        watermarked: false,
        render_engine_version: "husnalogy-2.2.0",
        template_version: customization.templateVersion || template.version || 1,
        order_id: claimed.order_id || null,
        output_type: "print_pdf",
        mime_type: "application/pdf",
        input_hash: claimed.input_hash,
        status: "ready",
        verified_at: new Date().toISOString(),
      });
    }

    for (const page of pages) {
      if (jobType === "mockup") break;
      if (jobType === "print_pdf") break; // pdf job stores only the pdf
      const path = `${basePath}/${page.pageId}.png`;
      await assertActiveLease();
      await uploadOutput(supabase, path, page.png, "image/png");
      uploadedPaths.push(path);
      const verifiedChecksum = await verifyStoredOutput(supabase, path, page.png);
      outputs.push({
        job_id: jobId,
        customization_id: customization.id,
        page_id: page.pageId,
        format: "png",
        bucket: RENDER_BUCKET,
        path,
        width_px: page.widthPx,
        height_px: page.heightPx,
        dpi: page.dpi,
        file_size_bytes: page.png.byteLength,
        checksum: verifiedChecksum,
        watermarked: !isPrint,
        render_engine_version: "husnalogy-2.2.0",
        template_version: customization.templateVersion || template.version || 1,
        order_id: claimed.order_id || null,
        output_type: jobType,
        mime_type: "image/png",
        input_hash: claimed.input_hash,
        status: "ready",
        verified_at: new Date().toISOString(),
      });
    }

    if (outputs.length) {
      await assertActiveLease();
      const { error: outputError } = await supabase.from("customizer_render_outputs").insert(outputs);
      if (outputError) throw new RenderError("output-record-failed", outputError.message);
    }

    // Keep the customization + any order snapshot pointing at the production
    // files (spec §22: print file references live on the snapshot).
    if (isPrint) {
      const printFiles: Record<string, unknown> = {};
      for (const output of outputs) {
        printFiles[String(output.page_id)] = {
          bucket: output.bucket,
          path: output.path,
          format: output.format,
          widthPx: output.width_px,
          heightPx: output.height_px,
          dpi: output.dpi,
          checksum: output.checksum,
          renderedAt: new Date().toISOString(),
        };
      }
      await supabase
        .from("product_customizations")
        .update({ print_files: printFiles })
        .eq("id", customization.id);
      if (claimed.order_id) {
        await supabase
          .from("order_design_snapshots")
          .update({ print_files: printFiles, render_status: "completed" })
          .eq("order_id", claimed.order_id)
          .eq("customization_id", customization.id);
      }
    }

    return await finish({
      status: "completed",
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
      next_attempt_at: null,
    });
  } catch (error: any) {
    const code = getRenderErrorCode(error);
    const attempts = (Number(claimed.attempt_count) || 0) + 1;
    await supabase.from("customizer_render_outputs").delete().eq("job_id", jobId);
    if (uploadedPaths.length) await supabase.storage.from(RENDER_BUCKET).remove(uploadedPaths);
    console.error(`[customizer] Render job ${jobId} failed (attempt ${attempts}):`, error);
    const cancelled = code === "RENDER_CANCELLED";
    const nextStatus = cancelled ? "cancelled" : renderRetryStatus(attempts);
    if (claimed.order_id) {
      await supabase
        .from("order_design_snapshots")
        .update({ render_status: cancelled ? "failed" : nextStatus === "failed" ? "failed" : "queued" })
        .eq("order_id", claimed.order_id)
        .eq("customization_id", claimed.customization_id);
    }
    return await finish({
      status: nextStatus,
      error_code: code,
      error_message: String(error?.message || error).slice(0, 1000),
      next_attempt_at: nextStatus === "retrying" ? new Date(Date.now() + 15_000 * 2 ** Math.max(0, attempts - 1)).toISOString() : null,
      completed_at: nextStatus === "failed" || nextStatus === "cancelled" ? new Date().toISOString() : null,
    });
  }
}

// Worker entry: claim and process up to `limit` queued jobs by priority.
export async function processQueuedRenderJobs(limit = 3): Promise<RenderJobRow[]> {
  const supabase = createServiceRoleClient();
  const { error: recoveryError } = await supabase.rpc("recover_abandoned_customizer_render_jobs");
  if (recoveryError) throw recoveryError;
  const { data, error } = await supabase
    .from("customizer_render_jobs")
    .select("id")
    .in("status", ["queued", "retrying"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const results: RenderJobRow[] = [];
  for (const row of data || []) {
    results.push(await processRenderJob(row.id));
  }
  return results;
}

export async function cancelRenderJob(jobId: string): Promise<RenderJobRow | null> {
  const supabase = createServiceRoleClient();
  const { data: current, error } = await supabase.from("customizer_render_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw error;
  if (!current) return null;
  if (["completed", "failed", "cancelled"].includes(current.status)) return jobFromRow(current);
  const now = new Date().toISOString();
  const immediate = ["queued", "retrying"].includes(current.status);
  const { data, error: updateError } = await supabase.from("customizer_render_jobs")
    .update({ cancel_requested_at: now, ...(immediate ? { status: "cancelled", completed_at: now } : {}) })
    .eq("id", jobId)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return jobFromRow(data);
}

export async function getRenderJob(jobId: string): Promise<RenderJobRow | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("customizer_render_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw error;
  return data ? jobFromRow(data) : null;
}

export async function getRenderOutputs(jobId: string, signedUrlTtlSeconds = 3600) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_render_outputs")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return Promise.all(
    (data || []).map(async (row: any) => {
      const { data: signed } = await supabase.storage
        .from(row.bucket)
        .createSignedUrl(row.path, signedUrlTtlSeconds);
      return {
        id: row.id,
        pageId: row.page_id,
        format: row.format,
        widthPx: row.width_px,
        heightPx: row.height_px,
        dpi: row.dpi,
        fileSizeBytes: row.file_size_bytes,
        checksum: row.checksum,
        watermarked: row.watermarked,
        bucket: row.bucket,
        path: row.path,
        mimeType: row.mime_type || (row.format === "webp" ? "image/webp" : row.format === "pdf" ? "application/pdf" : "image/png"),
        inputHash: row.input_hash || "",
        outputType: row.output_type || "",
        status: row.status || "ready",
        signedUrl: signed?.signedUrl || "",
      };
    }),
  );
}
