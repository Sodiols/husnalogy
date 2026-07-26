import AccountClient from "./account-client";

export const metadata = {
  title: "My Account",
  description: "Manage your Husnalogy profile, orders, wishlist, saved addresses, and files.",
};

export default function AccountPage() {
  return <AccountClient />;
}
