import { useMemo, useState, type ChangeEvent } from "react";
import { MonthlyChart } from "../components/MonthlyChart";
import {
  HabitsBlock,
  LowSampleTag,
  MatchesSection,
  PromoEvidenceCard,
  PromoSplitCards,
  RealMoneyPanel,
} from "../components/MyBetsSections";
import { ProfitChart } from "../components/ProfitChart";
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
  weekday,
  type GroupStats,
  type MonthSplit,
  type SettledBet,
  type Summary,
} from "../lib/betHistory/analysis";
import { LOW_SAMPLE, euro, moneyClass, pct, roiPct, roiPer100, signedPp } from "../lib/betHistory/format";
import { matchGroups } from "../lib/betHistory/matches";
import { excludingPromotions, fixedStakePromotions, promoEvidence, promoSplit } from "../lib/betHistory/promotions";
import {
  backupFileName,
  clearBets,
  describeUpdate,
  EMPTY_REAL_MONEY,
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
} from "../lib/betHistory/storage";
import type { ParsedBet } from "../lib/betHistory/types";
import { parseWinamaxHistory } from "../lib/betHistory/winamax";

type Period = "all" | "30" | "90" | "365";
const PERIODS: Record<Period, string> = { all: "Todo", "30": "Últimos 30 días", "90": "Últimos 90 días", "365": "Último año" };

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
  const [period, setPeriod] = useState<Period>("all");
  const [sport, setSport] = useState("");
  /** Mes elegido en la vista mensual ("2026-10"); tiene prioridad sobre el periodo. */
  const [month, setMonth] = useState<string | null>(null);
  const [realMoney, setRealMoney] = useState<RealMoney>(() => loadRealMoney());

  function onSaveRealMoney(m: RealMoney) {
    setRealMoney(m);
    saveRealMoney(m);
  }

  /** Restaura una copia: une las apuestas y, si aquí no hay dinero real apuntado, toma el de la copia. */
  function restoreBackup(backup: Backup) {
    applyIncoming(backup.bets, 0, "backup");
    if (backup.realMoney && !hasRealMoney(realMoney)) onSaveRealMoney(backup.realMoney);
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
    const { bets: parsed, failed } = parseWinamaxHistory(html);
    if (parsed.length === 0) {
      setReport({
        kind: "error",
        text: "No he encontrado apuestas en ese HTML. Asegúrate de copiar la lista de «Mis apuestas → Finalizadas» de Winamax (ver los pasos de abajo).",
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
    setRealMoney(EMPTY_REAL_MONEY);
    setLastImport(new Map());
    setReport({ kind: "cleared" });
  }

  const sports = useMemo(() => [...new Set(bets.map(sportOf))].sort((a, b) => a.localeCompare(b, "es")), [bets]);

  // El deporte se aplica a todo, también a la vista mensual.
  const base = useMemo(() => bets.filter((b) => !sport || sportOf(b) === sport), [bets, sport]);
  // El mes elegido (o, si no hay, el periodo) filtra el resto de la página.
  const filtered = useMemo(() => {
    if (month) return base.filter((b) => inPeriod(b, month));
    const from = period === "all" ? null : Date.now() - Number(period) * 86_400_000;
    return base.filter((b) => from === null || (b.placedAt !== null && new Date(b.placedAt).getTime() >= from));
  }, [base, month, period]);

  const settled = useMemo(() => filtered.map(settle).filter((r): r is SettledBet => r !== null), [filtered]);
  const baseSettled = useMemo(() => base.map(settle).filter((r): r is SettledBet => r !== null), [base]);
  const months = useMemo(() => monthlySplit(baseSettled), [baseSettled]);
  const years = useMemo(() => yearlySplit(baseSettled), [baseSettled]);

  // Para comparar con el dinero real: todo el historial importado, sin filtros.
  const history = useMemo(() => {
    const all = bets.map(settle).filter((r): r is SettledBet => r !== null);
    const dates = bets.map((b) => b.placedAt).filter((d): d is string => d !== null).sort();
    return {
      profit: Math.round(all.reduce((sum, r) => sum + r.profit, 0) * 100) / 100,
      freebetProfit: Math.round(all.filter((r) => r.bet.freebet).reduce((sum, r) => sum + r.profit, 0) * 100) / 100,
      first: dates[0] ?? null,
      last: dates[dates.length - 1] ?? null,
      pending: bets.filter((b) => b.status === "pending" || b.status === "unknown").length,
      bets: all.length,
    };
  }, [bets]);

  return (
    <div>
      <h1>Mis apuestas</h1>
      <p className="page-lead">
        Pega tu historial de Winamax y mira en qué ganas y en qué pierdes dinero: por cuota, tipo de apuesta, deporte,
        mercado, importe y hábitos.
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
          placeholder="Pega aquí el HTML del historial de Winamax (o el texto de una copia de seguridad)…"
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
      </section>

      {bets.length === 0 ? (
        <p className="muted">Todavía no has importado ninguna apuesta.</p>
      ) : (
        <>
          <div className="filters">
            <select
              aria-label="Periodo"
              value={month ? `mes:${month}` : period}
              onChange={(e) => {
                if (e.target.value.startsWith("mes:")) return;
                setMonth(null);
                setPeriod(e.target.value as Period);
              }}
            >
              {month && <option value={`mes:${month}`}>{monthLabel(month)}</option>}
              {(Object.keys(PERIODS) as Period[]).map((p) => (
                <option key={p} value={p}>
                  {PERIODS[p]}
                </option>
              ))}
            </select>
            <select aria-label="Deporte" value={sport} onChange={(e) => setSport(e.target.value)}>
              <option value="">Todos los deportes</option>
              {sports.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {month && (
              <button type="button" className="month-chip" onClick={() => setMonth(null)} aria-label="Quitar el filtro de periodo">
                {/^\d{4}$/.test(month) ? "Año" : "Mes"}: {monthLabel(month)} <span aria-hidden="true">✕</span>
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
              selectedMonth={month}
              onSelectMonth={setMonth}
              realMoney={realMoney}
              onSaveRealMoney={onSaveRealMoney}
              history={history}
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

function Headline({ s }: { s: Summary }) {
  const gap = s.hitRate !== null && s.impliedRate !== null ? s.hitRate - s.impliedRate : null;
  const share = (n: number) => (s.bets ? `${(100 * n) / s.bets}%` : "0%");
  return (
    <section className="bets-hero" aria-label="Resumen">
      <div className="bets-hero-top">
        <div className="bets-hero-profit">
          <span className="bets-hero-label">
            Beneficio neto <LowSampleTag n={s.bets} />
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

function Analysis({
  bets,
  settled,
  months,
  years,
  selectedMonth,
  onSelectMonth,
  realMoney,
  onSaveRealMoney,
  history,
  lastImport,
}: {
  bets: ParsedBet[];
  settled: SettledBet[];
  months: MonthSplit[];
  years: MonthSplit[];
  selectedMonth: string | null;
  onSelectMonth: (key: string | null) => void;
  realMoney: RealMoney;
  onSaveRealMoney: (m: RealMoney) => void;
  history: { profit: number; first: string | null; last: string | null; pending: number; freebetProfit: number; bets: number };
  lastImport: Map<string, ImportTag>;
}) {
  const s = summarize(bets, settled);
  const sentences = insights(settled);
  // Año que se ve en "Mes a mes": el del mes elegido o, si no hay, el más reciente. null = todos.
  const latestYear = years.length ? years[years.length - 1].key : null;
  const [year, setYear] = useState<string | null>(() => selectedMonth?.slice(0, 4) ?? latestYear);
  const shownYear = year !== null && years.some((y) => y.key === year) ? year : null;
  const shownMonths = shownYear ? months.filter((m) => m.key.startsWith(shownYear)) : months;
  const yearTotal = shownYear ? (years.find((y) => y.key === shownYear)?.total ?? null) : null;
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
    .filter((g) => /supercuota/i.test(g.key))
    .map((g) => promoEvidence(settled, g.key))
    .filter((e) => e !== null);
  const matches = matchGroups(settled);
  const leaks = biggestLeaks(dimensions);
  const h = habits(settled);
  const builder = builderSelections(settled);

  return (
    <>
      <Headline s={s} />
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


      <section>
        <div className="section-head">
          <h2>Mes a mes{shownYear ? ` · ${shownYear}` : ""}</h2>
          {years.length > 1 && (
            <div className="tab-group" role="group" aria-label="Año">
              {years.map((y) => (
                <button
                  key={y.key}
                  type="button"
                  className={shownYear === y.key ? "tab-button tab-button-active" : "tab-button"}
                  aria-pressed={shownYear === y.key}
                  onClick={() => setYear(y.key)}
                >
                  {y.key}
                </button>
              ))}
              <button
                type="button"
                className={shownYear === null ? "tab-button tab-button-active" : "tab-button"}
                aria-pressed={shownYear === null}
                onClick={() => setYear(null)}
              >
                Todos
              </button>
            </div>
          )}
        </div>
        {yearTotal && (
          <p className="small">
            Total de {shownYear}: <strong>{yearTotal.bets}</strong> apuestas · acierto {pct(yearTotal.hitRate)} · beneficio{" "}
            <strong className={moneyClass(yearTotal.profit)}>{euro(yearTotal.profit, true)}</strong> · ROI{" "}
            <span className={moneyClass(yearTotal.roi)}>{roiPct(yearTotal.roi)}</span> <LowSampleTag n={yearTotal.bets} />
          </p>
        )}
        <p className="small muted">
          Por la fecha en que hiciste la apuesta. Pulsa un mes (en el gráfico o en la tabla) para ver solo ese mes en el
          resto de la página; púlsalo otra vez, o «Mes ✕» arriba, para quitar el filtro.
        </p>
        <MonthlyChart months={shownMonths} selected={selectedMonth} onSelect={onSelectMonth} />
        <MonthlyTable months={shownMonths} selected={selectedMonth} onSelect={onSelectMonth} />
        <p className="small muted">Con menos de {LOW_SAMPLE} apuestas (en gris) el mes es poco fiable.</p>
      </section>

      <h2>Evolución del beneficio</h2>
      <ProfitChart points={cumulativeProfit(settled)} />

      {/* key: el formulario se recarga si el dinero real cambia por fuera (copia restaurada, datos borrados). */}
      <RealMoneyPanel key={realMoney.updatedAt ?? "vacío"} money={realMoney} onSave={onSaveRealMoney} history={history} />

      {leaks.length > 0 && (
        <section className="bets-leaks">
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
        title="Por cuota"
        rows={dimensions["Cuota"]}
        note="La columna clave es la diferencia: cuánto aciertas por encima o por debajo de lo que implica la cuota."
      />
      <Breakdown title="Simples y combinadas" rows={dimensions["Tipo de apuesta"]} />
      {promos.length > 0 && (
        <section>
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
            note="Supercuotas y operaciones de Winamax (Bang to the Moon, misiones...). Una apuesta con dos promociones cuenta en las dos."
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
          <p className="small muted">Winamax da el resultado de cada selección, así que aquí sí se ve cuáles fallan.</p>
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
        note="Por el importe de cada apuesta (las freebets no cuentan)."
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

      <MatchesSection groups={matches} />

      <BetList bets={bets} settled={settled} lastImport={lastImport} />
    </>
  );
}

function Breakdown({ title, rows, note }: { title: string; rows: GroupStats[]; note?: string }) {
  if (rows.length === 0) return null;
  return (
    <section>
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
    <section>
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
                        {l.participants.slice(0, 2).join(" – ")}:{" "}
                        {l.builder ? l.pick : [l.market, l.pick].filter(Boolean).join(" · ")}
                        {l.boosted && <span className="muted"> (supercuota)</span>}
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
