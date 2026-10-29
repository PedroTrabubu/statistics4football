import { describe, expect, it } from "vitest";

/** Elementos vacíos de HTML: el lector de <Trans> los cierra en el acto, así
 * que "<link>texto</link>" pinta un enlace vacío con el texto fuera. Las
 * etiquetas de los textos no pueden llamarse así. */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr",
]);

const FILES = import.meta.glob<Record<string, unknown>>("../locales/*/*.json", { eager: true, import: "default" });

function strings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === "string") out.push([path, value]);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) strings(child, path ? `${path}.${key}` : key, out);
  return out;
}

describe("etiquetas de los textos", () => {
  it("ninguna se llama como un elemento vacío de HTML", () => {
    const bad: string[] = [];
    for (const [file, json] of Object.entries(FILES)) {
      for (const [key, text] of strings(json, "", [])) {
        for (const [, tag] of text.matchAll(/<\/?([a-zA-Z][\w-]*)\b[^>]*>/g)) {
          if (VOID_ELEMENTS.has(tag.toLowerCase())) bad.push(`${file} ${key}: <${tag}>`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
