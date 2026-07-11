import { requireAdmin } from "@/lib/auth/admin-server";
import { resolveHeroImages } from "@/lib/hero-collections/store";

export const dynamic = "force-dynamic";

// Returns the images a hero record would show for a given source collection, so
// the admin form can render an accurate live preview before saving.
export async function GET(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { searchParams } = new URL(request.url);
  const collectionId = String(searchParams.get("collectionId") || "").trim();

  if (!collectionId) {
    return Response.json({ ok: false, error: "collectionId is required." }, { status: 400 });
  }

  const resolved = await resolveHeroImages(collectionId);
  if (!resolved || !resolved.items.length) {
    return Response.json({ ok: true, resolved: null });
  }

  const pool = resolved.items;
  const pick = (index) => pool[index] || pool[index % pool.length] || pool[0];
  const main = pick(0);
  const one = pick(1);
  const two = pick(2);
  const three = pick(3);

  return Response.json({
    ok: true,
    resolved: {
      collectionId: resolved.collectionId,
      collectionName: resolved.collectionName,
      collectionSlug: resolved.collectionSlug,
      childCount: resolved.childCount,
      productCount: resolved.productCount,
      itemCount: resolved.itemCount,
      imageCount: pool.length,
      collectionUrl: `/collections/${resolved.collectionSlug}`,
      mainImage: main.image,
      mainImageHref: main.href,
      thumbnailOne: one.image,
      thumbnailOneHref: one.href,
      thumbnailTwo: two.image,
      thumbnailTwoHref: two.href,
      thumbnailThree: three.image,
      thumbnailThreeHref: three.href,
    },
  });
}
