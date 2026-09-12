import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { MatchDetailPage } from "./pages/MatchDetailPage";
import { MatchesPage } from "./pages/MatchesPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MatchesPage />} />
        <Route path="matches/:matchId" element={<MatchDetailPage />} />
        <Route path="recommendations" element={<RecommendationsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
