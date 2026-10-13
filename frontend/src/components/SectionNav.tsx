/** Un acceso directo a un bloque de la página (`id` del bloque). `short`: en móvil, para que quepan. */
export interface NavSection {
  id: string;
  label: string;
  short?: string;
}

/** Accesos directos bajo la cabecera de una página larga, a cada uno de sus bloques. */
export function SectionNav({ sections, label }: { sections: NavSection[]; label: string }) {
  return (
    <nav className="section-nav" aria-label={label}>
      <ul>
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`}>
              <span className="label-long">{s.label}</span>
              <span className="label-short">{s.short ?? s.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
