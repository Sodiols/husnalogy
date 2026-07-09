import Link from "next/link";

/**
 * Breadcrumbs
 * Zazzle-style breadcrumb trail for the product detail page:
 * Home / Products / [Category] / [Product Title]
 *
 * Degrades gracefully if a product has no category.
 */
export default function Breadcrumbs({ product }) {
  const trail = [
    { label: "Home", href: "/" },
    { label: "Products", href: "/products" },
  ];

  if (product?.category) {
    trail.push({
      label: product.category,
      href: `/products?category=${encodeURIComponent(product.category)}`,
    });
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="mx-auto mb-5 max-w-[1480px] text-[#303839]"
    >
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[#303839]/55">
        {trail.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-x-1.5">
            <Link
              href={crumb.href}
              className="transition hover:text-[#303839] hover:underline"
            >
              {crumb.label}
            </Link>
            <span aria-hidden="true" className="text-[#303839]/30">
              /
            </span>
          </li>
        ))}

        {product?.title && (
          <li aria-current="page" className="max-w-full truncate text-[#303839]/80">
            {product.title}
          </li>
        )}
      </ol>
    </nav>
  );
}
