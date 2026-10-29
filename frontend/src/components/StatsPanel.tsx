import { Trans, useTranslation } from "react-i18next";
import type { EloSide, MatchElo, MatchFeatures } from "../api/types";
import { formatDate, formatFixed, withPercent } from "../lib/format";
import { CompareRow, CompareTable, type Seg } from "./CompareRows";
import { InfoTip } from "./InfoTip";
import { TeamCrest } from "./TeamCrest";

const wdl = (f: { wins: number; draws: number; losses: number }): Seg[] => [
  { value: f.wins, kind: "hit" },
  { value: f.draws, kind: "neutral" },
  { value: f.losses, kind: "miss" },
];
const goalsSegs = (f: { goals_for: number; goals_against: number }): Seg[] => [
  { value: f.goals_for, kind: "hit" },
  { value: f.goals_against, kind: "miss" },
];

const eloValue = (side: EloSide) => (side.elo !== null ? formatFixed(side.elo, 0) : "—");

/** Barra del rating en la nota: de 1250 a 1850, el rango habitual. */
const eloBar = (value: number) => Math.min(100, Math.max(4, ((value - 1250) / 600) * 100));

/** Expectativa clásica del Elo para el de más rating (ganar 1, empatar ½), en %. */
const expectedPct = (diff: number) => Math.round(100 / (1 + 10 ** (-diff / 400)));

/** Etiqueta de la fila de Elo: nota con qué es (y por qué falta, si falta) y,
 * debajo, la diferencia entre los dos ratings mostrados. */
function EloLabel({
  elo,
  homeTeam,
  awayTeam,
  league,
}: {
  elo: MatchElo;
  homeTeam: string;
  awayTeam: string;
  league?: string;
}) {
  const { t } = useTranslation();
  const { home, away } = elo;
  const diff = home.elo !== null && away.elo !== null ? Math.round(home.elo) - Math.round(away.elo) : null;
  const champions = home.missing === "champions";
  const reasons = champions
    ? [t("matches:statsPanel.eloMissing.champions")]
    : ([
        [homeTeam, home],
        [awayTeam, away],
      ] as const)
        .filter(([, side]) => side.missing !== null)
        .map(([team, side]) =>
          side.missing === "insufficient_history"
            ? t("matches:statsPanel.eloMissing.insufficient_history", { team, count: side.matches_rated ?? 0, min: elo.min_matches })
            : t("matches:statsPanel.eloMissing.not_generated", { team }),
        );
  return (
    <>
      <span className="elo-label">
        {t("matches:statsPanel.elo")}
        <InfoTip label={t("matches:statsPanel.eloInfoLabel")} popoverClassName="elo-tip">
          <span className="elo-tip-head">
            <strong>{t("matches:statsPanel.elo")}</strong>
            {elo.computed_until && (
              <span>{t("matches:statsPanel.eloTip.updated", { date: formatDate(elo.computed_until) })}</span>
            )}
          </span>
          {(
            [
              [homeTeam, home, "is-home"],
              [awayTeam, away, "is-away"],
            ] as const
          ).map(([team, side, cls]) => (
            <span key={cls} className={`elo-tip-team ${cls}`}>
              {league && <TeamCrest team={team} league={league} />}
              <span className="elo-tip-name">{team}</span>
              <span className="elo-tip-value">{eloValue(side)}</span>
              <span className="elo-tip-track">
                {side.elo !== null && <i style={{ width: `${eloBar(side.elo)}%` }} />}
              </span>
            </span>
          ))}
          {diff !== null && diff !== 0 && (
            <span className="elo-tip-verdict">
              <span className="elo-tip-chip">+{formatFixed(Math.abs(diff), 0)}</span>
              <span>
                <Trans
                  i18nKey="matches:statsPanel.eloTip.expected"
                  values={{ team: diff > 0 ? homeTeam : awayTeam, pct: withPercent(String(expectedPct(Math.abs(diff)))) }}
                  components={{ bold: <strong /> }}
                />
              </span>
            </span>
          )}
          {reasons.map((reason) => (
            <span key={reason} className="elo-tip-missing">
              {reason}
            </span>
          ))}
          <span className="elo-tip-notes">
            <span>{t("matches:statsPanel.eloTip.source")}</span>
            <span>{t("matches:statsPanel.eloTip.comparable")}</span>
            {!champions && <span>{t("matches:statsPanel.eloPromoted")}</span>}
          </span>
        </InfoTip>
      </span>
      {diff !== null && (
        <span className="elo-diff">
          {diff === 0
            ? t("matches:statsPanel.eloEqual")
            : t("matches:statsPanel.eloDiff", { diff: formatFixed(Math.abs(diff), 0), team: diff > 0 ? homeTeam : awayTeam })}
        </span>
      )}
    </>
  );
}

export function StatsPanel({
  features,
  homeTeam,
  awayTeam,
  league,
}: {
  features: MatchFeatures;
  homeTeam: string;
  awayTeam: string;
  league?: string;
}) {
  const {
    home_form,
    away_form,
    home_xg_form,
    away_xg_form,
    home_discipline,
    away_discipline,
    elo,
  } = features;
  const { t } = useTranslation();
  const disciplineMatches = home_discipline.matches_with_data || away_discipline.matches_with_data;
  const fixed = (value: number | null | undefined, digits: number) => (value != null ? formatFixed(value, digits) : "—");

  return (
    <div className="stats-panel compare-panel">
      <h3>{t("matches:statsPanel.title", { count: home_form.matches_played || away_form.matches_played })}</h3>
      <CompareTable
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        league={league}
        caption={t("matches:statsPanel.caption", { home: homeTeam, away: awayTeam })}
      >
        <CompareRow label={t("matches:statsPanel.points")} home={home_form.points} away={away_form.points} values={[home_form.points, away_form.points]} />
        <CompareRow
          label={t("matches:statsPanel.wdl")}
          home={`${home_form.wins}-${home_form.draws}-${home_form.losses}`}
          away={`${away_form.wins}-${away_form.draws}-${away_form.losses}`}
          homeSegs={wdl(home_form)}
          awaySegs={wdl(away_form)}
        />
        <CompareRow
          label={t("matches:statsPanel.goals")}
          home={`${home_form.goals_for}/${home_form.goals_against}`}
          away={`${away_form.goals_for}/${away_form.goals_against}`}
          homeSegs={goalsSegs(home_form)}
          awaySegs={goalsSegs(away_form)}
        />
        <CompareRow
          label={t("matches:statsPanel.xgFor")}
          home={fixed(home_xg_form.avg_xg_for, 2)}
          away={fixed(away_xg_form.avg_xg_for, 2)}
          values={[home_xg_form.avg_xg_for, away_xg_form.avg_xg_for]}
        />
        <CompareRow
          label={t("matches:statsPanel.xgAgainst")}
          home={fixed(home_xg_form.avg_xg_against, 2)}
          away={fixed(away_xg_form.avg_xg_against, 2)}
          values={[home_xg_form.avg_xg_against, away_xg_form.avg_xg_against]}
        />
        <CompareRow
          label={t("matches:statsPanel.cornersFor")}
          home={fixed(home_discipline.avg_corners_for, 1)}
          away={fixed(away_discipline.avg_corners_for, 1)}
          values={[home_discipline.avg_corners_for, away_discipline.avg_corners_for]}
        />
        <CompareRow
          label={t("matches:statsPanel.cornersAgainst")}
          home={fixed(home_discipline.avg_corners_against, 1)}
          away={fixed(away_discipline.avg_corners_against, 1)}
          values={[home_discipline.avg_corners_against, away_discipline.avg_corners_against]}
        />
        <CompareRow
          label={t("matches:statsPanel.yellowCards")}
          home={fixed(home_discipline.avg_yellow_cards, 1)}
          away={fixed(away_discipline.avg_yellow_cards, 1)}
          values={[home_discipline.avg_yellow_cards, away_discipline.avg_yellow_cards]}
        />
        <CompareRow
          label={t("matches:statsPanel.redCards")}
          home={fixed(home_discipline.avg_red_cards, 2)}
          away={fixed(away_discipline.avg_red_cards, 2)}
          values={[home_discipline.avg_red_cards, away_discipline.avg_red_cards]}
        />
        <CompareRow
          label={<EloLabel elo={elo} homeTeam={homeTeam} awayTeam={awayTeam} league={league} />}
          home={eloValue(elo.home)}
          away={eloValue(elo.away)}
          values={[elo.home.elo, elo.away.elo]}
        />
      </CompareTable>
      {disciplineMatches === 0 && (
        <p className="small muted">{t("matches:statsPanel.noDiscipline")}</p>
      )}
    </div>
  );
}
