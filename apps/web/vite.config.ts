import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { portInt } from '@ugula/config';
import react from '@vitejs/plugin-react';
import * as v from 'valibot';
import { defineConfig, loadEnv } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, root, '');

  return {
    plugins: [react(), tailwindcss()],
    ...(command === 'serve'
      ? {
          server: {
            port: v.parse(portInt, env.WEB_PORT)
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
