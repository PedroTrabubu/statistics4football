/** Logo de la web: anillo verde y rojo (aciertos y fallos) con las siglas
 * dentro. El anillo es SVG (trazo vectorial): nítido a cualquier tamaño y
 * densidad de pantalla, también mientras gira al pasar el ratón. */
export function AppMark() {
  return (
    <span className="app-mark">
      <svg className="app-mark-ring" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
        <circle className="app-mark-hit" cx="18" cy="18" r="16" pathLength="100" />
        <circle className="app-mark-miss" cx="18" cy="18" r="16" pathLength="100" />
      </svg>
      <span className="app-mark-text">S4B</span>
    </span>
  );
}
