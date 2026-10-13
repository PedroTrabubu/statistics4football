/** og:url y URLs absolutas de la imagen para compartir, a partir del dominio
 * (VITE_SITE_URL). Sin dominio no se pinta og:url, mejor ninguno que uno
 * falso, y la imagen se queda con su ruta relativa. */
export function withSiteUrl(html: string, siteUrl: string | undefined): string {
  const base = siteUrl?.trim().replace(/\/+$/, "");
  if (!base) return html;
  if (!/^https?:\/\/[^/]+/.test(base)) {
    throw new Error(`VITE_SITE_URL tiene que ser una URL absoluta (https://...), no "${siteUrl}"`);
  }
  return html
    .replace(/(<meta (?:property|name)="(?:og:image|twitter:image)" content=")\//g, `$1${base}/`)
    .replace('<meta property="og:type"', `<meta property="og:url" content="${base}/" />\n    <meta property="og:type"`);
}
