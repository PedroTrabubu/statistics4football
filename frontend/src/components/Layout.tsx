import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { IconBook, IconMatches, IconMenu, IconStats, IconTarget } from "./icons";

const NAV_ITEMS = [
  { to: "/", label: "Partidos", end: true, icon: IconMatches },
  { to: "/stats", label: "Estadísticas", end: false, icon: IconStats },
  { to: "/recommendations", label: "Recomendaciones", end: false, icon: IconTarget },
  { to: "/glosario", label: "Glosario", end: false, icon: IconBook },
];

export function Layout() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
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

          <div className="sidebar-footer">
            <p>Análisis estadístico de fútbol. No es una casa de apuestas.</p>
          </div>
        </aside>

        {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />}

        <div className="app-content">
          <main className="app-main">
            <Outlet />
          </main>

          <footer className="app-footer">
            <div className="app-footer-inner">
              <p className="small muted">
                Statistics 4 Bets muestra estadísticas históricas de fútbol para analizar mercados de apuestas. No son
                predicciones garantizadas ni recomendaciones de apuesta.
              </p>
              <p className="small muted">
                Juega con control. Si el juego deja de ser un entretenimiento, busca ayuda en{" "}
                <a href="https://www.jugarbien.es" target="_blank" rel="noreferrer">
                  jugarbien.es
                </a>
                . Prohibido a menores de 18 años.
              </p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
