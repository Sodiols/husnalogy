import CheckoutClient from "./checkout-client";
import { getInitialUser } from "../lib/initial-user";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const metadata = privatePageMetadata("Checkout");

export default async function CheckoutPage() {
  const initialUser = await getInitialUser();

  return <CheckoutClient initialUser={initialUser} />;
}
