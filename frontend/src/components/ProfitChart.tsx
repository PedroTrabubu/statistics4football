import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { niceTicks } from "../lib/chartTicks";

export interface ProfitPoint {
  date: Date;
  profit: number;
}

const HEIGHT = 220;
const PAD = { top: 16, right: 64, bottom: 28, left: 52 };

function euro(n: number, signed = false): string {
  const s = n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  return signed && n > 0 ? `+${s}` : s;
}

/** Beneficio acumulado apuesta a apuesta: una sola serie, con línea de cero y lectura al pasar el ratón. */
export function ProfitChart({ points }: { points: ProfitPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (points.length < 2) return null;

  // El acumulado empieza en 0 antes de la primera apuesta.
  const series = [{ date: points[0].date, profit: 0 }, ...points];
  const values = series.map((p) => p.profit);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const yMin = Math.min(ticks[0], ...values);
  const yMax = Math.max(ticks[ticks.length - 1], ...values);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (series.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const path = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.profit).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  const fmtDate = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "2-digit" });

  function onMove(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setActive(Math.max(1, Math.min(series.length - 1, Math.round(rel * (series.length - 1)))));
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    setActive((a) => Math.max(1, Math.min(series.length - 1, (a ?? series.length - 1) + step)));
  }

  const a = active !== null ? series[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active), 90), width - 90) : 0;

  return (
    <div className="profit-chart" ref={ref}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Beneficio acumulado: ${euro(last.profit, true)} tras ${points.length} apuestas`}
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => setActive((v) => v ?? series.length - 1)}
        onBlur={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "chart-zero" : "chart-grid"} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} />
            <text className="chart-axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {euro(t)}
            </text>
          </g>
        ))}
        <text className="chart-axis" x={PAD.left} y={HEIGHT - 8}>
          {fmtDate(points[0].date)}
        </text>
        <text className="chart-axis" x={PAD.left + plotW} y={HEIGHT - 8} textAnchor="end">
          {fmtDate(last.date)}
        </text>
        <path className="chart-line" d={path} />
        <circle className="chart-end" cx={x(series.length - 1)} cy={y(last.profit)} r={4} />
        <text className="chart-end-label" x={x(series.length - 1) + 8} y={y(last.profit)} dy="0.32em">
          {euro(last.profit, true)}
        </text>
        {a && active !== null && (
          <g>
            <line className="chart-crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} />
            <circle className="chart-dot" cx={x(active)} cy={y(a.profit)} r={4} />
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
        />
      </svg>
      {a && active !== null && (
        <div className="chart-tooltip" style={{ left: tipLeft }}>
          <strong>{euro(a.profit, true)}</strong>
          <span>
            Apuesta {active} de {points.length} · {fmtDate(a.date)}
          </span>
        </div>
      )}
    </div>
  );
}
