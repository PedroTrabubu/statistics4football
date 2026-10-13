import { type ReactNode, useState } from "react";
import { getTeamCrest, teamInitials } from "../lib/logos";

/** Tamaños de escudo de toda la web: sm en tablas y listas, md en cabeceras
 * de tarjeta, lg en filas de partido y xl en la ficha de partido. */
export type CrestSize = "sm" | "md" | "lg" | "xl";

const PIXELS: Record<CrestSize, number> = { sm: 24, md: 32, lg: 44, xl: 88 };

/** Escudo en una caja cuadrada fija, para que escudos de formas distintas no
 * descuadren las filas. Siempre va junto al nombre del equipo, así que es
 * decorativo (alt=""). Sin escudo, o si falla la carga, uno neutro con las
 * iniciales y el mismo tamaño. `eager` para lo que se ve sin hacer scroll. */
export function TeamCrest({
  team,
  league,
  size = "sm",
  eager = false,
}: {
  team: string;
  league?: string | null;
  size?: CrestSize;
  eager?: boolean;
}) {
  const src = getTeamCrest(league, team);
  // Guarda la url que fallo: si el componente pasa a otro equipo, se reintenta.
  const [failed, setFailed] = useState<string | null>(null);
  const px = PIXELS[size];

  if (!src || failed === src) {
    return (
      <span className={`team-crest team-crest-${size} team-crest-fallback`} aria-hidden="true">
        <svg className="team-crest-shield" viewBox="0 0 24 28">
          <path d="M12 1.2 21.6 4.6v8.2c0 6.2-4.1 10.9-9.6 13.6C6.5 23.7 2.4 19 2.4 12.8V4.6Z" />
        </svg>
        <span className="team-crest-initials">{teamInitials(team)}</span>
      </span>
    );
  }

  return (
    <span className={`team-crest team-crest-${size}`}>
      <img
        src={src}
        alt=""
        width={px}
        height={px}
        loading={eager ? "eager" : "lazy"}
        decoding={eager ? "auto" : "async"}
        draggable={false}
        onError={() => setFailed(src)}
      />
    </span>
  );
}

/** Escudo + nombre. `reverse` pone el escudo detrás (local). `children`
 * sustituye al nombre cuando hace falta añadirle algo, ej. "(local)". */
export function TeamName({
  team,
  league,
  size = "sm",
  eager = false,
  reverse = false,
  className,
  children,
}: {
  team: string;
  league?: string | null;
  size?: CrestSize;
  eager?: boolean;
  reverse?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const classes = ["team-name", `team-name-${size}`];
  if (reverse) classes.push("team-name-reverse");
  if (className) classes.push(className);
  return (
    <span className={classes.join(" ")}>
      <TeamCrest team={team} league={league} size={size} eager={eager} />
      <span className="team-name-text">{children ?? team}</span>
    </span>
  );
}

/** Los dos equipos de un partido con la misma disposición en toda la web, la
 * de un marcador: local + escudo, `middle` (marcador, "vs" o un guion) y
 * escudo + visitante. Los nombres quedan cerca y los escudos, alineados. */
export function MatchTeams({
  home,
  away,
  league,
  middle,
  size = "sm",
  eager = false,
  className,
}: {
  home: string;
  away: string;
  league?: string | null;
  middle: ReactNode;
  size?: CrestSize;
  eager?: boolean;
  className?: string;
}) {
  return (
    <span className={className ? `match-teams ${className}` : "match-teams"}>
      <TeamName team={home} league={league} size={size} eager={eager} reverse className="match-teams-home" />
      <span className="match-teams-middle">{middle}</span>
      <TeamName team={away} league={league} size={size} eager={eager} className="match-teams-away" />
    </span>
  );
}
