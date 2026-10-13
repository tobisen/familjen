import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:4173/familjen/' },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command:
      'vite build --outDir dist-shell && vite preview --outDir dist-shell --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/familjen/',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_BASE_PATH: '/familjen/',
    },
  },
})
