import { defineConfig } from 'vite';

export default defineConfig({
  base: '/ZZ_Markdown_Editor/',

  publicDir: 'src',
  server: {
    host: '127.0.0.1',
    port: 5173
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
