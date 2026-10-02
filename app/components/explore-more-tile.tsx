import Link from "next/link";

/**
 * Closing tile for short grids (fewer items than a full row), so sparse
 * collections end with a next step instead of a mostly empty row.
 */
export default function ExploreMoreTile({
  title = "More designs are on the way",
  text = "Explore other collections, or ask us about a design made for your occasion.",
  className = "",
}: {
  title?: string;
  text?: string;
  className?: string;
}) {
  return (
    <div className={`flex h-full min-h-[220px] flex-col justify-center rounded-[10px] bg-cream p-6 sm:aspect-square sm:min-h-0 ${className}`}>
      <p className="font-display text-[1.6rem] font-medium leading-tight text-ink">{title}</p>
      <p className="mt-3 text-[14px] leading-6 text-muted">{text}</p>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
        <Link href="/products" className="btn btn-text text-[14px]">
          Shop all
        </Link>
        <Link href="/contact" className="btn btn-text text-[14px]">
          Contact us
        </Link>
      </div>
    </div>
  );
}
