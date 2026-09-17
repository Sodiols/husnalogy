import { redirect } from "next/navigation";
import { getProductBySlug } from "@/lib/products";
import { buildFallbackTemplateFromFields } from "@/lib/customizer";
import PersonalizeClient from "./personalize-client";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { resolveFlagsIntoTemplate } from "@/lib/customizer/v2/feature-flags.server";
import { loadNormalizedMockupTemplate } from "@/lib/customizer/mockup-store";
import { getPublicCustomizerTemplate } from "@/lib/customizer/versions";
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
 * The version an in-progress customization is PINNED to.
 *
 * A customer who started before a re-publish keeps the design they actually
 * chose — both on screen and, because the same number reaches the save
 * validator and the renderer, in print. Read with the service-role client and
 * then checked against the signed-in user, so a customization id guessed from
 * the URL cannot pin someone else's session or reveal that it exists.
 */
async function resolvePinnedVersion(
  customizationId: string,
  productId: string,
  userId: string,
): Promise<number | null> {
  if (!customizationId || customizationId.startsWith("local_") || !userId) return null;
  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("product_customizations")
      .select("template_version,product_id,user_id")
      .eq("id", customizationId)
      .maybeSingle();
    if (!data || data.product_id !== productId || data.user_id !== userId) return null;
    return Number(data.template_version) || null;
  } catch (error) {
    // A pin we cannot read is not worth failing the page for — fall through to
    // the latest published version, which is always a valid design.
    logServerFailure("Could not resolve the pinned customizer version", error);
    return null;
  }
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
  const rawCustomizationId = Array.isArray(query.customizationId) ? query.customizationId[0] : query.customizationId;
  const pinnedVersion = await resolvePinnedVersion(
    String(rawCustomizationId || ""),
    product.id,
    user?.id || "",
  );
  const published = await getPublicCustomizerTemplate(product.id, pinnedVersion);

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
