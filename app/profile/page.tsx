import AccountClient from "../account/account-client";

export const metadata = {
  title: "My Profile",
  description: "Manage your Husnalogy profile, orders, favorites, and saved addresses.",
};

export default function ProfilePage() {
  return <AccountClient />;
}
