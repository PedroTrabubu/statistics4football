import { useEffect, useState } from "react";
import { AppMark } from "./AppMark";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation, useMatch } from "react-router-dom";
import { MARKET_GROUPS, SIDEBAR_MARKETS, findMarket, marketGroupLabel } from "../lib/markets";
import { ROUTES, ROUTE_PATTERNS, marketFromUrl, statPath } from "../lib/routes";
import {
  IconBook,
  IconCheck,
  IconClose,
  IconMatches,
  IconMenu,
  IconStats,
  IconStreak,
  IconTarget,
  IconTicket,
  IconWallet,
} from "./icons";
import { LanguageSwitch } from "./LanguageSwitch";
import { SiteFooter } from "./SiteFooter";
import { ThemeSwitch } from "./ThemeSwitch";

/** `label`: clave de su texto en nav. */
const NAV_ITEMS = [
  { to: ROUTES.matches, label: "nav:matches", end: false, icon: IconMatches },
  { to: ROUTES.standings, label: "nav:standings", end: false, icon: IconStats },
  { to: ROUTES.picks, label: "nav:picks", end: false, icon: IconTicket },
  { to: ROUTES.probablePicks, label: "nav:probablePicks", end: false, icon: IconCheck },
  { to: ROUTES.streaks, label: "nav:streaks", end: false, icon: IconStreak },
  { to: ROUTES.highProbability, label: "nav:highProbability", end: false, icon: IconTarget },
  { to: ROUTES.myBets, label: "nav:myBets", end: false, icon: IconWallet },
  { to: ROUTES.glossary, label: "nav:glossary", end: false, icon: IconBook },
];

export function Layout() {
  const { t } = useTranslation();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const currentMarket = findMarket(marketFromUrl(useMatch(ROUTE_PATTERNS.stat)?.params.stat));

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // En el móvil el menú ocupa toda la pantalla: Escape también lo cierra.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="app-shell">
      {/* index.html lleva el titulo de la portada; React 19 sube este a <head>. */}
      <title>Statistics 4 Bets</title>
      <header className="app-navbar">
        <div className="app-navbar-inner">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={navOpen ? t("nav:closeMenu") : t("nav:openMenu")}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            {navOpen ? <IconClose /> : <IconMenu />}
          </button>
          <NavLink to={ROUTES.home} className="app-brand" end>
            <AppMark />
            <span className="app-title">Statistics 4 Bets</span>
          </NavLink>
          <div className="header-switches">
            <LanguageSwitch />
            <ThemeSwitch />
          </div>
          <span className="scroll-progress" aria-hidden="true" />
        </div>
      </header>

      <div className="app-body">
        {/* Cualquier enlace lo cierra, también el de la página en la que ya
            estás (la ruta no cambia y el menú se quedaba abierto). */}
        <aside
          className={navOpen ? "app-sidebar open" : "app-sidebar"}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setNavOpen(false);
          }}
        >
          <nav className="sidebar-nav">
            {NAV_ITEMS.map(({ to, label, end, icon: Icon }) => (
              <NavLink key={to} to={to} end={end} className="sidebar-link">
                <Icon className="sidebar-icon" />
                <span>{t(label)}</span>
              </NavLink>
            ))}
          </nav>

          {MARKET_GROUPS.map((group) => (
            <nav
              key={group}
              className="sidebar-nav sidebar-section"
              aria-label={t("nav:marketsGroup", { group: marketGroupLabel(group) })}
            >
              <p className="sidebar-heading">{marketGroupLabel(group)}</p>
              {SIDEBAR_MARKETS.filter((market) => market.group === group).map((market) => {
                // Una familia (Córners, Tarjetas...) queda activa en cualquiera de sus variantes.
                const active =
                  currentMarket !== undefined &&
                  (currentMarket.slug === market.slug ||
                    (market.family !== undefined && currentMarket.family?.key === market.family.key));
                return (
                  <NavLink
                    key={market.slug}
                    to={statPath(market.slug)}
                    className={active ? "sidebar-link sidebar-sublink active" : "sidebar-link sidebar-sublink"}
                  >
                    <span>{market.label}</span>
                  </NavLink>
                );
              })}
              {group === "stats" && (
                <NavLink to={ROUTES.referees} className="sidebar-link sidebar-sublink">
                  <span>{t("nav:referees")}</span>
                </NavLink>
              )}
            </nav>
          ))}

          <div className="sidebar-footer">
            <p>{t("legal:claim")}</p>
          </div>
        </aside>

        {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />}

        <div className="app-content">
          <main className="app-main">
            <Outlet />
          </main>

          <SiteFooter />
        </div>
      </div>
    </div>
  );
}
