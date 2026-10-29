import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { MARKET_GROUPS, SIDEBAR_MARKETS, findMarket, marketGroupLabel } from "../lib/markets";
import {
  IconBook,
  IconCheck,
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
  { to: "/partidos", label: "nav:matches", end: false, icon: IconMatches },
  { to: "/stats", label: "nav:standings", end: false, icon: IconStats },
  { to: "/picks", label: "nav:picks", end: false, icon: IconTicket },
  { to: "/picks-probables", label: "nav:probablePicks", end: false, icon: IconCheck },
  { to: "/rachas", label: "nav:streaks", end: false, icon: IconStreak },
  { to: "/alta-probabilidad", label: "nav:highProbability", end: false, icon: IconTarget },
  { to: "/mis-apuestas", label: "nav:myBets", end: false, icon: IconWallet },
  { to: "/glosario", label: "nav:glossary", end: false, icon: IconBook },
];

export function Layout() {
  const { t } = useTranslation();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const currentMarket = findMarket(location.pathname.match(/^\/mercados\/([^/]+)/)?.[1]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

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
            <IconMenu />
          </button>
          <NavLink to="/" className="app-brand" end>
            <span className="app-mark">S4B</span>
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
        <aside className={navOpen ? "app-sidebar open" : "app-sidebar"}>
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
                    to={`/mercados/${market.slug}`}
                    className={active ? "sidebar-link sidebar-sublink active" : "sidebar-link sidebar-sublink"}
                  >
                    <span>{market.label}</span>
                  </NavLink>
                );
              })}
              {group === "stats" && (
                <NavLink to="/arbitros" className="sidebar-link sidebar-sublink">
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
