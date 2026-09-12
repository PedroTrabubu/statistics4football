import { NavLink, Outlet } from "react-router-dom";

export function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <span className="app-title">⚽ Stadistics4bet</span>
          <nav className="app-nav">
            <NavLink to="/" end>
              Partidos
            </NavLink>
            <NavLink to="/recommendations">Recomendaciones</NavLink>
          </nav>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
