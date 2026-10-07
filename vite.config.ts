import { defineConfig } from 'vite';
export default defineConfig({
  root: 'apps/client',
  base: process.env.GITHUB_ACTIONS ? '/BombRush/' : '/',
  publicDir: '../../assets',
  envDir:'../..',
  server: {
    port: 5173,
    proxy: {
      '/matchmake': 'http://127.0.0.1:2567',
      '/rooms': 'http://127.0.0.1:2567',
    },
  },
  build: { outDir: '../../dist/client', emptyOutDir: true },
});
