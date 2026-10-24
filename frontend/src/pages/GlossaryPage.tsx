import { PageHero } from "../components/PageHero";
import { Trans, useTranslation } from "react-i18next";

/** Terminos de "Mercados": sus textos, en glossary:markets.<clave>. */
const TERMS = ["oneXTwo", "btts", "overUnder", "asianHandicap", "halfTime"];

export function GlossaryPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHero title={t("nav:glossary")} accentWords={0} lead={<p>{t("glossary:intro")}</p>} />

      <div className="detail-section">
        <h2>{t("glossary:basics.title")}</h2>
        <dl className="glossary-list">
          <dt>{t("glossary:basics.frequency.term")}</dt>
          <dd>{t("glossary:basics.frequency.def")}</dd>

          <dt>{t("glossary:basics.modelProbability.term")}</dt>
          <dd>{t("glossary:basics.modelProbability.def")}</dd>

          <dt>{t("glossary:basics.value.term")}</dt>
          <dd>{t("glossary:basics.value.def")}</dd>
        </dl>
      </div>

      <div className="detail-section">
        <h2>{t("glossary:markets.title")}</h2>
        <dl className="glossary-list">
          {TERMS.map((term) => (
            <div key={term}>
              <dt>{t(`glossary:markets.${term}.term`)}</dt>
              <dd>{t(`glossary:markets.${term}.def`)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="detail-section">
        <h2>{t("glossary:streaks.title")}</h2>
        <dl className="glossary-list">
          <dt>{t("glossary:streaks.streak.term")}</dt>
          <dd>{t("glossary:streaks.streak.def")}</dd>

          <dt>{t("glossary:streaks.rarity.term")}</dt>
          <dd>
            <Trans i18nKey="glossary:streaks.rarity.def" components={{ sup: <sup /> }} />
          </dd>
        </dl>
      </div>

      <div className="detail-section">
        <h2>{t("glossary:odds.title")}</h2>
        <dl className="glossary-list">
          <dt>{t("glossary:odds.implied.term")}</dt>
          <dd>{t("glossary:odds.implied.def")}</dd>

          <dt>{t("glossary:odds.fair.term")}</dt>
          <dd>{t("glossary:odds.fair.def")}</dd>

          <dt>{t("glossary:odds.yourEv.term")}</dt>
          <dd>{t("glossary:odds.yourEv.def")}</dd>
        </dl>
      </div>

      <div className="detail-section">
        <h2>{t("glossary:risk.title")}</h2>
        <dl className="glossary-list">
          <dt>{t("glossary:risk.confidence.term")}</dt>
          <dd>{t("glossary:risk.confidence.def")}</dd>

          <dt>{t("glossary:risk.level.term")}</dt>
          <dd>{t("glossary:risk.level.def")}</dd>
        </dl>
      </div>
    </div>
  );
}
