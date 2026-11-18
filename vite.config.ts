/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// base: './' — відносні шляхи. Працює для https://USERNAME.github.io/REPOSITORY/
// з будь-якою назвою репозиторію. Можна задати явно через змінну BASE_PATH (наприклад, /inclusive-insight/).
const base = process.env.BASE_PATH || './';

export default defineConfig({
  base,
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Inclusive Insight',
        short_name: 'Inclusive Insight',
        description: 'Електронний журнал педагогічних спостережень для асистента вчителя',
        lang: 'uk',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#F6F9FD',
        theme_color: '#5B9BD5',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Кешуються лише статичні файли застосунку. IndexedDB не потрапляє в Cache Storage.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          dexie: ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
