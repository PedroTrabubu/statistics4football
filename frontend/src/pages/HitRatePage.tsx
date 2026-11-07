import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { getHitRateIndex, getHitRateSlice, getHitRateTeam, getLeagues } from "../api/client";
import type {
  HitRateCell,
  HitRateGroup,
  HitRateIndex,
  HitRateModelKey,
  HitRateModelSlice,
  HitRateSlice,
  HitRateTeamMatch,
} from "../api/types";
import { LeagueLogo } from "../components/LeagueLogo";
import { PageHero } from "../components/PageHero";
import { SectionNav } from "../components/SectionNav";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { TeamName } from "../components/TeamCrest";
import { currentLocale, i18n, t as translate } from "../i18n";
import {
  formatFixed,
  formatLocaleNumber,
  formatPercent,
  formatSeason,
  formatShortDate,
  formatSignedPoints,
  marketLabel,
  selectionLabel,
} from "../lib/format";
import { CHAMPIONS_LEAGUE_CODE, leagueName, leagueParam, orderLeagues, parseLeagueParam } from "../lib/leagues";
import { findMarket } from "../lib/markets";
import { savedPickText } from "../lib/patterns";
import { ALL_PARAM, matchPath, QUERY, ROUTES } from "../lib/routes";
import { useApi } from "../lib/useApi";

/** Bloques por orden del menú: primero los de la ficha de partido. Textos en
 * hitrate:sections.<clave> y hitrate:models.<modelo>. */
const SECTIONS: { key: string; models: HitRateModelKey[] }[] = [
  { key: "result", models: ["result_1x2", "result_double"] },
  { key: "statsPredictor", models: ["stats_predictor"] },
  { key: "cornerDuel", models: ["corner_duel"] },
  { key: "probablePicks", models: ["probable_picks"] },
  { key: "highProbability", models: ["high_probability"] },
];

/** Etiqueta del "tipo" de cada modelo: tramo de la doble oportunidad, mercado
 * de alta probabilidad o estadística (del pick o del predictor). */
const percent = (x: string) => String(Math.round(Number(x) * 100));
const TYPE_LABEL: Partial<Record<HitRateModelKey, (key: string) => string>> = {
  // Tramos de su probabilidad, en %: "70–75 %", "≥ 85 %".
  result_double: (key) =>
    key.endsWith("+")
      ? translate("hitrate:bin.atLeast", { low: percent(key.slice(0, -1)) })
      : translate("hitrate:bin.range", { low: percent(key.split("-")[0]), high: percent(key.split("-")[1]) }),
  high_probability: marketLabel,
  probable_picks: (key) => findMarket(key)?.title ?? key,
  stats_predictor: (key) => translate(`matches:matchStats.stat.${key}`),
};

const MODELS = SECTIONS.flatMap((s) => s.models);
const WHERE_ID = "hr-where";
/** La sección del glosario que explica lo técnico de esta página. */
const GLOSSARY_ID = "aciertos";

/** Cuánto se repite un orden entre temporadas, en palabras (correlación de Spearman). */
const repeatLevel = (x: number) => (x < 0.2 ? "none" : x < 0.4 ? "low" : x < 0.6 ? "mid" : "high");

export function HitRatePage() {
  const { t } = useTranslation();
  const index = useApi(() => getHitRateIndex(), []);
  const { data: allLeagues } = useApi(() => getLeagues(), []);
  const [params, setParams] = useSearchParams();

  const data = index.data?.available ? index.data : null;
  // Sin ?league=, todas las ligas: al entrar se ve el acierto de cada modelo
  // en conjunto. Una liga sin aciertos (las de contexto) también es "todas".
  const wantedLeague = allLeagues ? parseLeagueParam(params.get(QUERY.league), allLeagues) : undefined;
  const leagueInfo = data?.leagues.find((l) => l.code === wantedLeague);
  const league = leagueInfo?.code ?? null;
  const seasons = leagueInfo?.seasons ?? data?.seasons ?? [];
  const wanted = params.get(QUERY.season);
  const season = wanted && seasons.includes(wanted) ? wanted : ALL_PARAM;
  // La temporada en curso: la última con datos.
  const current = data?.seasons.at(-1) ?? null;
  const leagueCodes = useMemo(() => {
    const codes = data?.leagues.map((l) => l.code) ?? [];
    const ordered = allLeagues ? orderLeagues(allLeagues).map((l) => l.code) : [];
    return [...codes].sort((a, b) => (ordered.indexOf(a) + 1 || 99) - (ordered.indexOf(b) + 1 || 99));
  }, [allLeagues, data]);
  const slice = useApi(
    () => (data ? getHitRateSlice(league ?? ALL_PARAM, season) : Promise.resolve(null)),
    [data, league, season],
  );

  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  const setLeague = (code: string) => setParam(QUERY.league, code === ALL_PARAM ? null : leagueParam({ code }));
  const setSeason = (value: string) => setParam(QUERY.season, value === ALL_PARAM ? null : value);

  const navSections = [
    { id: WHERE_ID, label: t("hitrate:where.title"), short: t("hitrate:where.short") },
    ...SECTIONS.map((s) => ({
      id: `hr-${s.key}`,
      label: t(`hitrate:sections.${s.key}.title`),
      short: t(`hitrate:sections.${s.key}.short`),
    })),
  ];

  return (
    <div className="hr-page">
      <PageHero
        eyebrow={league === null ? t("common:league.all") : leagueName(league)}
        title={t("nav:hitRate")}
        accentWords={1}
        lead={<p>{t("hitrate:lead")}</p>}
      />

      {index.loading ? (
        <LoadingView label={t("hitrate:loading")} />
      ) : index.error ? (
        <ErrorView message={t("hitrate:error", { error: index.error })} />
      ) : !data ? (
        <EmptyView message={t("hitrate:unavailable")} />
      ) : (
        <>
          <div className="hr-filters">
            <label className="hr-season">
              <span>{t("hitrate:filters.league")}</span>
              <select className="win-prob-season" value={league ?? ALL_PARAM} onChange={(e) => setLeague(e.target.value)}>
                <option value={ALL_PARAM}>{t("common:league.all")}</option>
                {leagueCodes.map((code) => (
                  <option key={code} value={code}>
                    {leagueName(code)}
                    {code === CHAMPIONS_LEAGUE_CODE ? ` (${t("hitrate:uncalibrated")})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="hr-season">
              <span>{t("hitrate:filters.season")}</span>
              <select className="win-prob-season" value={season} onChange={(e) => setSeason(e.target.value)}>
                <option value={ALL_PARAM}>{t("hitrate:filters.allSeasons")}</option>
                {[...seasons].reverse().map((s) => (
                  <option key={s} value={s}>
                    {s === current ? t("hitrate:filters.current", { season: formatSeason(s) }) : formatSeason(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {slice.loading ? (
            <LoadingView label={t("hitrate:loading")} />
          ) : slice.error || !slice.data ? (
            <ErrorView message={t("hitrate:error", { error: slice.error ?? "" })} />
          ) : (
            <>
              <Overview index={data} slice={slice.data} current={season === ALL_PARAM ? current : null} />
              <GlossaryLink />
              <SectionNav sections={navSections} label={t("hitrate:sectionsLabel")} />
              <WhereRight
                index={data}
                slice={slice.data}
                league={league}
                season={season}
                current={current}
                leagueOrder={leagueCodes}
              />
              {SECTIONS.map((section) => (
                <section key={section.key} id={`hr-${section.key}`} className="detail-section hr-section">
                  <h2>{t(`hitrate:sections.${section.key}.title`)}</h2>
                  <p className="muted">{t(`hitrate:sections.${section.key}.intro`)}</p>
                  {section.models.map((model) => (
                    <ModelBlock
                      key={model}
                      model={model}
                      slice={slice.data!.models[model]}
                      index={data}
                      current={season === ALL_PARAM ? current : null}
                    />
                  ))}
                </section>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Lo técnico (muestra, intervalos, cómo se calcula cada base...) está en el glosario. */
function GlossaryLink() {
  return (
    <p className="small muted hr-glossary-link">
      <Trans i18nKey="hitrate:glossaryLink" components={{ glossary: <Link to={`${ROUTES.glossary}#${GLOSSARY_ID}`} /> }} />
    </p>
  );
}

/** El acierto en una barra de 0 a 100 %. Decorativa: la cifra va encima. */
function Bar({ value }: { value: number }) {
  return (
    <span className="hr-bar" aria-hidden="true">
      <span className="hr-bar-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

/** Nada más entrar: todos los modelos y el acierto de cada uno, con el filtro
 * de liga y temporada. Cada tarjeta, en tres capas (qué mide, acierto frente a
 * su referencia y muestra) lleva a su detalle; aparte, "Cómo funciona". */
function Overview({ index, slice, current }: { index: HitRateIndex; slice: HitRateSlice; current: string | null }) {
  const { t } = useTranslation();
  const models = SECTIONS.flatMap((s) => s.models.map((model) => ({ model, section: s.key })));
  return (
    <section className="hr-overview" aria-labelledby="hr-overview-title">
      <h2 id="hr-overview-title">{t("hitrate:overview.title")}</h2>
      <p className="muted">{t("hitrate:overview.intro")}</p>

      <ul className="hr-cards">
        {models.map(({ model, section }) => {
          const m = slice.models[model];
          const total = m.available ? m.total : undefined;
          const thisSeason = currentSeasonOf(m, current);
          return (
            <li key={model}>
              <div className="hr-card">
                <a className="hr-card-link" href={`#hr-${section}`}>
                  <span className="hr-card-head">
                    <span className="hr-card-title">{t(`hitrate:models.${model}.title`)}</span>
                    <span className="hr-card-what">{t(`hitrate:models.${model}.what`)}</span>
                  </span>
                  {total && total.rate !== null ? (
                    <>
                      <span className="hr-card-main">
                        <span className="hr-card-rate num">{formatPercent(total.rate)}</span>
                        <Bar value={total.rate} />
                        {total.base !== null && (
                          <span className="hr-card-ref">
                            {t("hitrate:overview.reference", {
                              label: t(`hitrate:models.${model}.refShort`),
                              base: formatPercent(total.base),
                            })}
                            {total.edge !== null && ` · ${t("hitrate:points", { value: formatSignedPoints(total.edge) })}`}
                          </span>
                        )}
                      </span>
                      <span className="hr-card-foot">
                        <span>
                          {t("hitrate:overview.matches", { n: formatLocaleNumber(total.matches) })}
                          {total.n < index.low_sample && <span className="hr-tag">{t("hitrate:lowSample")}</span>}
                        </span>
                        {thisSeason && thisSeason.rate !== null && (
                          <span>
                            {t("hitrate:overview.current", {
                              season: formatSeason(thisSeason.key),
                              rate: formatPercent(thisSeason.rate),
                            })}
                          </span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="hr-card-line">{t("hitrate:noData")}</span>
                  )}
                </a>
                <details className="hr-card-how">
                  <summary>{t("hitrate:overview.how")}</summary>
                  <p>
                    {t(`hitrate:models.${model}.how`)} {t(`hitrate:models.${model}.versus`)}{" "}
                    <Link to={`${ROUTES.glossary}#${model === "high_probability" ? "alta-probabilidad" : GLOSSARY_ID}`}>
                      {t("hitrate:overview.moreInGlossary")}
                    </Link>
                  </p>
                </details>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** La temporada en curso de un modelo (si se ven todas y tiene datos en ella). */
const currentSeasonOf = (slice: HitRateModelSlice, current: string | null) =>
  current ? slice.by_season?.find((g) => g.key === current) : undefined;

/** Un modelo: total, temporada en curso y cuándo se hizo la predicción; sus
 * desgloses (liga, tipo, nivel, temporada y todos los equipos), en
 * desplegables cerrados. */
function ModelBlock({
  model,
  slice,
  index,
  current,
}: {
  model: HitRateModelKey;
  slice: HitRateModelSlice;
  index: HitRateIndex;
  current: string | null;
}) {
  const { t } = useTranslation();
  const title = t(`hitrate:models.${model}.title`);
  const low = index.low_sample;

  if (!slice.available || !slice.total) {
    return (
      <div className="hr-model">
        <h3>{title}</h3>
        <p className="hr-empty">{t("hitrate:noData")}</p>
      </div>
    );
  }

  const typeLabel = TYPE_LABEL[model] ?? ((key: string) => key);
  // El "tipo" de cada modelo con su nombre: por mercado, por estadística...
  const typeTitle = i18n.exists(`hitrate:models.${model}.typeLabel`)
    ? t(`hitrate:models.${model}.typeLabel`)
    : t("hitrate:breakdown.type");
  // Liga, tipo y nivel, a la vista; temporada y equipos, en desplegables cerrados.
  const breakdowns: { key: string; title: string; rows: HitRateGroup[]; label: (g: HitRateGroup) => ReactNode; fold?: boolean }[] = [
    {
      key: "league",
      title: t("hitrate:breakdown.league"),
      rows: slice.by_league ?? [],
      label: (g) => <LeagueCell code={g.key} calibrated={g.calibrated !== false} />,
    },
    { key: "type", title: typeTitle, rows: slice.by_type ?? [], label: (g) => typeLabel(g.key) },
    { key: "level", title: t("hitrate:breakdown.level"), rows: slice.by_level ?? [], label: (g) => t(`hitrate:levels.${g.key}`) },
    {
      key: "season",
      title: t("hitrate:breakdown.season"),
      rows: [...(slice.by_season ?? [])].reverse(),
      label: (g) => formatSeason(g.key),
      fold: true,
    },
  ];
  const origins = slice.by_origin ?? [];
  const thisSeason = currentSeasonOf(slice, current);

  return (
    <div className="hr-model">
      <h3>{title}</h3>
      {!slice.calibrated && <p className="hr-uncalibrated">{t("hitrate:uncalibratedNote")}</p>}

      <HitTable
        caption={t("hitrate:caption.summary", { model: title })}
        group={t("hitrate:columns.group")}
        low={low}
        rows={[
          { key: "total", label: <strong>{t("hitrate:rows.total")}</strong>, cell: slice.total },
          ...(thisSeason
            ? [{ key: "current", label: t("hitrate:rows.currentSeason", { season: formatSeason(thisSeason.key) }), cell: thisSeason }]
            : []),
          // Con un solo origen, el total ya lo dice.
          ...(origins.length > 1 ? origins : []).map((g) => ({
            key: g.key,
            label: t(`hitrate:origin.${g.key}`),
            cell: g,
          })),
        ]}
      />
      {origins.length === 1 && <p className="small muted">{t(`hitrate:originOnly.${origins[0].key}`)}</p>}

      {breakdowns
        .filter((b) => b.rows.length > 1)
        .map((b) => {
          const table = (
            <HitTable
              caption={t("hitrate:caption.breakdown", { model: title, breakdown: b.title })}
              group={b.title}
              low={low}
              rows={b.rows.map((g) => ({ key: g.key, label: b.label(g), cell: g }))}
            />
          );
          return b.fold ? (
            <details key={b.key} className="hr-fold">
              <summary>{t("hitrate:breakdown.summary", { title: b.title, n: b.rows.length })}</summary>
              {table}
            </details>
          ) : (
            <div key={b.key}>{table}</div>
          );
        })}
    </div>
  );
}

function LeagueCell({ code, calibrated }: { code: string; calibrated: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="hr-league">
      <LeagueLogo code={code} />
      {leagueName(code)}
      {!calibrated && <span className="hr-tag">{t("hitrate:uncalibrated")}</span>}
    </span>
  );
}

/** Cuánto se repite un orden entre temporadas, en una palabra; sin medida, una raya. */
const repeatWord = (x: number | undefined) => (x === undefined ? "—" : translate(`hitrate:where.repeat.${repeatLevel(x)}`));

/** Dónde aciertan más: cada liga con cada modelo y, de un modelo, los equipos
 * con más y menos acierto (o ventaja). Con la temporada del filtro, y con
 * cuánto se repite el orden de una temporada a la siguiente. */
function WhereRight({
  index,
  slice,
  league,
  season,
  current,
  leagueOrder,
}: {
  index: HitRateIndex;
  slice: HitRateSlice;
  league: string | null;
  /** La del filtro de arriba (ALL_PARAM: todas) y la que está en curso. */
  season: string;
  current: string | null;
  leagueOrder: string[];
}) {
  const { t } = useTranslation();
  return (
    <section id={WHERE_ID} className="detail-section hr-section">
      <h2>{t("hitrate:where.title")}</h2>
      <p className="muted">{t("hitrate:where.intro")}</p>
      <h3>{t("hitrate:where.leagues.title")}</h3>
      {league === null ? (
        <LeagueMatrix index={index} slice={slice} order={leagueOrder} />
      ) : (
        <p className="hr-empty">{t("hitrate:where.leagues.oneLeague")}</p>
      )}
      <TeamTable index={index} league={league} season={season} current={current} />
      <p className="small muted">{t("hitrate:where.noValue")}</p>
    </section>
  );
}

/** Una fila por liga y una columna por modelo: acierto y, debajo, ventaja. La
 * liga con más y con menos acierto de cada modelo, marcadas (solo calibradas y
 * con muestra suficiente). Al pie, cuánto se repite su orden entre temporadas. */
function LeagueMatrix({ index, slice, order }: { index: HitRateIndex; slice: HitRateSlice; order: string[] }) {
  const { t } = useTranslation();
  const low = index.low_sample;
  const groups = Object.fromEntries(
    MODELS.map((m) => [m, new Map((slice.models[m].by_league ?? []).map((g) => [g.key, g]))]),
  ) as Record<HitRateModelKey, Map<string, HitRateGroup>>;
  const leagues = order.filter((code) => MODELS.some((m) => groups[m].has(code)));
  const extremes = Object.fromEntries(
    MODELS.map((m) => {
      const ranked = [...groups[m].values()]
        .filter((g) => g.calibrated !== false && g.n >= low && g.rate !== null)
        .sort((a, b) => b.rate! - a.rate!);
      return [m, ranked.length > 1 ? { best: ranked[0].key, worst: ranked[ranked.length - 1].key } : null];
    }),
  ) as Record<HitRateModelKey, { best: string; worst: string } | null>;

  return (
    <>
      <div className="table-scroll hr-table-wrap">
        <table className="predictions-table hr-table hr-matrix">
          <caption className="visually-hidden">{t("hitrate:where.leagues.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("hitrate:filters.league")}</th>
              {MODELS.map((m) => (
                <th key={m} scope="col" className="num" title={t(`hitrate:models.${m}.title`)}>
                  {t(`hitrate:where.model.${m}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leagues.map((code) => (
              <tr key={code}>
                <th scope="row">
                  <LeagueCell code={code} calibrated={code !== CHAMPIONS_LEAGUE_CODE} />
                </th>
                {MODELS.map((m) => {
                  const g = groups[m].get(code);
                  if (!g || g.rate === null) return <td key={m} className="num">—</td>;
                  const mark = extremes[m]?.best === code ? "best" : extremes[m]?.worst === code ? "worst" : null;
                  return (
                    <td key={m} className={`num${g.n < low ? " hr-low-cell" : ""}${mark ? ` hr-${mark}` : ""}`}>
                      {formatPercent(g.rate)}
                      {mark && (
                        <span className={`hr-mark hr-mark-${mark}`}>
                          <span aria-hidden="true">{mark === "best" ? "▲" : "▼"}</span>
                          <span className="visually-hidden">{t(`hitrate:where.leagues.${mark}`)}</span>
                        </span>
                      )}
                      {g.edge !== null && <span className="hr-ci">{t("hitrate:points", { value: formatSignedPoints(g.edge) })}</span>}
                      {g.n < low && <span className="hr-tag">{t("hitrate:lowSample")}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t("hitrate:where.leagues.stability")}</th>
              {MODELS.map((m) => (
                <td key={m} className="num">
                  {repeatWord(index.stability?.[m]?.leagues?.rate)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="small muted">{t("hitrate:where.leagues.note")}</p>
    </>
  );
}

type TeamSort = "name" | "hits" | "matches" | "rate";
type TeamScope = "current" | "all";

/** Una predicción en palabras, desde lo que se guardó (`pick`, ver COLUMNS en
 * hit_rate.py) y su partido. */
function predictionText(model: HitRateModelKey, pick: unknown, match: HitRateTeamMatch): string {
  const team = (side: unknown) => (side === "away" ? match.away : match.home);
  switch (model) {
    case "result_1x2":
      return pick === "X"
        ? translate("hitrate:pick.draw")
        : translate("hitrate:pick.win", { team: team(pick === "2" ? "away" : "home") });
    case "result_double":
      return pick === "12"
        ? translate("hitrate:pick.noDraw")
        : translate("hitrate:pick.winOrDraw", { team: team(pick === "X2" ? "away" : "home") });
    case "corner_duel":
      return pick === "draw" ? translate("hitrate:pick.sameCorners") : translate("hitrate:pick.moreCorners", { team: team(pick) });
    case "stats_predictor": {
      const [stat, side] = pick as [string, string];
      return translate("hitrate:pick.more", { team: team(side), stat: translate(`matches:matchStats.statInline.${stat}`) });
    }
    case "high_probability": {
      const [market, selection] = pick as [string, string];
      return `${marketLabel(market)}: ${selectionLabel(market, selection, match.home, match.away)}`;
    }
    case "probable_picks": {
      const [family, option, side] = pick as [string, string | null, string | null];
      const saved = option ? savedPickText(family, option) : null;
      if (!saved) return findMarket(family)?.title ?? family;
      return saved.matchLevel ? saved.text : translate("hitrate:pick.ofTeam", { team: team(side), text: saved.text });
    }
  }
}

/** Todos los equipos de la liga y temporada elegidas, con un modelo: aciertos,
 * partidos y % con su intervalo. Cada fila cuenta las predicciones de los
 * partidos en que juega el equipo (también las que tratan del rival) y se
 * despliega con esos partidos. Con todas las temporadas arriba, se elige entre
 * la actual y todas. Por defecto, en orden alfabético; cada columna ordena. */
function TeamTable({
  index,
  league,
  season,
  current,
}: {
  index: HitRateIndex;
  league: string | null;
  season: string;
  current: string | null;
}) {
  const { t } = useTranslation();
  const [model, setModel] = useState<HitRateModelKey>(MODELS[0]);
  const [scope, setScope] = useState<TeamScope>("current");
  const [sort, setSort] = useState<{ key: TeamSort; desc: boolean }>({ key: "name", desc: false });
  const [open, setOpen] = useState<string | null>(null);
  const teamSeason = season !== ALL_PARAM ? season : scope === "current" && current ? current : ALL_PARAM;
  const slice = useApi(() => getHitRateSlice(league ?? ALL_PARAM, teamSeason), [league, teamSeason]);
  const teams = slice.data?.models[model].by_team ?? [];
  const value = (g: HitRateGroup) =>
    sort.key === "hits" ? g.hits : sort.key === "matches" ? g.matches : sort.key === "rate" ? (g.rate ?? -1) : 0;
  const rows = [...teams].sort((a, b) => {
    const c = sort.key === "name" ? a.key.localeCompare(b.key, currentLocale()) : value(a) - value(b) || a.key.localeCompare(b.key);
    return sort.desc ? -c : c;
  });
  const sortBy = (key: TeamSort) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));
  const header = (key: TeamSort, label: string, num = true) => (
    <th scope="col" className={num ? "num" : undefined} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="hr-sort" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.desc ? " ▼" : " ▲"}</span>}
      </button>
    </th>
  );

  return (
    <div className="hr-model hr-teams">
      <h3>{t("hitrate:teams.title")}</h3>
      <div className="hr-filters">
        <label className="hr-season">
          <span>{t("hitrate:teams.model")}</span>
          <select className="win-prob-season" value={model} onChange={(e) => setModel(e.target.value as HitRateModelKey)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {t(`hitrate:models.${m}.title`)}
              </option>
            ))}
          </select>
        </label>
        {season === ALL_PARAM && current && (
          <div className="tab-group" role="group" aria-label={t("hitrate:filters.season")}>
            {(["current", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={scope === s ? "tab-button tab-button-active" : "tab-button"}
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
              >
                {t(`hitrate:teams.scope.${s}`, { season: formatSeason(current) })}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="small muted">{t("hitrate:teams.note", { n: index.min_team })}</p>

      {slice.loading ? (
        <LoadingView label={t("hitrate:loading")} />
      ) : slice.error ? (
        <ErrorView message={t("hitrate:error", { error: slice.error })} />
      ) : rows.length === 0 ? (
        <p className="hr-empty">{t("hitrate:teams.empty")}</p>
      ) : (
        <div className="table-scroll hr-table-wrap">
          <table className="predictions-table hr-table hr-team-table">
            <caption className="visually-hidden">
              {t("hitrate:teams.caption", { model: t(`hitrate:models.${model}.title`) })}
            </caption>
            <thead>
              <tr>
                {header("name", t("hitrate:teams.column.team"), false)}
                {header("hits", t("hitrate:teams.column.hits"))}
                {header("matches", t("hitrate:teams.column.matches"))}
                {header("rate", t("hitrate:teams.column.rate"))}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <Fragment key={g.key}>
                  <tr className={g.n < index.min_team ? "hr-low" : undefined}>
                    <th scope="row">
                      <button
                        type="button"
                        className="hr-team-toggle"
                        aria-expanded={open === g.key}
                        onClick={() => setOpen(open === g.key ? null : g.key)}
                      >
                        <span className="hr-team-chevron" aria-hidden="true" />
                        <TeamName team={g.key} league={g.league} />
                      </button>
                    </th>
                    <td className="num">
                      {formatLocaleNumber(g.hits)}/{formatLocaleNumber(g.n)}
                      {g.n < index.min_team && <span className="hr-tag">{t("hitrate:lowSample")}</span>}
                    </td>
                    <td className="num">{formatLocaleNumber(g.matches)}</td>
                    <td className="num">
                      {formatPercent(g.rate)}
                      {g.low !== null && g.high !== null && <Ci text={rateRange(g.low, g.high)} />}
                    </td>
                  </tr>
                  {open === g.key && (
                    <tr className="hr-team-detail">
                      <td colSpan={4}>
                        <TeamMatches team={g.key} model={model} league={league} season={teamSeason} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Los partidos de un equipo con un modelo, del más reciente al más antiguo:
 * cada pick con ✓ o ✗, como en las páginas de estadísticas, y si se guardó
 * antes del partido. Misma liga y temporada que su fila de la tabla. */
function TeamMatches({
  team,
  model,
  league,
  season,
}: {
  team: string;
  model: HitRateModelKey;
  league: string | null;
  season: string;
}) {
  const { t } = useTranslation();
  const data = useApi(() => getHitRateTeam(team), [team]);
  if (data.loading) return <LoadingView label={t("hitrate:teams.loading")} />;
  if (data.error || !data.data) return <ErrorView message={t("hitrate:teams.error", { error: data.error ?? "" })} />;
  const matches = data.data.matches
    .filter((m) => (league === null ? m.league !== CHAMPIONS_LEAGUE_CODE : m.league === league))
    .filter((m) => season === ALL_PARAM || m.season === season)
    .map((m) => ({ match: m, preds: m.preds.filter((p) => p[0] === model) }))
    .filter((m) => m.preds.length > 0)
    .reverse();
  if (matches.length === 0) return <p className="small muted">{t("hitrate:teams.noMatches")}</p>;
  const mark = (hit: 1 | 0 | "=" | null) => (hit === 1 ? "hit" : hit === 0 ? "miss" : hit === "=" ? "tie" : "none");

  return (
    <>
      <p className="small muted">{t("hitrate:teams.legend")}</p>
      <table className="market-matches hr-team-matches">
        <tbody>
          {matches.map(({ match, preds }) => {
            // Con una sola predicción por partido, la fila entera en verde o rojo.
            const single = preds.length === 1 ? mark(preds[0][2]) : null;
            const rowClass =
              single === "hit" ? "market-hit" : single === "miss" ? "market-miss" : single ? "market-unknown" : undefined;
            return (
              <Fragment key={match.id}>
                <tr className={rowClass}>
                  <td className="market-date">{formatShortDate(match.date)}</td>
                  <td className={match.home === team ? "market-home market-self" : "market-home"}>
                    <TeamName team={match.home} league={match.league} reverse />
                  </td>
                  <td className="market-score">
                    <Link to={matchPath(match.id)}>{match.score ? `${match.score[0]} - ${match.score[1]}` : "–"}</Link>
                  </td>
                  <td className={match.away === team ? "market-away market-self" : "market-away"}>
                    <TeamName team={match.away} league={match.league} />
                  </td>
                </tr>
                <tr className="hr-picks-row">
                  <td colSpan={4}>
                    <ul className="hr-picks">
                      {preds.map(([, pick, hit, origin], i) => (
                        <li key={i}>
                          <span className={`hr-pick-mark is-${mark(hit)}`} aria-hidden="true">
                            {hit === 1 ? "✓" : hit === 0 ? "✗" : hit === "=" ? "=" : "–"}
                          </span>
                          <span className="visually-hidden">{t(`hitrate:teams.mark.${mark(hit)}`)}: </span>
                          {predictionText(model, pick, match)}
                          {origin === "f" && <span className="hr-tag">{t("hitrate:teams.frozen")}</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** "+1,5 a +8,3" (en puntos). */
const edgeRange = (low: number, high: number) =>
  translate("hitrate:range", { low: formatSignedPoints(low), high: formatSignedPoints(high) });

/** "69,9 a 76,9" (en %). */
const rateRange = (low: number, high: number) =>
  translate("hitrate:range", { low: formatFixed(low * 100, 1), high: formatFixed(high * 100, 1) });

function Ci({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <span className="hr-ci">
      <span className="visually-hidden">{t("hitrate:columns.ci")}: </span>
      {text}
    </span>
  );
}

/** n, acierto [Wilson], base y ventaja [remuestreo], fila a fila; y el error
 * medio del modelo y de la liga si lo traen (el predictor, por estadística). */
function HitTable({
  caption,
  group,
  low,
  rows,
}: {
  caption: string;
  group: string;
  low: number;
  rows: { key: string; label: ReactNode; cell: HitRateCell }[];
}) {
  const { t } = useTranslation();
  const mae = rows.some((r) => r.cell.mae !== undefined);
  return (
    <div className="table-scroll hr-table-wrap">
      <table className="predictions-table hr-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{group}</th>
            <th scope="col" className="num">
              {t("hitrate:columns.n")}
            </th>
            <th scope="col" className="num">
              {t("hitrate:columns.rate")}
            </th>
            <th scope="col" className="num">
              {t("hitrate:columns.base")}
            </th>
            <th scope="col" className="num">
              {t("hitrate:columns.edge")}
            </th>
            {mae && (
              <th scope="col" className="num">
                {t("hitrate:columns.mae")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, cell }) => (
            <tr key={key} className={cell.n < low ? "hr-low" : undefined}>
              <th scope="row">{label}</th>
              <td className="num">
                {formatLocaleNumber(cell.n)}
                {cell.n > 0 && cell.n < low && <span className="hr-tag">{t("hitrate:lowSample")}</span>}
              </td>
              <td className="num">
                {formatPercent(cell.rate)}
                {cell.low !== null && cell.high !== null && <Ci text={rateRange(cell.low, cell.high)} />}
              </td>
              <td className="num">{formatPercent(cell.base)}</td>
              <td className="num">
                {cell.edge === null ? "—" : t("hitrate:points", { value: formatSignedPoints(cell.edge) })}
                {cell.edge_low !== null && cell.edge_high !== null && <Ci text={edgeRange(cell.edge_low, cell.edge_high)} />}
              </td>
              {mae && (
                <td className="num">
                  {cell.mae != null && cell.mae_base != null
                    ? t("hitrate:maePair", { model: formatFixed(cell.mae, 2), league: formatFixed(cell.mae_base, 2) })
                    : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
