// POST /api/customizer/iconify/import  { "icon": "mdi:heart" }
//
// Turns an Iconify identity into a PERMANENT Husnalogy asset. The client sends
// nothing but the identity — the server fetches, sanitizes, measures, stores
// and records everything else (spec §13, §15).
//
// After this returns, the design references an ordinary `customizer_assets`
// row and never depends on Iconify again (spec §55).

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/security/rate-limit";
import { evaluateLicense, friendlyIconName, parseIconIdentity } from "@/lib/customizer/v2/iconify";
import { fetchIconSvg, getCollectionFor, IconifyUnavailableError } from "@/lib/customizer/v2/server/iconify";
import { signAdminAssetRow } from "@/lib/customizer/server/admin-assets";
import {
  AssetIngestError,
  cleanSearchTerm,
  ensureAvailability,
  findByChecksum,
  findBySourceIdentity,
  prepareAsset,
  storeAsset,
} from "@/lib/customizer/server/asset-ingest";

export const runtime = "nodejs";

const PROVIDER = "iconify";

export async function POST(request: Request) {
  // Import is materially more expensive than search (outbound fetch + image
  // processing + storage writes), so it is limited far more tightly.
  const limited = await rateLimitDistributed(request, { name: "iconify-import", limit: 30, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const identity = parseIconIdentity((body as any)?.icon);
  if (!identity) {
    return Response.json({ ok: false, error: "Invalid graphic reference." }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";

  const service = createServiceRoleClient();

  try {
    // 1/2. Already imported? Reuse the permanent asset — no second copy, no
    // second upstream request.
    const existing = await findBySourceIdentity(service, PROVIDER, identity.key);
    if (existing) {
      const reusable = await ensureAvailability(service, existing, {
        customerAvailable: true,
        adminAvailable: true,
      });
      return Response.json({ ok: true, reused: true, asset: await signAdminAssetRow(service, reusable) });
    }

    // License gate applies to the import itself, not just to search: guessing
    // a key must not smuggle a blocked collection into the library.
    const collection = await getCollectionFor(identity.key);
    const decision = evaluateLicense(collection?.license);
    if (!isAdmin && !decision.customerAllowed) {
      return Response.json(
        { ok: false, error: "This graphic is not available for use.", code: "LICENSE_NOT_PERMITTED" },
        { status: 403 },
      );
    }

    // 3/4. Fetch from trusted upstream with a byte cap.
    const fetched = await fetchIconSvg(identity.key);

    // 5–9. Sanitize, tint-detect, measure, checksum, build variants — the same
    // shared pipeline an admin upload uses.
    const prepared = await prepareAsset({
      buffer: Buffer.from(fetched.svg, "utf8"),
      mime: "image/svg+xml",
      filename: `${identity.prefix}-${identity.name}.svg`,
    });

    // Checksum dedupe complements source dedupe: the same artwork may already
    // exist from an admin upload or a differently-keyed icon (spec §21).
    const byChecksum = await findByChecksum(service, prepared.checksum);
    if (byChecksum) {
      const reusable = await ensureAvailability(service, byChecksum, { customerAvailable: true, adminAvailable: true });
      // Record provenance on a previously anonymous copy so Admin can still
      // see where it came from, without disturbing an existing identity.
      if (!byChecksum.source_provider) {
        await service
          .from("customizer_assets")
          .update({
            source_provider: PROVIDER,
            source_key: identity.key,
            source_collection: identity.prefix,
            source_license: decision.title || null,
            source_license_url: decision.url || null,
            source_license_spdx: decision.spdx || null,
            source_author: collection?.author || null,
          })
          .eq("id", byChecksum.id)
          // Losing this race is harmless: another import already claimed it.
          .is("source_provider", null);
      }
      const { data: refreshed } = await service.from("customizer_assets").select("*").eq("id", reusable.id).maybeSingle();
      return Response.json({ ok: true, reused: true, asset: await signAdminAssetRow(service, refreshed || reusable) });
    }

    const title = friendlyIconName(identity.name);

    // 10/11. Permanent storage + asset record, with rollback and concurrent
    // import resolution handled inside storeAsset.
    const { row } = await storeAsset(
      service,
      prepared,
      { buffer: prepared.buffer, mime: prepared.mime, filename: `${identity.prefix}-${identity.name}.svg` },
      {
        title,
        assetType: "svg",
        // Customer-available only when the licence genuinely permits it, even
        // when an admin performed the import.
        customerAvailable: decision.customerAllowed,
        adminAvailable: true,
        tags: [identity.prefix],
        keywords: cleanSearchTerm([title, identity.name.replace(/-/g, " "), identity.prefix, collection?.name].filter(Boolean).join(" ")).slice(0, 500),
        createdBy: user.id,
        provenance: {
          provider: PROVIDER,
          key: identity.key,
          collection: identity.prefix,
          license: decision.title,
          licenseUrl: decision.url,
          licenseSpdx: decision.spdx,
          author: collection?.author || "",
        },
      },
    );

    // 12. Return the normal hydrated Husnalogy asset.
    return Response.json({ ok: true, reused: false, asset: await signAdminAssetRow(service, row) }, { status: 201 });
  } catch (error) {
    if (error instanceof IconifyUnavailableError) {
      return Response.json(
        { ok: false, error: "Online graphics are temporarily unavailable.", code: "ICONIFY_UNAVAILABLE" },
        { status: 503 },
      );
    }
    if (error instanceof AssetIngestError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error(`[iconify] import failed for ${identity.key}:`, error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "This graphic could not be imported." }, { status: 500 });
  }
}
