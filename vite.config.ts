import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { publicConfiguration } from './src/services/supabaseConfig'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY
  if ((url || key) && !publicConfiguration(url, key))
    throw new Error(
      'Ogiltig Supabase-konfiguration: endast projekt-URL och publishable/anon-nyckel får byggas in i frontend.',
    )
  return {
    base: process.env.VITE_BASE_PATH || '/familjen/',
    plugins: [
      vue(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icons/*.png'],
        manifest: {
          name: 'Familjen – vår vardag tillsammans',
          short_name: 'Familjen',
          lang: 'sv',
          description: 'Familjens gemensamma plats för vardagen',
          theme_color: '#204f46',
          background_color: '#f7f6f2',
          display: 'standalone',
          start_url: './',
          scope: './',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          runtimeCaching: [],
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes('/node_modules/@js-temporal/') ||
              id.includes('/node_modules/jsbi/')
            )
              return 'temporal'
            if (id.includes('/node_modules/@supabase/')) return 'supabase'
          },
        },
      },
    },
    test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
  }
})
