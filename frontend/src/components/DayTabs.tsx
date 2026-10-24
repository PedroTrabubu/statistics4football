import { useTranslation } from "react-i18next";
import { dayLabel } from "../lib/streaks";

/** Pestañas de dias, las de Rachas y Picks probables: "Todos" y luego cada
 * dia de `days` (Hoy, Mañana, Sáb...). `value` null: todos. */
export function DayTabs({
  days,
  value,
  onChange,
  allDate,
  enabled,
  title,
}: {
  /** Claves "2026-10-24" desde hoy (upcomingDays). */
  days: string[];
  value: string | null;
  onChange: (day: string | null) => void;
  /** Bajo "Todos": "7 días", "12 partidos"... */
  allDate: string;
  /** Si el dia tiene partidos; null mientras cargan (todos activos). */
  enabled: ((day: string) => boolean) | null;
  /** Al pasar por encima de un dia con partidos: "3 rachas", "4 partidos"... */
  title: (day: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className="tab-group streak-days" role="group" aria-label={t("common:dayTabs.label")}>
      <button
        type="button"
        className={value === null ? "tab-button tab-button-active" : "tab-button"}
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        <span className="streak-day-name">{t("common:dayTabs.all")}</span>
        <span className="streak-day-date">{allDate}</span>
      </button>
      {days.map((key, i) => {
        const label = dayLabel(key, i);
        const off = enabled !== null && !enabled(key);
        return (
          <button
            key={key}
            type="button"
            className={value === key ? "tab-button tab-button-active" : "tab-button"}
            aria-pressed={value === key}
            disabled={off}
            title={off ? t("common:dayTabs.noMatches") : title(key)}
            onClick={() => onChange(key)}
          >
            <span className="streak-day-name">{label.name}</span>
            <span className="streak-day-date">{label.date}</span>
          </button>
        );
      })}
    </div>
  );
}
