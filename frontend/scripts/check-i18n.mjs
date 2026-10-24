// Comprueba los textos de src/locales sin dependencias (solo Node):
// 1. Cada idioma tiene los mismos espacios de nombres y claves que el español
//    (el de referencia), con las mismas variables de interpolacion ({{n}}) y
//    las mismas etiquetas de <Trans> (<bold>, <link>...).
// 2. Las claves con plural (_one, _many, _other...) tienen en cada idioma
//    justo las formas que pide su regla de plural (Intl.PluralRules).
// 3. Las claves literales del codigo (t("ns:clave"), i18nKey="ns:clave")
//    existen en español.
// Uso: node scripts/check-i18n.mjs [--lang es,en] [--all]   (sale con 1 si hay
// errores; --all los lista todos, no solo los 80 primeros)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const localesDir = join(root, "src", "locales");
const REFERENCE = "es";
const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];

const langArg = process.argv.indexOf("--lang");
const languages = (
  langArg >= 0
    ? process.argv[langArg + 1].split(",")
    : readdirSync(localesDir).filter((d) => statSync(join(localesDir, d)).isDirectory())
).filter((l) => l !== REFERENCE);

const showAll = process.argv.includes("--all");

const errors = [];
const error = (message) => errors.push(message);

/** { "ns": { "a.b.c": "texto" } } de un idioma. */
function load(lang) {
  const dir = join(localesDir, lang);
  const out = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const ns = file.slice(0, -5);
    try {
      out[ns] = flatten(JSON.parse(readFileSync(join(dir, file), "utf8")));
    } catch (e) {
      error(`${lang}/${file}: JSON no valido (${e.message})`);
    }
  }
  return out;
}

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") flatten(value, path, out);
    else if (typeof value !== "string") error(`${path}: el valor no es texto`);
    else out[path] = value;
  }
  return out;
}

/** Agrupa las formas de plural: "a_one", "a_other" -> base "a" con sus categorias. */
function group(keys) {
  const plain = new Map();
  const plural = new Map();
  for (const [key, value] of Object.entries(keys)) {
    const m = key.match(/^(.*)_(zero|one|two|few|many|other)$/);
    if (m) {
      if (!plural.has(m[1])) plural.set(m[1], new Map());
      plural.get(m[1]).set(m[2], value);
    } else {
      plain.set(key, value);
    }
  }
  return { plain, plural };
}

const vars = (text) => [...text.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]).sort();
const tags = (text) => [...text.matchAll(/<\/?([a-zA-Z][\w-]*)\s*\/?>/g)].map((m) => m[0]).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const union = (texts, fn) => [...new Set(texts.flatMap(fn))].sort();

function categories(lang) {
  return new Intl.PluralRules(lang).resolvedOptions().pluralCategories.slice().sort();
}

/** Formas de plural y textos sin HTML de un idioma. */
function checkOwn(lang, bundle) {
  const required = categories(lang);
  for (const [ns, keys] of Object.entries(bundle)) {
    const { plain, plural } = group(keys);
    for (const [base, forms] of plural) {
      const have = [...forms.keys()].sort((a, b) => PLURAL_SUFFIXES.indexOf(a) - PLURAL_SUFFIXES.indexOf(b));
      const want = required.slice().sort((a, b) => PLURAL_SUFFIXES.indexOf(a) - PLURAL_SUFFIXES.indexOf(b));
      if (!same(have, want)) error(`${lang}:${ns}:${base}: plurales ${have.join("/")}; ${lang} pide ${want.join("/")}`);
      if (plain.has(base)) error(`${lang}:${ns}:${base}: existe a la vez con y sin plural`);
    }
    for (const [key, value] of Object.entries(keys)) {
      if (/<(?!\/?(bold|em|link|sup|num|strong)\b)[a-zA-Z]/.test(value) && /<\/?(p|br|div|span|a|b|i)\b/i.test(value)) {
        error(`${lang}:${ns}:${key}: parece llevar HTML`);
      }
    }
  }
}

const reference = load(REFERENCE);
checkOwn(REFERENCE, reference);

for (const lang of languages) {
  const bundle = load(lang);
  checkOwn(lang, bundle);
  for (const ns of Object.keys(reference)) {
    if (!bundle[ns]) {
      error(`${lang}: falta el espacio de nombres ${ns} (${Object.keys(reference[ns]).length} claves)`);
      continue;
    }
    const ref = group(reference[ns]);
    const own = group(bundle[ns]);
    for (const [key, text] of ref.plain) {
      if (!own.plain.has(key)) {
        error(`${lang}:${ns}:${key}: falta${own.plural.has(key) ? " (en este idioma tiene plural y en español no)" : ""}`);
        continue;
      }
      const other = own.plain.get(key);
      if (!same(vars(text), vars(other))) error(`${lang}:${ns}:${key}: variables ${vars(other)} en vez de ${vars(text)}`);
      if (!same(tags(text), tags(other))) error(`${lang}:${ns}:${key}: etiquetas ${tags(other)} en vez de ${tags(text)}`);
      if (other.trim() === "") error(`${lang}:${ns}:${key}: vacio`);
    }
    for (const [base, forms] of ref.plural) {
      if (!own.plural.has(base)) {
        error(`${lang}:${ns}:${base}: falta (plural)`);
        continue;
      }
      const refTexts = [...forms.values()];
      const ownTexts = [...own.plural.get(base).values()];
      // {{count}} puede faltar en alguna forma ("Expulsión"); el resto, iguales.
      const noCount = (list) => list.filter((v) => v !== "count");
      if (!same(noCount(union(refTexts, vars)), noCount(union(ownTexts, vars)))) {
        error(`${lang}:${ns}:${base}: variables ${union(ownTexts, vars)} en vez de ${union(refTexts, vars)}`);
      }
      if (!same(union(refTexts, tags), union(ownTexts, tags))) {
        error(`${lang}:${ns}:${base}: etiquetas ${union(ownTexts, tags)} en vez de ${union(refTexts, tags)}`);
      }
    }
    for (const key of own.plain.keys()) {
      if (!ref.plain.has(key) && !ref.plural.has(key)) error(`${lang}:${ns}:${key}: sobra (no existe en español)`);
    }
    for (const base of own.plural.keys()) {
      if (!ref.plural.has(base) && !ref.plain.has(base)) error(`${lang}:${ns}:${base}: sobra (no existe en español)`);
    }
  }
  for (const ns of Object.keys(bundle)) {
    if (!reference[ns]) error(`${lang}: sobra el espacio de nombres ${ns}`);
  }
}

// --- Claves literales del codigo --------------------------------------------------
const exists = (full) => {
  const [ns, ...rest] = full.split(":");
  const key = rest.join(":");
  const keys = reference[ns];
  if (!keys) return false;
  return key in keys || PLURAL_SUFFIXES.some((s) => `${key}_${s}` in keys);
};

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "locales" ? [] : sources(path);
    return /\.(ts|tsx|jsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

let literal = 0;
for (const file of sources(join(root, "src"))) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/["'`]([a-z][a-zA-Z]*:[a-zA-Z0-9_.]+)["'`]/g)) {
    const key = m[1];
    if (!(key.split(":")[0] in reference)) continue;
    literal += 1;
    if (!exists(key)) error(`${relative(root, file)}: la clave ${key} no existe en español`);
  }
  if (/["'`]\$\{[A-Z]\}:/.test(text)) error(`${relative(root, file)}: clave con un prefijo sin sustituir`);
}

const count = Object.values(reference).reduce((n, keys) => n + Object.keys(keys).length, 0);
console.log(
  `Español: ${Object.keys(reference).length} espacios de nombres, ${count} textos; ` +
    `${literal} claves literales en el código. Idiomas comprobados: ${languages.join(", ") || "ninguno"}.`,
);
if (errors.length) {
  const shown = showAll ? errors : errors.slice(0, 80);
  console.log(`\n${errors.length} problemas:`);
  for (const e of shown) console.log(`- ${e}`);
  if (errors.length > shown.length) console.log(`... y ${errors.length - shown.length} más`);
  process.exit(1);
}
console.log("Sin problemas.");
