import { beforeEach, it, expect, vi } from 'vitest'
const fake = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  setAuth: vi.fn(),
  signOut: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithOtp: vi.fn(),
  onAuthStateChange: vi.fn(),
  stop: vi.fn(),
  start: vi.fn(),
}))
vi.mock('../services/supabase', () => ({
  supabase: { auth: fake, rpc: fake.rpc, realtime: { setAuth: fake.setAuth } },
}))
vi.mock('./chat', () => ({ stopChat: vi.fn(), startChat: vi.fn() }))
vi.mock('./lists', () => ({ stopLists: vi.fn(), startLists: vi.fn() }))
vi.mock('./calendar', () => ({
  stopCalendar: fake.stop,
  startCalendar: fake.start,
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  history.replaceState(null, '', '/')
  fake.getSession.mockResolvedValue({
    data: { session: { access_token: 'test-session' } },
  })
  fake.getUser.mockResolvedValue({
    data: { user: { id: 'server-user' } },
    error: null,
  })
  fake.rpc.mockResolvedValue({
    data: {
      profile_key: 'neo',
      family_id: 'family',
      profile_id: 'server-profile',
      display_name: 'Neo',
    },
    error: null,
  })
  fake.setAuth.mockResolvedValue(undefined)
  fake.signOut.mockResolvedValue({ error: null })
})
it('restores identity from server, ignoring forged local profile', async () => {
  localStorage.setItem('familjen.profile', 'sally')
  const auth = await import('./auth')
  await auth.restoreIdentity()
  expect(auth.identity.value?.profile_key).toBe('neo')
  expect(auth.authStatus.value).toBe('ready')
  expect(fake.setAuth).toHaveBeenCalledWith('test-session')
  expect(fake.start).toHaveBeenCalledOnce()
})
it('denies unregistered authenticated users', async () => {
  fake.rpc.mockResolvedValue({ data: null, error: null })
  const auth = await import('./auth')
  await auth.restoreIdentity()
  expect(auth.authStatus.value).toBe('unregistered')
  expect(auth.identity.value).toBeNull()
  expect(fake.start).not.toHaveBeenCalled()
})
it('clears private state before asynchronous signout', async () => {
  const auth = await import('./auth')
  await auth.restoreIdentity()
  const p = auth.signOut()
  expect(auth.identity.value).toBeNull()
  expect(fake.stop).toHaveBeenCalled()
  await p
  expect(auth.authStatus.value).toBe('signedOut')
})
it('does not accept an identity response that arrives after logout', async () => {
  let resolve!: (value: unknown) => void
  fake.rpc.mockImplementation(() => new Promise((r) => (resolve = r)))
  const auth = await import('./auth')
  const p = auth.restoreIdentity()
  await vi.waitFor(() => expect(fake.rpc).toHaveBeenCalled())
  await auth.signOut()
  resolve({
    data: { profile_key: 'neo', family_id: 'family', profile_id: 'profile' },
    error: null,
  })
  await p
  expect(auth.identity.value).toBeNull()
  expect(fake.start).not.toHaveBeenCalled()
})
it('scrubs registration fragments before navigation and consumes token only on action', async () => {
  history.replaceState(
    null,
    '',
    '/#/registrera?token_hash=abcdefghijklmnopqrstuvwx&type=magiclink',
  )
  const auth = await import('./auth')
  expect(location.hash).toBe('#/')
  expect(auth.registration.value?.token_hash).toBe('abcdefghijklmnopqrstuvwx')
  expect(fake.verifyOtp).not.toHaveBeenCalled()
  fake.verifyOtp.mockResolvedValue({
    data: { session: { access_token: 'new-session' } },
    error: null,
  })
  await auth.registerDevice()
  expect(auth.registration.value).toBeNull()
  expect(fake.verifyOtp).toHaveBeenCalledOnce()
  expect(auth.identity.value?.profile_key).toBe('neo')
})
it('fails closed when the user cannot be verified', async () => {
  fake.getUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'invalid' },
  })
  const auth = await import('./auth')
  await auth.restoreIdentity()
  expect(auth.authStatus.value).toBe('error')
  expect(fake.start).not.toHaveBeenCalled()
})
