import CartClient from "./cart-client";

export const metadata = {
  title: "Cart",
  description: "Review the products you have added to your Husnalogy cart.",
};

export default function CartPage() {
  return <CartClient />;
}
