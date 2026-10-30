import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LegacyRedirect } from "./components/LegacyRedirect";
import { LEGACY_PATTERNS, LEGACY_ROUTES } from "./lib/legacyRoutes";
import { ROUTES, ROUTE_PATTERNS } from "./lib/routes";
import { GlossaryPage } from "./pages/GlossaryPage";
import { LandingPage } from "./pages/LandingPage";
import { MarketPage, RefereePage } from "./pages/MarketPage";
import { MatchDetailPage } from "./pages/MatchDetailPage";
import { MatchesPage } from "./pages/MatchesPage";
import { MyBetsPage } from "./pages/MyBetsPage";
import { PicksHistoryPage } from "./pages/PicksHistoryPage";
import { PicksPage } from "./pages/PicksPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { SeasonStatsPage } from "./pages/SeasonStatsPage";
import { StreaksPage } from "./pages/StreaksPage";

function App() {
  // Al cambiar de idioma se vuelve a pintar toda la web: los textos de lib/
  // (mercados, picks, rachas...) salen del idioma actual al leerlos.
  useTranslation();
  return (
    <Routes>
      {/* La portada va sin el sidebar: es un escaparate, no la herramienta. */}
      <Route index element={<LandingPage />} />
      <Route path={ROUTES.football} element={<Navigate to={ROUTES.matches} replace />} />
      <Route element={<Layout />}>
        <Route path={ROUTES.matches} element={<MatchesPage />} />
        <Route path={ROUTE_PATTERNS.match} element={<MatchDetailPage />} />
        <Route path={ROUTES.standings} element={<SeasonStatsPage />} />
        <Route path={ROUTES.stats} element={<MarketPage />} />
        <Route path={ROUTE_PATTERNS.stat} element={<MarketPage />} />
        <Route path={ROUTES.referees} element={<RefereePage />} />
        <Route path={ROUTES.picks} element={<PicksPage />} />
        <Route path={ROUTES.probablePicks} element={<PicksHistoryPage />} />
        <Route path={ROUTES.streaks} element={<StreaksPage />} />
        <Route path={ROUTES.highProbability} element={<RecommendationsPage />} />
        <Route path={ROUTES.myBets} element={<MyBetsPage />} />
        <Route path={ROUTES.glossary} element={<GlossaryPage />} />
      </Route>
      {/* Las rutas antiguas (en español, sin /football) siguen valiendo. */}
      {[...Object.keys(LEGACY_ROUTES), ...LEGACY_PATTERNS].map((path) => (
        <Route key={path} path={path} element={<LegacyRedirect />} />
      ))}
    </Routes>
  );
}

export default App;
