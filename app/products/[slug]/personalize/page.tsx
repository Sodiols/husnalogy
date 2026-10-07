import { redirect } from "next/navigation";
import { getProductBySlug } from "@/lib/products";
import { buildFallbackTemplateFromFields } from "@/lib/customizer";
import PersonalizeClient from "./personalize-client";
import { createClient } from "@/lib/supabase/server";
import { resolveFlagsIntoTemplate } from "@/lib/customizer/v2/feature-flags.server";
import { loadNormalizedMockupTemplate } from "@/lib/customizer/mockup-store";
import { resolveSessionTemplate } from "@/lib/customizer/versions";
import { EXACT_VERSION_UNAVAILABLE_MESSAGE } from "@/lib/customizer/version-pin";
import { logServerFailure } from "@/lib/core/server-errors";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: any) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  return {
    title: product ? `Personalize ${product.title}` : "Personalize",
    robots: { index: false },
  };
}

/**
 * A saved design whose exact template version cannot be loaded right now.
 * The editor is NOT mounted: nothing can be edited, autosaved or rewritten,
 * and the design is never opened on another version. Retrying reloads it.
 */
function SavedDesignUnavailable({ slug, retryHref }: { slug: string; retryHref: string }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-[#F3F1EC] px-4 py-24 text-center text-[#303839]" data-customizer-version-unavailable>
      <div className="max-w-md rounded-2xl bg-white px-6 py-8 shadow-[0_18px_50px_rgba(48,56,57,0.16)]">
        <h1 className="font-display text-2xl">Your saved design is safe</h1>
        <p className="mt-3 text-sm leading-6">{EXACT_VERSION_UNAVAILABLE_MESSAGE}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href={retryHref} className="rounded-full bg-[#303839] px-5 py-2 text-xs font-bold text-white hover:bg-[#3d4748]">
            Retry
          </a>
          <a href={`/products/${slug}`} className="rounded-full border border-[#303839]/20 px-5 py-2 text-xs font-bold hover:bg-[#F3F1EC]">
            Back to product
          </a>
        </div>
      </div>
    </main>
  );
}

export default async function PersonalizePage({ params, searchParams }: any) {
  const { slug } = await params;
  const query = (await searchParams) || {};
  const product = await getProductBySlug(slug);

  if (!product) {
    return (
      <main className="bg-white px-4 py-24 text-center text-[#303839]">
        <h1 className="font-display text-4xl">Product not found</h1>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  /**
   * PUBLIC CUSTOMIZERS RUN ON PUBLISHED VERSIONS ONLY.
   *
   * `product.customizerTemplate` is the working draft in
   * `product_customizer_templates` — the row the design builder autosaves into
   * on every keystroke. It is not reviewed, and it is not what the save
   * validator (`getTrustedTemplateForCustomization`) or the print renderer
   * read: those resolve the immutable `customizer_template_versions` snapshot.
   *
   * Handing the draft to a customer therefore did two things at once: it
   * published unreviewed work the moment a designer typed, and it let the
   * customer design against one document while being sold another. The public
   * page now reads the same snapshot every downstream consumer does.
   */
  //
  // A SAVED design opens on the exact version it was made on, read from the
  // customization row itself (its own template id and version) — or not at
  // all. It is never moved onto the latest version: the next autosave would
  // rewrite the customer's design against artwork they never chose.
  const rawCustomizationId = Array.isArray(query.customizationId) ? query.customizationId[0] : query.customizationId;
  let session;
  try {
    session = await resolveSessionTemplate({ productId: product.id, customizationId: String(rawCustomizationId || ""), userId: user?.id || "" });
  } catch (error) {
    logServerFailure("Could not resolve the customizer template", error);
    if (rawCustomizationId) session = { kind: "unavailable" as const, templateVersion: 0 };
    else throw error;
  }
  if (session.kind === "unavailable") {
    const retry = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string") retry.set(key, value);
    }
    return <SavedDesignUnavailable slug={slug} retryHref={`/products/${slug}/personalize?${retry.toString()}`} />;
  }
  const published = session.kind === "latest" || session.kind === "pinned" ? session : null;

  // Legacy products that never had a V2 template still personalize through the
  // fields fallback; it is derived from the product row, not from a draft.
  const fallback =
    !published && product.customizeEnabled !== false && Array.isArray(product.customizationFields) && product.customizationFields.length
      ? buildFallbackTemplateFromFields(product)
      : null;

  const baseTemplate = published?.template ?? (fallback?.enabled ? fallback : null);
  // Nothing published yet means nothing to personalize. A draft is never a
  // substitute — that is the whole point of the review workflow.
  if (!baseTemplate) redirect(`/products/${slug}`);

  const productType = product.productType || product.departmentPath?.join("/") || product.category || "flat-card";
  const [flaggedTemplate, normalizedMockup] = await Promise.all([
    resolveFlagsIntoTemplate(baseTemplate, { productId: product.id, productType, actorId: user?.id || "" }),
    loadNormalizedMockupTemplate(product.id),
  ]);
  const template = normalizedMockup ? { ...flaggedTemplate, mockupTemplates: [normalizedMockup] } : flaggedTemplate;

  // The product still carries its draft template from the catalog join. Drop it
  // so no draft content can reach the client through a second door.
  const { customizerTemplate: _draft, ...publicProduct } = product as Record<string, unknown>;

  return <PersonalizeClient product={publicProduct} template={template} />;
}
