import { beforeEach, it, expect, vi } from 'vitest'
import {
  installAvailable,
  installBusy,
  installMessage,
  installPwa,
  type InstallPromptEvent,
} from './pwaInstall'
function offer(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', {
    cancelable: true,
  }) as InstallPromptEvent
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome })
  window.dispatchEvent(event)
  return event
}
beforeEach(() => {
  window.dispatchEvent(new Event('appinstalled'))
  installMessage.value = ''
})
it('offers installation only on a real browser event and requests once', async () => {
  expect(installAvailable.value).toBe(false)
  const event = offer()
  expect(event.defaultPrevented).toBe(true)
  expect(installAvailable.value).toBe(true)
  await installPwa()
  await installPwa()
  expect(event.prompt).toHaveBeenCalledTimes(1)
  expect(installAvailable.value).toBe(false)
  expect(installBusy.value).toBe(false)
  expect(installMessage.value).toContain('Installationsbegäran skickad')
})
it('distinguishes cancellation, browser-reported installation and actual launch verification', async () => {
  offer('dismissed')
  await installPwa()
  expect(installMessage.value).toContain('avbröts')
  window.dispatchEvent(new Event('appinstalled'))
  expect(installMessage.value).toContain(
    'Kontrollera att Familjen går att starta',
  )
})
it('does not touch auth or other local storage and reports prompt failure', async () => {
  localStorage.setItem('familjen.supabase.session', 'keep-session')
  localStorage.setItem('other-app', 'keep-other')
  const event = offer()
  vi.mocked(event.prompt).mockRejectedValue(new Error('Chrome error'))
  await installPwa()
  expect(installMessage.value).toContain('kunde inte visa')
  expect(localStorage.getItem('familjen.supabase.session')).toBe('keep-session')
  expect(localStorage.getItem('other-app')).toBe('keep-other')
})
