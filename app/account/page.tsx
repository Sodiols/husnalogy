import AccountClient from "./account-client";
import { getInitialUser } from "../lib/initial-user";

export const metadata = {
  title: "My Account",
  description: "Manage your Husnalogy profile, orders, wishlist, saved addresses, and files.",
};

export default async function AccountPage() {
  return <AccountClient initialUser={await getInitialUser()} />;
}
