"use client";

import { useEffect, useState } from "react";
import { removeCustomerAddress, subscribeToSavedAddresses } from "../lib/customer-lists";

export default function SavedAddressesClient() {
  const [items, setItems] = useState([]);

  useEffect(() => subscribeToSavedAddresses(setItems), []);

  return (
    <main className="px-4 py-12 text-[#303839]">
      <section className="mx-auto max-w-[880px]">
        <h1 className="font-display text-4xl">Saved Addresses</h1>
        <div className="mt-8 space-y-4">
          {items.map((item) => (
            <article key={item.id} className="rounded-none border border-[#303839]/10 bg-white p-5">
              <h2 className="font-bold">{item.customerName || "Saved address"}</h2>
              <p className="mt-2 text-sm leading-6 text-[#303839]/65">
                {[item.addressLine1, item.addressLine2, item.area, item.city, item.postalCode].filter(Boolean).join(", ")}
              </p>
              {item.customerPhone && <p className="mt-1 text-sm text-[#303839]/65">{item.customerPhone}</p>}
              <button type="button" onClick={() => removeCustomerAddress(item.id)} className="mt-3 text-xs font-bold text-red-600">Remove</button>
            </article>
          ))}
          {!items.length && <p className="text-sm text-[#303839]/65">No saved address found.</p>}
        </div>
      </section>
    </main>
  );
}
