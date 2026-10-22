import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    noExternal: true
  },
  build: {
    target: 'esnext',
    ssr: 'src/main.ts',
    outDir: '../../dist/sse',
    emptyOutDir: true,
    minify: 'oxc',
    sourcemap: false
  }
});
