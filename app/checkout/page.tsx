import CheckoutClient from "./checkout-client";
import { getInitialUser } from "../lib/initial-user";

export const metadata = {
  title: "Checkout",
  description: "Place your Husnalogy order request.",
};

export default async function CheckoutPage() {
  const initialUser = await getInitialUser();

  return <CheckoutClient initialUser={initialUser} />;
}
