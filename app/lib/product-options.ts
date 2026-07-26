import { createClient } from "@/lib/supabase/client";

export function getProductOptionId(product) {
  return String(product?.id || product?.slug || "product");
}

export function getProductOptionStorageKey(product) {
  return `husnalogy-product-options-${getProductOptionId(product)}`;
}

export function getLocalProductOptions(product) {
  if (typeof window === "undefined" || !product) return null;

  try {
    const saved = window.localStorage.getItem(getProductOptionStorageKey(product));
    if (!saved) return null;
    return JSON.parse(saved);
  } catch (error) {
    console.error("Could not read local product options:", error);
    return null;
  }
}

export function saveLocalProductOptions(product, options) {
  if (typeof window === "undefined" || !product) return;

  try {
    window.localStorage.setItem(
      getProductOptionStorageKey(product),
      JSON.stringify({
        ...options,
        savedLocallyAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error("Could not save local product options:", error);
  }
}

export async function getSavedProductOptions(user, product) {
  if (!user || !product) return null;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("customer_product_options")
    .select("options")
    .eq("user_id", user.uid || user.id)
    .eq("product_key", getProductOptionId(product))
    .maybeSingle();

  if (error) throw error;
  return data?.options || null;
}

export async function saveProductOptions(user, product, options) {
  if (!user || !product) return;

  const supabase = createClient();
  const { error } = await supabase.from("customer_product_options").upsert(
    {
      user_id: user.uid || user.id,
      product_key: getProductOptionId(product),
      product_id: product.id || "",
      product_slug: product.slug || "",
      product_title: product.title || "",
      options: {
        ...options,
        savedPermanently: true,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,product_key" },
  );

  if (error) throw error;
}

