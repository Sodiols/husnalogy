import { ORDER_POLICY } from "@/lib/launch-config";

/**
 * ProductTrustStrip
 * Launch-safe reassurance shown directly beneath the buy box.
 */
function TrustRow({ icon, title, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E6E6E6] text-[#303839]">
        <i className={`fa-solid ${icon} text-[13px]`} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-5">{title}</p>
        <p className="text-sm leading-5 text-[#303839]/65">{value}</p>
      </div>
    </div>
  );
}

export default function ProductTrustStrip({ className = "" }) {
  return (
    <div
      className={`space-y-4 rounded-none bg-white px-5 py-5 text-[#303839] ${className}`}
    >
      <TrustRow
        icon="fa-truck-fast"
        title="Delivery reviewed with your order"
        value={ORDER_POLICY.deliveryCharge}
      />
      <TrustRow
        icon="fa-rotate-left"
        title="Personalized-order support"
        value={ORDER_POLICY.personalizedReturns}
      />
      <TrustRow
        icon="fa-money-bill-wave"
        title="Cash on Delivery"
        value="Pay when a delivery order arrives or when collecting a store pickup order."
      />
    </div>
  );
}
