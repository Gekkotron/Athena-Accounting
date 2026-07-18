import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_DEMO=1 enables the browser-only demo build: output goes to
// dist-demo/ so the real dist/ is never overwritten, and the demo API
// adapter is tree-shaken into the bundle (see src/api/client.ts).

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', ['VITE_']);
  const viteDemo = env.VITE_DEMO ?? '';
  const isDemo = viteDemo === '1';
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_DEMO': JSON.stringify(viteDemo),
    },
    build: {
      outDir: isDemo ? 'dist-demo' : 'dist',
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
