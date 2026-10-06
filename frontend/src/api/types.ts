export type MatchStatus = "historical" | "scheduled";
export type RiskLevel = "low" | "medium" | "high";

export interface League {
  id: number;
  code: string;
  name: string;
  country: string | null;
}

export interface Team {
  id: number;
  name: string;
  league_id: number | null;
}

export interface Match {
  id: number;
  date: string;
  status: MatchStatus;
  league_id: number;
  league_code: string;
  season: string;
  home_team_id: number;
  away_team_id: number;
  home_team: string;
  away_team: string;
  home_goals: number | null;
  away_goals: number | null;
  home_ht_goals: number | null;
  away_ht_goals: number | null;
  referee: string | null;
}

export interface TeamMatchStats {
  corners: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  fouls: number | null;
  shots: number | null;
  shots_on_target: number | null;
}

export type RefereeScope = "season" | "all";

/** GET /matches/{id}/referee-stats: partidos previos del arbitro y de cada equipo. */
export interface MatchRefereeStats {
  referee: string | null;
  referee_scope: RefereeScope;
  referee_matches: MatchResult[];
  home_matches: MatchResult[];
  away_matches: MatchResult[];
}

/** Partido jugado con las stats de cada equipo (GET /leagues/{id}/results). */
export interface MatchResult extends Match {
  home_stats: TeamMatchStats | null;
  away_stats: TeamMatchStats | null;
}

export interface TeamForm {
  matches_played: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  points_per_game: number | null;
  goal_difference: number;
}

export interface HeadToHead {
  matches_played: number;
  team_a_wins: number;
  team_b_wins: number;
  draws: number;
  team_a_goals: number;
  team_b_goals: number;
}

export interface XgForm {
  matches_with_data: number;
  avg_xg_for: number | null;
  avg_xg_against: number | null;
}

export interface DisciplineForm {
  matches_with_data: number;
  avg_corners_for: number | null;
  avg_corners_against: number | null;
  avg_yellow_cards: number | null;
  avg_red_cards: number | null;
}

export interface MatchFeatures {
  home_form: TeamForm;
  away_form: TeamForm;
  h2h: HeadToHead;
  home_xg_form: XgForm;
  away_xg_form: XgForm;
  home_discipline: DisciplineForm;
  away_discipline: DisciplineForm;
  home_elo: number | null;
  away_elo: number | null;
}

export interface Prediction {
  market: string;
  selection: string;
  // null cuando el partido aun no tiene cuotas ingeridas (fixtures futuros):
  // prob_model sigue siendo una probabilidad real (Dixon-Coles), solo que sin
  // comparacion contra mercado.
  prob_market_implied: number | null;
  prob_model: number;
  ev: number | null;
  confidence: number;
  risk_level: RiskLevel;
  is_recommended: boolean;
  matches_used: number;
}

export interface SplitStats {
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  points_per_game: number | null;
  goals_for: number;
  goals_against: number;
  goals_for_avg: number | null;
  goals_against_avg: number | null;
  over_1_5_pct: number | null;
  over_2_5_pct: number | null;
  over_3_5_pct: number | null;
  btts_pct: number | null;
  clean_sheet_pct: number | null;
  failed_to_score_pct: number | null;
  matches_with_corners: number;
  corners_for_avg: number | null;
  corners_against_avg: number | null;
  matches_with_ht: number;
  ht_over_0_5_pct: number | null;
  ht_win_pct: number | null;
  matches_with_cards: number;
  yellow_for_avg: number | null;
  yellow_against_avg: number | null;
}

export type FormResult = "W" | "D" | "L";

export interface TeamSeasonStats {
  team_id: number;
  team_name: string;
  season: string;
  overall: SplitStats;
  home: SplitStats;
  away: SplitStats;
  /** Ultimos 5 partidos de la temporada (local o visitante). */
  last5: SplitStats;
  /** Resultados de esos partidos, del mas antiguo al mas reciente. */
  form: FormResult[];
}

export interface Recommendation {
  match_id: number;
  date: string;
  league_code: string;
  home_team: string;
  away_team: string;
  market: string;
  selection: string;
  prob_market_implied: number;
  prob_model: number;
  /** null en mercados sin cuota real (estrategia "alta probabilidad"). */
  ev: number | null;
  confidence: number;
  risk_level: RiskLevel;
  matches_used: number;
}

/** "valor": EV contra la cuota (Dixon-Coles). "alta_probabilidad": modelo de patrones. */
export type RecommendationStrategy = "valor" | "alta_probabilidad";

export type RecommendationOutcome = "won" | "lost" | "pending";

export interface RecommendationHistoryItem {
  match_id: number;
  date: string;
  league_code: string;
  home_team: string;
  away_team: string;
  home_goals: number;
  away_goals: number;
  market: string;
  selection: string;
  prob_market_implied: number | null;
  prob_model: number;
  ev: number | null;
  matches_used: number;
  outcome: RecommendationOutcome;
  pnl_units: number | null;
}

export interface RecommendationHistoryBreakdown {
  key: string;
  total: number;
  won: number;
  lost: number;
  pending: number;
  hit_rate: number | null;
  /** Probabilidad media que el mercado daba a esas mismas selecciones. */
  market_expected_hit_rate: number | null;
  /** Selecciones con cuota real: el ROI solo se calcula sobre estas. */
  with_odds: number;
  pnl_units: number;
  roi: number | null;
}

export interface RecommendationHistorySummary {
  total: number;
  won: number;
  lost: number;
  pending: number;
  hit_rate: number | null;
  /** Probabilidad media que el mercado daba a esas mismas selecciones. */
  market_expected_hit_rate: number | null;
  /** Selecciones con cuota real: el ROI solo se calcula sobre estas. */
  with_odds: number;
  pnl_units: number;
  roi: number | null;
}

export interface RecommendationHistoryResponse {
  summary: RecommendationHistorySummary;
  by_market: RecommendationHistoryBreakdown[];
  items: RecommendationHistoryItem[];
}

/** Picks (combinadas). Ver docs/PICKS_PROTOCOLO.md. */
export type PickOddsKind = "real" | "derivada" | "estimada";
export type PickKind = "segura" | "fiable" | "media" | "alta" | "bomba" | "mismo_partido";

export interface PickLeg {
  match_id: number;
  date: string;
  league_code: string;
  home_team: string;
  away_team: string;
  market: string;
  selection: string;
  line: number | null;
  family: string;
  prob: number;
  odds: number;
  odds_kind: PickOddsKind;
  outcome: RecommendationOutcome;
  /** Dato real "local-visitante" con el que se resuelve (goles, córners o amarillas). */
  actual: string | null;
}

export interface PickCombo {
  id: number;
  source: "backtest" | "live";
  window: string;
  scope: string;
  kind: PickKind;
  prob: number;
  odds: number;
  odds_kind: "real" | "estimada";
  outcome: RecommendationOutcome;
  legs: PickLeg[];
}

export interface PicksUpcoming {
  window: string | null;
  combos: PickCombo[];
}

export interface PickKindSummary {
  kind: PickKind;
  total: number;
  won: number;
  lost: number;
  pending: number;
  hit_rate: number | null;
  predicted_hit_rate: number | null;
  avg_odds: number | null;
  roi_shown_odds: number | null;
}

export interface PicksHistory {
  summary: PickKindSummary[];
  combos: PickCombo[];
}
