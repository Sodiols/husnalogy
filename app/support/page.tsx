import SupportClient from "./support-client";

export const metadata = {
  title: "Support",
  description: "Get help with Husnalogy orders, personalization, delivery, returns, and design requests.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return <SupportClient />;
}
