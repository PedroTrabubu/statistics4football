import { useState } from "react";
import { Link } from "react-router-dom";
import { getLeagues, getPicks, getPicksHistory } from "../api/client";
import type { PickCombo, PickKind, PickLeg } from "../api/types";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { OutcomeBadge } from "../components/OutcomeBadge";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { formatDateTime, formatMatchday, formatRoiPct, joinParts } from "../lib/format";
import { leagueName, onlyValidated, useSelectedLeagueCode } from "../lib/leagues";
import { ODDS_KIND_TITLES, PICK_KIND_LABELS, TIER_KINDS, oneInN, pickLegLabel, pickLegUnit } from "../lib/picks";
import { useApi } from "../lib/useApi";

type Tab = "upcoming" | "history";

const TIER_HINTS: Record<PickKind, string> = {
  segura: "Cuota ~1.40 · 2 selecciones",
  fiable: "Cuota ~1.50 · 2 selecciones · acierta ~2 de cada 3",
  media: "Cuota ~1.90 · 2-3 selecciones",
  alta: "Cuota 3 - 5 · hasta 4 selecciones",
  bomba: "Cuota 8 o más · hasta 5 selecciones",
  mismo_partido: "Dos o tres selecciones del mismo partido, probabilidad conjunta ≥ 70%",
};

function pct(prob: number): string {
  return `${Math.round(prob * 100)}%`;
}

function formatWindow(window: string): string {
  const start = new Date(`${window}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function PicksPage() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [selectedCode, setLeagueCode] = useSelectedLeagueCode();
  const { data: allLeagues } = useApi(() => getLeagues(), []);
  const { leagues, code: leagueCode, pending } = onlyValidated(allLeagues, selectedCode);

  return (
    <div>
      <h1>Picks</h1>
      <p className="page-lead">
        Combinadas para la próxima jornada construidas con estadística: cuotas pre-partido, córners y amarillas de
        cada equipo en casa y fuera. Para cada nivel de cuota se elige la combinada con más probabilidad de acierto,
        con pocas selecciones para no acumular el margen de la casa.
      </p>

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={setLeagueCode} allowAll />
      {pending && <p className="small muted">{pending}</p>}

      <div className="tab-group tab-group-spaced">
        <button
          className={tab === "upcoming" ? "tab-button tab-button-active" : "tab-button"}
          onClick={() => setTab("upcoming")}
        >
          Próxima jornada
        </button>
        <button
          className={tab === "history" ? "tab-button tab-button-active" : "tab-button"}
          onClick={() => setTab("history")}
        >
          Histórico
        </button>
      </div>

      {tab === "upcoming" ? <UpcomingPicks league={leagueCode ?? undefined} /> : <PicksHistoryView league={leagueCode ?? undefined} />}
    </div>
  );
}

function UpcomingPicks({ league }: { league: string | undefined }) {
  const { data, loading, error } = useApi(() => getPicks(league), [league]);
  const tiers = data?.combos.filter((c) => c.kind !== "mismo_partido") ?? [];
  const sameMatch = data?.combos.filter((c) => c.kind === "mismo_partido") ?? [];

  return (
    <>
      {loading && <LoadingView label="Cargando picks..." />}
      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}
      {!loading && !error && data && data.combos.length === 0 && (
        <EmptyView message="Todavía no hay picks para la próxima jornada. Se generan con scripts/refresh_picks.py (mejor después de refresh_odds.py, para tener las cuotas)." />
      )}

      {!loading && !error && data && data.combos.length > 0 && (
        <>
          <p className="small muted intro-note">
            Jornada del <strong>{data.window && formatWindow(data.window)}</strong>. La probabilidad es la del modelo,
            que en el backtest fuera de muestra acertó lo que prometía (ver Histórico). Las cuotas marcadas como{" "}
            <em>estimadas</em> no son de ninguna casa: compáralas con la tuya. Si tu casa paga más, mejor para ti; si
            paga menos, la combinada te sale peor de lo que parece.
          </p>

          <h2 className="picks-heading">Combinadas por nivel</h2>
          <div className="picks-grid">
            {TIER_KINDS.map((kind) => {
              const combo = tiers.find((c) => c.kind === kind);
              return combo ? (
                <ComboCard key={kind} combo={combo} />
              ) : (
                <div key={kind} className="pick-card pick-card-empty">
                  <h3>{PICK_KIND_LABELS[kind]}</h3>
                  <p className="small muted">No hay selecciones suficientes para este nivel en esta jornada.</p>
                </div>
              );
            })}
          </div>

          {sameMatch.length > 0 && (
            <>
              <h2 className="picks-heading">Una combinada muy probable por partido</h2>
              <p className="small muted">{TIER_HINTS.mismo_partido}. Las selecciones del mismo partido no son independientes: la probabilidad ya lo tiene en cuenta.</p>
              <div className="picks-grid picks-grid-small">
                {sameMatch.map((combo) => (
                  <ComboCard key={combo.id} combo={combo} compact />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function OddsTag({ kind }: { kind: string }) {
  return (
    <span className={`odds-tag odds-tag-${kind}`} title={ODDS_KIND_TITLES[kind]}>
      {kind}
    </span>
  );
}

function LegRow({ leg, showMatch, settled }: { leg: PickLeg; showMatch: boolean; settled: boolean }) {
  const unit = pickLegUnit(leg);
  return (
    <li className={settled ? `pick-leg pick-leg-${leg.outcome}` : "pick-leg"}>
      <div className="pick-leg-main">
        <span className="pick-leg-label">{pickLegLabel(leg)}</span>
        {showMatch && (
          <Link to={`/matches/${leg.match_id}`} className="pick-leg-match small">
            {joinParts(`${leg.home_team} – ${leg.away_team}`, leagueName(leg.league_code), formatMatchday(leg.matchday), formatDateTime(leg.date))}
          </Link>
        )}
        {settled && leg.actual && (
          <span className="small muted">
            Real: {leg.actual} {unit}
          </span>
        )}
      </div>
      <div className="pick-leg-numbers">
        <span className="pick-leg-prob">{pct(leg.prob)}</span>
        <span className="pick-leg-odds">
          {leg.odds.toFixed(2)} <OddsTag kind={leg.odds_kind} />
        </span>
      </div>
    </li>
  );
}

function ComboCard({ combo, compact = false }: { combo: PickCombo; compact?: boolean }) {
  const settled = combo.outcome !== "pending";
  const first = combo.legs[0];
  return (
    <article className={`pick-card pick-card-${combo.kind}`}>
      <header className="pick-card-header">
        <div>
          <h3>{compact ? `${first.home_team} – ${first.away_team}` : PICK_KIND_LABELS[combo.kind]}</h3>
          <p className="small muted">
            {compact ? joinParts(leagueName(first.league_code), formatMatchday(first.matchday), formatDateTime(first.date)) : TIER_HINTS[combo.kind]}
          </p>
        </div>
        <div className="pick-card-odds">
          <span className="pick-card-odds-value">{combo.odds.toFixed(2)}</span>
          <OddsTag kind={combo.odds_kind} />
        </div>
      </header>
      <p className="pick-card-prob">
        Probabilidad <strong>{pct(combo.prob)}</strong>
        <span className="muted"> · acierta {oneInN(combo.prob)}</span>
        {settled && (
          <>
            {" "}
            <OutcomeBadge outcome={combo.outcome} />
          </>
        )}
      </p>
      <ul className="pick-legs">
        {combo.legs.map((leg, i) => (
          <LegRow key={i} leg={leg} showMatch={!compact} settled={settled} />
        ))}
      </ul>
    </article>
  );
}

function PicksHistoryView({ league }: { league: string | undefined }) {
  const [kind, setKind] = useState<PickKind | undefined>(undefined);
  const { data, loading, error } = useApi(() => getPicksHistory({ league, kind, limit: 40 }), [league, kind]);

  return (
    <>
      {loading && <LoadingView label="Cargando histórico..." />}
      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}
      {!loading && !error && data && data.summary.length === 0 && (
        <EmptyView message="Todavía no hay picks resueltos." />
      )}

      {!loading && !error && data && data.summary.length > 0 && (
        <>
          <p className="small muted intro-note">
            Combinadas de 25/26 y 26/27 generadas con un modelo entrenado solo con temporadas anteriores, con reglas
            fijadas antes de ver estos partidos, más las jornadas ya jugadas desde entonces. Se cuentan todas, también
            las falladas. <strong>Compara el acierto con la probabilidad prometida</strong>: si se parecen, el modelo
            es fiable. El ROI usa las cuotas mostradas, que en casi todas las combinadas son estimadas con un margen de
            casa, así que es orientativo.
          </p>

          <div className="table-scroll">
            <table className="predictions-table">
              <thead>
                <tr>
                  <th>Nivel</th>
                  <th className="num">Combinadas</th>
                  <th className="num">Acierto</th>
                  <th className="num">Prometido</th>
                  <th className="num">Cuota media</th>
                  <th className="num">ROI (cuota mostrada)</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.map((s) => (
                  <tr key={s.kind}>
                    <td className="rec-match">{PICK_KIND_LABELS[s.kind]}</td>
                    <td className="num">{s.total}</td>
                    <td className="num">
                      <strong>{s.hit_rate !== null ? `${s.hit_rate}%` : "—"}</strong>
                      <span className="muted small"> ({s.won}/{s.won + s.lost})</span>
                    </td>
                    <td className="num">{s.predicted_hit_rate !== null ? `${s.predicted_hit_rate}%` : "—"}</td>
                    <td className="num">{s.avg_odds?.toFixed(2) ?? "—"}</td>
                    <td className={`num ${s.roi_shown_odds !== null && s.roi_shown_odds >= 0 ? "ev-positive" : "ev-negative"}`}>
                      {formatRoiPct(s.roi_shown_odds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="filters">
            <select
              aria-label="Nivel"
              value={kind ?? ""}
              onChange={(e) => setKind((e.target.value || undefined) as PickKind | undefined)}
            >
              <option value="">Todos los niveles</option>
              {(Object.keys(PICK_KIND_LABELS) as PickKind[]).map((k) => (
                <option key={k} value={k}>
                  {PICK_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <h2 className="picks-heading">Últimas combinadas</h2>
          <div className="picks-grid">
            {data.combos.map((combo) => (
              <div key={combo.id}>
                <p className="small muted picks-window">Jornada {formatWindow(combo.window)}</p>
                <ComboCard combo={combo} compact={combo.kind === "mismo_partido"} />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
