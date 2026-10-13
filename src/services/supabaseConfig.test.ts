import { it, expect } from 'vitest'
import { publicConfiguration } from './supabaseConfig'
const jwt = (role: string) =>
  `eyJ.fake.${role}`.replace('fake', btoa(JSON.stringify({ role })))
it('accepts public keys only', () => {
  expect(
    publicConfiguration('https://example.supabase.co', 'sb_publishable_test'),
  ).toBe(true)
  expect(publicConfiguration('https://example.supabase.co', jwt('anon'))).toBe(
    true,
  )
  for (const key of [
    'sb_secret_private',
    jwt('service_role'),
    jwt('authenticated'),
    'garbage',
    '',
  ])
    expect(publicConfiguration('https://example.supabase.co', key)).toBe(false)
})
it('rejects malformed URLs and credentials', () => {
  for (const url of [
    'not-url',
    'ftp://example.com',
    'https://user:pass@example.com',
    'http://example.com',
  ])
    expect(publicConfiguration(url, 'sb_publishable_test')).toBe(false)
})
