import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { portInt, urlString } from '@ugula/config';
import react from '@vitejs/plugin-react';
import * as v from 'valibot';
import { defineConfig, loadEnv } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, root, '');
  const apiUrl = v.parse(urlString, env.API_URL);

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'api-url',
        transformIndexHtml: () => [
          { tag: 'meta', attrs: { name: 'api-url', content: apiUrl }, injectTo: 'head' }
        ]
      }
    ],
    ...(command === 'serve'
      ? {
          server: {
            port: v.parse(portInt, env.WEB_PORT),
            strictPort: true
          }
        }
      : {}),
    build: {
      target: 'esnext',
      outDir: fileURLToPath(new URL('../../dist/web', import.meta.url)),
      emptyOutDir: true,
      minify: 'oxc',
      cssMinify: 'lightningcss',
      sourcemap: false
    }
  };
});
