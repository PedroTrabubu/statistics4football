import { useTranslation } from "react-i18next";
import { LANGUAGES, currentLanguage, type Language } from "../i18n";
import { chooseLanguage } from "../i18n/language";
import { HeaderMenu } from "./HeaderMenu";

/** Cada idioma, con su nombre en ese idioma (no se traduce). */
const NAMES: Record<Language, string> = { es: "Español", en: "English", fr: "Français" };

/** Selector de idioma de la barra superior (ES / EN / FR), junto al de tema.
 * Cambia el idioma sin recargar y lo guarda en este navegador. */
export function LanguageSwitch() {
  const { t } = useTranslation();
  const language = currentLanguage();

  return (
    <HeaderMenu
      className="theme-switch lang-switch"
      options={LANGUAGES.map((value) => ({ value, label: NAMES[value], lang: value }))}
      value={language}
      onChange={(value) => void chooseLanguage(value)}
      buttonLabel={t("common:language.button", { language: NAMES[language] })}
      buttonContent={
        <span className="lang-switch-code" aria-hidden="true">
          {language.toUpperCase()}
        </span>
      }
      menuLabel={t("common:language.menu")}
    />
  );
}
