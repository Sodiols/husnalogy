"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

import TopBar from "./topbar";
import Header from "./navbar";
import Footer from "./footer";
import MaintenanceScreen from "./maintenance";

import useAuth from "../lib/useAuth";

const MobileMenu = dynamic(() => import("./mobile-menu"), { ssr: false });
const SidePanel = dynamic(() => import("./side-panel"), { ssr: false });
const AuthModal = dynamic(() => import("./auth-modal"), { ssr: false });
const AskLogy = dynamic(() => import("./logy"), { ssr: false });

export default function SiteShell({ children, initialUser, initialSettings = null }) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin");

  // Seed with the settings the server resolved for this request so SSR and the
  // first client render are identical (no hydration mismatch), and maintenance
  // mode is honored server-side with no flash. The effect below refreshes from
  // the API to pick up changes without a reload.
  const [siteSettings, setSiteSettings] = useState(initialSettings);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidePanel, setSidePanel] = useState(null);
  const [askOpen, setAskOpen] = useState(false);

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");

  const [desktopDropdown, setDesktopDropdown] = useState(false);

  const { user } = useAuth(initialUser);

  useEffect(() => {
    if (isAdminRoute) return undefined;

    let cancelled = false;

    async function loadSettings() {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));

        if (!cancelled && response.ok && data?.settings) {
          setSiteSettings(data.settings);
        }
      } catch (error) {
        console.error("Could not load site settings:", error);
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, [isAdminRoute]);

  useEffect(() => {
    const faviconUrl = siteSettings?.branding?.faviconUrl;
    if (!faviconUrl || typeof document === "undefined") return;

    function upsertIcon(rel) {
      let link: any = document.querySelector(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = faviconUrl;
    }

    upsertIcon("icon");
    upsertIcon("shortcut icon");
    upsertIcon("apple-touch-icon");
  }, [siteSettings?.branding?.faviconUrl]);

  useEffect(() => {
    document.body.classList.toggle(
      "menu-open",
      Boolean(menuOpen || sidePanel || authOpen)
    );

    return () => {
      document.body.classList.remove("menu-open");
    };
  }, [menuOpen, sidePanel, authOpen]);

  useEffect(() => {
    function openAuthFromEvent(event) {
      openAuth(event?.detail?.mode || "login");
    }

    window.addEventListener("husnalogy-open-auth", openAuthFromEvent);

    return () => {
      window.removeEventListener("husnalogy-open-auth", openAuthFromEvent);
    };
  }, []);

  useEffect(() => {
    function closeWithEscape(event) {
      if (event.key !== "Escape") return;

      setMenuOpen(false);
      setSidePanel(null);
      setAuthOpen(false);
      setAskOpen(false);
      setDesktopDropdown(false);
    }

    document.addEventListener("keydown", closeWithEscape);

    return () => {
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);

  function openAuth(mode = "login") {
    setAuthMode(mode);
    setAuthOpen(true);
    setMenuOpen(false);
    setDesktopDropdown(false);
  }

  if (isAdminRoute) {
    return <>{children}</>;
  }

  const logoUrl = siteSettings?.branding?.logoUrl || "/Brand Kit/Logo-5.png";
  const storeName = siteSettings?.store?.name || "Husnalogy";
  const storeTagline = siteSettings?.store?.tagline || "Timeless Invitations & Gifts";

  if (siteSettings?.preferences?.maintenanceMode) {
    return <MaintenanceScreen storeName={storeName} storeTagline={storeTagline} />;
  }

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[4000] focus:rounded-none focus:bg-black focus:px-5 focus:py-3 focus:text-white"
      >
        Skip to content
      </a>

      <TopBar />

      <Header
        user={user}
        openAuth={openAuth}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        setSidePanel={setSidePanel}
        desktopDropdown={desktopDropdown}
        setDesktopDropdown={setDesktopDropdown}
        logoUrl={logoUrl}
      />

      {user?.role === "admin" && (
        <a
          href="/admin/dashboard"
          className="fixed bottom-[76px] left-5 z-[2350] rounded-none bg-[#303839] px-6 py-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-white shadow-[0_18px_45px_rgba(0,0,0,0.22)] transition-all duration-300 hover:scale-[1.02] sm:left-6 sm:px-7 sm:py-3.5 lg:bottom-6"
        >
          Admin
        </a>
      )}

      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {menuOpen && (
        <MobileMenu
          open={menuOpen}
          user={user}
          setOpen={setMenuOpen}
          logoUrl={logoUrl}
        />
      )}

      <main id="main">{children}</main>

      <AskLogy askOpen={askOpen} setAskOpen={setAskOpen} />

      <Footer />

      {sidePanel && (
        <SidePanel type={sidePanel} setType={setSidePanel} user={user} openAuth={openAuth} />
      )}

      {authOpen && (
        <AuthModal
          open={authOpen}
          setOpen={setAuthOpen}
          mode={authMode}
          setMode={setAuthMode}
        />
      )}
    </>
  );
}
