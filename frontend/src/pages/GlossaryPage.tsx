const TERMS: { term: string; def: string }[] = [
  {
    term: "1X2",
    def: "Mercado sobre el resultado final: 1 (gana el local), X (empate) o 2 (gana el visitante).",
  },
  {
    term: "BTTS (ambos anotan)",
    def: "Si los dos equipos marcan al menos un gol en el partido, sí o no.",
  },
  {
    term: "Over/Under 2.5",
    def: "Si el partido termina con más de 2.5 goles totales (over) o con 2.5 o menos (under).",
  },
  {
    term: "Hándicap asiático",
    def: "Mercado 1X2 con una ventaja/desventaja de goles aplicada de antemano a uno de los equipos, para igualar las opciones.",
  },
  {
    term: "Resultado al descanso",
    def: "El marcador al terminar la primera parte, no el resultado final.",
  },
];

export function GlossaryPage() {
  return (
    <div>
      <h1>Glosario</h1>
      <p className="muted">
        Qué significa cada término que verás en las páginas de partido, sin dar por hecho que ya lo sabes.
      </p>

      <div className="detail-section">
        <h2>Frecuencia, probabilidad y valor no son lo mismo</h2>
        <dl className="glossary-list">
          <dt>Frecuencia histórica</dt>
          <dd>
            Cuántas veces ha ocurrido algo sobre un número concreto de partidos pasados. Es un hecho contable, no una
            predicción: "over 2.5 ocurrió en 13 de los últimos 20 partidos" es frecuencia.
          </dd>

          <dt>Probabilidad del modelo</dt>
          <dd>
            Una estimación, calculada con un modelo estadístico (Dixon-Coles) que tiene en cuenta la fuerza de
            ataque/defensa de cada equipo, no solo el recuento simple. Sigue siendo una estimación, no un hecho.
          </dd>

          <dt>Valor (EV)</dt>
          <dd>
            Compara esa probabilidad estimada con una cuota concreta. Un EV positivo describe una ventaja esperada a
            largo plazo bajo los supuestos del modelo — no garantiza ganar la próxima apuesta, y una racha de
            pérdidas con EV positivo es perfectamente normal.
          </dd>
        </dl>
      </div>

      <div className="detail-section">
        <h2>Mercados</h2>
        <dl className="glossary-list">
          {TERMS.map((t) => (
            <div key={t.term}>
              <dt>{t.term}</dt>
              <dd>{t.def}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="detail-section">
        <h2>Cómo leer una cuota</h2>
        <dl className="glossary-list">
          <dt>Probabilidad implícita</dt>
          <dd>
            La probabilidad que una cuota "asume" si se toma al pie de la letra: 1 ÷ cuota. Una cuota de 2.00 implica
            un 50&nbsp;%.
          </dd>

          <dt>Cuota justa</dt>
          <dd>
            La cuota que correspondería exactamente a la probabilidad del modelo, sin margen del operador: 1 ÷
            probabilidad del modelo. Sirve como referencia para comparar, no como una cuota que vayas a encontrar
            necesariamente en ningún sitio.
          </dd>

          <dt>Tu EV</dt>
          <dd>
            Al introducir la cuota que te ofrece tu operador junto a la probabilidad del modelo, se calcula el valor
            esperado de esa combinación concreta. Nunca se guarda ni se envía a ningún sitio.
          </dd>
        </dl>
      </div>

      <div className="detail-section">
        <h2>Confianza y riesgo</h2>
        <dl className="glossary-list">
          <dt>Confianza</dt>
          <dd>
            Depende de cuántos partidos respaldan la estimación para esos dos equipos concretos (y, si hay cuotas de
            varias casas, de cuánto coinciden entre sí). Con pocos partidos disponibles, la confianza es baja aunque
            el porcentaje calculado parezca contundente.
          </dd>

          <dt>Riesgo bajo / medio / alto</dt>
          <dd>
            Sube cuando la confianza es baja o cuando la cuota es muy alta (mayor varianza), aunque el EV puntual sea
            positivo. No es una nota de calidad del dato, es una señal de cuánto puede variar el resultado real.
          </dd>
        </dl>
      </div>
    </div>
  );
}
