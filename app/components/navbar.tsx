"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { mainMenu } from "./data";
import { subscribeToUserCart, subscribeToUserWishlist } from "../lib/customer-lists";

export default function Header({
  user,
  openAuth,
  menuOpen,
  setMenuOpen,
  setSidePanel,
  desktopDropdown,
  setDesktopDropdown,
  logoUrl = "/Brand Kit/Logo-5.png",
}) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [searchValue, setSearchValue] = useState("");
  const [cartCount, setCartCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);

  useEffect(() => {
    const unsubCart = subscribeToUserCart(user, (items) => {
      const count = Array.isArray(items)
        ? items.reduce((sum, item) => sum + Number(item.quantity || 1), 0)
        : 0;
      setCartCount(count);
    });
    const unsubWishlist = subscribeToUserWishlist(user, (items) => {
      setWishlistCount(Array.isArray(items) ? items.length : 0);
    });

    return () => {
      unsubCart && unsubCart();
      unsubWishlist && unsubWishlist();
    };
  }, [user]);

  const openProtectedPanel = (panelName) => {
    if (!user) {
      openAuth("login");
      return;
    }
    setSidePanel(panelName);
  };

  const handleAccount = () => {
    if (!user) {
      openAuth("login");
      return;
    }
    router.push("/account");
  };

  const submitSearch = (event) => {
    event.preventDefault();
    const query = searchValue.trim();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  };

  const submitMobileSearch = (event) => {
    event.preventDefault();
    const query = searchValue.trim();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  };

  return (
    <>
    <header className="sticky top-0 z-[2400] border-b border-line bg-white">
      <div className="page-container">
        <div className="flex h-[64px] items-center justify-between gap-4 lg:h-[72px]">
          <Link href="/" className="flex shrink-0 items-center" aria-label="Husnalogy Home">
            <img
              src={logoUrl}
              alt="Husnalogy"
              className="h-9 w-auto object-contain lg:h-11"
            />
          </Link>

          <form
            onSubmit={submitMobileSearch}
            role="search"
            className="flex min-w-0 flex-1 justify-end lg:hidden"
          >
            <div className="flex h-10 w-full max-w-[320px] items-center rounded-full border border-[#ccc] bg-white pl-4 pr-1 transition-colors duration-200 focus-within:border-[#303839]/60 focus-within:shadow-[0_0_0_2px_rgba(48,56,57,0.08)]">
              <input
                type="search"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search"
                aria-label="Search products"
                className="input-bare min-w-0 flex-1 bg-transparent px-0 py-1 text-[14px] text-[#303839] outline-none placeholder:text-[#303839]/70"
              />
              <button
                type="submit"
                data-shape="round"
                className="grid h-8 w-8 shrink-0 place-items-center text-[#303839] transition-colors duration-200 hover:bg-[#303839]/[0.06]"
                aria-label="Submit search"
              >
                <NavIcon name="search" className="h-4 w-4" />
              </button>
            </div>
          </form>

          <form
            onSubmit={submitSearch}
            role="search"
            className="hidden min-w-0 flex-1 lg:flex lg:justify-center lg:px-10"
          >
            <div className="flex h-11 w-full max-w-[760px] items-center rounded-full border border-[#ccc] bg-white pl-5 pr-1.5 transition-colors duration-200 focus-within:border-[#303839]/60 focus-within:shadow-[0_0_0_2px_rgba(48,56,57,0.08)]">
              <input
                type="search"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search invitations, suites and gifts"
                aria-label="Search products"
                className="input-bare min-w-0 flex-1 bg-transparent px-0 py-1.5 text-[15px] text-[#303839] outline-none placeholder:text-[#303839]/70"
              />
              <button
                type="submit"
                data-shape="round"
                className="grid h-9 w-9 shrink-0 place-items-center text-[#303839] transition-colors duration-200 hover:bg-[#303839]/[0.06]"
                aria-label="Submit search"
              >
                <NavIcon name="search" className="h-[17px] w-[17px]" />
              </button>
            </div>
          </form>

          <div className="hidden shrink-0 items-center lg:flex">
            <button
              type="button"
              onClick={() => openProtectedPanel("wishlist")}
              data-shape="round"
              className="relative grid h-11 w-11 place-items-center rounded-full text-[#303839] transition-colors duration-200 hover:bg-cream"
              aria-label="Open wishlist"
            >
              <NavIcon name="heart" size={20} />
              {wishlistCount > 0 && <CountBadge count={wishlistCount} />}
            </button>

            <button
              type="button"
              onClick={() => openProtectedPanel("cart")}
              data-shape="round"
              className="relative grid h-11 w-11 place-items-center rounded-full text-[#303839] transition-colors duration-200 hover:bg-cream"
              aria-label="Open cart"
            >
              <NavIcon name="bag" size={20} />
              {cartCount > 0 && <CountBadge count={cartCount} />}
            </button>

            <button
              type="button"
              onClick={handleAccount}
              data-shape="round"
              className="ml-1 flex h-11 items-center gap-2 rounded-full px-3 text-[#303839] transition-colors duration-200 hover:bg-cream"
              aria-label={user ? "My account" : "Open account login"}
            >
              <NavIcon name="user" size={20} />
              <span className="max-w-[120px] truncate text-[14px] font-semibold text-[#303839]">
                {user ? String(user.name || "").split(" ")[0] || "Account" : "Sign in"}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="hidden lg:block">
        <nav
          className="page-container flex h-[48px] items-stretch justify-center gap-1 xl:gap-2"
          aria-label="Main Navigation"
        >
            {mainMenu.map((item) => {
              const isDropdownOpen = desktopDropdown === item.label;
              const isWideDropdown = item.dropdownColumns === 2;
              const dropdownId = `desktop-menu-${item.label.toLowerCase().replace(/\s+/g, "-")}`;
              const isActiveParent = isActiveNavItem(pathname, item);
              const dropdownItems = item.children
                ? [
                    {
                      href: item.href,
                      title: `Shop all ${item.label.toLowerCase()}`,
                    },
                    ...item.children,
                  ]
                : [];

              return item.children ? (
                <div
                  key={item.label}
                  className="group relative flex h-full items-center"
                  onMouseEnter={() => setDesktopDropdown(item.label)}
                  onMouseLeave={() => setDesktopDropdown(false)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      setDesktopDropdown(false);
                    }
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setDesktopDropdown(isDropdownOpen ? false : item.label)}
                    className={`relative flex h-full items-center gap-1 bg-transparent px-3 text-[15px] font-semibold text-[#303839] transition-colors duration-200 after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:origin-left after:bg-[#303839] after:transition-transform after:duration-300 after:ease-out hover:text-[#303839] hover:after:scale-x-100 group-hover:after:scale-x-100 focus-visible:outline-none focus-visible:after:scale-x-100 xl:px-4 xl:after:left-4 xl:after:right-4 ${
                      isDropdownOpen || isActiveParent ? "after:scale-x-100" : "after:scale-x-0"
                    }`}
                    aria-haspopup="true"
                    aria-label={`${item.label} menu`}
                    aria-expanded={isDropdownOpen}
                    aria-controls={dropdownId}
                  >
                    {item.label}
                    <NavIcon
                      name="chevron"
                      size={11}
                      className={`transition duration-200 ${isDropdownOpen ? "rotate-180 opacity-90" : "opacity-50"}`}
                    />
                  </button>

                  <div
                    id={dropdownId}
                    className={`absolute left-0 top-full z-[2450] transition-all duration-200 ease-out ${
                      isWideDropdown ? "w-[520px]" : "w-60"
                    } ${
                      isDropdownOpen
                        ? "visible translate-y-0 opacity-100"
                        : "invisible translate-y-2 opacity-0"
                    }`}
                  >
                    <div className="relative overflow-hidden rounded-b-[10px] border border-line bg-white py-2 shadow-[var(--shadow-overlay)]">
                      <div className={isWideDropdown ? "grid grid-cols-2 gap-0" : "grid gap-0"}>
                        {dropdownItems.map((child) => (
                          <a
                            key={`${child.href}-${child.title}`}
                            href={child.href}
                            onClick={() => setDesktopDropdown(false)}
                            className="group/dropdown flex min-h-11 items-center justify-between gap-2 px-5 py-2 text-left text-[#303839] transition-colors duration-200 ease-out hover:bg-cream active:bg-cream focus-visible:bg-cream focus-visible:outline-none"
                          >
                            <span className="block text-[15px] font-medium text-[#303839]">
                              {child.title}
                            </span>
                            <span className="grid w-0 shrink-0 place-items-center overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover/dropdown:w-3.5 group-hover/dropdown:opacity-60">
                              <NavIcon name="arrow" size={14} />
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <a
                  key={item.label}
                  href={item.href}
                  className={`group relative flex h-full items-center px-3 text-[15px] font-semibold text-[#303839] transition-colors duration-200 after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:origin-left after:bg-[#303839] after:transition-transform after:duration-300 after:ease-out hover:text-[#303839] hover:after:scale-x-100 focus-visible:outline-none focus-visible:after:scale-x-100 xl:px-4 xl:after:left-4 xl:after:right-4 ${
                    isActiveParent ? "after:scale-x-100" : "after:scale-x-0"
                  }`}
                >
                  {item.label}
                </a>
              );
            })}
        </nav>
      </div>
    </header>

    {/* Mobile bottom navigation — hidden on desktop, and while the menu is
        open so it never floats above its scrim. */}
    <nav
      aria-label="Mobile navigation"
      className={`fixed inset-x-0 bottom-0 z-[2200] border-t border-line bg-white transition-transform duration-300 lg:hidden ${
        menuOpen ? "translate-y-full" : "translate-y-0"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-[520px] items-stretch justify-around">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex h-[60px] flex-1 items-center justify-center text-[#303839] transition-opacity duration-200 hover:opacity-75"
          aria-label="Open menu"
        >
          <NavIcon name="menu" size={22} />
        </button>

        <Link
          href="/"
          className="flex h-[60px] flex-1 items-center justify-center text-[#303839] transition-opacity duration-200 hover:opacity-75"
          aria-label="Home"
        >
          <NavIcon name="home" size={22} />
        </Link>

        <button
          type="button"
          onClick={() => openProtectedPanel("wishlist")}
          className="relative flex h-[60px] flex-1 items-center justify-center text-[#303839] transition-opacity duration-200 hover:opacity-75"
          aria-label="Open wishlist"
        >
          <NavIcon name="heart" size={22} />
          {wishlistCount > 0 && (
            <span className="absolute right-[24%] top-2.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-charcoal px-1 text-[10px] font-bold leading-none text-white">
              {wishlistCount > 99 ? "99+" : wishlistCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => openProtectedPanel("cart")}
          className="relative flex h-[60px] flex-1 items-center justify-center text-[#303839] transition-opacity duration-200 hover:opacity-75"
          aria-label="Open cart"
        >
          <NavIcon name="bag" size={22} />
          {cartCount > 0 && (
            <span className="absolute right-[24%] top-2.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-charcoal px-1 text-[10px] font-bold leading-none text-white">
              {cartCount > 99 ? "99+" : cartCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={handleAccount}
          className="flex h-[60px] flex-1 items-center justify-center text-[#303839] transition-opacity duration-200 hover:opacity-75"
          aria-label="My account"
        >
          <NavIcon name="user" size={22} />
        </button>
      </div>
    </nav>

    </>
  );
}

function CountBadge({ count }) {
  return (
    <span className="absolute right-1 top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#303839] px-[3px] text-[9px] font-semibold leading-none text-white ring-2 ring-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function isActiveNavItem(pathname, item) {
  const normalizedPath = normalizePath(pathname);
  // Child links that are search queries (/search?q=…) all share one path, so
  // they would mark every menu active on any search page; only real paths count.
  const hrefs = [item.href, ...(item.children || []).map((child) => child.href)].filter(
    (href) => href && !String(href).includes("?"),
  );

  return hrefs.some((href) => {
    const normalizedHref = normalizePath(href);
    return normalizedPath === normalizedHref || normalizedPath.startsWith(`${normalizedHref}/`);
  });
}

function normalizePath(value) {
  const path = String(value || "/").split("?")[0].replace(/\/+$/, "");
  return path || "/";
}

function NavIcon({ name, className = "", size }: any) {
  // One stroke weight for every header and tab-bar icon.
  const base: any = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };
  const iconProps = (defaultSize = 21) => ({
    ...base,
    width: size || defaultSize,
    height: size || defaultSize,
    className: className || undefined,
  });

  switch (name) {
    case "chevron":
      return (
        <svg {...iconProps(13)}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "arrow":
      return (
        <svg
          {...base}
          width={size || 11}
          height={size || 11}
          className={`transition duration-200 opacity-90 rotate-[270deg] ${className}`.trim() || undefined}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "search":
      return (
        <svg {...iconProps()}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "user":
      return (
        <svg {...iconProps()}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case "heart":
      return (
        <svg {...iconProps()}>
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z" />
        </svg>
      );
    case "bag":
      return (
        <svg {...iconProps()}>
          <path d="M6 8h12l1 12H5L6 8Z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case "menu":
      return (
        <svg {...iconProps(22)}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      );
    case "home":
      return (
        <svg {...iconProps()}>
          <path d="M4 11.5 12 4l8 7.5" />
          <path d="M6 10v10h5v-6h2v6h5V10" />
        </svg>
      );
    default:
      return null;
  }
}
