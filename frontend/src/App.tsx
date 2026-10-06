import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { GlossaryPage } from "./pages/GlossaryPage";
import { MarketPage, RefereePage } from "./pages/MarketPage";
import { MatchDetailPage } from "./pages/MatchDetailPage";
import { MatchesPage } from "./pages/MatchesPage";
import { PicksPage } from "./pages/PicksPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { SeasonStatsPage } from "./pages/SeasonStatsPage";

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MatchesPage />} />
        <Route path="matches/:matchId" element={<MatchDetailPage />} />
        <Route path="stats" element={<SeasonStatsPage />} />
        <Route path="mercados" element={<MarketPage />} />
        <Route path="mercados/:slug" element={<MarketPage />} />
        <Route path="arbitros" element={<RefereePage />} />
        <Route path="picks" element={<PicksPage />} />
        <Route path="recommendations" element={<RecommendationsPage />} />
        <Route path="glosario" element={<GlossaryPage />} />
      </Route>
    </Routes>
  );
}

export default App;
