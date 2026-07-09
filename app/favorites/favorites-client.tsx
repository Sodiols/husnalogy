"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useAuth from "../lib/useAuth";
import { openCustomerLogin, removeFromWishlist, subscribeToUserWishlist } from "../lib/customer-lists";

export default function FavoritesClient() {
  const { user, authLoading } = useAuth();
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (authLoading) return undefined;
    return subscribeToUserWishlist(user, setItems);
  }, [authLoading, user]);

  return (
    <main className="px-4 py-12 text-[#303839]">
      <section className="mx-auto max-w-[1180px]">
        <h1 className="font-display text-4xl">Favorites</h1>
        {!authLoading && !user && (
          <div className="mt-6 rounded-none border border-[#303839]/10 bg-[#E6E6E6] p-5">
            <p className="text-sm font-bold text-[#303839]">Sign in to view your wishlist.</p>
            <button type="button" onClick={openCustomerLogin} className="mt-4 rounded-full bg-[#303839] px-6 py-3 text-sm font-bold text-white">
              Sign in
            </button>
          </div>
        )}
        <div className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <article key={item.productId || item.id} className="group">
              <Link href={item.slug ? `/products/${item.slug}` : "/products"}>
                <img src={item.image} alt={item.title} className="aspect-square w-full rounded-none object-cover" />
                <h2 className="mt-3 text-sm font-bold">{item.title}</h2>
                <p className="mt-1 text-sm text-[#303839]/65">${Number(item.price || 0).toFixed(2)}</p>
              </Link>
              <button type="button" onClick={() => removeFromWishlist(user, item.productId || item.id)} className="mt-3 text-xs font-bold text-red-600">Remove</button>
            </article>
          ))}
        </div>
        {!items.length && <p className="mt-8 text-sm text-[#303839]/65">No favorites saved yet.</p>}
      </section>
    </main>
  );
}
