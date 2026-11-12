import { Trans, useTranslation } from "react-i18next";
import { Link, useMatch } from "react-router-dom";
import { ROUTES } from "../lib/routes";

/** Pie comun de la herramienta y de la portada: aviso de que no son
 * predicciones y de juego responsable, y la vuelta a la portada desde dentro. */
export function SiteFooter() {
  const { t } = useTranslation();
  const onHome = useMatch(ROUTES.home) !== null;
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <p className="small muted">{t("legal:footer.disclaimer")}</p>
        <p className="small muted">
          <Trans
            i18nKey="legal:footer.responsibleGambling"
            components={{ anchor: <a href="https://www.jugarbien.es" target="_blank" rel="noreferrer" /> }}
          />
        </p>
        {!onHome && (
          <p className="small muted">
            <Link to={ROUTES.home}>{t("legal:footer.home")}</Link>
          </p>
        )}
      </div>
    </footer>
  );
}
