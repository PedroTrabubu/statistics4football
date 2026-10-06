import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { monthLabel, type MonthSplit } from "../lib/betHistory/analysis";
import { LOW_SAMPLE } from "../lib/betHistory/format";
import { niceTicks } from "../lib/chartTicks";

const HEIGHT = 240;
// Margen extra arriba y abajo para las cifras del total de cada mes.
const PAD = { top: 24, right: 12, bottom: 40, left: 60 };
/** Con más meses que esto no se rotula el total encima de cada barra (queda en el recuadro y la tabla). */
const MAX_TOTAL_LABELS = 12;

function euro(n: number, signed = true): string {
  const s = n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  return signed && n > 0 ? `+${s}` : s;
}

interface Segment {
  series: "without" | "with";
  from: number;
  to: number;
  outer: boolean;
}

/**
 * Apila "sin promoción" y "con promoción" alrededor del cero: lo positivo
 * hacia arriba y lo negativo hacia abajo, cada parte desde donde acabó la
 * anterior. Así el alto de cada tramo es su beneficio y el total del mes se
 * marca aparte.
 */
function stackSegments(m: MonthSplit): Segment[] {
  const parts: [Segment["series"], number][] = [
    ["without", m.withoutPromo.profit],
    ["with", m.withPromo.profit],
  ];
  let up = 0;
  let down = 0;
  const segs: Segment[] = [];
  for (const [series, v] of parts) {
    if (v === 0) continue;
    if (v > 0) {
      segs.push({ series, from: up, to: up + v, outer: false });
      up += v;
    } else {
      segs.push({ series, from: down, to: down + v, outer: false });
      down += v;
    }
  }
  // El tramo más alejado del cero en cada sentido lleva el extremo redondeado.
  const lastUp = [...segs].reverse().find((s) => s.to > s.from);
  const lastDown = [...segs].reverse().find((s) => s.to < s.from);
  if (lastUp) lastUp.outer = true;
  if (lastDown) lastDown.outer = true;
  return segs;
}

/** Tramo de barra entre dos valores; con extremo redondeado (4px) si es el exterior. */
function segmentPath(x: number, w: number, yFrom: number, yTo: number, rounded: boolean): string {
  const h = Math.abs(yTo - yFrom);
  if (h < 0.5) return `M${x},${yFrom}h${w}`;
  const r = rounded ? Math.min(4, w / 2, h) : 0;
  if (yTo < yFrom) {
    return `M${x},${yFrom}V${yTo + r}Q${x},${yTo} ${x + r},${yTo}H${x + w - r}Q${x + w},${yTo} ${x + w},${yTo + r}V${yFrom}Z`;
  }
  return `M${x},${yFrom}V${yTo - r}Q${x},${yTo} ${x + r},${yTo}H${x + w - r}Q${x + w},${yTo} ${x + w},${yTo - r}V${yFrom}Z`;
}

/** Beneficio por mes en dos series (sin / con promoción) con el total marcado. Clic en un mes para filtrar. */
export function MonthlyChart({
  months,
  selected,
  onSelect,
}: {
  months: MonthSplit[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (months.length === 0) return null;

  const stacks = months.map(stackSegments);
  const extents = stacks.flatMap((segs) => segs.flatMap((s) => [s.from, s.to])).concat(months.map((m) => m.total.profit), [0]);
  const ticks = niceTicks(Math.min(...extents), Math.max(...extents));
  const yMin = Math.min(ticks[0], ...extents);
  const yMax = Math.max(ticks[ticks.length - 1], ...extents);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const band = plotW / months.length;
  const barW = Math.max(6, Math.min(40, band - 6));
  const labelEvery = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor(plotW / 52))));
  const showTotals = months.length <= MAX_TOTAL_LABELS;
  // Si la columna es estrecha, la cifra va redondeada a euros; el importe exacto está en el recuadro y la tabla.
  const totalText = (v: number) =>
    band >= 64
      ? euro(v)
      : `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}`;

  function toggle(key: string) {
    onSelect(selected === key ? null : key);
  }

  function onKey(e: KeyboardEvent<SVGGElement>, key: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(key);
    }
  }

  const h = hover !== null ? months[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(PAD.left + band * (hover + 0.5), 100), width - 100) : 0;

  return (
    <div className="profit-chart monthly-chart" ref={ref}>
      <div className="chart-legend" aria-hidden="true">
        <span>
          <span className="legend-rect legend-without" /> Sin promoción
        </span>
        <span>
          <span className="legend-rect legend-with" /> Con promoción
        </span>
        <span>
          <span className="legend-line" /> Total del mes
        </span>
      </div>
      <svg width={width} height={HEIGHT} role="group" aria-label="Beneficio por mes, sin y con promoción">
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "chart-zero-solid" : "chart-grid"} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} />
            <text className="chart-axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {euro(t, false)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = PAD.left + band * i + (band - barW) / 2;
          const classes = ["chart-bar-group"];
          if (m.total.bets < LOW_SAMPLE) classes.push("chart-bar-low");
          if (selected !== null && selected !== m.key) classes.push("chart-bar-dimmed");
          if (selected === m.key) classes.push("chart-bar-selected");
          return (
            <g
              key={m.key}
              role="button"
              tabIndex={0}
              aria-pressed={selected === m.key}
              aria-label={`${monthLabel(m.key)}: total ${euro(m.total.profit)}; sin promoción ${euro(m.withoutPromo.profit)}; con promoción ${euro(m.withPromo.profit)}; ${m.total.bets} apuestas`}
              onClick={() => toggle(m.key)}
              onKeyDown={(e) => onKey(e, m.key)}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className={classes.join(" ")}
            >
              {/* Zona de clic: toda la columna del mes. */}
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent" />
              {stacks[i].map((s) => (
                <path
                  key={s.series}
                  className={`chart-seg chart-seg-${s.series}`}
                  d={segmentPath(x, barW, y(s.from), y(s.to), s.outer)}
                />
              ))}
              <line className="chart-total-mark" x1={x - 3} x2={x + barW + 3} y1={y(m.total.profit)} y2={y(m.total.profit)} />
              {showTotals && (
                <text
                  className="chart-total-label"
                  x={x + barW / 2}
                  // Encima de la parte positiva de la barra si el total es positivo; debajo de la negativa si no.
                  y={
                    m.total.profit >= 0
                      ? y(Math.max(m.total.profit, ...stacks[i].map((sg) => Math.max(sg.from, sg.to)), 0)) - 6
                      : y(Math.min(m.total.profit, ...stacks[i].map((sg) => Math.min(sg.from, sg.to)), 0)) + 13
                  }
                  textAnchor="middle"
                >
                  {totalText(m.total.profit)}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text className="chart-axis" x={PAD.left + band * (i + 0.5)} y={HEIGHT - 8} textAnchor="middle">
                  {monthLabel(m.key, "short")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div className="chart-tooltip" style={{ left: tipLeft }}>
          <span>
            {monthLabel(h.key)} · {h.total.bets} apuestas
          </span>
          <strong>Total del mes: {euro(h.total.profit)}</strong>
          <span className="tooltip-row">
            <span className="legend-rect legend-without" /> Sin promoción: {euro(h.withoutPromo.profit)}
          </span>
          <span className="tooltip-row">
            <span className="legend-rect legend-with" /> Con promoción: {euro(h.withPromo.profit)}
          </span>
          {h.total.bets < LOW_SAMPLE && <span>Poco fiable: menos de {LOW_SAMPLE} apuestas</span>}
        </div>
      )}
    </div>
  );
}
