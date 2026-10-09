import CartClient from "./cart-client";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const metadata = privatePageMetadata("Cart");

export default function CartPage() {
  return <CartClient />;
}
