import { Trans, useTranslation } from "react-i18next";

/** Pie comun de la herramienta y de la portada: aviso de que no son
 * predicciones y de juego responsable. */
export function SiteFooter() {
  const { t } = useTranslation();
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <p className="small muted">{t("legal:footer.disclaimer")}</p>
        <p className="small muted">
          <Trans
            i18nKey="legal:footer.responsibleGambling"
            components={{ link: <a href="https://www.jugarbien.es" target="_blank" rel="noreferrer" /> }}
          />
        </p>
      </div>
    </footer>
  );
}
