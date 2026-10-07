"use client";

import { useState } from "react";
import useAuth from "../lib/useAuth";
import { deleteAddress, useSavedAddresses } from "../lib/account-data";

export default function SavedAddressesClient() {
  const { user } = useAuth();
  // The signed-in account's own addresses (server + RLS), never this browser's.
  const { addresses: items, reload, error } = useSavedAddresses(user?.uid || user?.id || "");
  const [actionError, setActionError] = useState("");

  const remove = async (id: string) => {
    setActionError("");
    try {
      await deleteAddress(id);
      await reload();
    } catch (cause) {
      setActionError((cause as Error).message);
    }
  };

  return (
    <main className="px-4 py-12 text-[#303839]">
      <section className="mx-auto max-w-[880px]">
        <h1 className="font-display text-4xl">Saved Addresses</h1>
        {(error || actionError) && <p className="mt-4 text-sm font-semibold text-red-600">{actionError || error}</p>}
        <div className="mt-8 space-y-4">
          {items.map((item) => (
            <article key={item.id} className="rounded-none border border-[#303839]/10 bg-white p-5">
              <h2 className="font-bold">{item.fullName || "Saved address"}</h2>
              <p className="mt-2 text-sm leading-6 text-[#303839]/65">
                {[item.addressLine1, item.area, item.city, item.district, item.postalCode].filter(Boolean).join(", ")}
              </p>
              {item.phone && <p className="mt-1 text-sm text-[#303839]/65">{item.phone}</p>}
              <button type="button" onClick={() => remove(item.id)} className="mt-3 text-xs font-bold text-red-600">Remove</button>
            </article>
          ))}
          {!items.length && <p className="text-sm text-[#303839]/65">No saved address found.</p>}
        </div>
      </section>
    </main>
  );
}
