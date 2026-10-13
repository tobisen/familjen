import { expect, it } from 'vitest'
import { isAppCache } from './pwaRecovery'
it('targets only Familjen caches, including the old Workbox name', () => {
  const scope = 'https://tobisen.github.io/familjen/'
  expect(isAppCache('familjen-precache-v2-' + scope, scope)).toBe(true)
  expect(isAppCache('workbox-precache-v2-' + scope, scope)).toBe(true)
  expect(
    isAppCache(
      'workbox-precache-v2-https://tobisen.github.io/vinskapet/',
      scope,
    ),
  ).toBe(false)
  expect(isAppCache('another-app-session', scope)).toBe(false)
})
