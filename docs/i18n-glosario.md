# Glosario de traducción (i18n)

Términos fijos de la web en español (referencia), inglés británico y francés.
Los textos están en `frontend/src/locales/<idioma>/*.json`; este glosario
manda cuando un término se repite en varias páginas. Las fuentes solo se han
usado para elegir terminología: no se ha copiado ningún texto.

Criterios generales:

- Inglés británico y de tú a tú ("you"); francés con "vous" y tono neutro.
- Nombres propios sin traducir (equipos, árbitros, Statistics 4 Bets, casas de
  apuestas, Premier League, LaLiga...), salvo "Champions League", que en
  francés es "Ligue des champions". Los países sí se traducen.
- Números con el formato de cada idioma (Intl): `1,5` / `1.5` / `1,5`;
  `65 %` (espacio fijo) / `65%` / `65 %` (espacio fino fijo).
- Francés: espacio fijo antes de `:` y dentro de `« »`; espacio fino fijo
  antes de `; ! ? %`. Inglés: comillas simples `‘ ’`.

## Términos

| Español | English | Français | Notas |
| --- | --- | --- | --- |
| Partido | Match | Match | |
| Jornada | Matchday | Journée | Ver dudas. |
| Temporada | Season | Saison | |
| Clasificación | Standings | Classement | |
| Local / Visitante | Home / Away | Domicile / Extérieur | Letras: L/V → H/A → D/E. |
| G-E-P (gana, empata, pierde) | W-D-L | V-N-P | Ver dudas (FR). |
| Forma reciente | Recent form | Forme récente | |
| Enfrentamientos directos | Head-to-head | Confrontations directes | Pestaña corta: H2H / Face-à-face. |
| Árbitro | Referee | Arbitre | |
| Goles | Goals | Buts | |
| Córners | Corners | Corners | |
| Tarjetas | Cards | Cartons | "Picks up … cards" / "Reçoit … cartons". |
| Puntos de tarjeta | Booking points | Points de cartons | Ver dudas (FR). |
| Tiros / Tiros a puerta | Shots / Shots on target | Tirs / Tirs cadrés | |
| Faltas | Fouls | Fautes | |
| Expulsión | Red card | Expulsion | EN: "sending-off" descartado por largo en etiquetas. |
| Más de / Menos de | Over / Under (en frases: more than / fewer than) | Plus de / Moins de | "Plus de 2,5 buts" (plural, uso habitual). |
| Ambos marcan | Both teams to score | Les deux équipes marquent | |
| Ambos marcan y resultado (menú) | Both score and result | Les 2 marquent et résultat | Etiqueta corta para que quepa en una línea del menú lateral; el título de la página va completo. |
| Portería a cero | Clean sheet | Clean sheet | Ver dudas (FR). |
| Descanso / Final | Half-time / Full-time | Mi-temps / Fin de match | |
| Doble oportunidad | Double chance | Double chance | |
| Hándicap | Handicap | Handicap | |
| Duelo de córners | Corner count | Duel des corners | "Wins the corner count". |
| Racha | Streak / run | Série | "Série d'invincibilité" para invicto. |
| Pick(s) | Pick(s) | Sélection(s) | Ver dudas. |
| Picks probables | Likely picks | Sélections probables | |
| Pick muy probable | Very likely pick | Sélection très probable | |
| Pick del partido | Pick of the match | Sélection du match | |
| Patrón | Pattern | Tendance | |
| Fuerza alta / media / baja | High / Medium / Low strength | Force élevée / moyenne / faible | |
| Acierto | Hit rate | Réussite | |
| Se cumplió / No se cumplió | Hit / Missed | Validé / Non validé | |
| Respaldado por el rival | Backed by the opponent | Confirmé par l'adversaire | |
| Muestra | Sample | Échantillon | |
| Valor esperado (EV) | Expected value (EV) | Valeur attendue (EV) | Se mantiene la sigla EV. |
| Value | Value | Valeur | Etiqueta: VALUE / VALEUR. |
| Cuota / Cuota justa | Odds / Fair odds | Cote / Cote juste | |
| Ventaja (pts) | Edge (pts) | Écart (pts) | Ver dudas. |
| IC 95 % | 95% CI | IC 95 % | |
| Predecibilidad | Predictability | Prévisibilité | |
| Base de la liga | League base rate | Base du championnat | |
| Liga (competición) | League | Championnat | "Compétition" cuando incluye la Champions. |
| Champions League | Champions League | Ligue des champions | Corta: Champions / C1. |
| Fase de liga | League phase | Phase de ligue | |
| Eliminatoria previa (play-off) | Knockout play-offs | Barrages | |
| Octavos / Cuartos / Semifinales | Round of 16 / Quarter-finals / Semi-finals | Huitièmes / Quarts / Demi-finales | Ida / vuelta: first / second leg; aller / retour. |
| No es una casa de apuestas | Not a bookmaker | Ce n'est pas un bookmaker | |
| Casa (de apuestas) | Bookmaker | Bookmaker | |
| Combinada | Accumulator | Combiné | Tipos EN: double, treble, 4-fold. |
| Simple / sencilla | Single | Simple | |
| Freebet | Free bet | Freebet | |
| Cash out | Cash out | Cash out | |
| Acertada / fallada / anulada | Won / lost / void | Gagné / perdu / annulé | |
| Resuelta / sin resolver | Settled / unsettled | Réglé / en attente | |
| Importe | Stake | Mise | |
| Rareza | Rarity | Rareté | |
| Mala racha | Bad run | Mauvaise série | |
| Bomba (nivel de combinada) | Long shot | Grosse cote | |
| Crea tu apuesta, Crear apuesta, Supercuota, La Gran Supercuota | (sin traducir) | (sin traducir) | Nombres de productos de Winamax y bet365 España. |
| Mis apuestas → Finalizadas, Historial, Apuestas deportivas | (sin traducir) | (sin traducir) | Menús de las webs españolas de las casas: el usuario los ve así. |

## Dudas y decisiones

**Pick(s)**
- Elegido: EN "pick"; FR "sélection".
- Descartado: FR "prono" y "pronostic", que suenan a predicción, cuando aquí se trata de patrones históricos; FR "pick", un anglicismo poco natural fuera del argot de *tipsters*.
- "Sélection" es el término de las casas para cada elección de una apuesta.
- Fuente: [goal.com/fr, lexique](https://www.goal.com/fr/parier-en-ligne/lexique-des-paris-sportifs/blt316b0bf8b3763309).

**Ventaja (pts)**
- Elegido: EN "Edge (pts)"; FR "Écart (pts)".
- Descartado: EN "Advantage", que no se usa en apuestas; FR "Avantage", ambiguo con el hándicap.
- En las dos lenguas son puntos porcentuales sobre la base de la liga.
- Fuentes: [penaltyblog, value bets](https://penaltyblog.readthedocs.io/en/latest/betting/value_bets.html), [sharpapi, EV betting](https://sharpapi.io/learn/what-is-ev-betting).

**Market Average / Market Max**
- Se deja el nombre en inglés entre comillas, como en español, porque es el nombre de la fuente de cuotas.
- La descripción se traduce: EN "average odds across several bookmakers"; FR "cote moyenne de plusieurs bookmakers".
- Si aparece "Max": EN "best odds across bookmakers"; FR "meilleure cote du marché".

**Jornada**
- Elegido: EN "Matchday".
- Descartado: "Matchweek", que es el término propio de la Premier League; la web mezcla ligas y Champions, y UEFA usa "Matchday".
- Fuente: [premierleague.com](https://www.premierleague.com/en/news/4324539).

**G-E-P en francés**
- Elegido: V-N-P (victoires, nuls, perdus), como en las tablas de Eurosport ("J V N P").
- Descartado: V-N-D, porque la "D" chocaba con la D de domicile en la misma fila de últimos partidos.
- Fuente: [eurosport.fr, classement](https://www.eurosport.fr/football/ligue-1/2024-2025/live-ogc-nice-rc-lens_mtc1526338/live-table.shtml).

**Puntos de tarjeta en francés**
- Elegido: "points de cartons".
- No se ha encontrado una fuente francesa con un término establecido; se deja descriptivo y con la explicación "jaune = 10, rouge = 25" junto a él.
- En inglés, "booking points" sí está establecido: [goal.com/en-gb](https://www.goal.com/en-gb/betting/what-are-booking-points-and-how-do-they-work/bltb800276edd4ee1e4), [bettingexpert](https://www.bettingexpert.com/academy/glossary/total-booking-points).

**Portería a cero en francés**
- Elegido: "clean sheet", habitual en la prensa francófona.
- Descartado: "cage inviolée", más literaria y poco usada en estadísticas.
- Fuentes: [lavenir.net](https://www.lavenir.net/sports/football/d1a/2025/01/13/le-standard-roi-belge-de-la-clean-sheet-avec-les-meilleurs-deurope-et-avec-trois-gardiens-CMIP7M2YCRBX5MWRY4D7E6GJHE/), [dhnet.be](https://www.dhnet.be/sports/football/division-1a/standard/2025/01/13/le-standard-roi-belge-de-la-clean-sheet-avec-les-meilleurs-deurope-et-avec-trois-gardiens-ZIOXBIK4ZRFHZHKUKRZNJKQPQ4/).

**Champions en francés**
- Elegido: "Ligue des champions"; en sitios cortos (menú, chips), "C1".
- Fuente: [90min.com/fr](https://www.90min.com/fr/ligue-des-champions-quels-sont-les-clubs-qualifies-pour-les-barrages-et-les-huitiemes-de-finale-2025) ("phase de ligue", "barrages", "huitièmes").

**Duelo de córners**
- Elegido: EN "corner count" ("wins the corner count"); FR "duel des corners".
- Descartado: EN "corner duel", un calco; EN "most corners", que es el mercado de tres vías y no sirve para "no pierde el duelo".
- Fuente: [goal.com/en-gb, corner betting](https://www.goal.com/en-gb/betting/what-is-corner-betting/blta4aa3fc072052118).

**Tarjetas de un equipo**
- Elegido: EN "picks up … cards".
- Descartado: "receives", correcto pero poco natural.
- Fuentes: [squawka, cards betting](https://www.squawka.com/en/bet/guides/how-to-bet-on-cards-a-beginners-guide-to-cards-betting/), [gambling.com, cards markets](https://www.gambling.com/uk/online-betting/strategy/football-betting-strategy-cards-markets-7300).

**Tiros a puerta en francés**
- Elegido: "tirs cadrés".
- Descartado: "tirs au but", que es ambiguo con la tanda de penaltis.
- Fuente: [eurosport.fr, live stats](https://www.eurosport.fr/football/ligue-1/2025-2026/live-toulouse-fc-paris-saint-germain_mtc1609286/live-stats.shtml).

**Over/Under en francés**
- Elegido: "plus de / moins de 2,5 buts".
- Fuente: [goal.com/fr, over/under](https://www.goal.com/fr/parier-en-ligne/pari-over-under/blta1816bba5b7c3efb).

**Enfrentamientos directos en francés**
- Elegido: "confrontations directes".
- Fuente: [ligue1.com](https://ligue1.com/fr/articles/l1_article_5001-).

**Racha sin perder en francés**
- Elegido: "série d'invincibilité"; para victorias, "série de victoires".
- Fuentes: [liverpoolfc.com/fr](https://www.liverpoolfc.com/fr/news/crystal-palace-v-liverpool-13-pre-match-stats), [90min.com/fr](https://www.90min.com/fr/posts/top-5-des-plus-grandes-series-d-invincibilite-du-football-francais).

**Eliminatorias de la Champions en inglés**
- Elegido: "knockout play-offs", "round of 16".
- Fuente: [ESPN](https://global.espn.com/football/story/_/id/43637045/champions-league-knockout-rounds-format-draws-dates-fixtures).
