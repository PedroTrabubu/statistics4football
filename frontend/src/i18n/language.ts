/** Idioma del navegador: el elegido en este navegador (localStorage), si no el
 * primero de navigator.languages que tenga la web y, si ninguno, español. Al
 * cambiar se actualizan <html lang> y la meta description; el titulo lo pone
 * cada pagina con <title>. */

import { DEFAULT_LANGUAGE, changeLanguage, currentLanguage, i18n, isLanguage, t, type Language } from "./index";

export const LANGUAGE_STORAGE_KEY = "s4b-lang";

/** "en-GB" -> "en"; null si la web no tiene ese idioma. */
export function parseLanguage(value: string | null | undefined): Language | null {
  const primary = value?.trim().toLowerCase().split(/[-_]/)[0];
  return isLanguage(primary) ? primary : null;
}

export function readSavedLanguage(): Language | null {
  try {
    return parseLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function detectLanguage(): Language {
  const saved = readSavedLanguage();
  if (saved) return saved;
  const preferred = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of preferred) {
    const lng = parseLanguage(tag);
    if (lng) return lng;
  }
  return DEFAULT_LANGUAGE;
}

/** <html lang> es el idioma de los textos que se ven (si uno no se pudo
 * descargar, el de reserva). */
function applyDocumentLanguage() {
  document.documentElement.lang = currentLanguage();
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("landing:meta.description"));
}

/** Antes del primer pintado: pone el idioma detectado (descargando sus
 * textos si no es el español) y mantiene el documento al dia. */
export async function setupLanguage(): Promise<void> {
  i18n.on("languageChanged", applyDocumentLanguage);
  try {
    await changeLanguage(detectLanguage());
  } catch {
    // Sin red para descargar el idioma: la web sigue en español.
  }
  applyDocumentLanguage();
}

/** Elegido en el selector: se guarda en este navegador. */
export async function chooseLanguage(lng: Language): Promise<void> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // Sin almacenamiento: vale mientras dure la pagina.
  }
  await changeLanguage(lng);
}
