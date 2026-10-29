import { useLayoutEffect, useRef, useState } from "react";
import { dragToScroll } from "../lib/dragScroll";

/** Un acceso directo a un bloque de la página (`id` del bloque). `short`: en móvil, para que quepan. */
export interface NavSection {
  id: string;
  label: string;
  short?: string;
}

/** Cómo caben los accesos, siempre en una sola línea: con los textos largos,
 * con los cortos o, si ni así, con los cortos y deslizando la fila (con el
 * dedo, con la rueda del ratón o con el teclado). */
type Fit = "long" | "short" | "scroll";

/** Accesos directos bajo la cabecera de una página larga, a cada uno de sus bloques. */
export function SectionNav({ sections, label }: { sections: NavSection[]; label: string }) {
  const nav = useRef<HTMLElement>(null);
  const [fit, setFit] = useState<Fit>("long");
  const labels = sections.map((s) => `${s.label}|${s.short ?? ""}`).join("\n");

  // Se prueba cada forma en el propio DOM antes de pintar, y otra vez al
  // cambiar el ancho (ventana, barra lateral) o los textos (idioma).
  useLayoutEffect(() => {
    const el = nav.current;
    const list = el?.querySelector("ul");
    if (!el || !list) return;
    // Bordes difuminados en el lado por el que queda fila escondida.
    const edges = () => {
      const max = list.scrollWidth - list.clientWidth;
      el.toggleAttribute("data-more-start", max > 1 && list.scrollLeft > 1);
      el.toggleAttribute("data-more-end", max > 1 && list.scrollLeft < max - 1);
    };
    const measure = () => {
      let next: Fit = "scroll";
      for (const mode of ["long", "short"] as const) {
        el.dataset.fit = mode;
        if (list.scrollWidth <= list.clientWidth) {
          next = mode;
          break;
        }
      }
      el.dataset.fit = next;
      setFit(next);
      edges();
    };
    // Con ratón, la rueda desliza la fila; en sus extremos, baja la página
    // como siempre. Un trackpad que ya desliza en horizontal no se toca.
    const onWheel = (event: WheelEvent) => {
      const max = list.scrollWidth - list.clientWidth;
      if (max <= 1 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const next = Math.min(max, Math.max(0, list.scrollLeft + delta));
      if (Math.abs(next - list.scrollLeft) < 1) return;
      event.preventDefault();
      list.scrollLeft = next;
    };
    // Con ratón también se arrastra.
    const undrag = dragToScroll(list, el);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    // Al cargar la fuente los botones cambian de ancho sin que cambie la fila:
    // se vuelve a medir.
    const fonts = document.fonts;
    void fonts?.ready.then(measure);
    fonts?.addEventListener("loadingdone", measure);
    list.addEventListener("scroll", edges, { passive: true });
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      undrag();
      observer.disconnect();
      fonts?.removeEventListener("loadingdone", measure);
      list.removeEventListener("scroll", edges);
      list.removeEventListener("wheel", onWheel);
    };
  }, [labels]);

  return (
    <nav ref={nav} className="section-nav" data-fit={fit} aria-label={label}>
      <ul>
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} draggable={false}>
              <span className="label-long">{s.label}</span>
              <span className="label-short">{s.short ?? s.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
