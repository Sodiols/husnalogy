import FavoritesClient from "./favorites-client";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const metadata = privatePageMetadata("Favorites");

export default function FavoritesPage() {
  return <FavoritesClient />;
}
