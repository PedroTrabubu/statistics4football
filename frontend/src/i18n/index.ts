/** Textos de la web con i18next. El español va empaquetado y es el idioma de
 * reserva; el inglés y el francés se descargan al elegirlos (un trozo de JS
 * por idioma). La instancia se inicia al importar este modulo, ya en español,
 * para que las funciones de lib/ (y los tests y scripts que las usan) tengan
 * sus textos sin navegador. El idioma del navegador lo fija language.ts. */

import i18next, { type TOptions } from "i18next";
import es from "../locales/es";

export const LANGUAGES = ["es", "en", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "es";

/** Etiqueta de Intl y toLocale* de cada idioma (en español, la de siempre). */
export const LOCALES: Record<Language, string> = { es: "es-ES", en: "en-GB", fr: "fr-FR" };

export type Bundle = typeof es;

/** Cada idioma tiene sus propias formas de plural (el inglés no lleva _many),
 * asi que no se tipa con la forma del español: las claves las revisa
 * scripts/check-i18n.mjs. */
type LanguageBundle = Partial<Record<keyof Bundle, object>>;

const LOADERS: Record<Exclude<Language, "es">, () => Promise<{ default: LanguageBundle }>> = {
  en: () => import("../locales/en"),
  fr: () => import("../locales/fr"),
};

void i18next.init({
  resources: { es },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...LANGUAGES],
  ns: Object.keys(es),
  defaultNS: "common",
  // React ya escapa; los textos nunca llevan HTML.
  interpolation: { escapeValue: false },
  initAsync: false,
});

export const i18n = i18next;

/** Texto de una clave "espacio:clave", con sus parametros. */
export function t(key: string, options?: TOptions): string {
  return i18next.t(key, options) as string;
}

/** Mapa de textos fijos que se leen en el idioma actual: cada propiedad es
 * un getter de su clave ({ segura: "picks:kind.safe" } -> PICK.segura). */
export function translatedRecord<K extends string>(keys: Record<K, string>): Record<K, string> {
  const record = {} as Record<K, string>;
  for (const [name, key] of Object.entries(keys) as [K, string][]) {
    Object.defineProperty(record, name, { get: () => t(key), enumerable: true });
  }
  return record;
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

export function currentLanguage(): Language {
  const lng = i18next.resolvedLanguage ?? i18next.language;
  return isLanguage(lng) ? lng : DEFAULT_LANGUAGE;
}

/** Etiqueta de Intl del idioma actual ("es-ES", "en-GB", "fr-FR"). */
export function currentLocale(): string {
  return LOCALES[currentLanguage()];
}

/** Descarga (una vez) los textos de un idioma y lo pone. */
export async function changeLanguage(lng: Language): Promise<void> {
  if (lng !== "es" && !i18next.hasResourceBundle(lng, "common")) {
    const bundle = (await LOADERS[lng]()).default;
    for (const [ns, resources] of Object.entries(bundle)) i18next.addResourceBundle(lng, ns, resources, true, true);
  }
  await i18next.changeLanguage(lng);
}
