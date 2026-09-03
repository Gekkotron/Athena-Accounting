import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// VITE_DEMO=1 enables the browser-only demo build: output goes to
// dist-demo/ so the real dist/ is never overwritten, and the demo API
// adapter is tree-shaken into the bundle (see src/api/client.ts).

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', ['VITE_']);
  const viteDemo = env.VITE_DEMO ?? '';
  const isDemo = viteDemo === '1';
  // When VITE_DEMO=1 we're building for gh-pages under /Athena-Accounting/demo/.
  // A build-time base override lets local previews still use '/'.
  const demoBase = env.VITE_DEMO_BASE ?? '/Athena-Accounting/demo/';
  return {
    plugins: [
      react(),
      // PWA plumbing — manifest + service worker for install-to-home-screen.
      // Skipped in demo builds: the demo lives on gh-pages and has no
      // long-lived origin identity worth installing. Precache is app-shell
      // only; /api/* is explicitly ignored so live data never gets cached
      // (auth cookies + freshness matter more than offline reads here).
      !isDemo && VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['owl-logo.png', 'owl-192.png', 'owl-512.png'],
        manifest: {
          name: 'Athena Accounting',
          short_name: 'Athena',
          description: 'Personal accounting — self-hosted, LAN-friendly.',
          theme_color: '#0b0d11',
          background_color: '#0b0d11',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          lang: 'fr',
          icons: [
            { src: '/owl-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/owl-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/owl-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          // Precache the app shell. Route-level chunks are still fetched
          // on-demand; the SW just serves cached copies when the network
          // is slow or absent. Every /api/* and /events/* request always
          // hits the network so cookie auth + SSE stay correct.
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/events\//],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          runtimeCaching: [],
        },
      }),
    ].filter(Boolean),
    base: isDemo ? demoBase : '/',
    define: {
      'import.meta.env.VITE_DEMO': JSON.stringify(viteDemo),
    },
    build: {
      outDir: isDemo ? 'dist-demo' : 'dist',
      // Split hot vendor deps out of the main entry so the browser can cache
      // them independently of app code. React updates rarely; app routes ship
      // every release. Route-level chunks are already produced automatically
      // by the dynamic imports in App.tsx — this only touches node_modules.
      rollupOptions: {
        output: {
          // Function form (not object) so we grab whole node_modules subtrees,
          // not just the entry re-exports. Object form left the real react
          // runtime bundled into the main index chunk.
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
              return 'react-vendor';
            }
            if (id.includes('react-router')) return 'router';
            if (id.includes('@tanstack/react-query')) return 'query';
            if (id.includes('@dnd-kit')) return 'dnd';
            if (id.includes('@floating-ui')) return 'floating';
            if (
              id.includes('/i18next') ||
              id.includes('react-i18next') ||
              id.includes('i18next-browser-languagedetector')
            ) return 'i18n';
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:8001',
          changeOrigin: true,
        },
      },
    },
  };
});
