import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
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
  return (
    <Routes>
      {/* La portada va sin el sidebar: es un escaparate, no la herramienta. */}
      <Route index element={<LandingPage />} />
      <Route element={<Layout />}>
        <Route path="partidos" element={<MatchesPage />} />
        <Route path="matches/:matchId" element={<MatchDetailPage />} />
        <Route path="stats" element={<SeasonStatsPage />} />
        <Route path="mercados" element={<MarketPage />} />
        <Route path="mercados/:slug" element={<MarketPage />} />
        <Route path="arbitros" element={<RefereePage />} />
        <Route path="picks" element={<PicksPage />} />
        <Route path="picks-probables" element={<PicksHistoryPage />} />
        <Route path="rachas" element={<StreaksPage />} />
        <Route path="recommendations" element={<RecommendationsPage />} />
        <Route path="mis-apuestas" element={<MyBetsPage />} />
        <Route path="glosario" element={<GlossaryPage />} />
      </Route>
    </Routes>
  );
}

export default App;
