import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/calendar-e2e',
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4174/familjen/', serviceWorkers: 'block' },
  projects: [
    { name: 'calendar-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'calendar-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command:
      'vite build --outDir dist-e2e && vite preview --outDir dist-e2e --port 4174 --host 127.0.0.1',
    url: 'http://127.0.0.1:4174/familjen/',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'https://familjen.test.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only',
      VITE_BASE_PATH: '/familjen/',
    },
  },
})
