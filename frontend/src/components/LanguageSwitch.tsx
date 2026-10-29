import { useTranslation } from "react-i18next";
import { LANGUAGES, currentLanguage, type Language } from "../i18n";
import { chooseLanguage } from "../i18n/language";
import { HeaderMenu } from "./HeaderMenu";
import { IconChevronDown, IconGlobe } from "./icons";

/** Cada idioma, con su nombre en ese idioma (no se traduce). */
const NAMES: Record<Language, string> = { es: "Español", en: "English", fr: "Français" };

/** Selector de idioma de la barra superior (ES / EN / FR), junto al de tema:
 * una pastilla con globo, el código y una flecha, para que no se confunda con
 * el botón redondo del tema.
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
        <span className="lang-switch-content" aria-hidden="true">
          <IconGlobe className="lang-switch-globe" />
          <span className="lang-switch-code">{language.toUpperCase()}</span>
          <IconChevronDown className="lang-switch-chevron" />
        </span>
      }
      menuLabel={t("common:language.menu")}
    />
  );
}
