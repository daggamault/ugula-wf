import tailwindcss from '@tailwindcss/vite';
import { portInt } from '@ugula/config';
import react from '@vitejs/plugin-react';
import * as v from 'valibot';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '../..', '');

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
      outDir: '../../dist/web',
      emptyOutDir: true,
      minify: 'oxc',
      cssMinify: 'lightningcss',
      sourcemap: false
    }
  };
});
