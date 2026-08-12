import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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
    plugins: [react()],
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
