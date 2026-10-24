import { useEffect } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import {
  getMatch,
  getMatchHistory,
  getMatchPredictions,
  getMatchRecent,
  getMatchStats,
  getTeamSeasonStatsOrNull,
} from "../api/client";
import { MatchdayCarousel } from "../components/MatchdayCarousel";
import { PredictionsTable } from "../components/PredictionsTable";
import { ProbablePicks } from "../components/ProbablePicks";
import { HeadToHead, RecentMatches } from "../components/RecentMatches";
import { RefereePanel } from "../components/RefereePanel";
import { SeasonStatsSummary } from "../components/SeasonStatsSummary";
import { SectionNav } from "../components/SectionNav";
import { ErrorView, LoadingView } from "../components/StatusView";
import { StatsPanel } from "../components/StatsPanel";
import { TeamCrest } from "../components/TeamCrest";
import { formatDateTime, formatMatchday, formatSeason } from "../lib/format";
import { CHAMPIONS_LEAGUE_CODE, leagueName, useSelectedLeagueCode } from "../lib/leagues";
import { useApi } from "../lib/useApi";

/** Accesos directos bajo la cabecera, a cada bloque de la ficha (sus textos,
 * en matches:detail.section.<clave>). `short`: en movil, para que quepan en
 * dos filas. */
const SECTIONS = [
  { id: "forma", key: "form" },
  { id: "h2h", key: "h2h" },
  { id: "arbitro", key: "referee" },
  { id: "picks", key: "picks" },
  { id: "probabilidades", key: "probabilities" },
  { id: "otros-partidos", key: "otherMatches" },
];

export function MatchDetailPage() {
  const { t } = useTranslation();
  const { matchId } = useParams<{ matchId: string }>();
  const [, setLeagueCode] = useSelectedLeagueCode();
  const id = Number(matchId);

  // Al abrir otro partido (por ejemplo, desde el carrusel del final), arriba.
  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [id]);

  const { data: match, loading: loadingMatch, error: matchError } = useApi(() => getMatch(id), [id]);
  const { data: stats, loading: loadingStats, error: statsError } = useApi(
    () => getMatchStats(id),
    [id],
  );
  const {
    data: predictions,
    loading: loadingPredictions,
    error: predictionsError,
  } = useApi(() => getMatchPredictions(id), [id]);
  // Partidos de la liga anteriores a este: patrones de los equipos y lo
  // habitual en la liga (picks muy probables y hechos del arbitro).
  const history = useApi(() => getMatchHistory(id), [id]);
  // Los partidos de la forma y los enfrentamientos directos, uno a uno.
  const recent = useApi(() => getMatchRecent(id), [id]);
  const { data: seasonStats, loading: loadingSeasonStats } = useApi(
    () =>
      match
        ? Promise.all([
            getTeamSeasonStatsOrNull(match.home_team_id),
            getTeamSeasonStatsOrNull(match.away_team_id),
          ])
        : Promise.resolve(null),
    [match?.home_team_id, match?.away_team_id],
  );

  if (loadingMatch) return <LoadingView label={t("matches:detail.loading")} />;
  if (matchError || !match) return <ErrorView message={t("matches:detail.error", { error: matchError })} />;

  const played = match.status === "historical";
  // Sin cuotas de mercado (la Champions: Football-Data.co.uk no la cubre), ni EV ni «Valor».
  const marketOdds = match.league_code !== CHAMPIONS_LEAGUE_CODE;

  return (
    <div>
      <Link to="/partidos" className="back-link">
        {t("matches:detail.back")}
      </Link>

      <p className="match-meta">
        {[
          leagueName(match.league_code),
          t("matches:detail.season", { season: formatSeason(match.season) }),
          formatMatchday(match.matchday, match.league_code),
        ]
          .filter(Boolean)
          .map((part) => (
            <span key={part} className="match-meta-chip">
              {part}
            </span>
          ))}
        <span className="match-meta-chip is-date">{formatDateTime(match.date)}</span>
      </p>

      {/* Los escudos son los protagonistas de la cabecera. */}
      <h1 className="match-hero">
        <span className="match-hero-team">
          <TeamCrest team={match.home_team} league={match.league_code} size="xl" eager />
          <span className="match-hero-name">{match.home_team}</span>
        </span>{" "}
        <span className={played ? "match-hero-score" : "match-hero-score match-hero-vs"}>
          {played ? `${match.home_goals} - ${match.away_goals}` : "vs"}
        </span>{" "}
        <span className="match-hero-team">
          <TeamCrest team={match.away_team} league={match.league_code} size="xl" eager />
          <span className="match-hero-name">{match.away_team}</span>
        </span>
      </h1>

      <SectionNav
        label={t("matches:detail.sectionsLabel")}
        sections={SECTIONS.filter((s) => s.id !== "otros-partidos" || match.matchday !== null).map((s) => {
          const key = s.id === "probabilidades" && !marketOdds ? "probabilitiesOnly" : s.key;
          return {
            id: s.id,
            label: t(`matches:detail.section.${key}.label`),
            short: t(`matches:detail.section.${key}.short`),
          };
        })}
      />

      <section className="detail-section" id="forma">
        {loadingStats && <LoadingView label={t("matches:detail.statsLoading")} />}
        {statsError && <ErrorView message={t("matches:detail.statsError", { error: statsError })} />}
        {stats && (
          <StatsPanel
            features={stats}
            homeTeam={match.home_team}
            awayTeam={match.away_team}
            league={match.league_code}
          />
        )}
        {recent.loading && <LoadingView label={t("matches:detail.recentLoading")} />}
        {recent.error && <ErrorView message={t("matches:detail.recentError", { error: recent.error })} />}
        {recent.data && <RecentMatches match={match} recent={recent.data} />}
      </section>

      <section className="detail-section" id="h2h">
        <h2>{t("matches:detail.h2hTitle")}</h2>
        {recent.loading && <LoadingView label={t("matches:detail.h2hLoading")} />}
        {recent.error && <ErrorView message={t("matches:detail.h2hError", { error: recent.error })} />}
        {recent.data && <HeadToHead match={match} recent={recent.data} />}
      </section>

      <section className="detail-section">
        <h2>{t("matches:detail.seasonTitle")}</h2>
        {loadingSeasonStats && <LoadingView label={t("matches:detail.seasonLoading")} />}
        {seasonStats && (
          <SeasonStatsSummary
            homeStats={seasonStats[0]}
            awayStats={seasonStats[1]}
            homeTeam={match.home_team}
            awayTeam={match.away_team}
            leagueId={match.league_id}
            league={match.league_code}
          />
        )}
      </section>

      <section className="detail-section" id="arbitro">
        <h2>
          {match.referee ? (
            <Trans
              i18nKey="matches:detail.refereeNamed"
              values={{ name: match.referee }}
              components={{
                link: (
                  <Link
                    to={`/arbitros?arbitro=${encodeURIComponent(match.referee)}`}
                    onClick={() => setLeagueCode(match.league_code)}
                    title={t("matches:detail.refereeLinkTitle")}
                  />
                ),
              }}
            />
          ) : (
            t("matches:detail.referee")
          )}
        </h2>
        <RefereePanel match={match} history={history.data?.matches} />
      </section>

      {/* Justo antes del modelo: primero lo que se ha repetido, despues lo que
          estima el modelo para 1X2, más/menos 2.5 y ambos marcan. */}
      <section className="detail-section" id="picks">
        <h2>{t("matches:detail.picksTitle")}</h2>
        <ProbablePicks match={match} history={history.data} loading={history.loading} error={history.error} />
      </section>

      <section className="detail-section" id="probabilidades">
        {marketOdds ? (
          <>
            <h2>{t("matches:detail.probabilitiesTitle")}</h2>
            <p className="muted">{t("matches:detail.probabilitiesNote")}</p>
          </>
        ) : (
          <>
            <h2>{t("matches:detail.probabilitiesOnlyTitle")}</h2>
            <p className="muted">{t("matches:detail.probabilitiesOnlyNote")}</p>
          </>
        )}
        {loadingPredictions && <LoadingView label={t("matches:detail.predictionsLoading")} />}
        {predictionsError && <ErrorView message={t("matches:detail.predictionsError", { error: predictionsError })} />}
        {predictions && (
          <PredictionsTable
            predictions={predictions}
            homeTeam={match.home_team}
            awayTeam={match.away_team}
            marketOdds={marketOdds}
          />
        )}
      </section>

      <MatchdayCarousel key={match.id} match={match} />
    </div>
  );
}
