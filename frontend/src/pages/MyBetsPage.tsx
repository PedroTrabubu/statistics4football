import { useMemo, useState, type ChangeEvent } from "react";
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
import { teamGroups } from "../lib/betHistory/teams";
import { getTeamCrest } from "../lib/logos";
import { excludingPromotions, fixedStakePromotions, promoEvidence, promoSplit } from "../lib/betHistory/promotions";
import {
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

const STATUS_LABELS: Record<ParsedBet["status"], string> = {
  won: "Ganada",
  lost: "Perdida",
  void: "Anulada",
  cashout: "Cash out",
  pending: "En curso",
  unknown: "Desconocido",
};

type ImportTag = "added" | "updated";

type ImportReport =
  | { kind: "error"; text: string }
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
  if (b.legs.length > 1) return `${b.typeLabel || "Combinada"}: ${b.legs.map((l) => l.participants[0] ?? "?").join(", ")}`;
  const leg = b.legs[0];
  if (!leg) return b.ref ?? b.id;
  return `${leg.participants.slice(0, 2).join(" – ")}${leg.eventDate ? ` (${leg.eventDate})` : ""}`;
}

export function MyBetsPage() {
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
        setReport({ kind: "error", text: err instanceof Error ? err.message : "No se pudo leer la copia." });
      }
      return;
    }
    const { bets: parsed, failed } = looksLikeBet365(html) ? parseBet365History(html) : parseWinamaxHistory(html);
    if (parsed.length === 0) {
      setReport({
        kind: "error",
        text: "No he encontrado apuestas en ese HTML. Asegúrate de copiar la lista de «Mis apuestas → Finalizadas» de Winamax o la del historial de apuestas deportivas de bet365 (ver los pasos de abajo).",
      });
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
      setReport({ kind: "error", text: err instanceof Error ? err.message : "No se pudo leer la copia." });
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importHtml(await file.text());
    e.target.value = "";
  }

  function onClear() {
    if (!window.confirm("¿Borrar todas las apuestas importadas y el dinero real apuntado en este navegador?")) return;
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
      <h1>Mis apuestas</h1>
      <p className="page-lead">
        Pega tu historial de Winamax o de bet365 y mira en qué ganas y en qué pierdes dinero, año a año: por cuota, tipo
        de apuesta, deporte, mercado, importe y hábitos.
      </p>

      <section className="bets-import">
        <p className="small muted">
          <strong>Privacidad:</strong> el historial se analiza en tu navegador y se guarda solo en él. No se envía a
          ningún servidor. Por eso conviene <strong>descargar una copia</strong> de vez en cuando: si borras los datos
          del navegador o cambias de ordenador, con «Restaurar copia» las recuperas.
        </p>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="Pega aquí el HTML del historial de Winamax o de bet365 (o el texto de una copia de seguridad)…"
          rows={5}
          aria-label="HTML del historial de apuestas"
        />
        <div className="filters">
          <button type="button" className="tab-button tab-button-active" disabled={!pasted.trim()} onClick={() => importHtml(pasted)}>
            Analizar
          </button>
          <label className="tab-button bets-file">
            Subir archivo .html
            <input type="file" accept=".html,.htm,.txt,text/html" onChange={onFile} />
          </label>
          {bets.length > 0 && (
            <button type="button" className="tab-button" onClick={onDownloadBackup}>
              Descargar copia ({bets.length})
            </button>
          )}
          <label className="tab-button bets-file">
            Restaurar copia
            <input type="file" accept=".json,application/json" onChange={onRestore} />
          </label>
          {bets.length > 0 && (
            <button type="button" className="tab-button" onClick={onClear}>
              Borrar mis datos
            </button>
          )}
        </div>
        {report && <ImportReportPanel report={report} onClose={() => setReport(null)} />}
        {backupText && (
          <div className="import-report" role="status">
            <button type="button" className="import-report-close" onClick={() => setBackupText(null)} aria-label="Cerrar">
              ×
            </button>
            <p className="import-report-title">
              Copia de {bets.length} apuestas preparada: <code>{backupFileName()}</code>
            </p>
            <p className="small">
              Si no se ha descargado (algunos visores, como el navegador integrado de VS Code, no permiten descargas),
              cópiala y guárdala tú en un archivo <code>.json</code>. Para restaurarla, súbela con «Restaurar copia» o
              pega el texto en el cuadro de arriba y pulsa «Analizar».
            </p>
            <div className="filters">
              <button type="button" className="tab-button tab-button-active" onClick={onCopyBackup}>
                {copied ? "Copiada ✓" : "Copiar al portapapeles"}
              </button>
            </div>
            <textarea id="backup-text" className="backup-text" readOnly value={backupText} rows={3} aria-label="Copia de seguridad" />
          </div>
        )}
        <details className="small muted">
          <summary>Cómo sacar el historial de Winamax</summary>
          <ol>
            <li>
              En Winamax, entra en <strong>Mis apuestas → Finalizadas</strong> y baja hasta el final para que se carguen
              todas las que quieras analizar.
            </li>
            <li>
              <strong>Opción A:</strong> pulsa Ctrl+S, elige «Página web completa» y sube aquí el archivo .html.
            </li>
            <li>
              <strong>Opción B:</strong> clic derecho sobre la lista → «Inspeccionar», clic derecho sobre el elemento
              resaltado → «Copiar → Copiar elemento» (outerHTML), y pégalo arriba.
            </li>
            <li>Puedes importar varias veces: las apuestas repetidas no se duplican.</li>
          </ol>
        </details>
        <details className="small muted">
          <summary>Cómo sacar el historial de bet365</summary>
          <ol>
            <li>
              En bet365, abre el <strong>Historial</strong> de tu cuenta, elige <strong>Apuestas deportivas</strong> y
              las fechas que quieras, y baja hasta el final para que se carguen todas.
            </li>
            <li>
              Igual que con Winamax: guarda la página con Ctrl+S («Página web completa») y súbela, o copia el elemento
              de la lista con «Inspeccionar → Copiar elemento» y pégalo arriba.
            </li>
            <li>
              bet365 no indica en el historial si una apuesta se ganó o se perdió: se deduce de lo cobrado. Si cobraste
              menos de lo que pagaba la cuota (cash out o una selección anulada), sale como «Cash out». Las apuestas
              con créditos de apuesta cuentan como freebets.
            </li>
            <li>
              Las sencillas solo traen la selección («Real Madrid»), sin el partido ni el mercado, así que no entran en
              «Por mercado» ni en «Partidos».
            </li>
          </ol>
        </details>
      </section>

      {bets.length === 0 ? (
        <p className="muted">Todavía no has importado ninguna apuesta.</p>
      ) : (
        <>
          <div className="filters">
            <select aria-label="Año" value={year ?? "all"} onChange={(e) => selectYear(e.target.value === "all" ? null : e.target.value)}>
              {allYears.map((y) => (
                <option key={y} value={y}>
                  Año {y}
                </option>
              ))}
              <option value="all">Todos los años</option>
            </select>
            {books.length > 1 && (
              <select aria-label="Casa" value={book} onChange={(e) => setBook(e.target.value as Bookmaker | "")}>
                <option value="">Todas las casas</option>
                {books.map((k) => (
                  <option key={k} value={k}>
                    {BOOKMAKER_LABELS[k]}
                  </option>
                ))}
              </select>
            )}
            <select aria-label="Deporte" value={sport} onChange={(e) => setSport(e.target.value)}>
              <option value="">Todos los deportes</option>
              {sports.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {month && (
              <button type="button" className="month-chip" onClick={() => setMonth(null)} aria-label="Quitar el filtro de mes">
                Mes: {monthLabel(month)} <span aria-hidden="true">✕</span>
              </button>
            )}
          </div>
          {settled.length === 0 ? (
            <p className="muted">No hay apuestas resueltas con estos filtros.</p>
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
  if (report.kind === "error") {
    return (
      <div className="import-report import-report-error" role="alert">
        <p>{report.text}</p>
        <button type="button" className="import-report-close" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </div>
    );
  }
  if (report.kind === "cleared") {
    return (
      <div className="import-report" role="status">
        <p>Se han borrado todas las apuestas guardadas en este navegador.</p>
        <button type="button" className="import-report-close" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </div>
    );
  }
  const nothingNew = report.added.length === 0 && report.updated.length === 0;
  return (
    <div className="import-report" role="status">
      <button type="button" className="import-report-close" onClick={onClose} aria-label="Cerrar">
        ×
      </button>
      <p className="import-report-title">
        {nothingNew
          ? `Las ${report.read} apuestas de ${report.source === "backup" ? "la copia" : "este HTML"} ya estaban guardadas. No ha cambiado nada.`
          : `${report.source === "backup" ? "Copia restaurada" : "Importación hecha"}: he leído ${report.read} apuestas.`}
      </p>
      <div className="import-chips">
        <span className={`import-chip import-chip-added${report.added.length ? "" : " import-chip-zero"}`}>
          <strong>{report.added.length}</strong> nuevas
        </span>
        <span className={`import-chip import-chip-updated${report.updated.length ? "" : " import-chip-zero"}`}>
          <strong>{report.updated.length}</strong> actualizadas
        </span>
        <span className={`import-chip import-chip-unchanged${report.unchanged ? "" : " import-chip-zero"}`}>
          <strong>{report.unchanged}</strong> repetidas sin cambios
        </span>
        {report.withWarnings > 0 && (
          <span className="import-chip import-chip-warning">
            <strong>{report.withWarnings}</strong> con datos incompletos
          </span>
        )}
        {report.failed > 0 && (
          <span className="import-chip import-chip-error">
            <strong>{report.failed}</strong> no se pudieron leer
          </span>
        )}
      </div>
      {report.updated.length > 0 && (
        <div className="import-report-list">
          <p className="small">Qué ha cambiado en las actualizadas:</p>
          <ul>
            {report.updated.slice(0, 8).map((u) => (
              <li key={u.after.id}>
                {betTitle(u.after)}: <strong>{describeUpdate(u)}</strong>
              </li>
            ))}
            {report.updated.length > 8 && <li className="muted">…y {report.updated.length - 8} más.</li>}
          </ul>
        </div>
      )}
      <p className="small muted">
        Ahora tienes <strong>{report.total}</strong> apuestas guardadas. En la tabla de abajo, las de esta importación
        llevan la etiqueta «Nueva» o «Actualizada».
        {!report.saved && " Ojo: este navegador no permite guardarlas, se perderán al cerrar la página."}
      </p>
    </div>
  );
}

function Headline({ s, period }: { s: Summary; period: string }) {
  const gap = s.hitRate !== null && s.impliedRate !== null ? s.hitRate - s.impliedRate : null;
  const share = (n: number) => (s.bets ? `${(100 * n) / s.bets}%` : "0%");
  return (
    <section className="bets-hero" aria-label="Resumen">
      <div className="bets-hero-top">
        <div className="bets-hero-profit">
          <span className="bets-hero-label">
            Beneficio neto {period} <LowSampleTag n={s.bets} />
          </span>
          <span className={`bets-hero-value ${moneyClass(s.profit)}`}>{euro(s.profit, true)}</span>
          <span className="small muted">
            Apuestas con saldo {euro(s.ownProfit, true)} · con freebets {euro(s.freebetProfit, true)}
          </span>
        </div>
        <div className="bets-hero-record">
          <div className="bets-record-numbers">
            <span>
              <strong className="ev-positive">{s.wins}</strong> acertadas
            </span>
            <span>
              <strong className="ev-negative">{s.losses}</strong> falladas
            </span>
            {s.cashouts > 0 && (
              <span className="muted small">
                <strong>{s.cashouts}</strong> cash out
              </span>
            )}
          </div>
          <div
            className="bets-record-bar"
            role="img"
            aria-label={`${s.wins} acertadas, ${s.losses} falladas${s.cashouts ? ` y ${s.cashouts} cash out` : ""}`}
          >
            <span className="bets-record-won" style={{ width: share(s.wins) }} />
            <span className="bets-record-lost" style={{ width: share(s.losses) }} />
            {s.cashouts > 0 && <span className="bets-record-cashout" style={{ width: share(s.cashouts) }} />}
          </div>
          <span className="small muted">
            {s.bets} resueltas = {s.wins} + {s.losses}
            {s.cashouts > 0 && ` + ${s.cashouts} cash out (cuentan en el dinero, no en el acierto)`}
          </span>
        </div>
      </div>
      <div className="bets-hero-second">
        <div>
          <span className="bets-hero-label">ROI</span>
          <span className={`bets-hero-mid ${moneyClass(s.roi)}`}>{roiPct(s.roi, 1)}</span>
          <span className="small muted">{roiPer100(s.roi)}</span>
        </div>
        <div>
          <span className="bets-hero-label">Volumen apostado</span>
          <span className="bets-hero-mid">{euro(s.ownStaked)}</span>
          <span className="small muted bets-hero-hint">
            Suma de todos los importes apostados (sin freebets); el dinero reinvertido cuenta varias veces. No es lo que
            has ingresado.
          </span>
        </div>
        <div>
          <span className="bets-hero-label">Acierto frente a tus cuotas</span>
          <span className="bets-hero-mid">
            {pct(s.hitRate, 1)} <span className="muted small">frente al</span> {pct(s.impliedRate, 1)}
          </span>
          <span className={`small ${moneyClass(gap)}`}>
            {signedPp(gap)} {gap !== null && (gap < 0 ? "por debajo de lo que implican" : "por encima de lo que implican")}
          </span>
        </div>
      </div>
      {(s.voids > 0 || s.pending > 0) && (
        <p className="small muted bets-hero-note">
          No cuentan: {s.voids > 0 && `${s.voids} anuladas`}
          {s.voids > 0 && s.pending > 0 && " · "}
          {s.pending > 0 && `${s.pending} sin resolver`}.
        </p>
      )}
    </section>
  );
}

function MonthlyTable({
  months,
  selected,
  onSelect,
  unit = "Mes",
}: {
  months: MonthSplit[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  unit?: "Mes" | "Año";
}) {
  return (
    <div className="table-scroll">
      <table className="predictions-table">
        <thead>
          <tr>
            <th>{unit}</th>
            <th className="num">Apuestas</th>
            <th className="num">Acierto</th>
            <th className="num">Apostado</th>
            <th className="num">Beneficio</th>
            <th className="num">Sin promoción</th>
            <th className="num">Con promoción</th>
            <th className="num">ROI</th>
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
  const byBook = books.length > 1;
  return (
    <section id="anual">
      <h2>Año a año</h2>
      <p className="small muted">
        Por año natural, del 1 de enero al 31 de diciembre: es el periodo con el que se declaran las ganancias del juego
        en la renta. Cada apuesta cuenta en el año en que la hiciste; una de finales de diciembre que se resolvió en enero
        podría ir al año siguiente. El beneficio incluye lo ganado con freebets. Pulsa un año para ver solo ese año.
      </p>
      <div className="table-scroll">
        <table className="predictions-table">
          <thead>
            <tr>
              <th>Año</th>
              <th className="num">Apuestas</th>
              <th className="num">Acierto</th>
              <th className="num">Apostado</th>
              <th className="num">Beneficio</th>
              {byBook && books.map((k) => <th key={k} className="num">{BOOKMAKER_LABELS[k]}</th>)}
              <th className="num">ROI</th>
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
  const s = summarize(bets, settled);
  const sentences = insights(settled);
  const shownMonths = year ? months.filter((m) => m.key.startsWith(year)) : months;
  const period = selectedMonth ? `en ${monthLabel(selectedMonth)}` : year ? `en ${year}` : "en todos los años";
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
        label="Secciones de mis apuestas"
        sections={[
          { id: "anual", label: "Año a año", short: "Por año" },
          { id: "mensual", label: "Mes a mes", short: "Por mes" },
          { id: "evolucion", label: "Evolución" },
          { id: "dinero-real", label: "Dinero real" },
          ...(leaks.length > 0 ? [{ id: "donde-pierdes", label: "Dónde pierdes más", short: "Dónde pierdes" }] : []),
          { id: "por-categoria", label: "Cuota, importe, deporte…", short: "Categorías" },
          ...(promos.length > 0 ? [{ id: "promociones", label: "Promociones" }] : []),
          { id: "habitos", label: "Hábitos" },
          ...(teams.length > 0 ? [{ id: "equipos", label: "Equipos y tenistas", short: "Equipos" }] : []),
          { id: "apuestas", label: "Apuestas importadas", short: "Apuestas" },
        ]}
      />
      <Headline s={s} period={period} />
      <PromoSplitCards split={split} />

      {settled.length < 30 && (
        <p className="small muted intro-note">
          Solo hay {settled.length} apuestas resueltas: con tan pocas, los porcentajes cambian mucho con cada apuesta.
          Tómalos como orientativos.
        </p>
      )}

      {sentences.length > 0 && (
        <div className="bets-insights">
          {sentences.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
      )}

      <YearSection years={years} settled={baseSettled} books={books} selected={year} onSelect={onSelectYear} />

      <section id="mensual">
        <h2>Mes a mes{year ? ` · ${year}` : ""}</h2>
        <p className="small muted">
          Por la fecha en que hiciste la apuesta. Pulsa un mes (en el gráfico o en la tabla) para ver solo ese mes en el
          resto de la página; púlsalo otra vez, o «Mes ✕» arriba, para quitar el filtro.
        </p>
        <MonthlyChart months={shownMonths} selected={selectedMonth} onSelect={onSelectMonth} />
        <MonthlyTable months={shownMonths} selected={selectedMonth} onSelect={onSelectMonth} />
        <p className="small muted">Con menos de {LOW_SAMPLE} apuestas (en gris) el mes es poco fiable.</p>
      </section>

      <section id="evolucion">
        <h2>Evolución del beneficio{year && !selectedMonth ? ` · ${year}` : ""}</h2>
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
          <h2>Dónde pierdes más</h2>
          <ul>
            {leaks.map(({ dimension, group }) => (
              <li key={`${dimension}-${group.key}`}>
                <strong>
                  {dimension}: {group.key}
                </strong>{" "}
                — <span className="ev-negative">{euro(group.profit, true)}</span> en {group.bets} apuestas
                {group.hitRate !== null && group.impliedRate !== null && (
                  <>
                    {" "}
                    (aciertas un {pct(group.hitRate)} y sus cuotas implicaban un {pct(group.impliedRate)})
                  </>
                )}
                .
              </li>
            ))}
          </ul>
        </section>
      )}

      <Breakdown
        id="por-categoria"
        title="Por cuota"
        rows={dimensions["Cuota"]}
        note="La columna clave es la diferencia: cuánto aciertas por encima o por debajo de lo que implica la cuota."
      />
      <Breakdown title="Simples y combinadas" rows={dimensions["Tipo de apuesta"]} />
      {promos.length > 0 && (
        <section id="promociones">
          <h2>Promociones</h2>
          <ul className="promo-summary">
            {promos.map((g) => (
              <li key={g.key}>
                <span className="badge promo-badge">{g.key}</span>{" "}
                <strong>
                  {g.wins} de {g.decided}
                </strong>{" "}
                acertadas ({pct(g.hitRate)}) · beneficio{" "}
                <span className={moneyClass(g.profit)}>{euro(g.profit, true)}</span>
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
            title="Por promoción"
            rows={dimensions["Promoción"]}
            note="Supercuotas y operaciones de Winamax (Bang to the Moon, misiones...) y aumentos de bet365 (de cuota y de ganancias). Una apuesta con dos promociones cuenta en las dos."
          />
        </section>
      )}
      <Breakdown title="Por deporte" rows={dimensions["Deporte"]} />
      <Breakdown
        title="Por mercado (apuestas simples)"
        rows={dimensions["Mercado (simples)"]}
        note="Solo apuestas simples: en una combinada no se puede saber qué mercado la hizo ganar o perder."
      />
      {builder.length > 0 && (
        <section>
          <h2>Selecciones dentro de «Crea tu apuesta»</h2>
          <p className="small muted">
            Winamax da el resultado de cada selección, así que aquí sí se ve cuáles fallan. bet365 no lo da: sus «Crear
            apuesta» no entran aquí.
          </p>
          <div className="table-scroll">
            <table className="predictions-table">
              <thead>
                <tr>
                  <th>Mercado</th>
                  <th className="num">Selecciones</th>
                  <th className="num">Acertadas</th>
                  <th className="num">Acierto</th>
                </tr>
              </thead>
              <tbody>
                {builder.map((b) => (
                  <tr key={b.family} className={b.selections < LOW_SAMPLE ? "low-sample-row" : undefined}>
                    <td className="rec-match">{b.family}</td>
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
        title="Por importe — todas las apuestas"
        rows={dimensions["Importe"]}
        note="Por el importe de cada apuesta (las freebets no cuentan). Cada tramo empieza en su importe: una apuesta de 5 € va en «5 – 9,99 €»."
      />
      {fixedPromos.length > 0 && (
        <Breakdown
          title={`Por importe — sin promociones de importe fijo (${fixedPromos.join(", ")})`}
          rows={stakeWithoutFixed}
          note="Las promociones de importe fijo concentran apuestas en un mismo importe; sin ellas se ve mejor cómo eliges tú cuánto apostar. Las dos lecturas son válidas."
        />
      )}
      <Breakdown title="Por día de la semana" rows={dimensions["Día"]} />
      <Breakdown title="Por hora de la apuesta" rows={dimensions["Hora"]} />

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
  if (rows.length === 0) return null;
  return (
    <section id={id}>
      <h2>{title}</h2>
      {note && <p className="small muted">{note}</p>}
      <div className="table-scroll">
        <table className="predictions-table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th className="num">Apuestas</th>
              <th className="num">Acierto</th>
              <th className="num">Implica la cuota</th>
              <th className="num">Diferencia</th>
              <th className="num">Apostado</th>
              <th className="num">Beneficio</th>
              <th className="num">ROI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const gap = g.hitRate !== null && g.impliedRate !== null ? g.hitRate - g.impliedRate : null;
              return (
                <tr key={g.key} className={g.bets < LOW_SAMPLE ? "low-sample-row" : undefined}>
                  <td className="rec-match">
                    {g.key} <LowSampleTag n={g.bets} />
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
      <p className="small muted">
        Con menos de {LOW_SAMPLE} apuestas (en gris) la fila es poco fiable. El ROI es el beneficio por cada 100 €
        apostados (las freebets no cuentan como importe); el beneficio sí incluye lo ganado con freebets.
      </p>
    </section>
  );
}

function BetList({ bets, settled, lastImport }: { bets: ParsedBet[]; settled: SettledBet[]; lastImport: Map<string, ImportTag> }) {
  const [showAll, setShowAll] = useState(false);
  const [onlyLast, setOnlyLast] = useState(false);
  const profitOf = new Map(settled.map((r) => [r.bet.id, r.profit]));
  const pool = onlyLast && lastImport.size ? bets.filter((b) => lastImport.has(b.id)) : bets;
  const shown = showAll ? pool : pool.slice(0, 30);
  return (
    <section id="apuestas">
      <h2>Apuestas importadas</h2>
      <p className="small muted">Para comprobar que se han leído bien. Las más recientes primero.</p>
      {lastImport.size > 0 && (
        <label className="filter-label">
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} />
          Ver solo las nuevas y actualizadas en la última importación ({lastImport.size})
        </label>
      )}
      <div className="table-scroll">
        <table className="predictions-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Casa</th>
              <th>Tipo</th>
              <th>Deporte</th>
              <th>Selecciones</th>
              <th className="num">Cuota</th>
              <th className="num">Importe</th>
              <th>Resultado</th>
              <th className="num">Beneficio</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => {
              const profit = profitOf.get(b.id) ?? null;
              return (
                <tr key={b.id} className={lastImport.has(b.id) ? `bet-row-${lastImport.get(b.id)}` : undefined}>
                  <td className="num">
                    {lastImport.get(b.id) === "added" && <span className="badge import-tag-added">Nueva</span>}
                    {lastImport.get(b.id) === "updated" && <span className="badge import-tag-updated">Actualizada</span>}{" "}
                    {b.placedAt ? new Date(b.placedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                  <td className="rec-match">{BOOKMAKER_LABELS[b.bookmaker] ?? b.bookmaker}</td>
                  <td className="rec-match">{b.typeLabel || "—"}</td>
                  <td className="rec-match">{sportOf(b)}</td>
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
                        {l.boosted && <span className="muted"> ({b.bookmaker === "bet365" ? "cuota aumentada" : "supercuota"})</span>}
                      </div>
                    ))}
                    {b.warnings.length > 0 && <div className="bets-warning">{b.warnings.join(" ")}</div>}
                  </td>
                  <td className="num">{b.odds?.toFixed(2) ?? "—"}</td>
                  <td className="num">
                    {euro(b.stake)}
                    {b.freebet && <span className="muted small"> freebet</span>}
                  </td>
                  <td className="rec-match">
                    <span className={`badge bet-status-${b.status}`}>{STATUS_LABELS[b.status]}</span>
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
          Ver las {pool.length} apuestas
        </button>
      )}
    </section>
  );
}
