import { createHash } from 'node:crypto'
import { defineConfig } from 'vitest/config'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'
import { publicConfiguration } from './src/services/supabaseConfig'
import project from './config/public-supabase.json'
import pushConfig from './config/public-push.json'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!publicConfiguration(project.url, project.publishableKey))
    throw new Error(
      'Projektkonfigurationen får endast innehålla offentlig Supabase-nyckel.',
    )
  if ((url || key) && !publicConfiguration(url, key))
    throw new Error(
      'Ogiltig Supabase-konfiguration: endast projekt-URL och publishable/anon-nyckel får byggas in i frontend.',
    )
  if (
    Object.keys(pushConfig).some((k) => k !== 'publicKey') ||
    (pushConfig.publicKey && !/^[A-Za-z0-9_-]{87}$/.test(pushConfig.publicKey))
  )
    throw new Error(
      'Push-konfigurationen får bara innehålla en publik VAPID-nyckel.',
    )
  const base = process.env.VITE_BASE_PATH || '/familjen/'
  return {
    base: process.env.VITE_BASE_PATH || '/familjen/',
    plugins: [
      vue(),
      {
        name: 'github-pages-entrypoints',
        writeBundle(options) {
          const output = resolve(options.dir || 'dist')
          mkdirSync(resolve(output, 'register'), { recursive: true })
          mkdirSync(resolve(output, 'recover'), { recursive: true })
          writeFileSync(
            resolve(output, 'register/index.html'),
            readFileSync(resolve(output, 'index.html')),
          )
          const recovery = readFileSync(
            'public/recovery.html',
            'utf8',
          ).replaceAll('__APP_BASE__', base)
          writeFileSync(resolve(output, 'recover/index.html'), recovery)
          writeFileSync(resolve(output, 'recovery.html'), recovery)
        },
      },
      VitePWA({
        registerType: 'prompt',
        scope: base,
        includeManifestIcons: true,
        includeAssets: ['icons/*.png'],
        manifest: {
          id: base,
          name: 'Familjen – vår vardag tillsammans',
          short_name: 'Familjen',
          lang: 'sv',
          description: 'Familjens gemensamma plats för vardagen',
          theme_color: '#111318',
          background_color: '#111318',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            {
              src: base + 'icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: base + 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: base + 'icons/maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          importScripts: [
            `push-sw.js?v=${createHash('sha256').update(readFileSync('public/push-sw.js')).digest('hex').slice(0, 12)}`,
          ],
          navigateFallback: base + 'index.html',
          navigateFallbackDenylist: [/\/recover(?:\/|$)/, /\/recovery\.html$/],
          cacheId: 'familjen',
          cleanupOutdatedCaches: true,
          clientsClaim: true,
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
