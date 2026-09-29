import type {
  League,
  Match,
  MatchFeatures,
  MatchStatus,
  Prediction,
  Recommendation,
  RecommendationHistoryResponse,
  RiskLevel,
  Team,
  TeamSeasonStats,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new ApiError(response.status, `${response.status} ${response.statusText} — ${path}`);
  }
  return response.json() as Promise<T>;
}

export function getLeagues(): Promise<League[]> {
  return request("/leagues");
}

export function getTeams(leagueId?: number): Promise<Team[]> {
  return request("/teams", { league_id: leagueId });
}

export function getLeagueSeasons(leagueId: number): Promise<string[]> {
  return request(`/leagues/${leagueId}/seasons`);
}

export function getLeagueSeasonStats(leagueId: number, season?: string): Promise<TeamSeasonStats[]> {
  return request(`/leagues/${leagueId}/season-stats`, { season });
}

export function getTeamSeasonStats(teamId: number, season?: string): Promise<TeamSeasonStats> {
  return request(`/teams/${teamId}/season-stats`, { season });
}

/** Como getTeamSeasonStats, pero null en vez de lanzar cuando el equipo
 * todavia no tiene partidos jugados (ej. recien ascendido): no es un error,
 * es un dato que simplemente no existe todavia. */
export async function getTeamSeasonStatsOrNull(
  teamId: number,
  season?: string,
): Promise<TeamSeasonStats | null> {
  try {
    return await getTeamSeasonStats(teamId, season);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export interface MatchFilters {
  league_id?: number;
  season?: string;
  status?: MatchStatus;
  team_id?: number;
  limit?: number;
  offset?: number;
}

export function getMatches(filters: MatchFilters = {}): Promise<Match[]> {
  return request("/matches", { ...filters });
}

export function getMatch(matchId: number): Promise<Match> {
  return request(`/matches/${matchId}`);
}

export function getMatchStats(matchId: number, numMatches = 5): Promise<MatchFeatures> {
  return request(`/matches/${matchId}/stats`, { num_matches: numMatches });
}

export function getMatchPredictions(matchId: number): Promise<Prediction[]> {
  return request(`/matches/${matchId}/predictions`);
}

export interface RecommendationFilters {
  league_id?: number;
  market?: string;
  risk_level?: RiskLevel;
  min_ev?: number;
  limit?: number;
}

export function getRecommendations(filters: RecommendationFilters = {}): Promise<Recommendation[]> {
  return request("/recommendations", { ...filters });
}

export interface RecommendationHistoryFilters {
  league_id?: number;
  market?: string;
  limit?: number;
}

export function getRecommendationHistory(
  filters: RecommendationHistoryFilters = {},
): Promise<RecommendationHistoryResponse> {
  return request("/recommendations/history", { ...filters });
}

export { ApiError };
