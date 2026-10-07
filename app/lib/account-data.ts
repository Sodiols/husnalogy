"use client";

/**
 * The signed-in customer's own account data — saved addresses and profile —
 * read from and written to THEIR account on the server (/api/account/*).
 *
 * Nothing here is kept in browser storage. These values used to live in
 * global localStorage keys shared by every account that ever signed in on the
 * browser, so customer B saw customer A's address and phone. Those legacy keys
 * carry no owner, so they cannot be migrated to anyone safely: they are
 * deleted instead (see purgeLegacyAccountStorage).
 */

import { useCallback, useEffect, useState } from "react";

export type SavedAddress = {
  id: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  area: string;
  city: string;
  district: string;
  postalCode: string;
  note: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AddressInput = {
  fullName: string;
  phone: string;
  addressLine1: string;
  area?: string;
  city: string;
  district?: string;
  postalCode?: string;
  note?: string;
  isDefault?: boolean;
};

/** Browser keys that held account data without saying whose it was. */
export const LEGACY_ACCOUNT_STORAGE_KEYS = ["husnalogy_saved_addresses", "husnalogy_profile", "husnalogy_orders"] as const;

export function purgeLegacyAccountStorage(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of LEGACY_ACCOUNT_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Storage that cannot be written holds nothing to remove.
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    // JSON bodies are strings; a FormData upload sets its own multipart boundary.
    headers: typeof init.body === "string" ? { "Content-Type": "application/json", ...(init.headers || {}) } : init.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || "Something went wrong. Please try again.");
  return data as T;
}

export async function fetchAddresses(): Promise<SavedAddress[]> {
  const data = await request<{ addresses: SavedAddress[] }>("/api/account/addresses");
  return Array.isArray(data.addresses) ? data.addresses : [];
}

export async function createAddress(input: AddressInput): Promise<SavedAddress> {
  return (await request<{ address: SavedAddress }>("/api/account/addresses", { method: "POST", body: JSON.stringify(input) })).address;
}

export async function updateAddress(id: string, patch: Partial<AddressInput>): Promise<SavedAddress> {
  return (await request<{ address: SavedAddress }>(`/api/account/addresses/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })).address;
}

export async function deleteAddress(id: string): Promise<void> {
  await request(`/api/account/addresses/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * The signed-in account's addresses. Keyed by account: switching accounts
 * clears the list immediately, before the new account's list arrives, so one
 * customer's addresses are never on screen for another.
 */
export function useSavedAddresses(userId: string) {
  const [state, setState] = useState<{ owner: string; addresses: SavedAddress[]; loading: boolean; error: string }>({ owner: "", addresses: [], loading: Boolean(userId), error: "" });

  const reload = useCallback(async () => {
    if (!userId) {
      setState({ owner: "", addresses: [], loading: false, error: "" });
      return;
    }
    setState((current) => (current.owner === userId ? { ...current, loading: true, error: "" } : { owner: userId, addresses: [], loading: true, error: "" }));
    try {
      const addresses = await fetchAddresses();
      setState((current) => (current.owner === userId ? { owner: userId, addresses, loading: false, error: "" } : current));
    } catch (error) {
      setState((current) => (current.owner === userId ? { ...current, loading: false, error: (error as Error).message } : current));
    }
  }, [userId]);

  useEffect(() => {
    purgeLegacyAccountStorage();
    void reload();
  }, [reload]);

  const addresses = state.owner === userId ? state.addresses : [];
  return { addresses, loading: state.owner === userId ? state.loading : Boolean(userId), error: state.owner === userId ? state.error : "", reload };
}

/* ------------------------------------------------------------- profile -- */

export type AccountProfile = { name: string; email: string; phone: string; avatarUrl: string };

export async function fetchProfile(): Promise<AccountProfile> {
  return (await request<{ profile: AccountProfile }>("/api/account/profile")).profile;
}

export async function saveProfile(patch: { name?: string; phone?: string }): Promise<AccountProfile> {
  return (await request<{ profile: AccountProfile }>("/api/account/profile", { method: "PATCH", body: JSON.stringify(patch) })).profile;
}

/** Upload a new profile photo; the server validates, re-encodes and stores it on the account. */
export async function uploadProfilePhoto(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const data = await request<{ avatarUrl: string }>("/api/account/avatar", { method: "POST", body: form });
  return data.avatarUrl;
}

export async function removeProfilePhoto(): Promise<void> {
  await request("/api/account/avatar", { method: "DELETE" });
}

/** The signed-in account's profile; cleared at once when the account changes. */
export function useAccountProfile(userId: string) {
  const [state, setState] = useState<{ owner: string; profile: AccountProfile | null; error: string }>({ owner: "", profile: null, error: "" });

  const reload = useCallback(async () => {
    if (!userId) {
      setState({ owner: "", profile: null, error: "" });
      return;
    }
    setState((current) => (current.owner === userId ? current : { owner: userId, profile: null, error: "" }));
    try {
      const profile = await fetchProfile();
      setState((current) => (current.owner === userId ? { owner: userId, profile, error: "" } : current));
    } catch (error) {
      setState((current) => (current.owner === userId ? { ...current, error: (error as Error).message } : current));
    }
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const mine = state.owner === userId;
  return {
    profile: mine ? state.profile : null,
    error: mine ? state.error : "",
    reload,
    setProfile: (profile: AccountProfile) => setState({ owner: userId, profile, error: "" }),
  };
}
