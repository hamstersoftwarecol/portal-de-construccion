const STATIC = process.env.PORTAL_STATIC === '1'
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  ssr: false, // SPA instalable (PWA): la sesión vive en una cookie del mismo origen
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  telemetry: false,
  // Versión que se abre con doble clic (file://): rutas con # y scripts clásicos
  ...(STATIC ? {
    router: { options: { hashMode: true } },
    vite: { build: { rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } } } },
  } : {}),
  app: {
    ...(STATIC ? { baseURL: './', buildAssetsDir: 'assets/' } : {}),
    head: {
      title: 'Portal de Construcción',
      htmlAttrs: { lang: 'es' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#1f2328' },
        { name: 'description', content: 'Gestión de obras: equipos, tareas, agenda, documentos y topografía.' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'apple-touch-icon', href: '/icon-192.png' },
      ],
    },
  },
  // El navegador siempre habla con el mismo origen; Nuxt reenvía /api a Hono.
  routeRules: {
    '/api/**': { proxy: { to: `${process.env.API_URL ?? 'http://localhost:3001'}/api/**` } },
  },
})
