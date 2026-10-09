import OrdersClient from "./orders-client";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const metadata = privatePageMetadata("My Orders");

export default function OrdersPage() {
  return <OrdersClient />;
}
