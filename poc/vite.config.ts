import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * OPENAI_API_KEY (and optionally OPENAI_MODEL / OPENAI_REASONING_EFFORT / OPENAI_BASE_URL) come from poc/.env — see .env.example.
 * The key never reaches the browser: the dev server proxies /api/openai/* and adds the Authorization header.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const key = env.OPENAI_API_KEY ?? '';
  const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api/openai': {
          target: base,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/openai/, ''),
          headers: key ? { Authorization: `Bearer ${key}` } : {},
        },
      },
    },
    define: {
      __AI__: JSON.stringify({ configured: !!key, model: env.OPENAI_MODEL || 'gpt-4.1-mini', effort: env.OPENAI_REASONING_EFFORT || '' }),
    },
  };
});
