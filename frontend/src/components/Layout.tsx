import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { MARKET_GROUPS, SIDEBAR_MARKETS, findMarket } from "../lib/markets";
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
import { SiteFooter } from "./SiteFooter";

const NAV_ITEMS = [
  { to: "/partidos", label: "Partidos", end: false, icon: IconMatches },
  { to: "/stats", label: "Clasificación", end: false, icon: IconStats },
  { to: "/picks", label: "Picks", end: false, icon: IconTicket },
  { to: "/picks-probables", label: "Picks probables", end: false, icon: IconCheck },
  { to: "/rachas", label: "Rachas", end: false, icon: IconStreak },
  { to: "/recommendations", label: "Recomendaciones", end: false, icon: IconTarget },
  { to: "/mis-apuestas", label: "Mis apuestas", end: false, icon: IconWallet },
  { to: "/glosario", label: "Glosario", end: false, icon: IconBook },
];

export function Layout() {
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
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={navOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <IconMenu />
        </button>
        <NavLink to="/" className="app-brand" end>
          <span className="app-mark">S4B</span>
          <span className="app-title">Statistics 4 Bets</span>
        </NavLink>
      </header>

      <div className="app-body">
        <aside className={navOpen ? "app-sidebar open" : "app-sidebar"}>
          <nav className="sidebar-nav">
            {NAV_ITEMS.map(({ to, label, end, icon: Icon }) => (
              <NavLink key={to} to={to} end={end} className="sidebar-link">
                <Icon className="sidebar-icon" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          {MARKET_GROUPS.map((group) => (
            <nav key={group} className="sidebar-nav sidebar-section" aria-label={`Mercados: ${group}`}>
              <p className="sidebar-heading">{group}</p>
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
              {group === "Estadísticas" && (
                <NavLink to="/arbitros" className="sidebar-link sidebar-sublink">
                  <span>Árbitros</span>
                </NavLink>
              )}
            </nav>
          ))}

          <div className="sidebar-footer">
            <p>Análisis estadístico de fútbol. No es una casa de apuestas.</p>
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
