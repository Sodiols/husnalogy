import { redirect } from "next/navigation";
import { getProductBySlug } from "@/lib/products";
import { buildFallbackTemplateFromFields } from "@/lib/customizer";
import PersonalizeClient from "./personalize-client";
import { createClient } from "@/lib/supabase/server";
import { resolveFlagsIntoTemplate } from "@/lib/customizer/v2/feature-flags.server";
import { loadNormalizedMockupTemplate } from "@/lib/customizer/mockup-store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: any) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  return {
    title: product ? `Personalize ${product.title}` : "Personalize",
    robots: { index: false },
  };
}

// Resolve the customizer template for a product:
//   1. the dedicated enabled template, else
//   2. a fallback built from legacy customizationFields (Part 14), else
//   3. bounce back to the product page (nothing to personalize).
function resolveTemplate(product: any) {
  if (product?.customizerTemplate?.enabled) return product.customizerTemplate;
  if (product?.customizeEnabled !== false && Array.isArray(product?.customizationFields) && product.customizationFields.length) {
    const fallback = buildFallbackTemplateFromFields(product);
    return fallback.enabled ? fallback : null;
  }
  return null;
}

export default async function PersonalizePage({ params }: any) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return (
      <main className="bg-white px-4 py-24 text-center text-[#303839]">
        <h1 className="font-display text-4xl">Product not found</h1>
      </main>
    );
  }

  const baseTemplate = resolveTemplate(product);
  if (!baseTemplate) redirect(`/products/${slug}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const productType = product.productType || product.departmentPath?.join("/") || product.category || "flat-card";
  const [flaggedTemplate, normalizedMockup] = await Promise.all([
    resolveFlagsIntoTemplate(baseTemplate, { productId: product.id, productType, actorId: user?.id || "" }),
    loadNormalizedMockupTemplate(product.id),
  ]);
  const template = normalizedMockup ? { ...flaggedTemplate, mockupTemplates: [normalizedMockup] } : flaggedTemplate;

  return <PersonalizeClient product={product} template={template} />;
}
