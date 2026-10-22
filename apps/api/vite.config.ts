import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    noExternal: true
  },
  build: {
    target: 'esnext',
    ssr: 'src/main.ts',
    outDir: '../../dist/api',
    emptyOutDir: true,
    minify: 'oxc',
    sourcemap: false
  }
});
