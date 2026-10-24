import type { ReactNode } from "react";
import { Accent } from "./Accent";

/** Cabecera de las páginas de la herramienta, con el mismo lenguaje que el
 * hero de la portada: fondo de puntos, halo verde, etiqueta con punto vivo,
 * titular con la última palabra en serif cursiva y, a la derecha, una
 * tarjeta con el dato más útil de la página (`aside`). Más compacta que la de
 * la portada: aquí se viene a consultar, no a leer. */
export function PageHero({
  eyebrow,
  title,
  accentWords = 1,
  lead,
  aside,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  accentWords?: number;
  lead?: ReactNode;
  aside?: ReactNode;
  /** Bajo el texto (ej. un enlace). */
  children?: ReactNode;
}) {
  return (
    <header className={aside ? "page-hero has-aside" : "page-hero"}>
      <div className="page-hero-glow" aria-hidden="true" />
      <div className="page-hero-text">
        {eyebrow && (
          <p className="page-hero-eyebrow rise">
            <span className="live-dot" aria-hidden="true" />
            {eyebrow}
          </p>
        )}
        <h1 className="rise" style={{ animationDelay: "0.08s" }}>
          <Accent text={title} words={accentWords} />
        </h1>
        {lead && (
          <div className="page-hero-lead rise" style={{ animationDelay: "0.16s" }}>
            {lead}
          </div>
        )}
        {children}
      </div>
      {aside && (
        <div className="page-hero-aside rise" style={{ animationDelay: "0.22s" }}>
          {aside}
        </div>
      )}
    </header>
  );
}
