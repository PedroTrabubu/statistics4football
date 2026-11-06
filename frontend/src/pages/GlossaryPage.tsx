import { useEffect, useMemo, useState } from "react";
import { PageHero } from "../components/PageHero";
import { IconClose, IconSearch } from "../components/icons";
import { SectionNav } from "../components/SectionNav";
import { Trans, useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

/** Secciones del glosario, en orden. `key` es su bloque en glossary.json
 * (glossary:<key>.<termino>.term/.def) y `id` el ancla (#alta-probabilidad y
 * #aciertos se enlazan desde esas paginas). */
const SECTIONS = [
  { key: "basics", id: "basico", terms: ["frequency", "modelProbability"] },
  { key: "markets", id: "mercados", terms: ["oneXTwo", "btts", "overUnder", "asianHandicap", "halfTime"] },
  { key: "streaks", id: "rachas", terms: ["streak", "rarity"] },
  { key: "odds", id: "cuotas", terms: ["implied", "fair"] },
  { key: "highProbability", id: "alta-probabilidad", terms: ["margin", "test"] },
  {
    key: "hitRate",
    id: "aciertos",
    terms: ["rate", "sample", "interval", "base", "edge", "side", "mae", "origin", "uncalibrated", "repeat", "ranking"],
  },
] as const;

/** A partir de aqui una definicion ocupa toda la fila (y se lee en columnas
 * si cabe): en media tarjeta quedaria una tira larguisima. */
const WIDE_DEF_CHARS = 330;

/** Para buscar sin que importen mayusculas ni tildes ("hándicap" = "handicap"). */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");

export function GlossaryPage() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const [query, setQuery] = useState("");

  const sections = useMemo(() => {
    const q = fold(query.trim());
    return SECTIONS.map((s) => {
      const terms = s.terms.map((term) => {
        const name = t(`glossary:${s.key}.${term}.term`);
        const def = stripTags(t(`glossary:${s.key}.${term}.def`));
        return { term, name, wide: def.length > WIDE_DEF_CHARS, match: !q || fold(`${name} ${def}`).includes(q) };
      });
      return { ...s, terms: terms.filter((x) => x.match) };
    }).filter((s) => s.terms.length > 0);
  }, [query, t]);

  // Desde otra pagina (#aciertos), directo a esa seccion.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <div className="glossary-page">
      <PageHero
        eyebrow={t("glossary:page.eyebrow")}
        title={t("nav:glossary")}
        accentWords={0}
        lead={<p>{t("glossary:intro")}</p>}
      />

      <div className="glossary-search">
        <IconSearch aria-hidden="true" />
        <input
          type="search"
          aria-label={t("glossary:page.search")}
          placeholder={t("glossary:page.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="glossary-search-clear" onClick={() => setQuery("")} aria-label={t("glossary:page.clear")}>
            <IconClose aria-hidden="true" />
          </button>
        )}
      </div>

      {sections.length > 0 && (
        <SectionNav
          sections={sections.map((s) => ({ id: s.id, label: t(`glossary:page.toc.${s.key}`) }))}
          label={t("glossary:page.sections")}
        />
      )}

      <div className="glossary-sections">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="detail-section glossary-section">
            <div className="glossary-section-head">
              <span className="glossary-section-num">{String(i + 1).padStart(2, "0")}</span>
              <h2>{t(`glossary:${s.key}.title`)}</h2>
              <span className="glossary-count">{t("glossary:page.count", { count: s.terms.length })}</span>
            </div>
            <dl className="glossary-terms">
              {s.terms.map((x) => (
                <div key={x.term} className={x.wide ? "glossary-term wide" : "glossary-term"}>
                  <dt>{x.name}</dt>
                  <dd>
                    <Trans i18nKey={`glossary:${s.key}.${x.term}.def`} components={{ sup: <sup /> }} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {sections.length === 0 && (
          <p className="detail-section glossary-empty">{t("glossary:page.noResults", { query: query.trim() })}</p>
        )}
      </div>
    </div>
  );
}
