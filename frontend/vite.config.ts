import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { withSiteUrl } from './siteMeta.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Dominio publico para og:url (ver .env.example). Vacio: sin og:url.
  const { VITE_SITE_URL } = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [
      react(),
      { name: 's4b-site-url', transformIndexHtml: (html: string) => withSiteUrl(html, VITE_SITE_URL) },
    ],
    build: {
      // Logos y escudos, siempre como fichero aparte: el navegador descarga
      // solo los que se ven (en linea irian todos dentro del JS).
      assetsInlineLimit: (file: string) => (/[\\/]assets[\\/]logos[\\/]/.test(file) ? false : undefined),
    },
  }
})
