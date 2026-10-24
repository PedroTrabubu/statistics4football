import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { currentLocale } from "../i18n";
import { formatFixed } from "../lib/format";
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
  const { t } = useTranslation();
  if (n >= LOW_SAMPLE) return null;
  return (
    <span className="low-tag" title={t("mybets:lowSample.title", { n: LOW_SAMPLE })}>
      {t("mybets:lowSample.label")}
    </span>
  );
}

function StatsCard({ g, title }: { g: GroupStats; title: string }) {
  const { t } = useTranslation();
  return (
    <div className="split-card">
      <h3>
        {title} <LowSampleTag n={g.bets} />
      </h3>
      <dl>
        <div>
          <dt>{t("mybets:column.bets")}</dt>
          <dd>{g.bets}</dd>
        </div>
        <div>
          <dt>{t("mybets:column.hitRate")}</dt>
          <dd>
            {pct(g.hitRate)} <span className="muted small">({g.wins}/{g.decided})</span>
          </dd>
        </div>
        <div>
          <dt>{t("mybets:column.staked")}</dt>
          <dd>{euro(g.ownStaked)}</dd>
        </div>
        <div>
          <dt>{t("mybets:column.profit")}</dt>
          <dd className={moneyClass(g.profit)}>{euro(g.profit, true)}</dd>
        </div>
        <div>
          <dt>{t("mybets:column.roi")}</dt>
          <dd className={moneyClass(g.roi)}>{roiPct(g.roi)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Desglose fijo debajo del bloque principal: con y sin promoción, que suman el total. */
export function PromoSplitCards({ split }: { split: PromoSplit }) {
  const { t } = useTranslation();
  const { withPromo: a, withoutPromo: b, total } = split;
  return (
    <section className="promo-split" aria-label={t("mybets:split.label")}>
      <div className="split-cards">
        <StatsCard g={a} title={t("mybets:column.withPromo")} />
        <StatsCard g={b} title={t("mybets:column.withoutPromo")} />
      </div>
      <p className="small muted">
        {t("mybets:split.note", {
          withBets: a.bets,
          withoutBets: b.bets,
          totalBets: total.bets,
          withProfit: euro(a.profit, true),
          withoutProfit: euro(b.profit, true),
          totalProfit: euro(total.profit, true),
        })}
      </p>
    </section>
  );
}

/** Evidencia estadística de una promoción: acierto necesario e intervalo de Wilson. */
export function PromoEvidenceCard({ e }: { e: PromoEvidence }) {
  const { t } = useTranslation();
  return (
    <div className="evidence-card">
      <h3>
        {e.promo} <LowSampleTag n={e.decided} />
      </h3>
      <p>
        <Trans i18nKey="mybets:evidence.bets" count={e.bets} components={{ bold: <strong /> }} /> ·{" "}
        <Trans
          i18nKey="mybets:evidence.wins"
          count={e.wins}
          values={{ decided: e.decided, pct: pct(e.hitRate) }}
          components={{ bold: <strong /> }}
        />{" "}
        ·{" "}
        <Trans
          i18nKey="mybets:evidence.profit"
          values={{ profit: euro(e.profit, true) }}
          components={{ money: <span className={moneyClass(e.profit)} /> }}
        />
      </p>
      {e.breakEven !== null && e.avgOdds !== null && (
        <p className="small">
          <Trans
            i18nKey="mybets:evidence.breakEven"
            values={{ odds: formatFixed(e.avgOdds, 2), pct: pct(e.breakEven, 1) }}
            components={{ bold: <strong /> }}
          />
        </p>
      )}
      {e.ci && (
        <p className="small">
          <Trans
            i18nKey="mybets:evidence.interval"
            values={{ low: pct(e.ci[0]), high: pct(e.ci[1]) }}
            components={{ bold: <strong /> }}
          />
        </p>
      )}
      <p className={`small ${e.supported ? "ev-positive" : "muted"}`}>
        {e.supported ? t("mybets:evidence.supported") : t("mybets:evidence.notSupported")} {t("mybets:evidence.past")}
      </p>
    </div>
  );
}

function HabitsColumn({ title, h, n }: { title: string; h: Habits; n: number }) {
  const { t } = useTranslation();
  return (
    <div className="split-card">
      <h3>
        {title} <LowSampleTag n={n} />
      </h3>
      <ul className="bets-habits">
        <li>
          <Trans i18nKey="mybets:habits.worst" count={h.longestLosingStreak} components={{ bold: <strong /> }} /> ·{" "}
          <Trans i18nKey="mybets:habits.best" count={h.longestWinningStreak} components={{ bold: <strong /> }} />
        </li>
        {h.stakeAfterLoss !== null && h.stakeAfterWin !== null && (
          <li>
            <Trans
              i18nKey="mybets:habits.stakes"
              values={{ afterLoss: euro(h.stakeAfterLoss), afterWin: euro(h.stakeAfterWin) }}
              components={{ bold: <strong /> }}
            />{" "}
            {h.stakeAfterLoss > h.stakeAfterWin * 1.2 ? t("mybets:habits.chasing") : t("mybets:habits.notChasing")}
            <span className="muted">
              {" "}
              {t("mybets:habits.cases", { loss: h.afterLossSamples, win: h.afterWinSamples })}
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
  const { t } = useTranslation();
  return (
    <section id="habitos">
      <h2>{t("mybets:habits.title")}</h2>
      <div className="split-cards">
        <HabitsColumn title={t("mybets:habits.all")} h={all} n={allCount} />
        <HabitsColumn title={t("mybets:habits.withoutPromo")} h={withoutPromo} n={withoutPromoCount} />
      </div>
      <p className="small muted">{t("mybets:habits.fixedNote")}</p>
      <p className="small muted">
        {t("mybets:habits.normal")}
        {expectedStreak !== null &&
          ` ${t("mybets:habits.expected", { pct: pct(hitRate), n: allCount, streak: expectedStreak })}`}
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
  const { t } = useTranslation();
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
        <span className="small muted">{t("mybets:teams.won", { wins: g.wins, decided: g.decided })}</span>
      </p>
      <p className="small">
        <Trans
          i18nKey="mybets:teams.implied"
          values={{ pct: pct(g.impliedRate), gap: signedPp(gap) }}
          components={{ gap: <span className={moneyClass(gap)} /> }}
        />
      </p>
      <p className="small">
        <Trans
          i18nKey="mybets:teams.profit"
          values={{ profit: euro(g.profit, true) }}
          components={{ bold: <strong className={moneyClass(g.profit)} /> }}
        />
        {g.roi !== null && (
          <span className={`muted ${moneyClass(g.roi)}`}>{t("mybets:teams.roi", { roi: roiPct(g.roi) })}</span>
        )}
      </p>
    </div>
  );
}

function TeamCards({ title, groups }: { title: string; groups: TeamGroup[] }) {
  const { t } = useTranslation();
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
          {t("mybets:teams.showAll", { n: groups.length })}
        </button>
      )}
    </>
  );
}

/** Con qué equipos y con qué tenistas aciertas más, de más a menos acierto. */
export function TeamsSection({ groups }: { groups: TeamGroup[] }) {
  const { t } = useTranslation();
  if (groups.length === 0) return null;
  return (
    <section id="equipos">
      <h2>{t("mybets:teams.title")}</h2>
      <p className="small muted">{t("mybets:teams.note")}</p>
      <TeamCards title={t("mybets:teams.teams")} groups={groups.filter((g) => g.sport === "Fútbol")} />
      <TeamCards title={t("mybets:teams.players")} groups={groups.filter((g) => g.sport === "Tenis")} />
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

/** Campos del extracto; su rotulo, en mybets:realMoney.field.<campo>. */
const FIELDS = ["opening", "deposited", "withdrawn", "closing"] as const;

type Field = (typeof FIELDS)[number];

function fmtDay(d: string | null): string {
  return d ? new Date(d).toLocaleDateString(currentLocale(), { day: "numeric", month: "short", year: "numeric" }) : "—";
}

/** Por qué no coinciden el resultado real de un año y el calculado con las apuestas. */
function DiffCauses({ history }: { history: MoneyHistory }) {
  const { t } = useTranslation();
  return (
    <ul className="small">
      <li>{t("mybets:realMoney.cause.missing", { from: fmtDay(history.first), to: fmtDay(history.last) })}</li>
      {history.pending > 0 && <li>{t("mybets:realMoney.cause.pending", { count: history.pending })}</li>}
      <li>{t("mybets:realMoney.cause.bonuses", { freebet: euro(history.freebetProfit, true) })}</li>
      <li>{t("mybets:realMoney.cause.december")}</li>
      <li>{t("mybets:realMoney.cause.otherProducts")}</li>
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
  const { t } = useTranslation();
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
    const values = Object.fromEntries(FIELDS.map((key) => [key, parseEuros(draft[key])])) as Record<Field, number | null>;
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
        {FIELDS.map((key) => (
          <label key={key}>
            <span className="small">{t(`mybets:realMoney.field.${key}`)}</span>
            <input
              inputMode="decimal"
              placeholder={key === "opening" && previousClosing !== null ? toInput(previousClosing) : "0,00"}
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            />
          </label>
        ))}
        <button type="button" className="tab-button tab-button-active" onClick={save}>
          {t("mybets:realMoney.save")}
        </button>
      </div>
      <p className="small muted">{t("mybets:realMoney.emptyNote")}</p>

      {result !== null && diff !== null && (
        <div className="real-money-result">
          <p>
            <Trans
              i18nKey="mybets:realMoney.yearResult"
              values={{ year, result: euro(result, true) }}
              components={{ bold: <strong className={moneyClass(result)} /> }}
            />
            <br />
            <Trans
              i18nKey="mybets:realMoney.yearCalculated"
              count={history.bets}
              values={{ book: bookmaker, year, profit: euro(history.profit, true) }}
              components={{ bold: <strong className={moneyClass(history.profit)} /> }}
            />
          </p>
          {openingMismatch && (
            <p className="small bets-warning">
              {t("mybets:realMoney.openingMismatch", {
                opening: euro(money.opening),
                year: Number(year) - 1,
                closing: euro(previousClosing),
              })}
            </p>
          )}
          {Math.abs(diff) < 1 ? (
            <p className="small">{t("mybets:realMoney.match")}</p>
          ) : (
            <>
              <p className="small">
                <Trans
                  i18nKey="mybets:realMoney.difference"
                  values={{ diff: euro(Math.abs(diff)) }}
                  components={{ bold: <strong /> }}
                />
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
  const { t } = useTranslation();
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
  const joinBooks = (list: Bookmaker[]) => list.map((b) => BOOKMAKER_LABELS[b]).join(t("common:listAnd"));

  return (
    <section id="dinero-real">
      <h2>{year ? t("mybets:realMoney.titleYear", { year }) : t("mybets:realMoney.title")}</h2>
      <p className="small muted">{t("mybets:realMoney.note")}</p>
      {selectedRow && (
        <div className="real-money-year-total">
          <p>
            <Trans
              i18nKey={byBook ? "mybets:realMoney.yearTotalBooks" : "mybets:realMoney.yearTotal"}
              values={{ year: selectedRow.year, books: bookNames, total: euro(selectedRow.real, true) }}
              components={{ bold: <strong className={`bets-hero-mid ${moneyClass(selectedRow.real)}`} /> }}
            />
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
                    <span className="muted">{c.hasBets ? t("mybets:realMoney.notEntered") : t("mybets:realMoney.noBets")}</span>
                  )}
                </span>
              ))}
            </p>
          )}
          <p className="small muted">
            {t("mybets:realMoney.calculated", { year: selectedRow.year, calc: euro(selectedRow.calc, true) })}
            {selectedRow.missing.length > 0 &&
              ` ${t("mybets:realMoney.missingBooks", { books: joinBooks(selectedRow.missing) })}`}
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
        <p className="small">{t("mybets:realMoney.chooseYear")}</p>
      )}

      {rows.length > 0 && (
        <>
          <h3>{t("mybets:year.title")}</h3>
          <div className="table-scroll">
            <table className="predictions-table">
              <thead>
                <tr>
                  <th>{t("mybets:column.year")}</th>
                  {byBook && books.map((b) => <th key={b} className="num">{BOOKMAKER_LABELS[b]}</th>)}
                  <th className="num">{byBook ? t("mybets:realMoney.totalReal") : t("mybets:realMoney.resultReal")}</th>
                  <th className="num">{t("mybets:realMoney.calculatedColumn")}</th>
                  <th className="num">{t("mybets:column.difference")}</th>
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
                          <span className="low-tag">{t("mybets:realMoney.missingTag", { books: joinBooks(r.missing) })}</span>
                        </>
                      )}
                    </td>
                    {byBook &&
                      r.cells.map((c) => (
                        <td key={c.book} className={`num ${moneyClass(c.result)}`}>
                          {c.result !== null ? euro(c.result, true) : c.hasBets ? t("mybets:realMoney.missingCell") : "—"}
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
                      <strong>{t("mybets:realMoney.sumYears")}</strong>
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
            <Trans
              i18nKey={`mybets:realMoney.summary.${byBook ? "books" : "one"}.${total >= 0 ? "won" : "lost"}`}
              values={{ books: joinBooks(books), amount: euro(Math.abs(total)) }}
              components={{ bold: <strong className={moneyClass(total)} /> }}
            />
            {rows.some((r) => r.missing.length > 0) && ` ${t("mybets:realMoney.incomplete")}`}
          </p>
        </>
      )}

      {wholeAccounts.map((book) => {
        const money = realMoney[book]?.[WHOLE_ACCOUNT] ?? EMPTY_REAL_MONEY;
        const result = realResult(money);
        const h = history({ book, period: WHOLE_ACCOUNT });
        return (
          <div key={book} className="real-money">
            <h3>{t("mybets:realMoney.whole.title", { book: BOOKMAKER_LABELS[book] })}</h3>
            <p className="small">
              <Trans
                i18nKey="mybets:realMoney.whole.text"
                count={h.bets}
                values={{
                  deposited: euro(money.deposited),
                  withdrawn: euro(money.withdrawn),
                  closing: euro(money.closing),
                  result: euro(result, true),
                  profit: euro(h.profit, true),
                  book: BOOKMAKER_LABELS[book],
                }}
                components={{
                  result: <strong className={moneyClass(result)} />,
                  profit: <strong className={moneyClass(h.profit)} />,
                }}
              />
            </p>
            <p className="small muted">{t("mybets:realMoney.whole.note")}</p>
            <button
              type="button"
              className="tab-button"
              onClick={() => {
                if (window.confirm(t("mybets:realMoney.whole.confirm", { book: BOOKMAKER_LABELS[book] }))) {
                  onSave({ book, period: WHOLE_ACCOUNT }, null);
                }
              }}
            >
              {t("mybets:realMoney.whole.delete")}
            </button>
          </div>
        );
      })}
    </section>
  );
}
