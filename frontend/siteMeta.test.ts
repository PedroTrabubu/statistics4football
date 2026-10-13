import { describe, expect, it } from "vitest";
import { withSiteUrl } from "./siteMeta";

const HTML = `<meta property="og:type" content="website" />
    <meta property="og:image" content="/og-image.png" />
    <meta name="twitter:image" content="/og-image.png" />`;

describe("withSiteUrl", () => {
  it("sin dominio no añade og:url ni toca la imagen", () => {
    expect(withSiteUrl(HTML, undefined)).toBe(HTML);
    expect(withSiteUrl(HTML, "")).toBe(HTML);
  });

  it("con dominio añade og:url y hace absolutas las imágenes", () => {
    const html = withSiteUrl(HTML, "https://ejemplo.test/");
    expect(html).toContain('<meta property="og:url" content="https://ejemplo.test/" />');
    expect(html).toContain('<meta property="og:image" content="https://ejemplo.test/og-image.png" />');
    expect(html).toContain('<meta name="twitter:image" content="https://ejemplo.test/og-image.png" />');
  });

  it("rechaza un dominio sin protocolo", () => {
    expect(() => withSiteUrl(HTML, "ejemplo.test")).toThrow(/URL absoluta/);
  });
});
