import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getLeagueResults, getLeagueSeasons, getLeagues, getUpcomingMatches } from "../api/client";
import type { Match } from "../api/types";
import { formatDateTime, formatSeason, withPercent } from "../lib/format";
import { defaultLeagueCode, leagueName } from "../lib/leagues";
import { findMarket, groupByTeam, hitRate, marketGroupLabel } from "../lib/markets";
import { matchPath, statPath } from "../lib/routes";
import { useApi } from "../lib/useApi";
import { useCountUp } from "../lib/useCountUp";
import { TeamCrest } from "./TeamCrest";

const MARKET_SLUG = "ambos-marcan";
const TEAMS_SHOWN = 3;
/** Cuadritos de racha por equipo (los partidos más recientes). */
const FORM_SHOWN = 9;

/** Tarjeta de la portada: la página de un mercado en pequeño, con datos
 * reales (los tres equipos con más "Ambos marcan" de la liga del idioma en la
 * temporada actual: LaLiga, Premier League o Ligue 1) y, flotando al lado, el próximo partido de esos tres. Enlaza a
 * esa página. Si la API falla, no se pinta. */
export function HeroPreview() {
  const { t } = useTranslation();
  const market = findMarket(MARKET_SLUG);
  // useTranslation vuelve a pintar al cambiar de idioma: la liga cambia con él.
  const code = defaultLeagueCode();
  const option = market?.options.find((o) => o.key === market.defaultOption) ?? market?.options[0];

  const data = useApi(async () => {
    if (!option) return null;
    const leagues = await getLeagues();
    const league = leagues.find((l) => l.code === code);
    if (!league) return null;
    const seasons = await getLeagueSeasons(league.id);
    const season = seasons[0];
    if (!season) return null;
    const results = await getLeagueResults(league.id, season);
    const groups = groupByTeam(results)
      .map((group) => ({ group, rate: hitRate(group.all, option) }))
      .filter((r) => r.rate.pct !== null && r.rate.total >= 5)
      .sort((a, b) => (b.rate.pct ?? 0) - (a.rate.pct ?? 0) || b.rate.total - a.rate.total)
      .slice(0, TEAMS_SHOWN);
    // El partido más cercano de cualquiera de los tres.
    const upcoming = await Promise.all(
      groups.map(({ group }) =>
        group.teamId === null
          ? null
          : getUpcomingMatches({ league_id: league.id, team_id: group.teamId, limit: 1 })
              .then((matches) => matches[0] ?? null)
              .catch(() => null),
      ),
    );
    const next =
      upcoming.filter((m): m is Match => m !== null).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    return { league, season, results, groups, next };
  }, [code]);

  const progress = useCountUp(data.data !== null, 1500, 500);

  if (!market || !option || data.error || (!data.loading && !data.data)) return null;

  if (data.loading || !data.data) {
    return (
      <div className="hero-card hero-card-loading" aria-hidden="true">
        <span className="sk" style={{ width: "40%", height: 12 }} />
        <span className="sk" style={{ width: "70%", height: 22 }} />
        {Array.from({ length: TEAMS_SHOWN }, (_, i) => (
          <span key={i} className="sk hero-card-sk-team" />
        ))}
      </div>
    );
  }

  const { league, season, results, groups, next } = data.data;
  if (groups.length === 0) return null;

  const leagueViews = groupByTeam(results).flatMap((g) => g.home);
  const leagueRate = hitRate(leagueViews, option);

  return (
    <>
    <Link to={statPath(MARKET_SLUG)} className="hero-card">
      <span className="hero-card-head">
        <span className="hero-card-titles">
          <span className="hero-card-kicker">
            {leagueName(league.code)} · {marketGroupLabel(market.group)}
          </span>
          <span className="hero-card-title">{market.title}</span>
        </span>
        <span className="hero-card-option" aria-hidden="true">
          {market.options.map((o) => (
            <span key={o.key} className={o.key === option.key ? "is-on" : undefined}>
              {o.short ?? o.label}
            </span>
          ))}
        </span>
      </span>

      {groups.map(({ group, rate }, i) => {
        const pct = Math.round((rate.pct ?? 0) * 100);
        const home = hitRate(group.home, option);
        const away = hitRate(group.away, option);
        const form = group.all.slice(0, FORM_SHOWN).reverse();
        return (
          <span key={group.key} className={i === 0 ? "hero-team is-first" : "hero-team"}>
            <span className="hero-team-top">
              <span className="hero-team-name">
                <TeamCrest team={group.name} league={league.code} size="sm" eager />
                {group.name}
              </span>
              <span className="hero-team-figures">
                <span className="num hero-team-count">
                  {rate.hits}/{rate.total}
                </span>
                <span className="hero-team-pct">{withPercent(String(Math.round(pct * progress)))}</span>
              </span>
            </span>
            <span className="hero-team-bar">
              <span className="grow" style={{ width: `${pct}%`, animationDelay: `${0.9 + i * 0.15}s` }} />
            </span>
            <span className="hero-team-bottom">
              <span className="hero-form" aria-hidden="true">
                {form.map((view, k) => (
                  <span
                    key={view.match.id}
                    className={option.hit(view) ? "pop is-hit" : "pop is-miss"}
                    style={{ animationDelay: `${1 + i * 0.2 + k * 0.05}s` }}
                  />
                ))}
              </span>
              <span className="num hero-team-split">
                {t("markets:page.home")} {home.hits}/{home.total} · {t("markets:page.away")} {away.hits}/{away.total}
              </span>
            </span>
          </span>
        );
      })}

      {leagueRate.pct !== null && (
        <span className="hero-card-foot">
          <Trans
            i18nKey="markets:page.leagueRate"
            values={{
              season: formatSeason(season),
              pct: withPercent(String(Math.round(leagueRate.pct * 100 * progress))),
              hits: leagueRate.hits,
              total: leagueRate.total,
            }}
            components={{ bold: <strong /> }}
          />
        </span>
      )}
    </Link>

    {/* Etiquetas flotantes, como en el diseño: el próximo partido de esos
        equipos y la vista local / visitante. */}
    {next && (
      <Link to={matchPath(next.id)} className="hero-chip hero-chip-match">
        <span className="hero-chip-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" />
          </svg>
        </span>
        <span className="hero-chip-text">
          <span className="num hero-chip-date">{formatDateTime(next.date)}</span>
          <span className="hero-chip-teams">
            {next.home_team} <em className="serif-accent">vs</em> {next.away_team}
          </span>
        </span>
      </Link>
    )}
    <span className="hero-chip hero-chip-split" aria-hidden="true">
      <span className="hero-chip-dot" />
      {t("markets:page.viewSplit")}
    </span>
    </>
  );
}
