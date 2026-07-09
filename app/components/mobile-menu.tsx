"use client";

import { useEffect, useState } from "react";

import { mainMenu } from "./data";

export default function MobileMenu({
  open,
  user,
  setOpen,
  logoUrl = "/Brand Kit/Logo-1.png",
}) {
  const [openSection, setOpenSection] = useState(null);

  useEffect(() => {
    if (!open) {
      setOpenSection(null);
    }
  }, [open]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[2998] bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed right-0 top-0 z-[2999] flex h-full w-full max-w-none flex-col bg-[#ffffff] shadow-[0_30px_90px_rgba(48,56,57,0.22)] transition-transform duration-300 lg:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex h-full flex-col overflow-x-hidden overflow-y-auto px-6 py-6 sm:px-7">
          <div className="mb-8 flex items-center justify-between gap-4">
            <img
              src={logoUrl}
              alt="Husnalogy logo"
              className="h-10 w-auto object-contain"
            />

            <button
              type="button"
              onClick={() => setOpen(false)}
              data-shape="round"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-black transition hover:bg-[#E6E6E6] active:bg-[#E6E6E6]"
              aria-label="Close menu"
            >
              <MenuIcon name="close" />
            </button>
          </div>

          <nav className="flex flex-col gap-2 text-[#303839]" aria-label="Mobile Navigation">
            {mainMenu.map((item) => {
              const isSectionOpen = openSection === item.label;
              const sectionId = `mobile-menu-${item.label.toLowerCase().replace(/\s+/g, "-")}`;

              return item.children ? (
                <div key={item.label} className="pb-1">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenSection(isSectionOpen ? null : item.label);
                    }}
                    className="flex w-full items-center gap-3 rounded-[12px] px-4 py-4 text-left transition hover:bg-[#E6E6E6] active:bg-[#E6E6E6]"
                    aria-expanded={isSectionOpen}
                    aria-controls={sectionId}
                  >
                    <span className="flex-1 text-[15px] font-semibold tracking-[0.01em]">
                      {item.label}
                    </span>
                    <MenuIcon
                      name="chevron"
                      className={`transition duration-200 ${isSectionOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  <div
                    id={sectionId}
                    className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
                      isSectionOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="min-h-0">
                      <div className="mb-2 mt-1 grid gap-1 rounded-[14px] bg-white p-2 shadow-[inset_0_0_0_1px_rgba(48,56,57,0.04)]">
                        <a
                          href={item.href}
                          onClick={() => {
                            setOpenSection(null);
                            setOpen(false);
                          }}
                          className="flex items-center justify-between rounded-[10px] px-3.5 py-3 text-[13px] font-semibold text-[#303839] transition hover:bg-[#E6E6E6] active:bg-[#E6E6E6]"
                        >
                          <span>Shop All {item.label}</span>
                          <MenuIcon name="arrow" />
                        </a>

                        {item.children.map((child) => (
                          <a
                            key={`${child.href}-${child.title}`}
                            className="flex items-center justify-between rounded-[10px] px-3.5 py-3 text-[13px] font-medium text-[#303839]/72 transition hover:bg-[#E6E6E6] hover:text-[#303839] active:bg-[#E6E6E6]"
                            href={child.href}
                            onClick={() => {
                              setOpenSection(null);
                              setOpen(false);
                            }}
                          >
                            <span>{child.title}</span>
                            <MenuIcon name="arrow" />
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <a
                  key={item.label}
                  className="flex items-center gap-3 rounded-[12px] px-4 py-4 text-[#303839] transition hover:bg-[#E6E6E6] active:bg-[#E6E6E6]"
                  href={item.href}
                  onClick={() => {
                    setOpenSection(null);
                    setOpen(false);
                  }}
                >
                  <span className="text-[15px] font-semibold tracking-[0.01em]">
                    {item.label}
                  </span>
                </a>
              );
            })}
          </nav>

          <div className="mt-auto pt-8">
            {user?.role === "admin" && (
              <a
                href="/admin/dashboard"
                onClick={() => setOpen(false)}
                className="block w-full rounded-[14px] bg-white px-6 py-4 text-center text-sm font-semibold text-[#303839] shadow-[inset_0_0_0_1px_rgba(48,56,57,0.08)] transition hover:bg-[#E6E6E6] active:bg-[#E6E6E6]"
              >
                Admin Dashboard
              </a>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function MenuIcon({ name, className = "" }) {
  const base: any = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    width: 18,
    height: 18,
    className: className || undefined,
    "aria-hidden": "true",
  };

  switch (name) {
    case "close":
      return (
        <svg {...base} width={21} height={21} strokeWidth={2.4}>
          <path d="m6 6 12 12" />
          <path d="m18 6-12 12" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...base} width={16} height={16}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "arrow":
      return (
        <svg
          {...base}
          width={11}
          height={11}
          className={`transition duration-200 opacity-90 rotate-[270deg] ${className}`.trim()}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "bag":
      return (
        <svg {...base}>
          <path d="M6 8h12l1 12H5L6 8Z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case "heart":
      return (
        <svg {...base}>
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z" />
        </svg>
      );
    case "user":
      return (
        <svg {...base}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    default:
      return null;
  }
}
