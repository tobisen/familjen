import { it, expect } from 'vitest'
import history from '../../tests/fixtures/pwa-identity-history.json'
it.each(history)(
  'preserves the effective identity and scope from $commit',
  (manifest) => {
    const start = new URL(manifest.start_url, manifest.manifestUrl)
    const identity = new URL(manifest.id || start.href, start)
    expect(identity.href).toBe('https://tobisen.github.io/familjen/')
    expect(start.href).toBe(identity.href)
    expect(new URL(manifest.scope, manifest.manifestUrl).href).toBe(
      identity.href,
    )
  },
)
