import { useMemo, useState, type ChangeEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { PageHero } from "../components/PageHero";
import { currentLocale, t } from "../i18n";
import { formatFixed } from "../lib/format";
import { MonthlyChart } from "../components/MonthlyChart";
import {
  HabitsBlock,
  LowSampleTag,
  TeamsSection,
  PromoEvidenceCard,
  PromoSplitCards,
  RealMoneySection,
} from "../components/MyBetsSections";
import { ProfitChart } from "../components/ProfitChart";
import { SectionNav } from "../components/SectionNav";
import {
  DAY_PARTS,
  ODDS_BUCKETS,
  STAKE_BUCKETS,
  TYPE_ORDER,
  WEEKDAYS,
  betType,
  biggestLeaks,
  builderSelections,
  cumulativeProfit,
  dayPart,
  expectedLongestLosingStreak,
  groupBy,
  habits,
  hasPromotion,
  insights,
  monthLabel,
  monthlySplit,
  inPeriod,
  yearlySplit,
  NO_PROMOTION,
  oddsBucket,
  promotionGroups,
  settle,
  singleMarket,
  sportOf,
  stakeBucket,
  summarize,
  moneyHistory,
  weekday,
  yearKey,
  stats,
  type GroupStats,
  type MoneyHistory,
  type MonthSplit,
  type SettledBet,
  type Summary,
} from "../lib/betHistory/analysis";
import { looksLikeBet365, parseBet365History } from "../lib/betHistory/bet365";
import { LOW_SAMPLE, euro, moneyClass, pct, roiPct, roiPer100, signedPp } from "../lib/betHistory/format";
import { dimensionLabel, groupLabel, warningLabel } from "../lib/betHistory/labels";
import { teamGroups } from "../lib/betHistory/teams";
import { getTeamCrest } from "../lib/logos";
import { excludingPromotions, fixedStakePromotions, promoEvidence, promoSplit } from "../lib/betHistory/promotions";
import {
  BackupError,
  backupFileName,
  clearBets,
  describeUpdate,
  exportBackup,
  hasRealMoney,
  loadBets,
  loadRealMoney,
  mergeBets,
  parseBackup,
  saveBets,
  saveRealMoney,
  type Backup,
  type BetUpdate,
  type RealMoney,
  type RealMoneyByBook,
  WHOLE_ACCOUNT,
} from "../lib/betHistory/storage";
import { BOOKMAKER_LABELS, type Bookmaker, type ParsedBet } from "../lib/betHistory/types";
import { parseWinamaxHistory } from "../lib/betHistory/winamax";

const BOOKMAKERS = Object.keys(BOOKMAKER_LABELS) as Bookmaker[];

/** Un año ("2026") o toda la cuenta (WHOLE_ACCOUNT) de una casa. */
type MoneyPeriod = { book: Bookmaker; period: string };

type ImportTag = "added" | "updated";

/** Un error de importacion: `key`, la clave de su texto (sale del idioma
 * actual al pintarlo); `text`, un mensaje que no es nuestro. */
type ImportReport =
  | { kind: "error"; key: string; text?: string }
  | { kind: "cleared" }
  | {
      kind: "done";
      source: "html" | "backup";
      read: number;
      added: ParsedBet[];
      updated: BetUpdate[];
      unchanged: number;
      failed: number;
      withWarnings: number;
      total: number;
      saved: boolean;
    };

/** "Deportivo de A Coruña – Real Betis (20/09)" o, en combinadas, el número de selecciones. */
function betTitle(b: ParsedBet): string {
  if (b.legs.length > 1) {
    return t("mybets:import.comboTitle", {
      type: b.typeLabel || t("mybets:import.combo"),
      participants: b.legs.map((l) => l.participants[0] ?? "?").join(", "),
    });
  }
  const leg = b.legs[0];
  if (!leg) return b.ref ?? b.id;
  return `${leg.participants.slice(0, 2).join(" – ")}${leg.eventDate ? ` (${leg.eventDate})` : ""}`;
}

/** El error de una copia o de lo pegado, para guardarlo en el informe. */
function importError(err: unknown): ImportReport {
  if (err instanceof BackupError) return { kind: "error", key: `mybets:backupError.${err.code}` };
  return err instanceof Error
    ? { kind: "error", key: "", text: err.message }
    : { kind: "error", key: "mybets:import.backupUnreadable" };
}

export function MyBetsPage() {
  const { t } = useTranslation();
  const [bets, setBets] = useState<ParsedBet[]>(() => loadBets());
  const [report, setReport] = useState<ImportReport | null>(null);
  const [lastImport, setLastImport] = useState<Map<string, ImportTag>>(new Map());
  const [backupText, setBackupText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  /** Año natural elegido ("2026"), "all" para todos; null = el más reciente con apuestas. */
  const [yearChoice, setYearChoice] = useState<string | null>(null);
  const [book, setBook] = useState<Bookmaker | "">("");
  const [sport, setSport] = useState("");
  /** Mes elegido en la vista mensual ("2026-10"); tiene prioridad sobre el año. */
  const [month, setMonth] = useState<string | null>(null);
  const [realMoney, setRealMoney] = useState<RealMoneyByBook>(() => loadRealMoney());

  /** Guarda (o, con null, borra) el dinero real de una casa en un año o en toda la cuenta. */
  function onSaveRealMoney({ book: k, period }: MoneyPeriod, m: RealMoney | null) {
    const periods = { ...realMoney[k] };
    if (m) periods[period] = m;
    else delete periods[period];
    const next = { ...realMoney, [k]: periods };
    setRealMoney(next);
    saveRealMoney(next);
  }

  /** Restaura una copia: une las apuestas y, en cada casa y año sin dinero real apuntado aquí, toma el de la copia. */
  function restoreBackup(backup: Backup) {
    applyIncoming(backup.bets, 0, "backup");
    let next = realMoney;
    for (const k of BOOKMAKERS) {
      for (const [period, m] of Object.entries(backup.realMoney?.[k] ?? {})) {
        if (!hasRealMoney(next[k]?.[period])) next = { ...next, [k]: { ...next[k], [period]: m } };
      }
    }
    if (next !== realMoney) {
      setRealMoney(next);
      saveRealMoney(next);
    }
  }

  function importHtml(html: string) {
    // Una copia de seguridad pegada como texto (plan B si el navegador no deja subir o descargar archivos).
    if (/^\s*[[{]/.test(html)) {
      try {
        restoreBackup(parseBackup(html));
        setPasted("");
      } catch (err) {
        setReport(importError(err));
      }
      return;
    }
    const { bets: parsed, failed } = looksLikeBet365(html) ? parseBet365History(html) : parseWinamaxHistory(html);
    if (parsed.length === 0) {
      setReport({ kind: "error", key: "mybets:import.noBets" });
      return;
    }
    applyIncoming(parsed, failed, "html");
    setPasted("");
  }

  /** Une apuestas nuevas (de un HTML o de una copia) con las guardadas y muestra el resultado. */
  function applyIncoming(parsed: ParsedBet[], failed: number, source: "html" | "backup") {
    const { bets: merged, added, updated, unchanged } = mergeBets(bets, parsed);
    setBets(merged);
    setLastImport(
      new Map<string, ImportTag>([
        ...added.map((b) => [b.id, "added"] as const),
        ...updated.map((u) => [u.after.id, "updated"] as const),
      ]),
    );
    setReport({
      kind: "done",
      source,
      read: added.length + updated.length + unchanged.length,
      added,
      updated,
      unchanged: unchanged.length,
      failed,
      withWarnings: parsed.filter((b) => b.warnings.length).length,
      total: merged.length,
      saved: saveBets(merged),
    });
  }

  function onDownloadBackup() {
    const content = exportBackup(bets, realMoney);
    setBackupText(content);
    setCopied(false);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = backupFileName();
    link.style.display = "none";
    // El enlace tiene que estar en la página para que todos los navegadores
    // respeten el clic, y el archivo no se libera hasta que la descarga empieza.
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function onCopyBackup() {
    if (!backupText) return;
    try {
      await navigator.clipboard.writeText(backupText);
      setCopied(true);
    } catch {
      // Sin acceso al portapapeles: el texto queda seleccionado en el cuadro para copiarlo a mano.
      const area = document.getElementById("backup-text") as HTMLTextAreaElement | null;
      area?.select();
    }
  }

  async function onRestore(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      restoreBackup(parseBackup(await file.text()));
    } catch (err) {
      setReport(importError(err));
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importHtml(await file.text());
    e.target.value = "";
  }

  function onClear() {
    if (!window.confirm(t("mybets:import.confirmClear"))) return;
    clearBets();
    setBets([]);
    setRealMoney({});
    setLastImport(new Map());
    setReport({ kind: "cleared" });
  }

  const sports = useMemo(() => [...new Set(bets.map(sportOf))].sort((a, b) => a.localeCompare(b, "es")), [bets]);

  const books = useMemo(() => BOOKMAKERS.filter((k) => bets.some((b) => b.bookmaker === k)), [bets]);
  // Años naturales con apuestas, del más reciente al más antiguo.
  const allYears = useMemo(
    () => [...new Set(bets.map(yearKey).filter((y): y is string => y !== null))].sort().reverse(),
    [bets],
  );
  const year =
    yearChoice === "all" ? null : yearChoice && allYears.includes(yearChoice) ? yearChoice : (allYears[0] ?? null);

  // La casa y el deporte se aplican a todo, también a las vistas por año y por mes.
  const base = useMemo(
    () => bets.filter((b) => (!book || b.bookmaker === book) && (!sport || sportOf(b) === sport)),
    [bets, book, sport],
  );
  // El mes elegido (o, si no hay, el año) filtra el resto de la página.
  const filtered = useMemo(() => {
    if (month) return base.filter((b) => inPeriod(b, month));
    return year ? base.filter((b) => inPeriod(b, year)) : base;
  }, [base, month, year]);

  const settled = useMemo(() => filtered.map(settle).filter((r): r is SettledBet => r !== null), [filtered]);
  const baseSettled = useMemo(() => base.map(settle).filter((r): r is SettledBet => r !== null), [base]);
  const months = useMemo(() => monthlySplit(baseSettled), [baseSettled]);
  const years = useMemo(() => yearlySplit(baseSettled), [baseSettled]);

  // Para comparar con el dinero real: las apuestas de la casa en ese año (o todas), de todos los deportes.
  const moneyHistoryOf = useMemo(() => {
    const cache = new Map<string, MoneyHistory>();
    return ({ book: k, period }: MoneyPeriod): MoneyHistory => {
      const id = `${k}|${period}`;
      if (!cache.has(id)) {
        const rows = bets.filter((b) => b.bookmaker === k && (period === WHOLE_ACCOUNT || yearKey(b) === period));
        cache.set(id, moneyHistory(rows));
      }
      return cache.get(id) as MoneyHistory;
    };
  }, [bets]);

  function selectYear(key: string | null) {
    setYearChoice(key ?? "all");
    setMonth(null);
  }

  return (
    <div>
      <PageHero title={t("nav:myBets")} lead={<p>{t("mybets:page.lead")}</p>} />

      <section className="bets-import">
        <p className="small muted">
          <Trans i18nKey="mybets:import.privacy" components={{ bold: <strong /> }} />
        </p>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={t("mybets:import.placeholder")}
          rows={5}
          aria-label={t("mybets:import.textareaLabel")}
        />
        <div className="filters">
          <button type="button" className="tab-button tab-button-active" disabled={!pasted.trim()} onClick={() => importHtml(pasted)}>
            {t("mybets:import.analyze")}
          </button>
          <label className="tab-button bets-file">
            {t("mybets:import.upload")}
            <input type="file" accept=".html,.htm,.txt,text/html" onChange={onFile} />
          </label>
          {bets.length > 0 && (
            <button type="button" className="tab-button" onClick={onDownloadBackup}>
              {t("mybets:import.download", { n: bets.length })}
            </button>
          )}
          <label className="tab-button bets-file">
            {t("mybets:import.restore")}
            <input type="file" accept=".json,application/json" onChange={onRestore} />
          </label>
          {bets.length > 0 && (
            <button type="button" className="tab-button" onClick={onClear}>
              {t("mybets:import.clear")}
            </button>
          )}
        </div>
        {report && <ImportReportPanel report={report} onClose={() => setReport(null)} />}
        {backupText && (
          <div className="import-report" role="status">
            <button
              type="button"
              className="import-report-close"
              onClick={() => setBackupText(null)}
              aria-label={t("mybets:import.close")}
            >
              ×
            </button>
            <p className="import-report-title">
              <Trans
                i18nKey="mybets:backup.ready"
                count={bets.length}
                values={{ file: backupFileName() }}
                components={{ file: <code /> }}
              />
            </p>
            <p className="small">
              <Trans i18nKey="mybets:backup.help" components={{ file: <code /> }} />
            </p>
            <div className="filters">
              <button type="button" className="tab-button tab-button-active" onClick={onCopyBackup}>
                {copied ? t("mybets:backup.copied") : t("mybets:backup.copy")}
              </button>
            </div>
            <textarea
              id="backup-text"
              className="backup-text"
              readOnly
              value={backupText}
              rows={3}
              aria-label={t("mybets:backup.label")}
            />
          </div>
        )}
        <details className="small muted">
          <summary>{t("mybets:howTo.winamax.title")}</summary>
          <ol>
            <li>
              <Trans i18nKey="mybets:howTo.winamax.step1" components={{ bold: <strong /> }} />
            </li>
            <li>
              <Trans i18nKey="mybets:howTo.winamax.step2" components={{ bold: <strong /> }} />
            </li>
            <li>
              <Trans i18nKey="mybets:howTo.winamax.step3" components={{ bold: <strong /> }} />
            </li>
            <li>{t("mybets:howTo.winamax.step4")}</li>
          </ol>
        </details>
        <details className="small muted">
          <summary>{t("mybets:howTo.bet365.title")}</summary>
          <ol>
            <li>
              <Trans i18nKey="mybets:howTo.bet365.step1" components={{ bold: <strong /> }} />
            </li>
            <li>{t("mybets:howTo.bet365.step2")}</li>
            <li>{t("mybets:howTo.bet365.step3")}</li>
            <li>{t("mybets:howTo.bet365.step4")}</li>
          </ol>
        </details>
      </section>

      {bets.length === 0 ? (
        <p className="muted">{t("mybets:page.empty")}</p>
      ) : (
        <>
          <div className="filters">
            <select
              aria-label={t("mybets:filter.year")}
              value={year ?? "all"}
              onChange={(e) => selectYear(e.target.value === "all" ? null : e.target.value)}
            >
              {allYears.map((y) => (
                <option key={y} value={y}>
                  {t("mybets:filter.yearOption", { year: y })}
                </option>
              ))}
              <option value="all">{t("mybets:filter.allYears")}</option>
            </select>
            {books.length > 1 && (
              <select aria-label={t("mybets:filter.book")} value={book} onChange={(e) => setBook(e.target.value as Bookmaker | "")}>
                <option value="">{t("mybets:filter.allBooks")}</option>
                {books.map((k) => (
                  <option key={k} value={k}>
                    {BOOKMAKER_LABELS[k]}
                  </option>
                ))}
              </select>
            )}
            <select aria-label={t("mybets:filter.sport")} value={sport} onChange={(e) => setSport(e.target.value)}>
              <option value="">{t("mybets:filter.allSports")}</option>
              {sports.map((s) => (
                <option key={s} value={s}>
                  {groupLabel(s)}
                </option>
              ))}
            </select>
            {month && (
              <button
                type="button"
                className="month-chip"
                onClick={() => setMonth(null)}
                aria-label={t("mybets:filter.clearMonth")}
              >
                {t("mybets:filter.month", { month: monthLabel(month) })} <span aria-hidden="true">✕</span>
              </button>
            )}
          </div>
          {settled.length === 0 ? (
            <p className="muted">{t("mybets:filter.noSettled")}</p>
          ) : (
            <Analysis
              bets={filtered}
              settled={settled}
              months={months}
              years={years}
              baseSettled={baseSettled}
              books={book ? [book] : books}
              year={year}
              onSelectYear={selectYear}
              selectedMonth={month}
              onSelectMonth={setMonth}
              realMoney={realMoney}
              onSaveRealMoney={onSaveRealMoney}
              moneyHistoryOf={moneyHistoryOf}
              lastImport={lastImport}
            />
          )}
        </>
      )}
    </div>
  );
}

function ImportReportPanel({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  const { t } = useTranslation();
  const close = (
    <button type="button" className="import-report-close" onClick={onClose} aria-label={t("mybets:import.close")}>
      ×
    </button>
  );
  if (report.kind === "error") {
    return (
      <div className="import-report import-report-error" role="alert">
        <p>{report.key ? t(report.key) : report.text}</p>
        {close}
      </div>
    );
  }
  if (report.kind === "cleared") {
    return (
      <div className="import-report" role="status">
        <p>{t("mybets:import.cleared")}</p>
        {close}
      </div>
    );
  }
  const nothingNew = report.added.length === 0 && report.updated.length === 0;
  const chip = (key: string, n: number) => <Trans i18nKey={`mybets:import.chip.${key}`} count={n} components={{ bold: <strong /> }} />;
  return (
    <div className="import-report" role="status">
      {close}
      <p className="import-report-title">
        {nothingNew
          ? t(report.source === "backup" ? "mybets:import.nothingNewBackup" : "mybets:import.nothingNewHtml", { count: report.read })
          : t(report.source === "backup" ? "mybets:import.doneBackup" : "mybets:import.doneHtml", { count: report.read })}
      </p>
      <div className="import-chips">
        <span className={`import-chip import-chip-added${report.added.length ? "" : " import-chip-zero"}`}>
          {chip("added", report.added.length)}
        </span>
        <span className={`import-chip import-chip-updated${report.updated.length ? "" : " import-chip-zero"}`}>
          {chip("updated", report.updated.length)}
        </span>
        <span className={`import-chip import-chip-unchanged${report.unchanged ? "" : " import-chip-zero"}`}>
          {chip("unchanged", report.unchanged)}
        </span>
        {report.withWarnings > 0 && (
          <span className="import-chip import-chip-warning">{chip("warnings", report.withWarnings)}</span>
        )}
        {report.failed > 0 && <span className="import-chip import-chip-error">{chip("failed", report.failed)}</span>}
      </div>
      {report.updated.length > 0 && (
        <div className="import-report-list">
          <p className="small">{t("mybets:import.whatChanged")}</p>
          <ul>
            {report.updated.slice(0, 8).map((u) => (
              <li key={u.after.id}>
                {betTitle(u.after)}: <strong>{describeUpdate(u)}</strong>
              </li>
            ))}
            {report.updated.length > 8 && <li className="muted">{t("mybets:import.andMore", { n: report.updated.length - 8 })}</li>}
          </ul>
        </div>
      )}
      <p className="small muted">
        <Trans i18nKey="mybets:import.total" count={report.total} components={{ bold: <strong /> }} />
        {!report.saved && ` ${t("mybets:import.notSaved")}`}
      </p>
    </div>
  );
}

function Headline({ s, period }: { s: Summary; period: string }) {
  const { t } = useTranslation();
  const gap = s.hitRate !== null && s.impliedRate !== null ? s.hitRate - s.impliedRate : null;
  const share = (n: number) => (s.bets ? `${(100 * n) / s.bets}%` : "0%");
  return (
    <section className="bets-hero" aria-label={t("mybets:hero.label")}>
      <div className="bets-hero-top">
        <div className="bets-hero-profit">
          <span className="bets-hero-label">
            {t("mybets:hero.netProfit", { period })} <LowSampleTag n={s.bets} />
          </span>
          <span className={`bets-hero-value ${moneyClass(s.profit)}`}>{euro(s.profit, true)}</span>
          <span className="small muted">
            {t("mybets:hero.split", { own: euro(s.ownProfit, true), freebet: euro(s.freebetProfit, true) })}
          </span>
        </div>
        <div className="bets-hero-record">
          <div className="bets-record-numbers">
            <span>
              <Trans i18nKey="mybets:hero.wins" count={s.wins} components={{ bold: <strong className="ev-positive" /> }} />
            </span>
            <span>
              <Trans i18nKey="mybets:hero.losses" count={s.losses} components={{ bold: <strong className="ev-negative" /> }} />
            </span>
            {s.cashouts > 0 && (
              <span className="muted small">
                <Trans i18nKey="mybets:hero.cashouts" values={{ n: s.cashouts }} components={{ bold: <strong /> }} />
              </span>
            )}
          </div>
          <div
            className="bets-record-bar"
            role="img"
            aria-label={t(s.cashouts ? "mybets:hero.barLabelCashout" : "mybets:hero.barLabel", {
              wins: t("mybets:hero.winsText", { count: s.wins }),
              losses: t("mybets:hero.lossesText", { count: s.losses }),
              cashouts: t("mybets:hero.cashoutsText", { count: s.cashouts }),
            })}
          >
            <span className="bets-record-won" style={{ width: share(s.wins) }} />
            <span className="bets-record-lost" style={{ width: share(s.losses) }} />
            {s.cashouts > 0 && <span className="bets-record-cashout" style={{ width: share(s.cashouts) }} />}
          </div>
          <span className="small muted">
            {s.cashouts > 0
              ? t("mybets:hero.settledCashout", { count: s.bets, wins: s.wins, losses: s.losses, cashouts: s.cashouts })
              : t("mybets:hero.settled", { count: s.bets, wins: s.wins, losses: s.losses })}
          </span>
        </div>
      </div>
      <div className="bets-hero-second">
        <div>
          <span className="bets-hero-label">{t("mybets:hero.roi")}</span>
          <span className={`bets-hero-mid ${moneyClass(s.roi)}`}>{roiPct(s.roi, 1)}</span>
          <span className="small muted">{roiPer100(s.roi)}</span>
        </div>
        <div>
          <span className="bets-hero-label">{t("mybets:hero.staked")}</span>
          <span className="bets-hero-mid">{euro(s.ownStaked)}</span>
          <span className="small muted bets-hero-hint">{t("mybets:hero.stakedHint")}</span>
        </div>
        <div>
          <span className="bets-hero-label">{t("mybets:hero.hitVsOdds")}</span>
          <span className="bets-hero-mid">
            {pct(s.hitRate, 1)} <span className="muted small">{t("mybets:hero.versus")}</span> {pct(s.impliedRate, 1)}
          </span>
          <span className={`small ${moneyClass(gap)}`}>
            {signedPp(gap)} {gap !== null && (gap < 0 ? t("mybets:hero.below") : t("mybets:hero.above"))}
          </span>
        </div>
      </div>
      {(s.voids > 0 || s.pending > 0) && (
        <p className="small muted bets-hero-note">
          {t("mybets:hero.notCounted", {
            items: [
              s.voids > 0 ? t("mybets:hero.voids", { count: s.voids }) : null,
              s.pending > 0 ? t("mybets:hero.pending", { n: s.pending }) : null,
            ]
              .filter(Boolean)
              .join(" · "),
          })}
        </p>
      )}
    </section>
  );
}

function MonthlyTable({
  months,
  selected,
  onSelect,
  unit = "month",
}: {
  months: MonthSplit[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  unit?: "month" | "year";
}) {
  const { t } = useTranslation();
  return (
    <div className="table-scroll">
      <table className="predictions-table">
        <thead>
          <tr>
            <th>{t(`mybets:column.${unit}`)}</th>
            <th className="num">{t("mybets:column.bets")}</th>
            <th className="num">{t("mybets:column.hitRate")}</th>
            <th className="num">{t("mybets:column.staked")}</th>
            <th className="num">{t("mybets:column.profit")}</th>
            <th className="num">{t("mybets:column.withoutPromo")}</th>
            <th className="num">{t("mybets:column.withPromo")}</th>
            <th className="num">{t("mybets:column.roi")}</th>
          </tr>
        </thead>
        <tbody>
          {[...months].reverse().map(({ key, total: m, withPromo, withoutPromo }) => {
            const classes = [m.bets < LOW_SAMPLE ? "low-sample-row" : "", selected === key ? "month-row-selected" : ""];
            return (
              <tr key={key} className={classes.join(" ").trim() || undefined}>
                <td className="rec-match">
                  <button
                    type="button"
                    className="month-link"
                    aria-pressed={selected === key}
                    onClick={() => onSelect(selected === key ? null : key)}
                  >
                    {monthLabel(key)}
                  </button>{" "}
                  <LowSampleTag n={m.bets} />
                </td>
                <td className="num">{m.bets}</td>
                <td className="num">
                  {pct(m.hitRate)}
                  <span className="muted small"> ({m.wins}/{m.decided})</span>
                </td>
                <td className="num">{euro(m.ownStaked)}</td>
                <td className={`num ${moneyClass(m.profit)}`}>{euro(m.profit, true)}</td>
                <td className={`num ${moneyClass(withoutPromo.profit)}`}>{euro(withoutPromo.profit, true)}</td>
                <td className={`num ${moneyClass(withPromo.profit)}`}>{euro(withPromo.profit, true)}</td>
                <td className={`num ${moneyClass(m.roi)}`}>{roiPct(m.roi)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Resultado de cada año natural, el periodo con el que se declaran las ganancias del juego. */
function YearSection({
  years,
  settled,
  books,
  selected,
  onSelect,
}: {
  years: MonthSplit[];
  settled: SettledBet[];
  books: Bookmaker[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const { t } = useTranslation();
  const byBook = books.length > 1;
  return (
    <section id="anual">
      <h2>{t("mybets:year.title")}</h2>
      <p className="small muted">{t("mybets:year.note")}</p>
      <div className="table-scroll">
        <table className="predictions-table">
          <thead>
            <tr>
              <th>{t("mybets:column.year")}</th>
              <th className="num">{t("mybets:column.bets")}</th>
              <th className="num">{t("mybets:column.hitRate")}</th>
              <th className="num">{t("mybets:column.staked")}</th>
              <th className="num">{t("mybets:column.profit")}</th>
              {byBook && books.map((k) => <th key={k} className="num">{BOOKMAKER_LABELS[k]}</th>)}
              <th className="num">{t("mybets:column.roi")}</th>
            </tr>
          </thead>
          <tbody>
            {[...years].reverse().map(({ key, total: y }) => (
              <tr key={key} className={selected === key ? "month-row-selected" : undefined}>
                <td className="rec-match">
                  <button
                    type="button"
                    className="month-link"
                    aria-pressed={selected === key}
                    onClick={() => onSelect(selected === key ? null : key)}
                  >
                    {key}
                  </button>{" "}
                  <LowSampleTag n={y.bets} />
                </td>
                <td className="num">{y.bets}</td>
                <td className="num">
                  {pct(y.hitRate)}
                  <span className="muted small"> ({y.wins}/{y.decided})</span>
                </td>
                <td className="num">{euro(y.ownStaked)}</td>
                <td className={`num ${moneyClass(y.profit)}`}>
                  <strong>{euro(y.profit, true)}</strong>
                </td>
                {byBook &&
                  books.map((k) => {
                    const g = stats(k, settled.filter((r) => r.bet.bookmaker === k && yearKey(r.bet) === key));
                    return (
                      <td key={k} className={`num ${moneyClass(g.profit)}`}>
                        {g.bets ? euro(g.profit, true) : "—"}
                      </td>
                    );
                  })}
                <td className={`num ${moneyClass(y.roi)}`}>{roiPct(y.roi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Analysis({
  bets,
  settled,
  months,
  years,
  baseSettled,
  books,
  year,
  onSelectYear,
  selectedMonth,
  onSelectMonth,
  realMoney,
  onSaveRealMoney,
  moneyHistoryOf,
  lastImport,
}: {
  bets: ParsedBet[];
  settled: SettledBet[];
  months: MonthSplit[];
  years: MonthSplit[];
  /** Todas las apuestas resueltas de la casa y el deporte elegidos, de todos los años. */
  baseSettled: SettledBet[];
  books: Bookmaker[];
  year: string | null;
  onSelectYear: (key: string | null) => void;
  selectedMonth: string | null;
  onSelectMonth: (key: string | null) => void;
  realMoney: RealMoneyByBook;
  onSaveRealMoney: (p: MoneyPeriod, m: RealMoney | null) => void;
  moneyHistoryOf: (p: MoneyPeriod) => MoneyHistory;
  lastImport: Map<string, ImportTag>;
}) {
  const { t } = useTranslation();
  const s = summarize(bets, settled);
  const sentences = insights(settled);
  const shownMonths = year ? months.filter((m) => m.key.startsWith(year)) : months;
  const period = selectedMonth
    ? t("mybets:period.in", { period: monthLabel(selectedMonth) })
    : year
      ? t("mybets:period.in", { period: year })
      : t("mybets:period.allYears");
  const dimensions = {
    "Cuota": groupBy(settled, (r) => oddsBucket(r.bet.odds), ODDS_BUCKETS.map((b) => b[2])),
    "Tipo de apuesta": groupBy(settled, (r) => betType(r.bet), TYPE_ORDER),
    "Deporte": groupBy(settled, (r) => sportOf(r.bet)),
    "Mercado (simples)": groupBy(settled, singleMarket),
    "Importe": groupBy(settled, stakeBucket, STAKE_BUCKETS.map((b) => b[2])),
    "Día": groupBy(settled, weekday, WEEKDAYS),
    "Hora": groupBy(settled, dayPart, DAY_PARTS),
    "Promoción": promotionGroups(settled),
  };
  const promos = dimensions["Promoción"].filter((g) => g.key !== NO_PROMOTION);
  const split = promoSplit(settled);
  const withoutPromoRows = settled.filter((r) => !hasPromotion(r.bet));
  const fixedPromos = fixedStakePromotions(settled);
  const stakeWithoutFixed = groupBy(
    excludingPromotions(settled, fixedPromos),
    stakeBucket,
    STAKE_BUCKETS.map((b) => b[2]),
  );
  const evidence = promos
    .filter((g) => /supercuota|superaumento/i.test(g.key))
    .map((g) => promoEvidence(settled, g.key))
    .filter((e) => e !== null);
  // Una sencilla de bet365 sin partido cuenta para el equipo elegido si tiene escudo (no "Empate" ni un jugador).
  const teams = teamGroups(settled, (name) => getTeamCrest(null, name) !== undefined);
  const leaks = biggestLeaks(dimensions);
  const h = habits(settled);
  const builder = builderSelections(settled);

  return (
    <>
      <SectionNav
        label={t("mybets:sections.label")}
        sections={[
          { id: "anual", label: t("mybets:sections.year"), short: t("mybets:sections.yearShort") },
          { id: "mensual", label: t("mybets:sections.month"), short: t("mybets:sections.monthShort") },
          { id: "evolucion", label: t("mybets:sections.evolution") },
          { id: "dinero-real", label: t("mybets:sections.realMoney") },
          ...(leaks.length > 0
            ? [{ id: "donde-pierdes", label: t("mybets:sections.leaks"), short: t("mybets:sections.leaksShort") }]
            : []),
          { id: "por-categoria", label: t("mybets:sections.categories"), short: t("mybets:sections.categoriesShort") },
          ...(promos.length > 0 ? [{ id: "promociones", label: t("mybets:sections.promotions") }] : []),
          { id: "habitos", label: t("mybets:sections.habits") },
          ...(teams.length > 0
            ? [{ id: "equipos", label: t("mybets:sections.teams"), short: t("mybets:sections.teamsShort") }]
            : []),
          { id: "apuestas", label: t("mybets:sections.bets"), short: t("mybets:sections.betsShort") },
        ]}
      />
      <Headline s={s} period={period} />
      <PromoSplitCards split={split} />

      {settled.length < 30 && (
        <p className="small muted intro-note">{t("mybets:fewBets", { count: settled.length })}</p>
      )}

      {sentences.length > 0 && (
        <div className="bets-insights">
          {sentences.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>
      )}

      <YearSection years={years} settled={baseSettled} books={books} selected={year} onSelect={onSelectYear} />

      <section id="mensual">
        <h2>{year ? t("mybets:month.titleYear", { year }) : t("mybets:month.title")}</h2>
        <p className="small muted">{t("mybets:month.note")}</p>
        <MonthlyChart months={shownMonths} selected={selectedMonth} onSelect={onSelectMonth} />
        <MonthlyTable months={shownMonths} selected={selectedMonth} onSelect={onSelectMonth} />
        <p className="small muted">{t("mybets:month.lowSample", { n: LOW_SAMPLE })}</p>
      </section>

      <section id="evolucion">
        <h2>{year && !selectedMonth ? t("mybets:evolution.titleYear", { year }) : t("mybets:evolution.title")}</h2>
        <ProfitChart points={cumulativeProfit(settled)} />
      </section>

      <RealMoneySection
        books={books}
        year={year}
        realMoney={realMoney}
        history={moneyHistoryOf}
        onSave={onSaveRealMoney}
      />

      {leaks.length > 0 && (
        <section className="bets-leaks" id="donde-pierdes">
          <h2>{t("mybets:leaks.title")}</h2>
          <ul>
            {leaks.map(({ dimension, group }) => (
              <li key={`${dimension}-${group.key}`}>
                <Trans
                  i18nKey={
                    group.hitRate !== null && group.impliedRate !== null ? "mybets:leaks.itemRates" : "mybets:leaks.item"
                  }
                  values={{
                    dimension: dimensionLabel(dimension),
                    group: groupLabel(group.key),
                    profit: euro(group.profit, true),
                    bets: group.bets,
                    hitRate: pct(group.hitRate),
                    implied: pct(group.impliedRate),
                  }}
                  components={{ bold: <strong />, loss: <span className="ev-negative" /> }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Breakdown
        id="por-categoria"
        title={t("mybets:breakdown.odds.title")}
        rows={dimensions["Cuota"]}
        note={t("mybets:breakdown.odds.note")}
      />
      <Breakdown title={t("mybets:breakdown.type.title")} rows={dimensions["Tipo de apuesta"]} />
      {promos.length > 0 && (
        <section id="promociones">
          <h2>{t("mybets:promotions.title")}</h2>
          <ul className="promo-summary">
            {promos.map((g) => (
              <li key={g.key}>
                <span className="badge promo-badge">{g.key}</span>{" "}
                <Trans
                  i18nKey="mybets:promotions.item"
                  values={{ wins: g.wins, decided: g.decided, pct: pct(g.hitRate), profit: euro(g.profit, true) }}
                  components={{ bold: <strong />, money: <span className={moneyClass(g.profit)} /> }}
                />
              </li>
            ))}
          </ul>
          {evidence.length > 0 && (
            <div className="evidence-cards">
              {evidence.map((e) => (
                <PromoEvidenceCard key={e.promo} e={e} />
              ))}
            </div>
          )}
          <Breakdown
            title={t("mybets:breakdown.promotion.title")}
            rows={dimensions["Promoción"]}
            note={t("mybets:breakdown.promotion.note")}
          />
        </section>
      )}
      <Breakdown title={t("mybets:breakdown.sport.title")} rows={dimensions["Deporte"]} />
      <Breakdown
        title={t("mybets:breakdown.market.title")}
        rows={dimensions["Mercado (simples)"]}
        note={t("mybets:breakdown.market.note")}
      />
      {builder.length > 0 && (
        <section>
          <h2>{t("mybets:builder.title")}</h2>
          <p className="small muted">{t("mybets:builder.note")}</p>
          <div className="table-scroll">
            <table className="predictions-table">
              <thead>
                <tr>
                  <th>{t("mybets:column.market")}</th>
                  <th className="num">{t("mybets:column.selections")}</th>
                  <th className="num">{t("mybets:column.won")}</th>
                  <th className="num">{t("mybets:column.hitRate")}</th>
                </tr>
              </thead>
              <tbody>
                {builder.map((b) => (
                  <tr key={b.family} className={b.selections < LOW_SAMPLE ? "low-sample-row" : undefined}>
                    <td className="rec-match">{groupLabel(b.family)}</td>
                    <td className="num">{b.selections}</td>
                    <td className="num">{b.won}</td>
                    <td className="num">{pct(b.hitRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Breakdown
        title={t("mybets:breakdown.stake.title")}
        rows={dimensions["Importe"]}
        note={t("mybets:breakdown.stake.note")}
      />
      {fixedPromos.length > 0 && (
        <Breakdown
          title={t("mybets:breakdown.stakeWithoutFixed.title", { promotions: fixedPromos.join(", ") })}
          rows={stakeWithoutFixed}
          note={t("mybets:breakdown.stakeWithoutFixed.note")}
        />
      )}
      <Breakdown title={t("mybets:breakdown.weekday.title")} rows={dimensions["Día"]} />
      <Breakdown title={t("mybets:breakdown.hour.title")} rows={dimensions["Hora"]} />

      <HabitsBlock
        all={h}
        allCount={settled.length}
        withoutPromo={habits(withoutPromoRows)}
        withoutPromoCount={withoutPromoRows.length}
        hitRate={s.hitRate}
        expectedStreak={expectedLongestLosingStreak(s.decided, s.hitRate)}
      />

      <TeamsSection groups={teams} />

      <BetList bets={bets} settled={settled} lastImport={lastImport} />
    </>
  );
}

function Breakdown({ id, title, rows, note }: { id?: string; title: string; rows: GroupStats[]; note?: string }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <section id={id}>
      <h2>{title}</h2>
      {note && <p className="small muted">{note}</p>}
      <div className="table-scroll">
        <table className="predictions-table">
          <thead>
            <tr>
              <th>{t("mybets:column.category")}</th>
              <th className="num">{t("mybets:column.bets")}</th>
              <th className="num">{t("mybets:column.hitRate")}</th>
              <th className="num">{t("mybets:column.implied")}</th>
              <th className="num">{t("mybets:column.difference")}</th>
              <th className="num">{t("mybets:column.staked")}</th>
              <th className="num">{t("mybets:column.profit")}</th>
              <th className="num">{t("mybets:column.roi")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const gap = g.hitRate !== null && g.impliedRate !== null ? g.hitRate - g.impliedRate : null;
              return (
                <tr key={g.key} className={g.bets < LOW_SAMPLE ? "low-sample-row" : undefined}>
                  <td className="rec-match">
                    {groupLabel(g.key)} <LowSampleTag n={g.bets} />
                  </td>
                  <td className="num">{g.bets}</td>
                  <td className="num">
                    {pct(g.hitRate)}
                    <span className="muted small"> ({g.wins}/{g.decided})</span>
                  </td>
                  <td className="num">{pct(g.impliedRate)}</td>
                  <td className={`num ${moneyClass(gap)}`}>{signedPp(gap)}</td>
                  <td className="num">{euro(g.ownStaked)}</td>
                  <td className={`num ${moneyClass(g.profit)}`}>{euro(g.profit, true)}</td>
                  <td className={`num ${moneyClass(g.roi)}`}>{roiPct(g.roi)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">{t("mybets:breakdown.note", { n: LOW_SAMPLE })}</p>
    </section>
  );
}

function BetList({ bets, settled, lastImport }: { bets: ParsedBet[]; settled: SettledBet[]; lastImport: Map<string, ImportTag> }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const [onlyLast, setOnlyLast] = useState(false);
  const profitOf = new Map(settled.map((r) => [r.bet.id, r.profit]));
  const pool = onlyLast && lastImport.size ? bets.filter((b) => lastImport.has(b.id)) : bets;
  const shown = showAll ? pool : pool.slice(0, 30);
  return (
    <section id="apuestas">
      <h2>{t("mybets:list.title")}</h2>
      <p className="small muted">{t("mybets:list.note")}</p>
      {lastImport.size > 0 && (
        <label className="filter-label">
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} />
          {t("mybets:list.onlyLast", { n: lastImport.size })}
        </label>
      )}
      <div className="table-scroll">
        <table className="predictions-table">
          <thead>
            <tr>
              <th>{t("mybets:column.date")}</th>
              <th>{t("mybets:column.book")}</th>
              <th>{t("mybets:column.type")}</th>
              <th>{t("mybets:column.sport")}</th>
              <th>{t("mybets:column.selections")}</th>
              <th className="num">{t("mybets:column.odds")}</th>
              <th className="num">{t("mybets:column.stake")}</th>
              <th>{t("mybets:column.result")}</th>
              <th className="num">{t("mybets:column.profit")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => {
              const profit = profitOf.get(b.id) ?? null;
              return (
                <tr key={b.id} className={lastImport.has(b.id) ? `bet-row-${lastImport.get(b.id)}` : undefined}>
                  <td className="num">
                    {lastImport.get(b.id) === "added" && <span className="badge import-tag-added">{t("mybets:list.added")}</span>}
                    {lastImport.get(b.id) === "updated" && (
                      <span className="badge import-tag-updated">{t("mybets:list.updated")}</span>
                    )}{" "}
                    {b.placedAt
                      ? new Date(b.placedAt).toLocaleString(currentLocale(), { dateStyle: "short", timeStyle: "short" })
                      : "—"}
                  </td>
                  <td className="rec-match">{BOOKMAKER_LABELS[b.bookmaker] ?? b.bookmaker}</td>
                  <td className="rec-match">{b.typeLabel || "—"}</td>
                  <td className="rec-match">{groupLabel(sportOf(b))}</td>
                  <td className="rec-match bets-legs">
                    {(b.promotions ?? []).length > 0 && (
                      <div>
                        {b.promotions.map((p) => (
                          <span key={p} className="badge promo-badge">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                    {b.legs.map((l, i) => (
                      <div key={i}>
                        {l.participants.length > 0 && `${l.participants.slice(0, 2).join(" – ")}: `}
                        {l.builder ? l.pick : [l.market, l.pick].filter(Boolean).join(" · ")}
                        {l.boosted && (
                          <span className="muted">
                            {" "}
                            {t(b.bookmaker === "bet365" ? "mybets:list.boostedBet365" : "mybets:list.boostedWinamax")}
                          </span>
                        )}
                      </div>
                    ))}
                    {b.warnings.length > 0 && <div className="bets-warning">{b.warnings.map(warningLabel).join(" ")}</div>}
                  </td>
                  <td className="num">{b.odds != null ? formatFixed(b.odds, 2) : "—"}</td>
                  <td className="num">
                    {euro(b.stake)}
                    {b.freebet && <span className="muted small"> {t("mybets:list.freebet")}</span>}
                  </td>
                  <td className="rec-match">
                    <span className={`badge bet-status-${b.status}`}>{t(`mybets:status.${b.status}`)}</span>
                  </td>
                  <td className={`num ${moneyClass(profit)}`}>{profit === null ? "—" : euro(profit, true)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pool.length > shown.length && (
        <button type="button" className="tab-button" onClick={() => setShowAll(true)}>
          {t("mybets:list.showAll", { n: pool.length })}
        </button>
      )}
    </section>
  );
}
