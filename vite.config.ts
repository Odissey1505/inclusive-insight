/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// base: './' — відносні шляхи. Працює для https://USERNAME.github.io/REPOSITORY/
// з будь-якою назвою репозиторію. Можна задати явно через змінну BASE_PATH (наприклад, /inclusive-insight/).
const base = process.env.BASE_PATH || './';

/** Refuse to build if a secret / service_role key was put into the frontend env. */
function assertNoSecretKey(mode: string) {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith('VITE_') || !v) continue;
    let serviceRole = false;
    const parts = v.split('.');
    if (parts.length === 3) {
      try {
        serviceRole = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role === 'service_role';
      } catch {
        /* not a JWT */
      }
    }
    if (/^sb_secret_/i.test(v) || serviceRole) {
      throw new Error(`${k} містить секретний (service_role / sb_secret_) ключ Supabase. У frontend дозволено лише publishable (anon) ключ.`);
    }
  }
}

export default defineConfig(({ mode }) => {
  assertNoSecretKey(mode);
  return {
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
};
});
