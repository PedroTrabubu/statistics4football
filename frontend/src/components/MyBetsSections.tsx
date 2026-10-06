import { useState } from "react";
import type { GroupStats, Habits } from "../lib/betHistory/analysis";
import { LOW_SAMPLE, euro, moneyClass, pct, roiPct } from "../lib/betHistory/format";
import type { MatchGroup } from "../lib/betHistory/matches";
import type { PromoEvidence, PromoSplit } from "../lib/betHistory/promotions";
import { hasRealMoney, realResult, type RealMoney } from "../lib/betHistory/storage";

export function LowSampleTag({ n }: { n: number }) {
  if (n >= LOW_SAMPLE) return null;
  return (
    <span className="low-tag" title={`Menos de ${LOW_SAMPLE} apuestas: cifra poco fiable`}>
      poco fiable
    </span>
  );
}

function StatsCard({ g, title }: { g: GroupStats; title: string }) {
  return (
    <div className="split-card">
      <h3>
        {title} <LowSampleTag n={g.bets} />
      </h3>
      <dl>
        <div>
          <dt>Apuestas</dt>
          <dd>{g.bets}</dd>
        </div>
        <div>
          <dt>Acierto</dt>
          <dd>
            {pct(g.hitRate)} <span className="muted small">({g.wins}/{g.decided})</span>
          </dd>
        </div>
        <div>
          <dt>Apostado</dt>
          <dd>{euro(g.ownStaked)}</dd>
        </div>
        <div>
          <dt>Beneficio</dt>
          <dd className={moneyClass(g.profit)}>{euro(g.profit, true)}</dd>
        </div>
        <div>
          <dt>ROI</dt>
          <dd className={moneyClass(g.roi)}>{roiPct(g.roi)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Desglose fijo debajo del bloque principal: con y sin promoción, que suman el total. */
export function PromoSplitCards({ split }: { split: PromoSplit }) {
  const { withPromo: a, withoutPromo: b, total } = split;
  return (
    <section className="promo-split" aria-label="Con y sin promoción">
      <div className="split-cards">
        <StatsCard g={a} title="Con promoción" />
        <StatsCard g={b} title="Sin promoción" />
      </div>
      <p className="small muted">
        Suman el total: {a.bets} + {b.bets} = {total.bets} apuestas · {euro(a.profit, true)} + {euro(b.profit, true)} ={" "}
        {euro(total.profit, true)}. Aquí una apuesta con dos promociones cuenta una sola vez; en la tabla «Por promoción»
        cuenta en cada una.
      </p>
    </section>
  );
}

/** Evidencia estadística de una promoción: acierto necesario e intervalo de Wilson. */
export function PromoEvidenceCard({ e }: { e: PromoEvidence }) {
  return (
    <div className="evidence-card">
      <h3>
        {e.promo} <LowSampleTag n={e.decided} />
      </h3>
      <p>
        <strong>{e.bets}</strong> apuestas · <strong>{e.wins}</strong> acertadas de {e.decided} ({pct(e.hitRate)}) ·
        beneficio <span className={moneyClass(e.profit)}>{euro(e.profit, true)}</span>
      </p>
      {e.breakEven !== null && e.avgOdds !== null && (
        <p className="small">
          Cuota media {e.avgOdds.toFixed(2)}: para no ganar ni perder hace falta acertar el{" "}
          <strong>{pct(e.breakEven, 1)}</strong>.
        </p>
      )}
      {e.ci && (
        <p className="small">
          Con tus apuestas, tu acierto real está entre el <strong>{pct(e.ci[0])}</strong> y el{" "}
          <strong>{pct(e.ci[1])}</strong> (intervalo de confianza del 95 %, Wilson).
        </p>
      )}
      <p className={`small ${e.supported ? "ev-positive" : "muted"}`}>
        {e.supported
          ? "Incluso el extremo bajo del intervalo supera el acierto necesario: la muestra apoya que, hasta ahora, esta promoción te ha sido rentable."
          : "El extremo bajo del intervalo no llega al acierto necesario: todavía no hay evidencia suficiente para decir si es rentable."}{" "}
        Describe tus apuestas pasadas; no garantiza lo que pasará.
      </p>
    </div>
  );
}

function HabitsColumn({ title, h, n }: { title: string; h: Habits; n: number }) {
  return (
    <div className="split-card">
      <h3>
        {title} <LowSampleTag n={n} />
      </h3>
      <ul className="bets-habits">
        <li>
          Peor racha: <strong>{h.longestLosingStreak}</strong> perdidas seguidas · mejor: <strong>{h.longestWinningStreak}</strong>{" "}
          ganadas seguidas.
        </li>
        {h.stakeAfterLoss !== null && h.stakeAfterWin !== null && (
          <li>
            Tras perder apuestas de media <strong>{euro(h.stakeAfterLoss)}</strong>; tras ganar,{" "}
            <strong>{euro(h.stakeAfterWin)}</strong>.{" "}
            {h.stakeAfterLoss > h.stakeAfterWin * 1.2
              ? "Subes el importe tras perder, la señal clásica de intentar recuperar lo perdido."
              : "No subes el importe tras perder."}
            <span className="muted">
              {" "}
              ({h.afterLossSamples} y {h.afterWinSamples} casos)
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

export function HabitsBlock({
  all,
  allCount,
  withoutPromo,
  withoutPromoCount,
  hitRate,
  expectedStreak,
}: {
  all: Habits;
  allCount: number;
  withoutPromo: Habits;
  withoutPromoCount: number;
  hitRate: number | null;
  expectedStreak: number | null;
}) {
  return (
    <section>
      <h2>Hábitos</h2>
      <div className="split-cards">
        <HabitsColumn title="Todas las apuestas" h={all} n={allCount} />
        <HabitsColumn title="Solo sin promoción" h={withoutPromo} n={withoutPromoCount} />
      </div>
      <p className="small muted">
        Las promociones de importe fijo (como La Gran Supercuota, siempre 10 €) cambian la media de importes, así que
        las dos lecturas son válidas: la primera es lo que has hecho, la segunda refleja mejor cómo eliges tú el importe.
      </p>
      <p className="small muted">
        Con un acierto del 30–35 %, las rachas largas de apuestas perdidas son normales.
        {expectedStreak !== null &&
          ` Con tu acierto (${pct(hitRate)}) y ${allCount} apuestas, por puro azar cabe esperar una racha máxima de unas ${expectedStreak} perdidas seguidas.`}
      </p>
    </section>
  );
}

const STATUS_TEXT: Record<string, string> = { won: "Ganada", lost: "Perdida", cashout: "Cash out" };

export function MatchesSection({ groups }: { groups: MatchGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section>
      <h2>Apuestas por partido</h2>
      <p className="small muted">
        Partidos con 3 o más apuestas resueltas. Las combinadas con varios partidos cuentan en cada uno. «Posible
        duplicada»: mismo importe, misma cuota y mismas selecciones con menos de 10 minutos de diferencia; puede ser
        intencionado.
      </p>
      <div className="matches-list">
        {groups.map((g) => (
          <details key={g.key} className="match-item">
            <summary>
              <span className="match-name">
                {g.label}
                {g.eventDate && <span className="muted small"> ({g.eventDate})</span>}
              </span>
              <span className="match-figures">
                {g.bets.length} apuestas · expuesto {euro(g.exposed)}
                {g.freebetExposed > 0 && <span className="muted small"> ({euro(g.freebetExposed)} en freebets)</span>} ·{" "}
                <span className={moneyClass(g.profit)}>{euro(g.profit, true)}</span>
                {g.possibleDuplicates.size > 0 && (
                  <span className="badge dup-badge">{g.possibleDuplicates.size} posibles duplicadas</span>
                )}
              </span>
            </summary>
            <ul>
              {g.bets.map((r) => (
                <li key={r.bet.id}>
                  <span className="muted small">
                    {r.bet.placedAt ? new Date(r.bet.placedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—"}
                  </span>{" "}
                  {r.bet.legs.map((l) => [l.market, l.pick].filter(Boolean).join(": ")).join(" + ")} · cuota{" "}
                  {r.bet.odds?.toFixed(2) ?? "—"} · {euro(r.bet.stake)}
                  {r.bet.freebet && " (freebet)"} · {STATUS_TEXT[r.bet.status] ?? r.bet.status} ·{" "}
                  <span className={moneyClass(r.profit)}>{euro(r.profit, true)}</span>
                  {g.possibleDuplicates.has(r.bet.id) && <span className="badge dup-badge">posible duplicada</span>}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}

function parseEuros(raw: string): number | null {
  const s = raw.trim().replace(/[€\s]/g, "");
  if (!s) return null;
  // "1.234,56" o "1234.56"
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function toInput(n: number | null): string {
  return n === null ? "" : String(n).replace(".", ",");
}

/** Dinero real apuntado a mano, comparado con el beneficio calculado del historial. */
export function RealMoneyPanel({
  money,
  onSave,
  history,
}: {
  money: RealMoney;
  onSave: (m: RealMoney) => void;
  history: { profit: number; first: string | null; last: string | null; pending: number; freebetProfit: number; bets: number };
}) {
  const [draft, setDraft] = useState({
    deposited: toInput(money.deposited),
    withdrawn: toInput(money.withdrawn),
    balance: toInput(money.balance),
  });
  const filled = hasRealMoney(money);
  const result = realResult(money);
  const diff = result !== null ? Math.round((result - history.profit) * 100) / 100 : null;
  const fmtDay = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");

  function save() {
    onSave({
      deposited: parseEuros(draft.deposited),
      withdrawn: parseEuros(draft.withdrawn),
      balance: parseEuros(draft.balance),
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <details className="real-money" open={filled}>
      <summary>
        <strong>Dinero real</strong>{" "}
        <span className="muted small">
          {filled
            ? "lo que has ingresado, retirado y tienes en la casa"
            : "— opcional: apunta lo que has ingresado y retirado para compararlo con tu historial"}
        </span>
      </summary>
      <p className="small muted">
        Estos datos no salen del historial de apuestas: los apuntas tú, a partir del historial de movimientos (ingresos y
        retiradas) de tu cuenta en la casa. Se guardan solo en este navegador, entran en la copia de seguridad y se
        borran con «Borrar mis datos».
      </p>
      <div className="real-money-fields">
        {(
          [
            ["deposited", "Total ingresado"],
            ["withdrawn", "Total retirado"],
            ["balance", "Saldo actual en la casa"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <span className="small">{label}</span>
            <input
              inputMode="decimal"
              placeholder="0,00"
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            />
          </label>
        ))}
        <button type="button" className="tab-button tab-button-active" onClick={save}>
          Guardar
        </button>
      </div>

      {result !== null && diff !== null && (
        <div className="real-money-result">
          <p>
            Resultado real (retirado + saldo − ingresado):{" "}
            <strong className={moneyClass(result)}>{euro(result, true)}</strong>
            <br />
            Beneficio calculado con las {history.bets} apuestas importadas:{" "}
            <strong className={moneyClass(history.profit)}>{euro(history.profit, true)}</strong>
          </p>
          {Math.abs(diff) < 1 ? (
            <p className="small">Coinciden: el historial importado explica tu resultado real.</p>
          ) : (
            <>
              <p className="small">
                Hay una diferencia de <strong>{euro(Math.abs(diff))}</strong>. Es habitual que no coincidan del todo;
                algunas causas posibles:
              </p>
              <ul className="small">
                <li>
                  Periodo distinto: el historial importado va del {fmtDay(history.first)} al {fmtDay(history.last)}. Si la
                  cuenta es anterior, esas apuestas no están.
                </li>
                <li>Apuestas no importadas: páginas del historial que no se cargaron al copiarlo.</li>
                {history.pending > 0 && (
                  <li>
                    {history.pending} apuestas sin resolver: su importe ya ha salido del saldo, pero aún no cuentan en el
                    historial.
                  </li>
                )}
                <li>
                  Freebets y bonos: lo ganado con freebets ({euro(history.freebetProfit, true)}) sí está en el historial,
                  pero los bonos en efectivo o las devoluciones pueden mover el saldo sin aparecer como apuesta.
                </li>
                <li>Otros productos de la misma cuenta (póker, casino) también cambian el saldo.</li>
              </ul>
            </>
          )}
        </div>
      )}
    </details>
  );
}
