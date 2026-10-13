import { useId, useState } from "react";
import type { GroupStats, Habits, MoneyHistory } from "../lib/betHistory/analysis";
import { LOW_SAMPLE, euro, moneyClass, pct, roiPct, signedPp } from "../lib/betHistory/format";
import type { TeamGroup } from "../lib/betHistory/teams";
import { TeamCrest } from "./TeamCrest";
import type { PromoEvidence, PromoSplit } from "../lib/betHistory/promotions";
import {
  EMPTY_REAL_MONEY,
  realResult,
  WHOLE_ACCOUNT,
  type RealMoney,
  type RealMoneyByBook,
} from "../lib/betHistory/storage";
import { BOOKMAKER_LABELS, type Bookmaker } from "../lib/betHistory/types";

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
    <section id="habitos">
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

/** Tarjetas que se ven sin pulsar «Ver todos». */
const TEAM_CARDS = 12;

/** Pelota de tenis: hace de escudo en las tarjetas de los tenistas. */
function TennisBall() {
  // Ids únicos: hay una pelota por tenista en la misma página. Sin los signos
  // de useId (":", "«"), que no siempre valen dentro de url(#...).
  const id = `ball${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="tennis-ball" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-felt`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#f1fa8c" />
          <stop offset="55%" stopColor="#d4e636" />
          <stop offset="100%" stopColor="#a9bd1c" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="16" cy="16" r="14" />
        </clipPath>
      </defs>
      <circle cx="16.6" cy="17.2" r="14" fill="rgba(0, 0, 0, 0.12)" />
      <circle cx="16" cy="16" r="14" fill={`url(#${id}-felt)`} />
      <g clipPath={`url(#${id}-clip)`} fill="none" stroke="#fdfdf5" strokeWidth="1.8" strokeLinecap="round">
        <path d="M2.5 4.5C12 10 12 22 2.5 27.5" />
        <path d="M29.5 4.5C20 10 20 22 29.5 27.5" />
      </g>
      <ellipse cx="11.5" cy="9.5" rx="4" ry="2.4" fill="#ffffff" opacity="0.35" transform="rotate(-30 11.5 9.5)" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(0, 0, 0, 0.18)" strokeWidth="0.8" />
    </svg>
  );
}

function TeamCard({ g }: { g: TeamGroup }) {
  const gap = g.hitRate !== null && g.impliedRate !== null ? g.hitRate - g.impliedRate : null;
  return (
    <div className="team-card">
      <div className="team-card-head">
        {g.sport === "Tenis" ? <TennisBall /> : <TeamCrest team={g.name} size="md" />}
        <span className="team-card-name">{g.name}</span>
        <LowSampleTag n={g.bets} />
      </div>
      <p className="team-card-rate">
        <strong>{pct(g.hitRate)}</strong>{" "}
        <span className="small muted">
          {g.wins} de {g.decided} acertadas
        </span>
      </p>
      <p className="small">
        La cuota implicaba {pct(g.impliedRate)} <span className={moneyClass(gap)}>({signedPp(gap)})</span>
      </p>
      <p className="small">
        Beneficio <strong className={moneyClass(g.profit)}>{euro(g.profit, true)}</strong>
        {g.roi !== null && <span className={`muted ${moneyClass(g.roi)}`}> · ROI {roiPct(g.roi)}</span>}
      </p>
    </div>
  );
}

function TeamCards({ title, groups }: { title: string; groups: TeamGroup[] }) {
  const [showAll, setShowAll] = useState(false);
  if (groups.length === 0) return null;
  const shown = showAll ? groups : groups.slice(0, TEAM_CARDS);
  return (
    <>
      <h3>{title}</h3>
      <div className="team-cards">
        {shown.map((g) => (
          <TeamCard key={g.name} g={g} />
        ))}
      </div>
      {groups.length > shown.length && (
        <button type="button" className="tab-button" onClick={() => setShowAll(true)}>
          Ver los {groups.length}
        </button>
      )}
    </>
  );
}

/** Con qué equipos y con qué tenistas aciertas más, de más a menos acierto. */
export function TeamsSection({ groups }: { groups: TeamGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section id="equipos">
      <h2>Equipos y tenistas</h2>
      <p className="small muted">
        Cuánto aciertas en los partidos de cada equipo o tenista, con al menos 3 apuestas resueltas. Solo cuentan las
        apuestas de un solo partido (simples y «crea tu apuesta»): en una combinada de varios partidos no se sabe cuál
        la hizo fallar. Fíjate también en lo que implicaba la cuota: acertar mucho con favoritos no es mérito si las
        cuotas ya lo daban.
      </p>
      <TeamCards title="Equipos" groups={groups.filter((g) => g.sport === "Fútbol")} />
      <TeamCards title="Tenistas" groups={groups.filter((g) => g.sport === "Tenis")} />
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

type MoneyPeriod = { book: Bookmaker; period: string };

const FIELDS = [
  ["opening", "Saldo al 1 de enero"],
  ["deposited", "Ingresos"],
  ["withdrawn", "Retiradas"],
  ["closing", "Saldo al 31 de diciembre (o el actual)"],
] as const;

type Field = (typeof FIELDS)[number][0];

function fmtDay(d: string | null): string {
  return d ? new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

/** Por qué no coinciden el resultado real de un año y el calculado con las apuestas. */
function DiffCauses({ history }: { history: MoneyHistory }) {
  return (
    <ul className="small">
      <li>
        Apuestas que faltan por importar: las importadas de este año van del {fmtDay(history.first)} al{" "}
        {fmtDay(history.last)}.
      </li>
      {history.pending > 0 && (
        <li>
          {history.pending} apuestas sin resolver: su importe ya ha salido del saldo, pero aún no cuentan en el cálculo.
        </li>
      )}
      <li>
        Bonificaciones y ajustes de cuenta mueven el saldo sin ser apuestas. Lo ganado con freebets y créditos de apuesta
        ({euro(history.freebetProfit, true)}) sí está en el cálculo.
      </li>
      <li>Apuestas de finales de diciembre que se resolvieron en enero (o al revés).</li>
      <li>Otros productos de la misma cuenta (casino, póker) también cambian el saldo.</li>
    </ul>
  );
}

/** El extracto de un año en una casa: lo apunta el usuario y se compara con sus apuestas de ese año. */
function RealMoneyYearCard({
  bookmaker,
  year,
  money,
  previousClosing,
  history,
  onSave,
}: {
  bookmaker: string;
  year: string;
  money: RealMoney;
  /** Saldo final del año anterior, si está apuntado: debería ser el inicial de este. */
  previousClosing: number | null;
  history: MoneyHistory;
  onSave: (m: RealMoney | null) => void;
}) {
  const [draft, setDraft] = useState<Record<Field, string>>({
    opening: toInput(money.opening),
    deposited: toInput(money.deposited),
    withdrawn: toInput(money.withdrawn),
    closing: toInput(money.closing),
  });
  const result = realResult(money);
  const diff = result !== null ? Math.round((result - history.profit) * 100) / 100 : null;
  const openingMismatch =
    previousClosing !== null && money.opening !== null && Math.abs(previousClosing - money.opening) >= 0.01;

  function save() {
    const values = Object.fromEntries(FIELDS.map(([key]) => [key, parseEuros(draft[key])])) as Record<Field, number | null>;
    if (Object.values(values).every((v) => v === null)) {
      onSave(null);
      return;
    }
    // Los campos vacíos cuentan como 0: un año sin retiradas no necesita escribir "0".
    onSave({
      opening: values.opening ?? 0,
      deposited: values.deposited ?? 0,
      withdrawn: values.withdrawn ?? 0,
      closing: values.closing ?? 0,
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="real-money">
      <h3>
        {bookmaker} · {year}
      </h3>
      <div className="real-money-fields">
        {FIELDS.map(([key, label]) => (
          <label key={key}>
            <span className="small">{label}</span>
            <input
              inputMode="decimal"
              placeholder={key === "opening" && previousClosing !== null ? toInput(previousClosing) : "0,00"}
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            />
          </label>
        ))}
        <button type="button" className="tab-button tab-button-active" onClick={save}>
          Guardar
        </button>
      </div>
      <p className="small muted">Los campos vacíos cuentan como 0. Para borrar el año, vacíalos todos y guarda.</p>

      {result !== null && diff !== null && (
        <div className="real-money-result">
          <p>
            Resultado real de {year} (saldo final − saldo inicial − ingresos + retiradas):{" "}
            <strong className={moneyClass(result)}>{euro(result, true)}</strong>
            <br />
            Beneficio calculado con tus {history.bets} apuestas de {bookmaker} de {year}:{" "}
            <strong className={moneyClass(history.profit)}>{euro(history.profit, true)}</strong>
          </p>
          {openingMismatch && (
            <p className="small bets-warning">
              El saldo al 1 de enero ({euro(money.opening)}) no coincide con el saldo final que apuntaste para{" "}
              {Number(year) - 1} ({euro(previousClosing)}).
            </p>
          )}
          {Math.abs(diff) < 1 ? (
            <p className="small">Coinciden: tus apuestas importadas explican el resultado real del año.</p>
          ) : (
            <>
              <p className="small">
                Hay una diferencia de <strong>{euro(Math.abs(diff))}</strong>. Es habitual que no coincidan del todo;
                algunas causas posibles:
              </p>
              <DiffCauses history={history} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Dinero real por año natural y casa, apuntado a mano a partir del extracto de
 * la cuenta, y la suma de todos los años. `period` es un año ("2026") o
 * WHOLE_ACCOUNT (lo apuntado antes de separar por años).
 */
export function RealMoneySection({
  books,
  year,
  realMoney,
  history,
  onSave,
}: {
  books: Bookmaker[];
  /** Año elegido arriba; null = todos (solo se ve el resumen). */
  year: string | null;
  realMoney: RealMoneyByBook;
  history: (p: MoneyPeriod) => MoneyHistory;
  onSave: (p: MoneyPeriod, m: RealMoney | null) => void;
}) {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const years = [...new Set(books.flatMap((book) => Object.keys(realMoney[book] ?? {})))]
    .filter((period) => period !== WHOLE_ACCOUNT)
    .sort()
    .reverse();
  // Un año, todas las casas: el total suma solo las casas con su extracto apuntado.
  const rows = years
    .map((y) => {
      const cells = books.map((book) => {
        const m = realMoney[book]?.[y];
        const result = m ? realResult(m) : null;
        const h = history({ book, period: y });
        return { book, result, calc: h.profit, hasBets: h.bets > 0 || h.pending > 0 };
      });
      const done = cells.filter((c) => c.result !== null);
      return {
        year: y,
        cells,
        real: round2(done.reduce((s, c) => s + (c.result ?? 0), 0)),
        calc: round2(done.reduce((s, c) => s + c.calc, 0)),
        // Casas que apostaron ese año pero sin extracto apuntado.
        missing: cells.filter((c) => c.result === null && c.hasBets).map((c) => c.book),
        any: done.length > 0,
      };
    })
    .filter((r) => r.any);
  const total = round2(rows.reduce((s, r) => s + r.real, 0));
  const totalCalc = round2(rows.reduce((s, r) => s + r.calc, 0));
  const wholeAccounts = books.filter((book) => realMoney[book]?.[WHOLE_ACCOUNT]);
  const byBook = books.length > 1;
  const bookNames = books.map((b) => BOOKMAKER_LABELS[b]).join(" + ");
  const selectedRow = rows.find((r) => r.year === year) ?? null;
  const joinBooks = (list: Bookmaker[]) => list.map((b) => BOOKMAKER_LABELS[b]).join(" y ");

  return (
    <section id="dinero-real">
      <h2>Dinero real{year ? ` · ${year}` : ""}</h2>
      <p className="small muted">
        Lo que de verdad ha ganado o perdido tu cuenta en cada año natural, sacado del extracto de la casa (en bet365,
        el resumen de la cuenta con las fechas del 1 de enero al 31 de diciembre: saldo inicial, ingresos, retiradas y
        saldo final). Se compara con el beneficio de tus apuestas importadas de ese año, de todos los deportes. Se
        guarda solo en este navegador, entra en la copia de seguridad y se borra con «Borrar mis datos».
      </p>
      {selectedRow && (
        <div className="real-money-year-total">
          <p>
            Total de {selectedRow.year}
            {byBook ? ` (${bookNames})` : ""}:{" "}
            <strong className={`bets-hero-mid ${moneyClass(selectedRow.real)}`}>{euro(selectedRow.real, true)}</strong>
          </p>
          {byBook && (
            <p className="small">
              {selectedRow.cells.map((c, i) => (
                <span key={c.book}>
                  {i > 0 && " · "}
                  {BOOKMAKER_LABELS[c.book]}{" "}
                  {c.result !== null ? (
                    <strong className={moneyClass(c.result)}>{euro(c.result, true)}</strong>
                  ) : (
                    <span className="muted">{c.hasBets ? "sin apuntar" : "sin apuestas"}</span>
                  )}
                </span>
              ))}
            </p>
          )}
          <p className="small muted">
            Calculado con tus apuestas de esas casas en {selectedRow.year}: {euro(selectedRow.calc, true)}.
            {selectedRow.missing.length > 0 &&
              ` Falta apuntar ${joinBooks(selectedRow.missing)}: el total aún no incluye su resultado.`}
          </p>
        </div>
      )}
      {year ? (
        <div className="real-money-cards">
          {books.map((book) => {
            const money = realMoney[book]?.[year] ?? EMPTY_REAL_MONEY;
            const previous = realMoney[book]?.[String(Number(year) - 1)];
            return (
              // key: el formulario se recarga al cambiar de año o si los datos cambian por fuera (copia restaurada, datos borrados).
              <RealMoneyYearCard
                key={`${book}-${year}-${money.updatedAt ?? "vacío"}`}
                bookmaker={BOOKMAKER_LABELS[book]}
                year={year}
                money={money}
                previousClosing={previous?.closing ?? null}
                history={history({ book, period: year })}
                onSave={(m) => onSave({ book, period: year }, m)}
              />
            );
          })}
        </div>
      ) : (
        <p className="small">Elige un año arriba para apuntar su extracto.</p>
      )}

      {rows.length > 0 && (
        <>
          <h3>Año a año</h3>
          <div className="table-scroll">
            <table className="predictions-table">
              <thead>
                <tr>
                  <th>Año</th>
                  {byBook && books.map((b) => <th key={b} className="num">{BOOKMAKER_LABELS[b]}</th>)}
                  <th className="num">{byBook ? "Total real" : "Resultado real"}</th>
                  <th className="num">Calculado con tus apuestas</th>
                  <th className="num">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.year} className={r.year === year ? "month-row-selected" : undefined}>
                    <td className="rec-match">
                      {r.year}
                      {r.missing.length > 0 && (
                        <>
                          {" "}
                          <span className="low-tag">falta {joinBooks(r.missing)}</span>
                        </>
                      )}
                    </td>
                    {byBook &&
                      r.cells.map((c) => (
                        <td key={c.book} className={`num ${moneyClass(c.result)}`}>
                          {c.result !== null ? euro(c.result, true) : c.hasBets ? "falta" : "—"}
                        </td>
                      ))}
                    <td className={`num ${moneyClass(r.real)}`}>
                      <strong>{euro(r.real, true)}</strong>
                    </td>
                    <td className={`num ${moneyClass(r.calc)}`}>{euro(r.calc, true)}</td>
                    <td className="num">{euro(round2(r.real - r.calc), true)}</td>
                  </tr>
                ))}
                {rows.length > 1 && (
                  <tr className="real-money-total">
                    <td className="rec-match" colSpan={byBook ? books.length + 1 : 1}>
                      <strong>Suma de los años apuntados</strong>
                    </td>
                    <td className={`num ${moneyClass(total)}`}>
                      <strong>{euro(total, true)}</strong>
                    </td>
                    <td className={`num ${moneyClass(totalCalc)}`}>{euro(totalCalc, true)}</td>
                    <td className="num">{euro(round2(total - totalCalc), true)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="small">
            En los años apuntados{byBook ? `, entre ${joinBooks(books)},` : ","} tu dinero real{" "}
            {total >= 0 ? "ha ganado" : "ha perdido"} <strong className={moneyClass(total)}>{euro(Math.abs(total))}</strong>.
            {rows.some((r) => r.missing.length > 0) && " Ojo: algún año está incompleto (le falta el extracto de una casa)."}
          </p>
        </>
      )}

      {wholeAccounts.map((book) => {
        const money = realMoney[book]?.[WHOLE_ACCOUNT] ?? EMPTY_REAL_MONEY;
        const result = realResult(money);
        const h = history({ book, period: WHOLE_ACCOUNT });
        return (
          <div key={book} className="real-money">
            <h3>{BOOKMAKER_LABELS[book]} · toda la cuenta, sin año</h3>
            <p className="small">
              Lo que apuntaste antes de separar por años: ingresado {euro(money.deposited)}, retirado{" "}
              {euro(money.withdrawn)}, saldo {euro(money.closing)}. Resultado real{" "}
              <strong className={moneyClass(result)}>{euro(result, true)}</strong>, frente a{" "}
              <strong className={moneyClass(h.profit)}>{euro(h.profit, true)}</strong> calculado con tus {h.bets} apuestas
              de {BOOKMAKER_LABELS[book]}.
            </p>
            <p className="small muted">
              No se puede repartir entre años: apunta el extracto de cada año arriba y, cuando lo tengas, borra este
              dato.
            </p>
            <button
              type="button"
              className="tab-button"
              onClick={() => {
                if (window.confirm(`¿Borrar el dinero real de toda la cuenta de ${BOOKMAKER_LABELS[book]}?`)) {
                  onSave({ book, period: WHOLE_ACCOUNT }, null);
                }
              }}
            >
              Borrar este dato
            </button>
          </div>
        );
      })}
    </section>
  );
}
