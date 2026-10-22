import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    noExternal: true
  },
  build: {
    target: 'esnext',
    ssr: 'src/main.ts',
    outDir: '../../dist/worker',
    emptyOutDir: true,
    minify: 'oxc',
    sourcemap: false
  }
});
