"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PillDropdown } from "@/app/components/product/product-toolbar";
import useAuth from "../lib/useAuth";

function formatReviewDate(value) {
  if (!value) return "Recently";

  try {
    return new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "Recently";
  }
}

function openAuthModal(mode = "login") {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("husnalogy-open-auth", {
      detail: { mode },
    })
  );
}

export default function ProductAboutReviews({
  product,
  className = "",
  insideProductColumn = false,
}) {
  const { user, authLoading } = useAuth();
  const [reviews, setReviews] = useState(product.reviews || []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    rating: 5,
    text: "",
  });
  const [eligibility, setEligibility] = useState({
    loading: true,
    authenticated: false,
    eligible: false,
    reviewsEnabled: true,
    order: null,
    message: "",
  });
  const [status, setStatus] = useState({ loading: false, success: "", error: "" });
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setReviews(product.reviews || []);
  }, [product.slug, product.reviews]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      name: current.name || user?.name || "",
    }));
  }, [user?.name]);

  useEffect(() => {
    let cancelled = false;

    async function checkEligibility() {
      if (authLoading) return;

      setEligibility((current) => ({ ...current, loading: true }));

      try {
        const response = await fetch(`/api/products/${product.slug}/reviews`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));

        if (cancelled || !mountedRef.current) return;

        if (!response.ok || data.ok === false) {
          throw new Error(data?.error || "Could not check review access.");
        }

        setEligibility({
          loading: false,
          authenticated: Boolean(data.authenticated),
          eligible: Boolean(data.eligible),
          reviewsEnabled: data.reviewsEnabled !== false,
          order: data.order || null,
          message: data.message || "",
        });
      } catch (error) {
        if (cancelled || !mountedRef.current) return;

        setEligibility({
          loading: false,
          authenticated: true,
          eligible: false,
          reviewsEnabled: true,
          order: null,
          message: error.message || "Could not check review access.",
        });
      }
    }

    checkEligibility();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.uid, product.slug]);

  const about = product.about || {};
  const publishedReviews = useMemo(
    () => reviews.filter((review) => review.status !== "deleted"),
    [reviews]
  );

  const average =
    publishedReviews.length > 0
      ? publishedReviews.reduce((sum, item) => sum + Number(item.rating || 0), 0) / publishedReviews.length
      : 0;

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleReviewButton = () => {
    setStatus({ loading: false, success: "", error: "" });

    if (authLoading || eligibility.loading) return;

    if (!eligibility.reviewsEnabled) return;

    if (!user) {
      openAuthModal("login");
      return;
    }

    if (!eligibility.eligible) return;

    setShowForm((current) => !current);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, success: "", error: "" });

    try {
      if (!user) {
        throw new Error("Please sign in before leaving a review.");
      }

      const response = await fetch(`/api/products/${product.slug}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          orderId: eligibility.order?.id || "",
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Could not save your review.");
      }

      if (!mountedRef.current) return;

      setReviews(data.reviews || []);
      setForm({ name: user?.name || "", rating: 5, text: "" });
      setShowForm(false);
      setEligibility((current) => ({
        ...current,
        eligible: false,
        order: null,
        message: "Your verified review has already been submitted.",
      }));
      setStatus({ loading: false, success: "Thank you. Your verified review has been saved.", error: "" });
    } catch (error) {
      if (!mountedRef.current) return;
      setStatus({ loading: false, success: "", error: error.message || "Could not save your review." });
    }
  };

  const wrapperClassName = insideProductColumn
    ? className || "mt-16"
    : `mx-auto mt-24 max-w-[1480px] ${className}`;

  const aboutGridClassName = insideProductColumn
    ? "grid gap-10 xl:grid-cols-2"
    : "grid gap-12 lg:grid-cols-2";

  const reviewGridClassName = insideProductColumn
    ? "mt-8 grid gap-10 xl:grid-cols-[330px_1fr]"
    : "mt-8 grid gap-10 lg:grid-cols-[370px_1fr]";

  const reviewButtonText = authLoading || eligibility.loading
    ? "Checking review access..."
    : !eligibility.reviewsEnabled
      ? "Reviews disabled"
      : !user
      ? "Sign in to review"
      : eligibility.eligible
        ? "Write verified review"
        : "Review unavailable";

  return (
    <>
      <section className={`${wrapperClassName} border-t border-[#303839]/15 pt-12`}>
        <div className={aboutGridClassName}>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold">About Invitations</h2>
              <div className="h-px flex-1 bg-[#303839]/15" />
            </div>

            <p className="mt-5 text-sm font-semibold">
              Size: {about?.size || '5" x 7"'}
            </p>

            <p className="mt-4 max-w-xl text-sm leading-7 text-[#303839]/80">
              {product.aboutInvitation || about?.description || "A refined invitation design created for a clean, meaningful, and elegant wedding presentation."}
            </p>

            {!!about?.features?.length && (
              <ul className="mt-5 max-w-xl list-disc space-y-2 pl-5 text-sm leading-6 text-[#303839]/80">
                {about.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            )}

            {(about?.paperType || product.paperType) && (
              <h3 className="mt-8 text-lg font-semibold">
                Paper Type: {about?.paperType || product.paperType}
              </h3>
            )}
          </div>

          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold">About This Design</h2>
              <div className="h-px flex-1 bg-[#303839]/15" />
            </div>

            <h3 className="mt-5 max-w-xl text-base font-semibold">
              {product.title}
            </h3>

            <p className="mt-3 max-w-xl text-sm leading-7 text-[#303839]/80">
              {product.aboutDesign || product.description || "This design keeps the focus on your names, your date, and the feeling of the moment with a simple premium layout."}
            </p>
          </div>
        </div>
      </section>

      <section className={`${wrapperClassName} border-t border-[#303839]/15 pt-12`}>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold">Customer Reviews</h2>
          <div className="h-px flex-1 bg-[#303839]/15" />
        </div>

        <div className={reviewGridClassName}>
          <div>
            <div className="flex items-center gap-6">
              <div>
                <p className="text-5xl font-bold">{average ? average.toFixed(1) : "0.0"}</p>
                <p className="mt-1 text-sm">
                  ({publishedReviews.length} review{publishedReviews.length === 1 ? "" : "s"})
                </p>
              </div>

              <div className="flex-1 space-y-3 text-sm">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = publishedReviews.filter((review) => Number(review.rating) === star).length;
                  const width = publishedReviews.length ? (count / publishedReviews.length) * 100 : 0;

                  return (
                    <div key={star} className="flex items-center gap-3">
                      <span className="w-4 font-semibold">{star}</span>
                      <div className="h-5 flex-1 rounded-none bg-[#ece9e1]">
                        <div
                          className="h-full rounded-none bg-[#303839]"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={handleReviewButton}
              disabled={authLoading || eligibility.loading || !eligibility.reviewsEnabled || Boolean(user && !eligibility.eligible)}
              className="mt-6 h-14 w-full rounded-full bg-[#303839] text-sm font-bold text-white transition hover:bg-[#303839] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {reviewButtonText}
            </button>

            <p className="mt-3 text-xs leading-5 text-[#303839]/60">
              {eligibility.message || "Reviews are accepted only from signed in customers whose order for this product has been delivered."}
            </p>

            {status.error && <p className="mt-4 rounded-none bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{status.error}</p>}
            {status.success && <p className="mt-4 rounded-none bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{status.success}</p>}

            <div
              className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                showForm && eligibility.eligible ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden">
                <form
                  onSubmit={handleSubmit}
                  className={`mt-6 space-y-4 rounded-none border border-[#303839]/15 p-5 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    showForm && eligibility.eligible ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"
                  }`}
                >
                  <input
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                    placeholder="Your display name"
                    required
                    className="h-12 w-full rounded-none border border-[#303839]/20 px-4 outline-none transition focus:border-[#303839]/45"
                  />

                  <PillDropdown
                    value={String(form.rating)}
                    onChange={(value) => updateForm("rating", Number(value))}
                    label="Rating"
                    options={[
                      { value: "5", label: "5 stars" },
                      { value: "4", label: "4 stars" },
                      { value: "3", label: "3 stars" },
                      { value: "2", label: "2 stars" },
                      { value: "1", label: "1 star" },
                    ]}
                    className="w-full"
                    buttonClassName="h-12 bg-white text-sm shadow-none"
                  />

                  <textarea
                    value={form.text}
                    onChange={(event) => updateForm("text", event.target.value)}
                    placeholder="Write your review"
                    required
                    className="min-h-28 w-full rounded-none border border-[#303839]/20 p-4 outline-none transition focus:border-[#303839]/45"
                  />

                  <button
                    type="submit"
                    disabled={status.loading}
                    className="h-12 w-full rounded-full bg-[#303839] text-sm font-bold text-white transition hover:bg-[#303839] disabled:opacity-60"
                  >
                    {status.loading ? "Saving..." : "Submit verified review"}
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {publishedReviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
            {!publishedReviews.length && (
              <p className="rounded-none border border-[#303839]/15 p-6 text-sm text-[#303839]/65">
                No verified reviews yet. Once a customer who received this product reviews it, it will appear here.
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function ReviewCard({ review }) {
  const rating = Math.min(5, Math.max(1, Number(review.rating || 5)));

  return (
    <div className="rounded-none border border-[#303839]/15 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-lg">{"★".repeat(rating)}{"☆".repeat(5 - rating)}</p>
        {review.verifiedPurchase && (
          <span className="rounded-full bg-[#E6E6E6] px-3 py-1 text-xs font-bold text-[#303839]/70">
            Verified purchase
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-bold">By {review.name}</p>
      <p className="text-sm text-[#303839]/60">{formatReviewDate(review.createdAt)}</p>

      <p className="mt-5 text-sm leading-7 text-[#303839]/80">
        {review.text}
      </p>
    </div>
  );
}
