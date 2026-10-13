/** Pie comun de la herramienta y de la portada: aviso de que no son
 * predicciones y de juego responsable. */
export function SiteFooter() {
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <p className="small muted">
          Statistics 4 Bets muestra estadísticas históricas de fútbol para analizar mercados de apuestas. No son
          predicciones garantizadas ni recomendaciones de apuesta.
        </p>
        <p className="small muted">
          Juega con control. Si el juego deja de ser un entretenimiento, busca ayuda en{" "}
          <a href="https://www.jugarbien.es" target="_blank" rel="noreferrer">
            jugarbien.es
          </a>
          . Prohibido a menores de 18 años.
        </p>
      </div>
    </footer>
  );
}
