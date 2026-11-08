import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Two ways to run:
 *  - `bun run app`  — the desktop app (Tauri). AI calls go through Rust; the key is in the OS keychain.
 *  - `bun run dev`  — the same UI in a browser. Data in localStorage; AI via this dev server's proxy,
 *                     which adds OPENAI_API_KEY from app/.env so the key never reaches the page.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const key = env.OPENAI_API_KEY ?? '';
  const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: 5174,
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**'] },
      proxy: {
        '/api/openai': {
          target: base,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/openai/, ''),
          headers: key ? { Authorization: `Bearer ${key}` } : {},
        },
      },
    },
    // browser mode only: what the dev proxy is configured with (the desktop app asks Rust at runtime)
    define: {
      __WEB_AI__: JSON.stringify({ configured: !!key, model: env.OPENAI_MODEL || 'gpt-4.1-mini', effort: env.OPENAI_REASONING_EFFORT || '' }),
    },
    build: {
      target: 'es2022',
      rollupOptions: { input: { main: resolve(__dirname, 'index.html'), capture: resolve(__dirname, 'capture.html'), popup: resolve(__dirname, 'popup.html') } },
    },
  };
});
