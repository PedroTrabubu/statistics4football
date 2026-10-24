import { useTranslation } from "react-i18next";
import type { MatchFeatures } from "../api/types";
import { formatFixed } from "../lib/format";
import { TeamName } from "./TeamCrest";

type Seg = { value: number; kind: "hit" | "neutral" | "miss" };

/** Barra de una fila: proporcional a la mayor de las dos cifras (`width`), o
 * partida en tramos (`segs`: victorias/empates/derrotas, a favor/en contra).
 * La del local crece hacia el centro desde la derecha. */
function Bar({ side, width, segs }: { side: "home" | "away"; width?: number; segs?: Seg[] }) {
  const total = segs?.reduce((a, s) => a + s.value, 0) ?? 0;
  return (
    <span className={`compare-bar compare-bar-${side}`} aria-hidden="true">
      {segs && total > 0
        ? segs.map((seg, i) =>
            seg.value > 0 ? (
              <span key={i} className={`compare-seg is-${seg.kind}`} style={{ width: `${(seg.value / total) * 100}%` }} />
            ) : null,
          )
        : width !== undefined && <span className="compare-fill" style={{ width: `${width}%` }} />}
    </span>
  );
}

function FormRow({
  label,
  home,
  away,
  values,
  homeSegs,
  awaySegs,
}: {
  label: string;
  home: string | number;
  away: string | number;
  /** Cifras para la barra proporcional (null: sin barra). */
  values?: [number | null | undefined, number | null | undefined];
  homeSegs?: Seg[];
  awaySegs?: Seg[];
}) {
  const [h, a] = values ?? [null, null];
  const max = Math.max(h ?? 0, a ?? 0);
  const pct = (v: number | null | undefined) => (v == null || max <= 0 ? 0 : (v / max) * 100);
  const bars = values !== undefined || homeSegs !== undefined;
  return (
    <tr>
      <td className="stats-value">
        <span className="compare-cell compare-cell-home">
          <span className="compare-num">{home}</span>
          {bars && <Bar side="home" width={values ? pct(h) : undefined} segs={homeSegs} />}
        </span>
      </td>
      <td className="stats-label">{label}</td>
      <td className="stats-value">
        <span className="compare-cell compare-cell-away">
          {bars && <Bar side="away" width={values ? pct(a) : undefined} segs={awaySegs} />}
          <span className="compare-num">{away}</span>
        </span>
      </td>
    </tr>
  );
}

const wdl = (f: { wins: number; draws: number; losses: number }): Seg[] => [
  { value: f.wins, kind: "hit" },
  { value: f.draws, kind: "neutral" },
  { value: f.losses, kind: "miss" },
];
const goalsSegs = (f: { goals_for: number; goals_against: number }): Seg[] => [
  { value: f.goals_for, kind: "hit" },
  { value: f.goals_against, kind: "miss" },
];

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
    home_elo,
    away_elo,
  } = features;
  const { t } = useTranslation();
  const disciplineMatches = home_discipline.matches_with_data || away_discipline.matches_with_data;
  const fixed = (value: number | null | undefined, digits: number) => (value != null ? formatFixed(value, digits) : "—");

  return (
    <div className="stats-panel compare-panel">
      <h3>{t("matches:statsPanel.title", { count: home_form.matches_played || away_form.matches_played })}</h3>
      <table className="stats-table compare-table">
        <thead>
          <tr>
            <th>
              <TeamName team={homeTeam} league={league} />
            </th>
            <th></th>
            <th>
              <TeamName team={awayTeam} league={league} />
            </th>
          </tr>
        </thead>
        <tbody>
          <FormRow label={t("matches:statsPanel.points")} home={home_form.points} away={away_form.points} values={[home_form.points, away_form.points]} />
          <FormRow
            label={t("matches:statsPanel.wdl")}
            home={`${home_form.wins}-${home_form.draws}-${home_form.losses}`}
            away={`${away_form.wins}-${away_form.draws}-${away_form.losses}`}
            homeSegs={wdl(home_form)}
            awaySegs={wdl(away_form)}
          />
          <FormRow
            label={t("matches:statsPanel.goals")}
            home={`${home_form.goals_for}/${home_form.goals_against}`}
            away={`${away_form.goals_for}/${away_form.goals_against}`}
            homeSegs={goalsSegs(home_form)}
            awaySegs={goalsSegs(away_form)}
          />
          <FormRow
            label={t("matches:statsPanel.xgFor")}
            home={fixed(home_xg_form.avg_xg_for, 2)}
            away={fixed(away_xg_form.avg_xg_for, 2)}
            values={[home_xg_form.avg_xg_for, away_xg_form.avg_xg_for]}
          />
          <FormRow
            label={t("matches:statsPanel.xgAgainst")}
            home={fixed(home_xg_form.avg_xg_against, 2)}
            away={fixed(away_xg_form.avg_xg_against, 2)}
            values={[home_xg_form.avg_xg_against, away_xg_form.avg_xg_against]}
          />
          <FormRow
            label={t("matches:statsPanel.cornersFor")}
            home={fixed(home_discipline.avg_corners_for, 1)}
            away={fixed(away_discipline.avg_corners_for, 1)}
            values={[home_discipline.avg_corners_for, away_discipline.avg_corners_for]}
          />
          <FormRow
            label={t("matches:statsPanel.cornersAgainst")}
            home={fixed(home_discipline.avg_corners_against, 1)}
            away={fixed(away_discipline.avg_corners_against, 1)}
            values={[home_discipline.avg_corners_against, away_discipline.avg_corners_against]}
          />
          <FormRow
            label={t("matches:statsPanel.yellowCards")}
            home={fixed(home_discipline.avg_yellow_cards, 1)}
            away={fixed(away_discipline.avg_yellow_cards, 1)}
            values={[home_discipline.avg_yellow_cards, away_discipline.avg_yellow_cards]}
          />
          <FormRow
            label={t("matches:statsPanel.redCards")}
            home={fixed(home_discipline.avg_red_cards, 2)}
            away={fixed(away_discipline.avg_red_cards, 2)}
            values={[home_discipline.avg_red_cards, away_discipline.avg_red_cards]}
          />
          <FormRow
            label={t("matches:statsPanel.elo")}
            home={home_elo !== null ? formatFixed(home_elo, 0) : "—"}
            away={away_elo !== null ? formatFixed(away_elo, 0) : "—"}
            values={[home_elo, away_elo]}
          />
        </tbody>
      </table>
      {disciplineMatches === 0 && (
        <p className="small muted">{t("matches:statsPanel.noDiscipline")}</p>
      )}
    </div>
  );
}
