"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword } from "@/app/lib/auth";

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, error: "" });

    try {
      await signInWithEmailAndPassword(email.trim(), password);

      router.push(searchParams.get("next") || "/admin/dashboard");
      router.refresh();
    } catch (error) {
      setStatus({ loading: false, error: error.message || "Something went wrong." });
    }
  };

  return (
    <main className="min-h-screen bg-white px-4 py-12 text-[#111111]">
      <section className="mx-auto flex min-h-[calc(100vh-96px)] max-w-[520px] items-center">
        <div className="w-full rounded-none border border-black/10 bg-white p-8 shadow-[0_24px_80px_-60px_rgba(0,0,0,0.7)]">
          <img src="/Brand Kit/Logo-5.png" alt="Husnalogy" className="mx-auto h-14 w-auto object-contain" />

          <h1 className="mt-8 text-center font-body text-4xl font-semibold">
            Admin Login
          </h1>

          <p className="mx-auto mt-3 max-w-sm text-center text-sm leading-6 text-[#111111]/70">
            Sign in to manage Husnalogy products, requests, messages and newsletter subscribers.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <label className="block text-sm font-bold">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="mt-2 h-12 w-full rounded-none border border-black/15 bg-white px-5 text-sm font-normal outline-none transition hover:border-black/25 focus:border-black focus:ring-2 focus:ring-black/10"
              />
            </label>

            <label className="block text-sm font-bold">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your admin password"
                required
                autoComplete="current-password"
                className="mt-2 h-12 w-full rounded-none border border-black/15 bg-white px-5 text-sm font-normal outline-none transition hover:border-black/25 focus:border-black focus:ring-2 focus:ring-black/10"
              />
            </label>

            {status.error && (
              <p className="rounded-none bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {status.error}
              </p>
            )}

            <button
              type="submit"
              disabled={status.loading}
              className="h-12 w-full rounded-full bg-black text-sm font-extrabold uppercase tracking-[0.14em] text-white transition hover:bg-[#222222] disabled:opacity-60"
            >
              {status.loading ? "Signing in" : "Login"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
